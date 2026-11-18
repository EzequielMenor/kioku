// Calidad de la búsqueda con el índice real: 40 notas personales y 32 preguntas (docs/research/03-embeddings-busqueda.md).
// Protege la corrección de FTS5 (palabras vacías + completar con OR): antes, con AND estricto, R@5 era 0,47 y 0,00.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { tmpVault } from "./helpers.ts";

const corpus = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", "search-corpus.json"), "utf8")) as {
  notes: { title: string; body: string }[]; questions: { q: string; kw: string; gold: string[] }[];
};

test("búsqueda: con palabras clave encuentra la nota en el top 5 siempre; con preguntas naturales, casi siempre", async () => {
  const { root, cleanup } = tmpVault();
  const j = await Kioku.open({ root });
  try {
    for (const n of corpus.notes) await j.createNote({ title: n.title, type: "note", body: n.body });
    const pathOf = new Map(j.index.listNotes({ limit: 500 }).map((n) => [n.title, n.path]));
    const recall5 = (form: "q" | "kw") => corpus.questions.filter((item) => {
      const gold = item.gold.map((g) => pathOf.get(g));
      return j.index.search(item[form], 20).slice(0, 5).some((h) => gold.includes(h.path));
    }).length / corpus.questions.length;
    assert.equal(recall5("kw"), 1, "palabras clave (como busca Kio)");
    assert.ok(recall5("q") >= 0.85, `preguntas naturales: ${recall5("q")}`);
  } finally { j.close(); cleanup(); }
});
