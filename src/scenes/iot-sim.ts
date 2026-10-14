// Manutenção preditiva: sinal de vibração sintético, FFT, features espectrais,
// Isolation Forest e a máquina que degrada ao longo dos dias.
// Sem dependência de Three.js.

export const FS = 5120; // Hz, taxa de amostragem do acelerômetro
export const N = 512; // amostras por janela (0,1 s)
export const SHAFT_HZ = 1480 / 60; // motor de 4 polos a 1480 rpm
export const BPFO = 3.58 * SHAFT_HZ; // frequência de defeito na pista externa do rolamento
export const RESONANCE_HZ = 2300; // ressonância estrutural excitada pelos impactos
export const TTF_DAYS = 21; // dias entre o início do defeito e a falha

export type Fault = 'bearing' | 'imbalance' | 'overheat';

const randn = () => {
  let u = 0;
  while (!u) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
};

// FFT radix-2 in-place (Cooley–Tukey iterativa).
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

export interface Severity {
  bearing: number;
  imbalance: number;
  overheat: number;
}

// Uma janela de 0,1 s de aceleração (em g) e a temperatura do mancal.
export function makeWindow(sev: Severity) {
  const x = new Float64Array(N);
  const f1 = SHAFT_HZ * (1 + randn() * 0.002);
  const p1 = Math.random() * 6.28;
  const p2 = Math.random() * 6.28;
  const p9 = Math.random() * 6.28;
  const a1 = 0.5 * (1 + 0.04 * randn()) + 1.6 * sev.imbalance;
  for (let n = 0; n < N; n++) {
    const t = n / FS;
    x[n] =
      a1 * Math.sin(2 * Math.PI * f1 * t + p1) +
      0.15 * Math.sin(2 * Math.PI * 2 * f1 * t + p2) +
      0.08 * Math.sin(2 * Math.PI * 9 * f1 * t + p9) +
      0.12 * randn();
  }
  // Defeito no rolamento: um impacto a cada passagem de esfera, que faz a
  // estrutura "tocar" na ressonância e decair rápido.
  if (sev.bearing > 0) {
    const T = 1 / BPFO;
    for (let tk = Math.random() * T; tk < N / FS; tk += T * (1 + randn() * 0.01)) {
      const amp = 2.6 * sev.bearing * (0.7 + Math.random() * 0.6);
      const n0 = Math.floor(tk * FS);
      for (let n = n0; n < Math.min(N, n0 + 48); n++) {
        const dt = n / FS - tk;
        x[n] += amp * Math.exp(-dt / 0.0011) * Math.sin(2 * Math.PI * RESONANCE_HZ * dt);
      }
    }
  }
  const temp = 52 + randn() * 0.6 + 22 * sev.overheat + 7 * sev.bearing + 3 * sev.imbalance;
  return { signal: x, temp };
}

export const FEATURE_NAMES = ['rms', 'kurtosis', 'crest', 'band_low', 'band_mid', 'band_high', 'temp'] as const;

// Features por janela: estatísticas no tempo e energia por banda no espectro.
export function extract(signal: Float64Array, temp: number) {
  let mean = 0;
  for (const v of signal) mean += v;
  mean /= N;
  let m2 = 0;
  let m4 = 0;
  let peak = 0;
  for (const v of signal) {
    const d = v - mean;
    m2 += d * d;
    m4 += d ** 4;
    peak = Math.max(peak, Math.abs(d));
  }
  m2 /= N;
  m4 /= N;
  const rms = Math.sqrt(m2);
  const kurtosis = m4 / (m2 * m2);
  const crest = peak / rms;

  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let n = 0; n < N; n++) re[n] = (signal[n] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1)));
  fft(re, im);
  const spectrum = new Float64Array(N / 2);
  const band = [0, 0, 0];
  for (let k = 1; k < N / 2; k++) {
    const mag = (2 * Math.hypot(re[k], im[k])) / (N * 0.5);
    spectrum[k] = mag;
    const f = (k * FS) / N;
    band[f < 200 ? 0 : f < 1000 ? 1 : 2] += mag * mag;
  }
  const features = [rms, kurtosis, crest, Math.sqrt(band[0]), Math.sqrt(band[1]), Math.sqrt(band[2]), temp];
  return { features, spectrum, rms, kurtosis, temp };
}

