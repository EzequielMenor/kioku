import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { tmpVault } from "./helpers.ts";

async function setup() {
  const { root, cleanup } = tmpVault();
  const j = await Kioku.open({ root });
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
    for (const f of ["index.db", "index.db-wal", "index.db-shm"]) rmSync(path.join(root, ".kioku", f), { force: true });
    const j2 = await Kioku.open({ root });
    assert.deepEqual(j2.queryDatabase(db.path, "Por estado"), a);
    j2.close();
  } finally { cleanup(); }
});

test("bases: queryDatabase expone las propiedades disponibles (esquema + las vistas en las filas) con tipo y opciones", async () => {
  const { j, cleanup } = await setup();
  try {
    const db = await j.createDatabase({ name: "Libros", template: "libros" });
    await j.createRow(db.path, { title: "Dune", props: { Estado: "Leyendo", Editorial: "Ace", Terminado: true } });
    const keys = j.queryDatabase(db.path).database.available;
    const byKey = Object.fromEntries(keys.map((c) => [c.key, c]));
    for (const k of ["title", "Estado", "Autor", "Nota", "Editorial", "Terminado", "tags"]) assert.ok(byKey[k], `falta ${k}`);
    assert.equal(byKey.Estado.type, "select");
    assert.deepEqual(byKey.Estado.options, [{ name: "Quiero leer" }, { name: "Leyendo" }, { name: "Leído" }]);
    assert.equal(byKey.Terminado.type, "checkbox");
    assert.equal(byKey.Editorial.type, "text");
    assert.ok(!("id" in byKey) && !("created" in byKey) && !("type" in byKey), "las claves del sistema no son columnas");
    j.close();
  } finally { cleanup(); }
});

test("bases: una carpeta de origen con .. o segmentos ocultos no deja a createRow escribir en .kioku", async () => {
  const { j, root, cleanup } = await setup();
  try {
    for (const folder of ["Notas/../.kioku", ".kioku/x", "../fuera", "a//b"]) {
      const db = await j.createNote({ title: `Hostil ${folder.length}`, type: "database", fm: { source: { folder } } });
      await assert.rejects(() => j.createRow(db.path, { title: "pwn" }), /origen|carpeta|fuera|invalid|no válid/i, folder);
    }
    const { existsSync } = await import("node:fs");
    assert.ok(!existsSync(path.join(root, ".kioku", "pwn.md")));
    j.close();
  } finally { cleanup(); }
});

test("bases: saveView parte de lo que hay en disco, no del índice (una vista añadida a mano antes del reindexado no se pierde)", async () => {
  const { j, root, cleanup } = await setup();
  try {
    const db = await j.createDatabase({ name: "Libros", template: "libros" });
    const file = path.join(root, db.path);
    const { writeFileSync } = await import("node:fs");
    const { setFrontmatter } = await import("../src/core/markdown.ts");
    const views = [...(j.index.getNote(db.path)!.fm.views as object[]), { name: "Manual", kind: "list" }];
    // edición externa: el índice aún no la conoce
    writeFileSync(file, setFrontmatter(readFileSync(file, "utf8"), { views }));
    await j.saveView(db.path, { name: "Nueva", kind: "table", columns: [], filter: [], sort: [], group: null });
    const text = readFileSync(file, "utf8");
    assert.match(text, /Manual/);
    assert.match(text, /Nueva/);
    j.close();
  } finally { cleanup(); }
});

test("bases: dos saveView simultáneos conservan ambas vistas y ninguno falla", async () => {
  const { j, root, cleanup } = await setup();
  try {
    const db = await j.createDatabase({ name: "Libros", template: "libros" });
    const v = (name: string) => ({ name, kind: "table" as const, columns: [], filter: [], sort: [], group: null });
    await Promise.all([j.saveView(db.path, v("A")), j.saveView(db.path, v("B"))]);
    const text = readFileSync(path.join(root, db.path), "utf8");
    assert.match(text, /name: A/);
    assert.match(text, /name: B/);
    j.close();
  } finally { cleanup(); }
});

/* ---------------- editDatabase / planDatabaseEdit ---------------- */

const LIBROS_DB = `---
type: database
source:
  folder: Libros/
properties:
  Autor:
    type: text
  Estado:
    type: select
    options:
      - Leyendo
      - Leído
views:
  - name: Tabla
    kind: table
    columns: [title, Autor, Estado]
    filter: []
    sort: []
    group: null
---

# Libros
`;
const DUNE = "---\nAutor: Herbert\nEstado: Leyendo\nFecha: 2026-10-27 # x\n---\n\nDune\n";
const UBIK = "---\nAutor: Dick\nEstado: Leído\n---\n\nUbik\n";
const NEUROMANTE = "---\nEstado: Leído\n---\n\nNeuromante\n";

