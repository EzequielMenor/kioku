import { test } from "node:test";
import assert from "node:assert/strict";
import { Kioku } from "../src/core/kioku.ts";
import { AssistantTools } from "../src/assistant/tools.ts";
import { SessionRegistry } from "../src/assistant/session.ts";
import { UndoStore } from "../src/assistant/undo.ts";
import { tmpVault } from "./helpers.ts";

async function setup(exclude: string[] = []) {
  const { root, cleanup } = tmpVault();
  const j = await Kioku.open({ root });
  const libros = await j.createDatabase({ name: "Libros", template: "libros" });
  await j.createRow(libros.path, { title: "Dune", props: { Estado: "Leyendo", Nota: 9 } });
  await j.createRow(libros.path, { title: "Ubik", props: { Estado: "Leído", Nota: 7 } });
  const undo = new UndoStore(j);
  const tools = new AssistantTools(j, undo, { exclude });
  const s = new SessionRegistry().open();
  const call = async (name: string, args: unknown = {}) => {
    const r = await tools.call(s, name, args);
    return { ...r, json: r.isError ? null : JSON.parse(r.text) };
  };
  return { j, undo, tools, call, libros, root, cleanup };
}

test("asistente/bases: list_databases y query_database (vista guardada, filtro y límites)", async () => {
  const { j, call, libros, cleanup } = await setup();
  try {
    const l = await call("list_databases");
    assert.deepEqual(l.json.map((d: any) => [d.path, d.rows]), [[libros.path, 2]]);
    const all = await call("query_database", { path: libros.path });
    assert.equal(all.json.total, 2);
    assert.deepEqual(all.json.rows.map((r: any) => r.title), ["Dune", "Ubik"]);
    const f = await call("query_database", { path: libros.path, filter: [{ prop: "Estado", op: "is", value: "Leyendo" }] });
    assert.deepEqual(f.json.rows.map((r: any) => r.title), ["Dune"]);
    const board = await call("query_database", { path: libros.path, view: "Por estado" });
    assert.deepEqual(board.json.groups.map((g: any) => g.key), ["Leyendo", "Leído"]);
    assert.equal((await call("query_database", { path: libros.path, view: "Nope" })).isError, true);
    assert.equal((await call("query_database", { path: libros.path, filter: [{ prop: "Estado", op: "raro" }] })).isError, true);
    assert.equal((await call("query_database", { path: "Notas/x.md" })).isError, true);
    j.close();
  } finally { cleanup(); }
});

test("asistente/bases: query_database respeta exclude (filas, recuentos, propiedades y la propia base)", async () => {
  const { j, call, libros, cleanup } = await setup(["Libros/Ubik.md"]);
  try {
    await j.createRow(libros.path, { title: "Oculto", props: { Secreta: "x" } }); // fila visible: sirve de control
    const r = await call("query_database", { path: libros.path });
    assert.ok(!r.text.includes("Ubik"), "la fila excluida no aparece");
    assert.equal(r.json.total, r.json.rows.length);
    assert.equal((await call("list_databases")).json[0].rows, 2, "el recuento tampoco cuenta la excluida");
    assert.ok(!(await call("query_database", { path: libros.path, view: "Por estado" })).text.includes("Ubik"));
    j.close();
  } finally { cleanup(); }
  const t = await setup(["Bases/"]);
  try {
    assert.deepEqual((await t.call("list_databases")).json, []);
    assert.equal((await t.call("query_database", { path: t.libros.path })).isError, true);
    t.j.close();
  } finally { t.cleanup(); }
});

test("asistente/bases: lo que solo existe en una fila excluida no se deduce ni de los tipos de columna", async () => {
  const { j, call, libros, cleanup } = await setup(["Libros/Ubik.md"]);
  try {
    await j.setProps("Libros/Ubik.md", { SoloEnLoExcluido: 42 });
    await j.saveView(libros.path, { name: "Probe", kind: "table", columns: ["title", "SoloEnLoExcluido"], filter: [], sort: [], group: null });
    const r = await call("query_database", { path: libros.path, view: "Probe" });
    assert.ok(!r.text.includes("42"));
    assert.equal(r.json.columns.find((x: any) => x.key === "SoloEnLoExcluido").type, "text", "el tipo no se infiere de la fila oculta");
    j.close();
  } finally { cleanup(); }
});

