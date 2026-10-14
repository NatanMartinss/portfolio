// RAG com governança: índice TF-IDF, filtro de ACL, projeção PCA em 3D,
// gateway (rate limit + cache), guarda de entrada (prompt injection),
// resposta extrativa e guarda de saída (PII + aderência às fontes).
// Sem dependência de Three.js.
import type { Lang } from '../i18n/ui';
import { CHUNKS, DOCS, type Chunk } from './rag-corpus';

const STOP = new Set(
  (
    'a an and are as at be by do does for from has have how i in is it its me my of on or our the their this to was we what when which who will with you your ' +
    'a o as os e de do da dos das em no na nos nas um uma uns umas para por com que qual quais quantos quantas quanto como e é ser foi sao são tem tenho ' +
    'ao aos pelo pela pelos pelas se seu sua seus suas meu minha eu voce você mais'
  ).split(' '),
);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !STOP.has(t) && (t.length > 1 || /\d/.test(t)))
    .map((t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t)); // stemming mínimo
}

export interface Index {
  lang: Lang;
  vocab: Map<string, number>;
  idf: Float64Array;
  vectors: Float64Array[]; // um por chunk, normalizado
  coords: [number, number, number][]; // posição 3D (PCA)
  project: (v: Float64Array) => [number, number, number];
}

function normalize(v: Float64Array) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export function embed(text: string, ix: Pick<Index, 'vocab' | 'idf'>) {
  const v = new Float64Array(ix.vocab.size);
  for (const t of tokenize(text)) {
    const j = ix.vocab.get(t);
    if (j !== undefined) v[j] += ix.idf[j];
  }
  return normalize(v);
}

// PCA via a matriz de Gram (n×n, n = nº de chunks) com iteração de potência e deflação.
function pca3(X: Float64Array[]) {
  const n = X.length;
  const d = X[0].length;
  const mean = new Float64Array(d);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / n;
  const C = X.map((x) => x.map((v, j) => v - mean[j]));
  const K = C.map((a) => C.map((b) => a.reduce((s, v, j) => s + v * b[j], 0)));
  const comps: Float64Array[] = []; // direções no espaço do vocabulário
  for (let k = 0; k < 3; k++) {
    let u = Array.from({ length: n }, (_, i) => Math.sin(i * 1.7 + k + 1));
    let lambda = 0;
    for (let it = 0; it < 200; it++) {
      const w = K.map((row) => row.reduce((s, v, j) => s + v * u[j], 0));
      lambda = Math.hypot(...w);
      u = w.map((v) => v / (lambda || 1));
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) K[i][j] -= lambda * u[i] * u[j];
    const v = new Float64Array(d);
    for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) v[j] += C[i][j] * u[i];
    normalize(v);
    comps.push(v);
  }
  const raw = (x: Float64Array) => comps.map((c) => c.reduce((s, v, j) => s + v * (x[j] - mean[j]), 0)) as [number, number, number];
  const pts = X.map(raw);
  const scale = Math.max(...pts.flat().map(Math.abs)) || 1;
  // x e z: duas primeiras componentes; y: a terceira, achatada, flutuando acima do chão.
  const place = (p: [number, number, number]): [number, number, number] => [(p[0] / scale) * 3.2, 0.9 + (p[2] / scale) * 0.9, (p[1] / scale) * 3.2];
  return { coords: pts.map(place), project: (x: Float64Array) => place(raw(x)) };
}

export function buildIndex(lang: Lang): Index {
  const docsTokens = CHUNKS.map((c) => tokenize(c.text[lang] + ' ' + DOCS.find((d) => d.key === c.doc)!.title[lang]));
  const vocab = new Map<string, number>();
  const df: number[] = [];
  docsTokens.forEach((toks) => {
    for (const t of new Set(toks)) {
      if (!vocab.has(t)) vocab.set(t, vocab.size), df.push(0);
      df[vocab.get(t)!]++;
    }
  });
  const idf = Float64Array.from(df, (x) => Math.log((CHUNKS.length + 1) / (x + 1)) + 1);
  const vectors = docsTokens.map((toks) => {
    const v = new Float64Array(vocab.size);
    for (const t of toks) v[vocab.get(t)!] += idf[vocab.get(t)!];
    return normalize(v);
  });
  const { coords, project } = pca3(vectors);
  return { lang, vocab, idf, vectors, coords, project: (v) => project(v) };
}

// ---------- Guardas ----------

const INJECTION: [string, RegExp][] = [
  ['override', /ignor(e|ar|e as|e todas as)?\s+(all\s+|the\s+|as\s+|todas\s+as\s+)?(previous|prior|above|anteriores|acima|instru)/i],
  ['override', /instru[cç](oes|ões)\s+anteriores/i],
  ['system-prompt', /(system prompt|prompt do sistema|your instructions|suas instru[cç])/i],
  ['role-play', /(you are now|act as|a partir de agora voc[eê] [eé]|aja como|finja ser)/i],
  ['bulk-exfiltration', /(list|print|dump|show|liste|mostre|imprima|exporte).{0,40}(every|all|todos|todas).{0,30}(cpf|ssn|salar|senha|password|employee|funcion)/i],
];