// ---------- Isolation Forest (Liu, Ting & Zhou, 2008) ----------

type Node = { leaf: true; size: number } | { leaf: false; f: number; split: number; l: Node; r: Node };

// Comprimento médio de um caminho de busca malsucedido numa BST com n nós.
const c = (n: number) => (n <= 1 ? 0 : n === 2 ? 1 : 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n);

export class IsolationForest {
  private trees: Node[] = [];
  private psi = 0;
  private nTrees: number;
  private sampleSize: number;

  constructor(nTrees = 100, sampleSize = 128) {
    this.nTrees = nTrees;
    this.sampleSize = sampleSize;
  }

  fit(X: number[][]) {
    this.psi = Math.min(this.sampleSize, X.length);
    const maxDepth = Math.ceil(Math.log2(this.psi));
    this.trees = [];
    for (let t = 0; t < this.nTrees; t++) {
      const sample: number[][] = [];
      for (let i = 0; i < this.psi; i++) sample.push(X[Math.floor(Math.random() * X.length)]);
      this.trees.push(this.build(sample, 0, maxDepth));
    }
    return this;
  }

  private build(X: number[][], depth: number, maxDepth: number): Node {
    if (depth >= maxDepth || X.length <= 1) return { leaf: true, size: X.length };
    const d = X[0].length;
    // Escolhe uma feature que ainda varia neste nó.
    for (let attempt = 0; attempt < d; attempt++) {
      const f = Math.floor(Math.random() * d);
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of X) {
        lo = Math.min(lo, x[f]);
        hi = Math.max(hi, x[f]);
      }
      if (hi <= lo) continue;
      const split = lo + Math.random() * (hi - lo);
      const L = X.filter((x) => x[f] < split);
      const R = X.filter((x) => x[f] >= split);
      return { leaf: false, f, split, l: this.build(L, depth + 1, maxDepth), r: this.build(R, depth + 1, maxDepth) };
    }
    return { leaf: true, size: X.length };
  }

  private pathLength(x: number[], node: Node, depth: number): number {
    if (node.leaf) return depth + c(node.size);
    return this.pathLength(x, x[node.f] < node.split ? node.l : node.r, depth + 1);
  }

  // Score em [0, 1]: perto de 1 = fácil de isolar = anômalo; ~0,5 ou menos = normal.
  score(x: number[]) {
    let sum = 0;
    for (const t of this.trees) sum += this.pathLength(x, t, 0);
    return Math.pow(2, -sum / this.trees.length / c(this.psi));
  }
}

// ---------- A máquina ----------

export interface Reading {
  day: number;
  signal: Float64Array;
  spectrum: Float64Array;
  rms: number;
  kurtosis: number;
  temp: number;
  raw: number; // score bruto do Isolation Forest
  smooth: number; // score suavizado (EWMA)
}

export interface Events {
  faultDay: number | null;
  alertDay: number | null; // primeiro alerta do Isolation Forest
  rmsAlarmDay: number | null; // primeiro alarme clássico por RMS
  failureDay: number | null;
  falseAlarms: number;
}

export class Machine {
  day = 0;
  daysPerSecond = 0.5;
  windowsPerDay = 4; // uma janela a cada 6 h de tempo simulado
  fault: Fault | null = null;
  failed = false;
  forest = new IsolationForest(100, 128);
  baselineRms = 0;
  autoThreshold = 0.6;
  threshold = 0.6;
  rmsAlarmFactor = 1.4; // alarme clássico: RMS 40% acima do normal
  events: Events = { faultDay: null, alertDay: null, rmsAlarmDay: null, failureDay: null, falseAlarms: 0 };
  last: Reading | null = null;
  private smooth = 0;
  private above = 0;
  private inAlert = false;
  private acc = 0;

