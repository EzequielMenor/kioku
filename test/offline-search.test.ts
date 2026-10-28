import { test } from "node:test";
import assert from "node:assert/strict";
import { searchNotes } from "../web/src/offline/search.ts";
import type { StoredNote } from "../web/src/offline/store.ts";

const n = (path: string, text: string): StoredNote => ({ path, mtime: 1, hash: "h", text });
const FM = (type = "note") => `---\nid: X\ntype: ${type}\ncreated: 2026-01-01\n---\n`;

test("consulta vacía o de un carácter → []", () => {
  const notes = [n("A.md", FM() + "# Alfa\ncontenido")];
  assert.deepEqual(searchNotes(notes, ""), []);
  assert.deepEqual(searchNotes(notes, "  "), []);
  assert.deepEqual(searchNotes(notes, "a"), []);
});

test("insensible a mayúsculas y acentos", () => {
  const notes = [n("Café.md", FM() + "# Café con leche\nMAÑANA")];
  assert.equal(searchNotes(notes, "CAFE").length, 1);
  assert.equal(searchNotes(notes, "manana").length, 1);
});

test("todas las palabras deben aparecer (AND)", () => {
  const notes = [n("A.md", FM() + "# A\nmanzana pera"), n("B.md", FM() + "# B\nmanzana uva")];
  assert.deepEqual(searchNotes(notes, "manzana pera").map((h) => h.path), ["A.md"]);
});

test("un acierto en el título puntúa más que uno solo en el cuerpo", () => {
  const notes = [n("Cuerpo.md", FM() + "# Otra\nhablamos de cohete"), n("Titulo.md", FM() + "# Cohete\nnada")];
  const hits = searchNotes(notes, "cohete");
  assert.deepEqual(hits.map((h) => h.path), ["Titulo.md", "Cuerpo.md"]);
  assert.equal(hits[0].kind, "title");
  assert.equal(hits[1].kind, "content");
  assert.ok(hits[0].score > hits[1].score);
});

test("ignora el frontmatter", () => {
  const notes = [n("A.md", `---\nid: SECRETOXYZ\ntype: note\n---\n# A\ncuerpo`)];
  assert.deepEqual(searchNotes(notes, "secretoxyz"), []);
});

test("el snippet contiene el texto alrededor del acierto", () => {
  const largo = "relleno ".repeat(40) + "AGUJA en el pajar " + "relleno ".repeat(40);
  const [h] = searchNotes([n("A.md", FM() + "# A\n" + largo)], "aguja");
  assert.match(h.snippet, /AGUJA en el pajar/);
  assert.ok(h.snippet.length < 220);
});

test("respeta limit", () => {
  const notes = Array.from({ length: 20 }, (_, i) => n(`N${i}.md`, FM() + `# N${i}\ncomun`));
  assert.equal(searchNotes(notes, "comun").length, 12);
  assert.equal(searchNotes(notes, "comun", 5).length, 5);
});

test("título: primera cabecera # o, si no hay, el nombre del fichero; type del frontmatter o note", () => {
  const notes = [n("Dir/Con cabecera.md", FM("project") + "# Título real\ntexto zeta"), n("Dir/Sin cabecera.md", "solo texto zeta")];
  const hits = searchNotes(notes, "zeta");
  const con = hits.find((h) => h.path === "Dir/Con cabecera.md")!;
  const sin = hits.find((h) => h.path === "Dir/Sin cabecera.md")!;
  assert.equal(con.title, "Título real");
  assert.equal(con.type, "project");
  assert.equal(sin.title, "Sin cabecera");
  assert.equal(sin.type, "note");
});

test("a igualdad de puntuación ordena por path", () => {
  const notes = [n("B.md", FM() + "# B\ncomun"), n("A.md", FM() + "# A\ncomun")];
  assert.deepEqual(searchNotes(notes, "comun").map((h) => h.path), ["A.md", "B.md"]);
});
