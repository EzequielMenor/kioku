// Evalúa la búsqueda de Kioku (FTS5 real) frente a variantes: FTS5 con OR, solo vectores e híbrida (RRF).
// Herramienta de investigación (docs/research/03-embeddings-busqueda.md), no forma parte de Kioku.
// Necesita transformers.js fuera del proyecto:  mkdir /tmp/emb && cd /tmp/emb && npm i --ignore-scripts @huggingface/transformers@3.7.6
// Uso: KIOKU_TRANSFORMERS=/tmp/emb/node_modules/@huggingface/transformers node scripts/eval-search.ts [modelo-hf] [dtype]
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";

const tf = process.env.KIOKU_TRANSFORMERS;
if (!tf) throw new Error("Define KIOKU_TRANSFORMERS con la carpeta de @huggingface/transformers (ver cabecera)");
const { pipeline, env } = await import(path.join(tf, "dist", "transformers.node.mjs"));
env.cacheDir = path.join(tmpdir(), "kioku-eval-models");

const corpus = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "test", "fixtures", "search-corpus.json"), "utf8")) as { notes: { title: string; body: string }[]; questions: { q: string; kw: string; gold: string[] }[] };
const modelId = process.argv[2] ?? "Xenova/multilingual-e5-small";
const dtype = process.argv[3] ?? "q8";

// Prefijos que cada familia de modelos espera.
const fmt = modelId.includes("e5") ? { q: (t: string) => `query: ${t}`, d: (t: string) => `passage: ${t}`, pool: "mean" }
  : modelId.includes("gemma") ? { q: (t: string) => `task: search result | query: ${t}`, d: (t: string) => `title: none | text: ${t}`, pool: "mean" }
  : modelId.includes("Qwen3") ? { q: (t: string) => `Instruct: Dada una pregunta, encuentra la nota personal que la responde\nQuery:${t}`, d: (t: string) => t, pool: "last_token" }
  : { q: (t: string) => t, d: (t: string) => t, pool: "mean" };

const root = mkdtempSync(path.join(tmpdir(), "kioku-emb-"));
const j = await Kioku.open({ root });
for (const n of corpus.notes) await j.createNote({ title: n.title, type: "note", body: n.body });
const pathOf = new Map(corpus.notes.map((n) => [n.title, j.index.listNotes({ limit: 500 }).find((x) => x.title === n.title)!.path]));

const STOP = new Set("a al algo con cual cuál cuales cuándo cuando cuánto cuanto cuánta cuanta de del donde dónde el ella en es esta este hay la las le lo los me mi mis para por que qué quien quién se si sí su sus te tengo tiene toca un una y ya yo qué cómo como hago hace hacer".split(" "));
const toks = (q: string) => (q.match(/[\p{L}\p{N}_]+/gu) ?? []).filter((t) => !STOP.has(t.toLowerCase()));
const ftsOr = (q: string, limit = 20): string[] => {
  const t = toks(q);
  if (!t.length) return [];
  const match = t.map((x) => `"${x}"*`).join(" OR ");
  return ((j.index as any).ftsQuery(match, limit) as { path: string }[]).map((h) => h.path);
};
const ftsCurrent = (q: string) => j.index.search(q, 20).map((h) => h.path);

const t0 = Date.now();
const extractor = await pipeline("feature-extraction", modelId, { dtype });
const loadMs = Date.now() - t0;
const embed = async (texts: string[]) => {
  const out = await extractor(texts, { pooling: fmt.pool, normalize: true });
  return out.tolist() as number[][];
};
const t1 = Date.now();
const docVecs = new Map<string, number[]>();
for (const n of corpus.notes) docVecs.set(pathOf.get(n.title)!, (await embed([fmt.d(`${n.title}\n${n.body}`)]))[0]);
const indexMs = Date.now() - t1;
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const vector = async (q: string) => {
  const v = (await embed([fmt.q(q)]))[0];
  return [...docVecs.entries()].map(([p, d]) => [p, cos(v, d)] as const).sort((a, b) => b[1] - a[1]).map(([p]) => p);
};
const rrf = (...lists: string[][]) => {
  const s = new Map<string, number>();
  for (const l of lists) l.slice(0, 20).forEach((p, i) => s.set(p, (s.get(p) ?? 0) + 1 / (60 + i)));
  return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
};

type Variant = (q: string) => Promise<string[]> | string[];
const variants: Record<string, Variant> = {
  "FTS5 Kioku (nuevo)": ftsCurrent,
  "FTS5 OR": ftsOr,
  "Vectores": vector,
  "Híbrida (FTS5 OR + vectores, RRF)": async (q) => rrf(ftsOr(q), await vector(q)),
};

const res: Record<string, Record<string, { r1: number; r5: number; mrr: number; miss: string[] }>> = {};
let qMs = 0, qN = 0;
for (const form of ["q", "kw"] as const) {
  for (const [name, fn] of Object.entries(variants)) {
    let r1 = 0, r5 = 0, mrr = 0;
    const miss: string[] = [];
    for (const item of corpus.questions) {
      const t = Date.now();
      const ranked = await fn(item[form]);
      if (name === "Vectores") { qMs += Date.now() - t; qN++; }
      const gold = item.gold.map((g) => pathOf.get(g)!);
      const rank = ranked.findIndex((p) => gold.includes(p));
      if (rank === 0) r1++;
      if (rank >= 0 && rank < 5) r5++; else miss.push(item[form]);
      if (rank >= 0 && rank < 10) mrr += 1 / (rank + 1);
    }
    const n = corpus.questions.length;
    (res[form] ??= {})[name] = { r1: r1 / n, r5: r5 / n, mrr: mrr / n, miss };
  }
}
console.log(JSON.stringify({ model: modelId, dtype, loadMs, indexMs, notes: corpus.notes.length, questions: corpus.questions.length, avgQueryMs: Math.round(qMs / qN), res }, null, 1));
j.close();
rmSync(root, { recursive: true, force: true });
