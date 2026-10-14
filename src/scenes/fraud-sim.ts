// Simulação do pipeline de fraude: geração de transações, features,
// score do modelo e modelo de latência. Sem dependência de Three.js,
// para poder ser testada e reaproveitada.

export interface Tx {
  id: number;
  card: number;
  partition: number;
  amount: number;
  z: number; // z-score do valor contra o histórico do cartão
  velocity: number; // transações do cartão nos últimos 60 s
  distanceKm: number; // distância da última localização
  merchantRisk: number; // 0..1
  isFraud: boolean;
  attack: boolean;
  score: number;
  blocked: boolean;
  latency: { ingest: number; queue: number; flink: number; redis: number; model: number; total: number };
}

// Pesos do score logístico da demo (no lugar do XGBoost).
export const WEIGHTS = { bias: -5, z: 0.8, velocity: 0.7, distance: 2.6, merchantRisk: 2.5 };

export const CAPACITY_PER_WORKER = 2500; // tx/s que cada slot do Flink processa

let nextId = 1;

const randn = () => {
  let u = 0;
  while (!u) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
};
const expo = (mean: number) => -Math.log(1 - Math.random()) * mean;
const poisson = (lambda: number) => {
  let k = 0;
  let p = Math.exp(-lambda);
  let s = p;
  const u = Math.random();
  while (u > s && k < 50) {
    k++;
    p *= lambda / k;
    s += p;
  }
  return k;
};
const logn = (median: number, sigma: number) => median * Math.exp(sigma * randn());

export function contributions(tx: Pick<Tx, 'z' | 'velocity' | 'distanceKm' | 'merchantRisk'>) {
  return {
    z: WEIGHTS.z * tx.z,
    velocity: WEIGHTS.velocity * Math.min(tx.velocity, 8),
    distance: WEIGHTS.distance * (Math.log1p(tx.distanceKm) / Math.log1p(1000)),
    merchantRisk: WEIGHTS.merchantRisk * tx.merchantRisk,
  };
}

export function score(tx: Pick<Tx, 'z' | 'velocity' | 'distanceKm' | 'merchantRisk'>) {
  const c = contributions(tx);
  const logit = WEIGHTS.bias + c.z + c.velocity + c.distance + c.merchantRisk;
  return 1 / (1 + Math.exp(-logit));
}

export interface SimParams {
  tps: number;
  fraudRate: number; // 0..1
  threshold: number; // 0..1
  parallelism: number;
}

export class FraudSim {
  params: SimParams = { tps: 3000, fraudRate: 0.01, threshold: 0.5, parallelism: 4 };
  backlog = 0; // mensagens acumuladas no tópico quando a vazão excede a capacidade
  attackLeft = 0; // segundos restantes do ataque de card testing
  attackCount = 0;
  attackCard = 0;

  // Matriz de confusão em baldes de 1 s; as métricas usam os últimos 10 s.
  private buckets: { tp: number; fp: number; fn: number; tn: number }[] = [];
  private bucketAge = 0;
  // Amostras de latência recentes.
  private lat: number[] = [];

  get capacity() {
    return this.params.parallelism * CAPACITY_PER_WORKER;
  }
  get utilization() {
    return this.params.tps / this.capacity;
  }

  private queueMs() {
    const rho = Math.min(this.utilization, 0.985);
    const service = 1000 / CAPACITY_PER_WORKER; // ms por mensagem num slot
    const backlogMs = (this.backlog / this.capacity) * 1000;
    return expo((service * rho) / (1 - rho)) * 1.6 + backlogMs;
  }