async function setupLibros(extra: Record<string, string> = {}) {
  const files = { "Bases/Libros.md": LIBROS_DB, "Libros/Dune.md": DUNE, "Libros/Ubik.md": UBIK, "Libros/Neuromante.md": NEUROMANTE, ...extra };
  const { root, cleanup } = tmpVault(files);
  const j = await Kioku.open({ root });
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
  const snapshot = () => Object.fromEntries(Object.keys(files).map((f) => [f, read(f)]));
  return { j, root, cleanup, read, snapshot, db: "Bases/Libros.md" };
}

test("editDatabase rename-property reescribe base y filas", async () => {
  const { j, cleanup, read, snapshot, db } = await setupLibros();
  try {
    const before = snapshot();
    const r = await j.editDatabase(db, { op: "rename-property", name: "Autor", to: "Escritor" });
    assert.equal(r.affected, 2);
    assert.deepEqual(r.paths, [db, "Libros/Dune.md", "Libros/Ubik.md"]);
    assert.equal(r.note.path, db);
    assert.ok(r.summary.length > 0);
    assert.match(read("Libros/Dune.md"), /^---\nEscritor: Herbert\n/);
    assert.match(read("Libros/Ubik.md"), /^---\nEscritor: Dick\n/);
    assert.equal(read("Libros/Neuromante.md"), before["Libros/Neuromante.md"]);
    assert.match(read(db), /Escritor:/);
    const q = j.queryDatabase(db);
    assert.ok(q.database.available.some((c) => c.key === "Escritor"));
    assert.ok(!q.database.available.some((c) => c.key === "Autor"));
    j.close();
  } finally { cleanup(); }
});

test("editDatabase: renombrar conserva fechas sin comillas y comentarios", async () => {
  const { j, cleanup, read, db } = await setupLibros();
  try {
    await j.editDatabase(db, { op: "rename-property", name: "Autor", to: "Escritor" });
    assert.equal(read("Libros/Dune.md"), "---\nEscritor: Herbert\nEstado: Leyendo\nFecha: 2026-10-27 # x\n---\n\nDune\n");
    j.close();
  } finally { cleanup(); }
});

test("editDatabase: colisión lanza invalid y no cambia ningún fichero", async () => {
  const { j, cleanup, snapshot, db } = await setupLibros({ "Libros/Minusculas.md": "---\nautor: x\n---\n\nM\n" });
  try {
    const before = snapshot();
    await assert.rejects(() => j.editDatabase(db, { op: "rename-property", name: "Autor", to: "Estado" }), (e: any) => e.code === "invalid");
    assert.deepEqual(snapshot(), before);
    await assert.rejects(() => j.editDatabase(db, { op: "rename-property", name: "Autor", to: "autor" }), (e: any) => e.code === "invalid");
    assert.deepEqual(snapshot(), before);
    assert.throws(() => j.planDatabaseEdit(db, { op: "rename-property", name: "Autor", to: "Estado" }), (e: any) => e.code === "invalid");
    j.close();
  } finally { cleanup(); }
});

test("editDatabase: base inexistente es not-found y una nota que no es base es invalid", async () => {
  const { j, cleanup } = await setupLibros();
  try {
    const op = { op: "add-property", name: "X", type: "text" } as const;
    await assert.rejects(() => j.editDatabase("Bases/Nada.md", op), (e: any) => e.code === "not-found");
    await assert.rejects(() => j.editDatabase("Libros/Dune.md", op), (e: any) => e.code === "invalid");
    assert.throws(() => j.planDatabaseEdit("Bases/Nada.md", op), (e: any) => e.code === "not-found");
    assert.throws(() => j.planDatabaseEdit("Libros/Dune.md", op), (e: any) => e.code === "invalid");
    j.close();
  } finally { cleanup(); }
});

test("editDatabase expect: si tras planificar aparece otra fila afectada, lanza conflict y no escribe nada", async () => {
  const { j, cleanup, snapshot, db } = await setupLibros();
  try {
    const before = snapshot();
    const op = { op: "rename-property", name: "Autor", to: "Escritor" } as const;
    const planned = j.planDatabaseEdit(db, op);
    assert.deepEqual(planned.paths, [db, "Libros/Dune.md", "Libros/Ubik.md"]);
    await assert.rejects(() => j.editDatabase(db, op, { expect: [db, "Libros/Dune.md"] }), (e: any) => e.code === "conflict");
    assert.deepEqual(snapshot(), before);
    const ok = await j.editDatabase(db, op, { expect: planned.paths });
    assert.equal(ok.affected, 2);
    j.close();
  } finally { cleanup(); }
});

