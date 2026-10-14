// Feature store: join point-in-time vs. "último valor", e um experimento que
// mostra o efeito do vazamento no AUC offline versus produção.
// Sem dependência de Three.js.

export const NOW = 60; // dia em que o dataset de treino é extraído

export interface FeatureEvent {
  day: number;
  value: number;
}

export interface Customer {
  id: string;
  churned: boolean;
  labelDay: number; // quando o rótulo (churn / ficou) é observado
  events: FeatureEvent[]; // purchases_30d ao longo do tempo
}

// Quatro clientes desenhados à mão para a linha do tempo.
export function sampleCustomers(): Customer[] {
  const ev = (pairs: [number, number][]) => pairs.map(([day, value]) => ({ day, value }));
  return [
    { id: 'C-101', churned: true, labelDay: 38, events: ev([[2, 14], [9, 12], [17, 11], [24, 8], [31, 6], [36, 4], [44, 0], [52, 0]]) },
    { id: 'C-102', churned: false, labelDay: 40, events: ev([[3, 9], [10, 10], [18, 11], [27, 10], [35, 12], [46, 13], [55, 12]]) },
    { id: 'C-103', churned: true, labelDay: 30, events: ev([[5, 7], [14, 5], [22, 3], [27, 2], [37, 0], [49, 0]]) },
    { id: 'C-104', churned: false, labelDay: 45, events: ev([[1, 4], [8, 6], [20, 5], [50, 7]]) },
  ];
}

export type Strategy = 'pit' | 'latest';
export type JoinStatus = 'ok' | 'leak' | 'stale';

export interface JoinResult {
  event: FeatureEvent | null; // o valor que entra na linha de treino (null = ausente)
  candidate: FeatureEvent | null; // o evento considerado, mesmo se descartado por TTL
  status: JoinStatus;
}

// O coração da feature store: qual valor da feature pertence a este rótulo?
export function join(c: Customer, strategy: Strategy, ttlDays: number): JoinResult {
  if (strategy === 'latest') {
    // Ingênuo: pega o valor mais recente no momento da extração, ignorando quando o rótulo aconteceu.
    const e = [...c.events].filter((x) => x.day <= NOW).sort((a, b) => b.day - a.day)[0] ?? null;
    return { event: e, candidate: e, status: e && e.day >= c.labelDay ? 'leak' : 'ok' };
  }
  // Point-in-time: o valor mais recente ESTRITAMENTE antes do rótulo, e não mais velho que o TTL.
  const e = [...c.events].filter((x) => x.day < c.labelDay).sort((a, b) => b.day - a.day)[0] ?? null;
  if (e && c.labelDay - e.day > ttlDays) return { event: null, candidate: e, status: 'stale' };
  return { event: e, candidate: e, status: 'ok' };
}

// ---------- Experimento ----------

let seed = 7;
const rand = () => {
  // mulberry32: determinístico, para o resultado ser reproduzível
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const randn = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const poisson = (l: number) => {
  let k = 0;
  let p = Math.exp(-l);
  let s = p;
  const u = rand();
  while (u > s && k < 200) {
    k++;
    p *= l / k;
    s += p;
  }
  return k;
};
const expo = (mean: number) => -Math.log(1 - rand()) * mean;
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

interface Row {
  y: number;
  pit: number[]; // features como eram no momento do rótulo
  latest: number[]; // features como estão no dia da extração (depois do rótulo)
}

// purchases_30d, support_tickets_30d, days_since_last_login
export const EXP_FEATURES = ['purchases_30d', 'support_tickets_30d', 'days_since_last_login'];

function makeDataset(n: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const engagement = randn();
    const y = rand() < sigmoid(-0.7 - 1.1 * engagement + 0.5 * randn()) ? 1 : 0;
    const labelDay = 20 + rand() * 30;
    // Antes do rótulo: chamados de suporte são o sinal mais forte de churn.
    const tickets = poisson(Math.exp(-0.2 - 0.6 * engagement + 0.9 * y));
    const pit = [poisson(Math.exp(1.6 + 0.3 * engagement)), tickets, expo(Math.exp(1.1 - 0.4 * engagement))];
    // Depois do churn tudo fica em silêncio: compras e chamados zeram, o último login envelhece.
    const latest = y
      ? [rand() < 0.88 ? 0 : poisson(1), rand() < 0.55 ? 0 : poisson(1.2), NOW - labelDay + expo(4)]
      : [poisson(Math.exp(1.6 + 0.3 * engagement)), poisson(Math.exp(-0.2 - 0.6 * engagement)), expo(Math.exp(1.1 - 0.4 * engagement))];
    rows.push({ y, pit, latest });
  }
  return rows;
}

// Regressão logística com gradiente descendente em lote, features padronizadas.
function trainLogReg(X: number[][], y: number[], iters = 400, lr = 0.3) {
  const d = X[0].length;
  const mu = Array.from({ length: d }, (_, j) => X.reduce((s, x) => s + x[j], 0) / X.length);
  const sd = Array.from({ length: d }, (_, j) => Math.sqrt(X.reduce((s, x) => s + (x[j] - mu[j]) ** 2, 0) / X.length) || 1);
  const Z = X.map((x) => x.map((v, j) => (v - mu[j]) / sd[j]));
  const w = new Array(d).fill(0);
  let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < Z.length; i++) {
      const err = sigmoid(b + Z[i].reduce((s, v, j) => s + v * w[j], 0)) - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * Z[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= (lr * gw[j]) / Z.length;
    b -= (lr * gb) / Z.length;
  }
  return (x: number[]) => sigmoid(b + x.reduce((s, v, j) => s + ((v - mu[j]) / sd[j]) * w[j], 0));
}

// AUC pela estatística de Mann–Whitney (com empates contando meio).
export function auc(scores: number[], y: number[]) {
  const idx = scores.map((s, i) => [s, y[i]] as const).sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  let pos = 0;
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j < idx.length && idx[j][0] === idx[i][0]) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (idx[k][1]) (rankSum += avgRank), pos++;
    i = j;
  }
  const neg = idx.length - pos;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

export interface ExperimentResult {
  n: number;
  ms: number;
  pit: { offline: number; production: number };
  latest: { offline: number; production: number };
}

export function runExperiment(n = 4000, runSeed = 7): ExperimentResult {
  seed = runSeed;
  const t0 = performance.now();
  const rows = makeDataset(n);
  const cut = Math.floor(n * 0.7);
  const train = rows.slice(0, cut);
  const test = rows.slice(cut);
  const yTr = train.map((r) => r.y);
  const yTe = test.map((r) => r.y);
  const result = {} as ExperimentResult;
  for (const s of ['pit', 'latest'] as const) {
    const model = trainLogReg(train.map((r) => r[s]), yTr);
    // Offline: validação com features montadas pela mesma estratégia do treino.
    const offline = auc(test.map((r) => model(r[s])), yTe);
    // Produção: na hora de prever, só existe o passado, ou seja, as features point-in-time.
    const production = auc(test.map((r) => model(r.pit)), yTe);
    result[s] = { offline, production };
  }
  result.n = n;
  result.ms = Math.round(performance.now() - t0);
  return result;
}