export function detectInjection(q: string): string | null {
  for (const [rule, re] of INJECTION) if (re.test(q)) return rule;
  return null;
}

export interface Redaction {
  kind: 'CPF' | 'EMAIL' | 'PHONE';
  value: string;
}

const PII: [Redaction['kind'], RegExp][] = [
  ['CPF', /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g],
  ['EMAIL', /\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g],
  ['PHONE', /\(\d{2}\)\s?\d{4,5}-\d{4}/g],
];
const ALLOWED_DOMAINS = ['orbe.example']; // endereços corporativos podem aparecer

export function redactPII(text: string) {
  const found: Redaction[] = [];
  let out = text;
  for (const [kind, re] of PII) {
    out = out.replace(re, (m) => {
      if (kind === 'EMAIL' && ALLOWED_DOMAINS.some((d) => m.endsWith('@' + d))) return m;
      found.push({ kind, value: m });
      return `⟦${kind}:${m.length}⟧`;
    });
  }
  return { text: out, found };
}

const numbersIn = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ''));

// Uma frase é sustentada se a maior parte dos seus termos e TODOS os seus números aparecem nas fontes.
export function groundedness(sentences: string[], sources: string[]) {
  const srcTokens = new Set(sources.flatMap(tokenize));
  const srcNums = new Set(sources.flatMap(numbersIn));
  return sentences.map((s) => {
    const toks = tokenize(s);
    const overlap = toks.length ? toks.filter((t) => srcTokens.has(t)).length / toks.length : 0;
    const badNums = numbersIn(s).filter((n) => !srcNums.has(n));
    return { sentence: s, overlap, badNums, supported: overlap >= 0.6 && badNums.length === 0 };
  });
}

// ---------- Pipeline ----------

export type Role = 'employee' | 'hr';

export interface Hit {
  chunk: Chunk;
  index: number;
  score: number;
}

export type StepStatus = 'ok' | 'warn' | 'block' | 'skip';
export interface Step {
  key: 'rate' | 'cache' | 'input' | 'retrieve' | 'generate' | 'pii' | 'grounding' | 'audit';
  status: StepStatus;
  detail: Record<string, string | number>;
  ms: number;
}

export interface RunResult {
  query: string;
  steps: Step[];
  hits: Hit[];
  queryPos: [number, number, number] | null;
  blocked: 'rate' | 'injection' | null;
  answer: { html: string; citations: number[] } | null;
  notFound: boolean;
  decision: 'pass' | 'redacted' | 'flagged' | 'blocked' | 'throttled';
  cached: boolean;
  promptTokens: number;
}

const splitSentences = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/).filter(Boolean);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const timed = <T>(f: () => T): [T, number] => {
  const t = performance.now();
  const r = f();
  return [r, performance.now() - t];
};

export class RagPipeline {
  tokens = 6; // token bucket do rate limit
  readonly capacity = 6;
  readonly refillSeconds = 5;
  private cache = new Map<string, RunResult>();
  ix: Index;
  lang: Lang;

  constructor(lang: Lang) {
    this.lang = lang;
    this.ix = buildIndex(lang);
  }

  refill(dt: number) {
    this.tokens = Math.min(this.capacity, this.tokens + dt / this.refillSeconds);
  }