test("asistente/bases: create_row crea la fila con Deshacer y registra la acción", async () => {
  const { j, undo, call, libros, cleanup } = await setup();
  try {
    const r = await call("create_row", { database: libros.path, title: "Solaris", props: { Estado: "Quiero leer", Nota: 8 } });
    assert.ok(!r.isError, r.text);
    assert.ok(r.undoId);
    assert.equal(j.index.getNote("Libros/Solaris.md")!.fm.Estado, "Quiero leer");
    assert.equal((await call("query_database", { path: libros.path })).json.total, 3);
    await undo.undo(r.undoId!);
    assert.equal(j.index.getNote("Libros/Solaris.md"), null);
    j.close();
  } finally { cleanup(); }
});

test("asistente/bases: create_row rechaza claves del sistema, valores con objetos y bases sin origen", async () => {
  const { j, call, libros, cleanup } = await setup();
  try {
    for (const props of [{ id: "x" }, { type: "task" }, { x: { a: 1 } }]) assert.equal((await call("create_row", { database: libros.path, title: "Mala", props })).isError, true, JSON.stringify(props));
    assert.equal(j.index.getNote("Libros/Mala.md"), null);
    const note = await j.createNote({ title: "Normal" });
    assert.equal((await call("create_row", { database: note.path, title: "X" })).isError, true);
    j.close();
  } finally { cleanup(); }
});

test("asistente/bases: create_row no escribe en carpetas excluidas y en Notas/Importado/ pasa por propuesta", async () => {
  const { j, call, cleanup } = await setup(["Privado/"]);
  try {
    const priv = await j.createDatabase({ name: "Diario privado", template: "vacía" });
    await j.setProps(priv.path, { source: { folder: "Privado/" } });
    assert.equal((await call("create_row", { database: priv.path, title: "Secreto" })).isError, true);
    assert.equal(j.index.getNote("Privado/Secreto.md"), null);

    const imp = await j.createDatabase({ name: "Importadas", template: "vacía" });
    await j.setProps(imp.path, { source: { folder: "Notas/Importado/" } });
    const r = await call("create_row", { database: imp.path, title: "Vieja" });
    assert.equal(r.json.escalated, true);
    assert.equal(j.index.getNote("Notas/Importado/Vieja.md"), null, "nada escrito: solo propuesta");
    assert.equal((await j.proposals.list("pending")).length, 1);
    j.close();
  } finally { cleanup(); }
});

test("asistente/bases: create_row con enlaces web va a propuesta; la sexta nota tocada también", async () => {
  const { j, call, libros, cleanup } = await setup();
  try {
    const ext = await call("create_row", { database: libros.path, title: "Con enlace", props: { Autor: "https://evil.example/?q=" } });
    assert.equal(ext.json.escalated, true);
    assert.equal(j.index.getNote("Libros/Con enlace.md"), null);
    for (let i = 1; i <= 5; i++) assert.ok(!(await call("create_row", { database: libros.path, title: `L${i}` })).json.escalated);
    const sixth = await call("create_row", { database: libros.path, title: "L6" });
    assert.equal(sixth.json.escalated, true);
    assert.equal(j.index.getNote("Libros/L6.md"), null);
    j.close();
  } finally { cleanup(); }
});

test("asistente/bases: set_props acepta propiedades libres pero no puede reescribir la definición de una base", async () => {
  const { j, call, libros, cleanup } = await setup();
  try {
    const ok = await call("set_props", { path: "Libros/Dune.md", props: { Estado: "Leído", Nota: 10 } });
    assert.ok(!ok.isError, ok.text);
    assert.equal(j.index.getNote("Libros/Dune.md")!.fm.Estado, "Leído");
    const before = (await j.readNote(libros.path)).text;
    for (const props of [{ views: "x" }, { source: "x" }, { properties: ["x"] }, { views: [{ name: "a" }] }]) assert.equal((await call("set_props", { path: libros.path, props })).isError, true, JSON.stringify(props));
    assert.equal((await j.readNote(libros.path)).text, before, "la definición no cambió");
    assert.equal((await call("set_props", { path: "Libros/Dune.md", props: { type: "task" } })).isError, true);
    j.close();
  } finally { cleanup(); }
});