test("editDatabase: fallo a mitad de lote restaura los ficheros ya escritos", async () => {
  const { j, cleanup, snapshot, db } = await setupLibros();
  try {
    const before = snapshot();
    const orig = j.vault.write.bind(j.vault);
    let calls = 0;
    j.vault.write = (async (...args: Parameters<typeof orig>) => {
      calls++;
      if (calls === 3) throw new Error("disco lleno");
      return orig(...args);
    }) as typeof j.vault.write;
    await assert.rejects(() => j.editDatabase(db, { op: "rename-property", name: "Autor", to: "Escritor" }), /disco lleno/);
    assert.deepEqual(snapshot(), before);
    j.vault.write = orig;
    const q = j.queryDatabase(db);
    assert.ok(q.database.available.some((c) => c.key === "Autor"));
    j.close();
  } finally { cleanup(); }
});

test("editDatabase: una fila con YAML inválido aborta nombrando su ruta, sin escribir nada", async () => {
  const { j, root, cleanup, snapshot, db } = await setupLibros();
  try {
    const { writeFileSync } = await import("node:fs");
    // el índice la ve bien; el fichero se rompe después (edición externa aún no reindexada)
    writeFileSync(path.join(root, "Libros/Ubik.md"), "---\nAutor: [sin cerrar\nEstado: Leído\n---\n\nUbik\n");
    const before = snapshot();
    await assert.rejects(() => j.editDatabase(db, { op: "rename-property", name: "Autor", to: "Escritor" }), (e: any) => e.code === "invalid" && /Libros\/Ubik\.md/.test(e.message));
    assert.deepEqual(snapshot(), before);
    j.close();
  } finally { cleanup(); }
});

test("editDatabase skip: las filas excluidas no se tocan ni aparecen en paths", async () => {
  const { j, cleanup, read, snapshot, db } = await setupLibros();
  try {
    const before = snapshot();
    const skip = (p: string) => p === "Libros/Ubik.md";
    const op = { op: "rename-property", name: "Autor", to: "Escritor" } as const;
    assert.deepEqual(j.planDatabaseEdit(db, op, { skip }).paths, [db, "Libros/Dune.md"]);
    const r = await j.editDatabase(db, op, { skip });
    assert.deepEqual(r.paths, [db, "Libros/Dune.md"]);
    assert.equal(r.affected, 1);
    assert.equal(read("Libros/Ubik.md"), before["Libros/Ubik.md"]);
    j.close();
  } finally { cleanup(); }
});

test("editDatabase: filas de otra base con la misma clave no se tocan", async () => {
  const otra = "---\ntype: database\nsource:\n  folder: Cine/\nproperties:\n  Autor:\n    type: text\nviews: []\n---\n\n# Cine\n";
  const { j, cleanup, read, db } = await setupLibros({ "Bases/Cine.md": otra, "Cine/Alien.md": "---\nAutor: Scott\n---\n\nAlien\n" });
  try {
    await j.editDatabase(db, { op: "rename-property", name: "Autor", to: "Escritor" });
    assert.equal(read("Cine/Alien.md"), "---\nAutor: Scott\n---\n\nAlien\n");
    assert.equal(read("Bases/Cine.md"), otra);
    j.close();
  } finally { cleanup(); }
});

test("editDatabase: dos ediciones simultáneas se aplican las dos", async () => {
  const { j, cleanup, read, db } = await setupLibros();
  try {
    await Promise.all([
      j.editDatabase(db, { op: "add-property", name: "Paginas", type: "number" }),
      j.editDatabase(db, { op: "add-property", name: "Idioma", type: "text" }),
    ]);
    const text = read(db);
    assert.match(text, /Paginas:/);
    assert.match(text, /Idioma:/);
    j.close();
  } finally { cleanup(); }
});

test("planDatabaseEdit no escribe y devuelve los mismos paths/affected que luego aplica editDatabase", async () => {
  const { j, cleanup, snapshot, db } = await setupLibros();
  try {
    const before = snapshot();
    const op = { op: "delete-property", name: "Autor" } as const;
    const plan = j.planDatabaseEdit(db, op);
    assert.deepEqual(snapshot(), before);
    assert.equal(plan.affected, 2);
    const r = await j.editDatabase(db, op);
    assert.deepEqual({ paths: r.paths, affected: r.affected, summary: r.summary }, plan);
    j.close();
  } finally { cleanup(); }
});