  run(query: string, role: Role, hallucinate: boolean): RunResult {
    const steps: Step[] = [];
    const base = { query, hits: [] as Hit[], queryPos: null, answer: null, notFound: false, cached: false, promptTokens: 0 };

    // 1. Gateway: rate limit.
    if (this.tokens < 1) {
      steps.push({ key: 'rate', status: 'block', detail: { left: 0, cap: this.capacity }, ms: 0.01 });
      return { ...base, steps, blocked: 'rate', decision: 'throttled' };
    }
    this.tokens -= 1;
    steps.push({ key: 'rate', status: 'ok', detail: { left: Math.floor(this.tokens), cap: this.capacity }, ms: 0.01 });

    // 2. Gateway: cache semântico simplificado (consulta normalizada + papel + modo).
    const key = `${tokenize(query).sort().join(' ')}|${role}|${hallucinate}`;
    const cached = this.cache.get(key);
    if (cached) {
      steps.push({ key: 'cache', status: 'ok', detail: { hit: 1 }, ms: 0.02 });
      return { ...cached, steps: [...steps, ...cached.steps.slice(2).map((s) => ({ ...s, status: 'skip' as StepStatus, ms: 0 }))], cached: true, promptTokens: 0 };
    }
    steps.push({ key: 'cache', status: 'ok', detail: { hit: 0 }, ms: 0.02 });

    // 3. Guarda de entrada: prompt injection.
    const [rule, tIn] = timed(() => detectInjection(query));
    if (rule) {
      steps.push({ key: 'input', status: 'block', detail: { rule }, ms: tIn });
      return { ...base, steps, blocked: 'injection', decision: 'blocked' };
    }
    steps.push({ key: 'input', status: 'ok', detail: {}, ms: tIn });

    // 4. Recuperação: embedding da pergunta, filtro de ACL no "payload", top-k por cosseno.
    const [ret, tRet] = timed(() => {
      const q = embed(query, this.ix);
      const allowed = CHUNKS.map((c, i) => ({ c, i })).filter(({ c }) => role === 'hr' || DOCS.find((d) => d.key === c.doc)!.acl === 'all');
      const hits = allowed
        .map(({ c, i }) => ({ chunk: c, index: i, score: this.ix.vectors[i].reduce((s, v, j) => s + v * q[j], 0) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      return { q, hits, accessible: allowed.length };
    });
    const queryPos = this.ix.project(ret.q);
    const relevant = ret.hits.filter((h) => h.score >= 0.12);
    steps.push({ key: 'retrieve', status: relevant.length ? 'ok' : 'warn', detail: { k: ret.hits.length, of: ret.accessible, total: CHUNKS.length, best: ret.hits[0]?.score ?? 0 }, ms: tRet });

    if (!relevant.length) {
      steps.push({ key: 'generate', status: 'skip', detail: {}, ms: 0 });
      const r: RunResult = { ...base, steps, hits: ret.hits, queryPos, blocked: null, notFound: true, decision: 'pass' };
      this.cache.set(key, r);
      return r;
    }

    // 5. Geração extrativa: as frases mais parecidas com a pergunta, com citação.
    const qTok = new Set(tokenize(query));
    // Tabelas e figuras são uma unidade só (a legenda sem os dados não responde nada).
    const units = (c: Chunk) => (c.type === 'text' ? splitSentences(c.text[this.lang]) : [c.text[this.lang]]);
    const candidates = relevant.flatMap((h, rank) =>
      units(h.chunk).map((s) => ({ s, rank, score: tokenize(s).filter((t) => qTok.has(t)).length * h.score })),
    );
    candidates.sort((a, b) => b.score - a.score);
    const picked = candidates.slice(0, 1);
    if (candidates[1] && candidates[1].rank !== candidates[0].rank && candidates[1].score > candidates[0].score * 0.6) picked.push(candidates[1]);
    let sentences = picked.map((p) => p.s);
    const citations = picked.map((p) => p.rank);
    // "LLM que inventa": troca um número da resposta (a alucinação mais perigosa, porque parece plausível).
    if (hallucinate) {
      const swapped = sentences[0].replace(/\d+(?:[.,]\d+)?/, (n) => String(Math.round(parseFloat(n.replace(',', '.')) * 1.5 + 3)));
      sentences =
        swapped !== sentences[0]
          ? [swapped, ...sentences.slice(1)]
          : [...sentences, this.lang === 'pt' ? 'Além disso, todos recebem um bônus de R$ 2.000 em dezembro.' : 'In addition, everyone receives a R$ 2,000 bonus in December.'];
    }
    const promptTokens = Math.round((query.length + relevant.reduce((s, h) => s + h.chunk.text[this.lang].length, 0)) / 3.6) + 120;
    steps.push({ key: 'generate', status: 'ok', detail: { mode: hallucinate ? 'llm' : 'extractive', tokens: promptTokens }, ms: 0 });

    // 6. Guarda de saída: PII.
    const [pii, tPii] = timed(() => sentences.map(redactPII));
    const found = pii.flatMap((p) => p.found);
    steps.push({ key: 'pii', status: found.length ? 'warn' : 'ok', detail: { n: found.length, kinds: [...new Set(found.map((f) => f.kind))].join(', ') }, ms: tPii });

    // 7. Guarda de saída: aderência às fontes recuperadas.
    const [ground, tG] = timed(() => groundedness(sentences, relevant.map((h) => h.chunk.text[this.lang])));
    const unsupported = ground.filter((g) => !g.supported).length;
    const badNums = [...new Set(ground.flatMap((g) => g.badNums))].join(', ');
    steps.push({ key: 'grounding', status: unsupported ? 'warn' : 'ok', detail: { ok: ground.length - unsupported, n: ground.length, badNums }, ms: tG });

    steps.push({ key: 'audit', status: 'ok', detail: {}, ms: 0 });

    const html = pii
      .map((p, i) => {
        // Tarja preta do tamanho do original; o valor real nunca chega ao DOM.
        const body = esc(p.text).replace(/⟦(\w+):(\d+)⟧/g, (_, kind, n) => `<span class="redact" title="${kind}">${'x'.repeat(Number(n))}</span>`);
        const cite = `<sup>[${citations[i] + 1}]</sup>`;
        return ground[i].supported ? `${body} ${cite}` : `<del class="ungrounded" title="unsupported">${body}</del>`;
      })
      .join(' ');
    const r: RunResult = {
      ...base,
      steps,
      hits: ret.hits,
      queryPos,
      blocked: null,
      answer: { html, citations },
      decision: unsupported ? 'flagged' : found.length ? 'redacted' : 'pass',
      promptTokens,
    };
    this.cache.set(key, r);
    return r;
  }
}
