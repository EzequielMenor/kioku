import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Jarvis } from "../src/core/jarvis.ts";
import { tmpVault } from "./helpers.ts";

async function setup() {
  const { root, cleanup } = tmpVault();
  const j = await Jarvis.open({ root });
  return { j, root, cleanup };
}

test("bases: crear una base desde plantilla la deja como nota type: database y consultable", async () => {
  const { j, root, cleanup } = await setup();
  try {
    const db = await j.createDatabase({ name: "Libros", template: "libros" });
    assert.equal(db.path, "Bases/Libros.md");
    assert.match(readFileSync(path.join(root, db.path), "utf8"), /type: database/);
    const list = j.listDatabases();
    assert.deepEqual(list.map((d) => [d.path, d.title, d.rows]), [["Bases/Libros.md", "Libros", 0]]);
    assert.ok(list[0].views.length >= 1);
    const r = j.queryDatabase(db.path);
    assert.equal(r.total, 0);
    assert.ok(r.columns.some((c) => c.key === "Estado" && c.type === "select"));
    j.close();
  } finally { cleanup(); }
});

test("bases: createRow crea la nota en la carpeta de origen y no deja pisar id/type/created", async () => {
  const { j, cleanup } = await setup();
  try {
    const db = await j.createDatabase({ name: "Libros", template: "libros" });
    const row = await j.createRow(db.path, { title: "Dune", props: { Estado: "Leyendo", Nota: 9, id: "robado", type: "task", created: "1999-01-01" } });
    assert.equal(row.path, "Libros/Dune.md");
    const n = j.index.getNote(row.path)!;
    assert.equal(n.fm.Estado, "Leyendo");
    assert.equal(n.fm.Nota, 9);
    assert.equal(n.type, "note");
    assert.notEqual(n.fm.id, "robado");
    assert.notEqual(n.fm.created, "1999-01-01");
    const r = j.queryDatabase(db.path);
    assert.deepEqual(r.rows.map((x) => x.title), ["Dune"]);
    assert.equal(r.rows[0].cells.Estado, "Leyendo");
    j.close();
  } finally { cleanup(); }
});

test("bases: queryDatabase por nombre de vista, vista ad hoc y errores claros", async () => {
  const { j, cleanup } = await setup();
  try {
    const db = await j.createDatabase({ name: "Libros", template: "libros" });
    await j.createRow(db.path, { title: "Dune", props: { Estado: "Leyendo" } });
    await j.createRow(db.path, { title: "Ubik", props: { Estado: "Leído" } });
    const board = j.queryDatabase(db.path, "Por estado");
    assert.ok(board.groups);
    assert.deepEqual(board.groups!.map((g) => g.key), ["Leyendo", "Leído"]);
    const adhoc = j.queryDatabase(db.path, { name: "x", kind: "table", columns: ["title"], filter: [{ prop: "Estado", op: "is", value: "Leído" }], sort: [], group: null });
    assert.deepEqual(adhoc.rows.map((x) => x.title), ["Ubik"]);
    assert.throws(() => j.queryDatabase(db.path, "No existe"), /vista/i);
    const note = await j.createNote({ title: "Normal" });
    assert.throws(() => j.queryDatabase(note.path), /base de datos/i);
    assert.throws(() => j.queryDatabase("Bases/NoExiste.md"), /no encontrad|no existe/i);
    j.close();
  } finally { cleanup(); }
});

test("bases: la plantilla de tareas muestra las tareas existentes, agrupables por estado", async () => {
  const { j, cleanup } = await setup();
  try {
    await j.createNote({ title: "Llamar a Ana", type: "task", fm: { status: "todo", due: "2026-11-01" } });
    await j.createNote({ title: "Enviar informe", type: "task", fm: { status: "doing" } });
    const db = await j.createDatabase({ name: "Tareas", template: "tareas" });
    const t = j.queryDatabase(db.path);
    assert.deepEqual(t.rows.map((r) => r.title).sort(), ["Enviar informe", "Llamar a Ana"]);
    const b = j.queryDatabase(db.path, "Tablero");
    assert.deepEqual(b.groups!.map((g) => [g.key, g.rows.length]), [["todo", 1], ["doing", 1]]);
    j.close();
  } finally { cleanup(); }
});

test("bases: saveView añade o reemplaza por nombre y conserva el resto, incluso vistas inválidas", async () => {
  const { j, root, cleanup } = await setup();
  try {
    const db = await j.createDatabase({ name: "Libros", template: "libros" });
    const before = j.listDatabases()[0].views.length;
    await j.saveView(db.path, { name: "Leídos", kind: "table", columns: ["title", "Nota"], filter: [{ prop: "Estado", op: "is", value: "Leído" }], sort: [{ prop: "Nota", dir: "desc" }], group: null });
    assert.equal(j.listDatabases()[0].views.length, before + 1);
    await j.saveView(db.path, { name: "Leídos", kind: "list", columns: ["title"], filter: [], sort: [], group: null });
    const views = j.listDatabases()[0].views;
    assert.equal(views.length, before + 1, "reemplaza, no duplica");
    assert.equal(views.find((v) => v.name === "Leídos")!.kind, "list");
    assert.equal(j.index.getNote(db.path)!.type, "database");

    // una vista escrita a mano con errores no se pierde al guardar otra
    const file = path.join(root, db.path);
    const { setFrontmatter } = await import("../src/core/markdown.ts");
    const raw = setFrontmatter(readFileSync(file, "utf8"), { views: [...(j.index.getNote(db.path)!.fm.views as object[]), { name: "Rota", kind: "galaxia" }] });
    await j.saveNote(db.path, raw, (await j.readNote(db.path)).hash);
    await j.saveView(db.path, { name: "Otra", kind: "table", columns: [], filter: [], sort: [], group: null });
    assert.match(readFileSync(file, "utf8"), /galaxia/);

    await j.deleteView(db.path, "Otra");
    assert.ok(!j.listDatabases()[0].views.some((v) => v.name === "Otra"));
    assert.throws(() => j.queryDatabase(db.path, "Otra"), /vista/i);
    j.close();
  } finally { cleanup(); }
});

test("bases: borrar el índice y reindexar da exactamente el mismo resultado", async () => {
  const { j, root, cleanup } = await setup();
  try {
    const db = await j.createDatabase({ name: "Libros", template: "libros" });
    await j.createRow(db.path, { title: "Dune", props: { Estado: "Leyendo", Nota: 9 } });
    await j.createRow(db.path, { title: "Ubik", props: { Estado: "Leído", Nota: 7 } });
    const a = j.queryDatabase(db.path, "Por estado");
    j.close();
    const { rmSync } = await import("node:fs");
    for (const f of ["index.db", "index.db-wal", "index.db-shm"]) rmSync(path.join(root, ".jarvis", f), { force: true });
    const j2 = await Jarvis.open({ root });
    assert.deepEqual(j2.queryDatabase(db.path, "Por estado"), a);
    j2.close();
  } finally { cleanup(); }
});