  // Treina com janelas de operação normal: o modelo só aprende o que é "normal".
  train(n = 400) {
    const X: number[][] = [];
    let rmsSum = 0;
    for (let i = 0; i < n; i++) {
      const { signal, temp } = makeWindow({ bearing: 0, imbalance: 0, overheat: 0 });
      const e = extract(signal, temp);
      X.push(e.features);
      rmsSum += e.rms;
    }
    this.forest.fit(X);
    this.baselineRms = rmsSum / n;
    // Limiar automático: percentil 99,5 dos scores suavizados em operação normal.
    let s = 0;
    const smoothed = X.map((x, i) => (s = i ? 0.3 * this.forest.score(x) + 0.7 * s : this.forest.score(x)));
    smoothed.sort((a, b) => a - b);
    this.autoThreshold = this.threshold = Math.round(smoothed[Math.floor(0.995 * smoothed.length)] * 100 + 2) / 100;
    this.smooth = smoothed[Math.floor(smoothed.length / 2)];
  }

  severity(): Severity {
    const s = { bearing: 0, imbalance: 0, overheat: 0 };
    if (!this.fault || this.events.faultDay === null) return s;
    const p = Math.min(1, Math.max(0, (this.day - this.events.faultDay) / TTF_DAYS));
    // Degradação lenta no começo, acelerando no fim (curva exponencial).
    s[this.fault] = (Math.exp(3.2 * p) - 1) / (Math.exp(3.2) - 1);
    return s;
  }

  inject(f: Fault) {
    if (this.fault || this.failed) return;
    this.fault = f;
    this.events.faultDay = this.day;
  }

  reset() {
    this.day = 0;
    this.fault = null;
    this.failed = false;
    this.events = { faultDay: null, alertDay: null, rmsAlarmDay: null, failureDay: null, falseAlarms: 0 };
    this.inAlert = false;
    this.above = 0;
    this.last = null;
  }

  // Avança o relógio; devolve as leituras novas (uma por janela).
  step(dt: number): Reading[] {
    if (this.failed) return [];
    this.acc += dt * this.daysPerSecond * this.windowsPerDay;
    const out: Reading[] = [];
    while (this.acc >= 1) {
      this.acc -= 1;
      this.day += 1 / this.windowsPerDay;
      out.push(this.read());
      if (this.failed) break;
    }
    return out;
  }

  private read(): Reading {
    const { signal, temp } = makeWindow(this.severity());
    const e = extract(signal, temp);
    const raw = this.forest.score(e.features);
    this.smooth = 0.3 * raw + 0.7 * this.smooth;

    // Alerta exige 2 janelas seguidas acima do limiar (evita ruído pontual).
    this.above = this.smooth > this.threshold ? this.above + 1 : 0;
    if (this.above >= 2 && !this.inAlert) {
      this.inAlert = true;
      if (this.fault && this.events.alertDay === null) this.events.alertDay = this.day;
      else if (!this.fault) this.events.falseAlarms++;
    }
    if (this.above === 0 && !this.fault) this.inAlert = false;
    if (this.fault && this.events.rmsAlarmDay === null && e.rms > this.baselineRms * this.rmsAlarmFactor) {
      this.events.rmsAlarmDay = this.day;
    }
    // O sobreaquecimento não mexe no RMS; para ele o alarme clássico é por temperatura.
    if (this.fault === 'overheat' && this.events.rmsAlarmDay === null && temp > 70) this.events.rmsAlarmDay = this.day;
    if (this.fault && this.events.faultDay !== null && this.day - this.events.faultDay >= TTF_DAYS) {
      this.failed = true;
      this.events.failureDay = this.day;
    }
    this.last = { day: this.day, signal, spectrum: e.spectrum, rms: e.rms, kurtosis: e.kurtosis, temp, raw, smooth: this.smooth };
    return this.last;
  }

  get alerting() {
    return this.inAlert;
  }
}