  makeTx(attack = false): Tx {
    const fraud = attack || Math.random() < this.params.fraudRate;
    const card = attack ? this.attackCard : Math.floor(Math.random() * 1e6);
    let z: number, velocity: number, distanceKm: number, merchantRisk: number;
    if (attack) {
      // Card testing: valores pequenos, mesmo cartão, velocidade subindo.
      this.attackCount++;
      z = -1.5 + randn() * 0.3;
      velocity = Math.min(this.attackCount, 40);
      distanceKm = expo(5);
      merchantRisk = 0.35 + Math.random() * 0.3;
    } else if (fraud) {
      z = 1.6 + randn() * 1.1;
      velocity = poisson(3);
      distanceKm = Math.random() < 0.5 ? expo(400) : expo(10);
      merchantRisk = 0.3 + Math.random() * 0.7;
    } else {
      z = randn();
      velocity = poisson(0.6);
      distanceKm = expo(8);
      merchantRisk = Math.random() * 0.4;
    }
    const amount = Math.max(0.5, Math.exp(3.5 + 0.9 * z));
    const tx = { z, velocity, distanceKm, merchantRisk };
    const s = score(tx);
    const latency = {
      ingest: logn(1.1, 0.35),
      queue: this.queueMs(),
      flink: logn(2.2, 0.35),
      redis: logn(0.5, 0.4),
      model: logn(1.3, 0.3),
      total: 0,
    };
    latency.total = latency.ingest + latency.queue + latency.flink + latency.redis + latency.model;
    return {
      id: nextId++,
      card,
      partition: card % 3,
      amount: attack ? 1 + Math.random() * 4 : amount,
      ...tx,
      isFraud: fraud,
      attack,
      score: s,
      blocked: s > this.params.threshold,
      latency,
    };
  }

  startAttack() {
    this.attackLeft = 8;
    this.attackCount = 0;
    this.attackCard = Math.floor(Math.random() * 1e6);
  }

  // Avança a simulação completa (todas as transações, não só as desenhadas).
  step(dt: number) {
    const { tps } = this.params;
    const cap = this.capacity;
    this.backlog = Math.max(0, Math.min(this.backlog + (tps - cap) * dt, cap * 6));

    if (!this.buckets.length) this.buckets.push({ tp: 0, fp: 0, fn: 0, tn: 0 });
    this.bucketAge += dt;
    if (this.bucketAge >= 1) {
      this.bucketAge = 0;
      this.buckets.push({ tp: 0, fp: 0, fn: 0, tn: 0 });
      if (this.buckets.length > 10) this.buckets.shift();
    }
    const b = this.buckets[this.buckets.length - 1];

    // Para manter o custo baixo, calcula em detalhe até 400 tx por quadro
    // e escala a contagem para a vazão real.
    const n = tps * dt;
    const sampled = Math.min(400, Math.max(1, Math.round(n)));
    const weight = n / sampled;
    for (let i = 0; i < sampled; i++) {
      const tx = this.makeTx();
      this.record(b, tx, weight);
      if (i < 60) this.pushLatency(tx.latency.total);
    }
    const attacks: Tx[] = [];
    if (this.attackLeft > 0) {
      this.attackLeft -= dt;
      const k = poisson(6 * dt);
      for (let i = 0; i < k; i++) {
        const tx = this.makeTx(true);
        this.record(b, tx, 1);
        attacks.push(tx);
      }
    }
    return attacks;
  }

  private record(b: { tp: number; fp: number; fn: number; tn: number }, tx: Tx, w: number) {
    if (tx.isFraud && tx.blocked) b.tp += w;
    else if (!tx.isFraud && tx.blocked) b.fp += w;
    else if (tx.isFraud) b.fn += w;
    else b.tn += w;
  }

  private pushLatency(ms: number) {
    this.lat.push(ms);
    if (this.lat.length > 3000) this.lat.splice(0, this.lat.length - 3000);
  }

  metrics() {
    const sum = this.buckets.reduce(
      (a, b) => ({ tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn, tn: a.tn + b.tn }),
      { tp: 0, fp: 0, fn: 0, tn: 0 },
    );
    const sorted = [...this.lat].sort((a, b) => a - b);
    const q = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
    return {
      ...sum,
      precision: sum.tp + sum.fp ? sum.tp / (sum.tp + sum.fp) : NaN,
      recall: sum.tp + sum.fn ? sum.tp / (sum.tp + sum.fn) : NaN,
      falseBlockRate: sum.fp + sum.tn ? sum.fp / (sum.fp + sum.tn) : NaN,
      p50: q(0.5),
      p99: q(0.99),
      utilization: this.utilization,
      backlog: this.backlog,
    };
  }
}
