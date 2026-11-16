import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDatabase } from "../src/core/database.ts";
import { BIBLE_BOOKS } from "../src/core/bible.ts";
import { Kioku } from "../src/core/kioku.ts";
import { AssistantTools } from "../src/assistant/tools.ts";
import { SessionRegistry } from "../src/assistant/session.ts";
import { UndoStore } from "../src/assistant/undo.ts";
import { lastDays, readingTotals, streak, toggleDay } from "../web/src/trackers.ts";
import { tmpVault } from "./helpers.ts";

test("bases: vistas «habits» y «progress» con su propiedad de seguimiento (y valores por defecto)", () => {
  const db = parseDatabase({ path: "x.md", title: "x", fm: { views: [
    { name: "Semana", kind: "habits", track: "Hechos" },
    { name: "Progreso", kind: "progress", track: "Leídos", total: "Capítulos", group: "Testamento", sort: [{ prop: "Orden", dir: "asc" }] },
    { name: "Sin más", kind: "habits" },
  ] } });
  assert.deepEqual(db.warnings, []);
  assert.equal(db.views[0].track, "Hechos");
  assert.deepEqual([db.views[1].track, db.views[1].total, db.views[1].group], ["Leídos", "Capítulos", "Testamento"]);
  assert.equal(db.views[2].track, "Hechos", "por defecto, «Hechos»");
});

test("Biblia: 66 libros, 39 + 27, 1189 capítulos y nombres únicos", () => {
  assert.equal(BIBLE_BOOKS.length, 66);
  assert.equal(BIBLE_BOOKS.filter((b) => b.testament === "Antiguo").length, 39);
  assert.equal(BIBLE_BOOKS.reduce((n, b) => n + b.chapters, 0), 1189);
  assert.equal(new Set(BIBLE_BOOKS.map((b) => b.name)).size, 66);
  assert.deepEqual(BIBLE_BOOKS.find((b) => b.name === "Salmos"), { name: "Salmos", chapters: 150, testament: "Antiguo" });
});

test("plantillas: «Hábitos» y «Lectura de la Biblia» crean bases con su vista visual (la Biblia, con sus 66 libros)", async () => {
  const { root, cleanup } = tmpVault();
  const j = await Kioku.open({ root });
  try {
    const h = await j.createDatabase({ name: "Hábitos", template: "hábitos" });
    const hd = j.queryDatabase(h.path).database;
    assert.equal(hd.source.folder, "Hábitos/");
    assert.equal(hd.views[0].kind, "habits");
    const b = await j.createDatabase({ name: "Lectura de la Biblia", template: "biblia" });
    const r = await j.queryDatabase(b.path);
    assert.equal(r.total, 66);
    assert.equal(r.rows[0].title, "Génesis", "en orden canónico");
    assert.equal(r.rows[0].cells["Capítulos"], 50);
    assert.equal(r.rows[0].cells["Leídos"], 0);
    assert.equal(r.database.views[0].kind, "progress");
    await assert.rejects(j.createDatabase({ name: "Otra Biblia", template: "biblia" }), /Ya tienes/, "no duplica los 66 libros");
  } finally { j.close(); cleanup(); }
});

test("Kio: log_habit marca (o desmarca) un hábito por su nombre, sin duplicar el día y con Deshacer", async () => {
  const { root, cleanup } = tmpVault();
  const j = await Kioku.open({ root });
  try {
    const h = await j.createDatabase({ name: "Hábitos", template: "hábitos" });
    await j.createRow(h.path, { title: "Ejercicio" });
    const tools = new AssistantTools(j, new UndoStore(j), { exclude: [] });
    const s = new SessionRegistry().open();
    const call = async (args: unknown) => { const r = await tools.call(s, "log_habit", args); return { ...r, json: r.isError ? null : JSON.parse(r.text) }; };
    const a = await call({ habit: "ejercicio", date: "2026-11-16" });
    assert.ok(!a.isError, a.text);
    assert.deepEqual(j.index.getNote("Hábitos/Ejercicio.md")!.fm["Hechos"], ["2026-11-16"]);
    await call({ habit: "Ejercicio", date: "2026-11-16" });
    assert.deepEqual(j.index.getNote("Hábitos/Ejercicio.md")!.fm["Hechos"], ["2026-11-16"], "el mismo día no se repite");
    await call({ habit: "Ejercicio", date: "2026-11-15" });
    assert.deepEqual(j.index.getNote("Hábitos/Ejercicio.md")!.fm["Hechos"], ["2026-11-15", "2026-11-16"]);
    const off = await call({ habit: "Ejercicio", date: "2026-11-15", done: false });
    assert.deepEqual(j.index.getNote("Hábitos/Ejercicio.md")!.fm["Hechos"], ["2026-11-16"]);
    await new UndoStore(j).undo(off.undoId!);
    assert.deepEqual(j.index.getNote("Hábitos/Ejercicio.md")!.fm["Hechos"], ["2026-11-15", "2026-11-16"]);
    assert.match((await call({ habit: "Meditar" })).text, /No encuentro el hábito «Meditar».*Ejercicio/s, "dice cuáles hay");
  } finally { j.close(); cleanup(); }
});

test("seguimientos: últimos días, marcar y desmarcar, racha y totales de lectura", () => {
  assert.deepEqual(lastDays("2026-11-16", 3), ["2026-11-14", "2026-11-15", "2026-11-16"]);
  assert.deepEqual(lastDays("2026-03-01", 2), ["2026-02-28", "2026-03-01"]);
  assert.deepEqual(toggleDay(["2026-11-14"], "2026-11-16"), ["2026-11-14", "2026-11-16"]);
  assert.deepEqual(toggleDay(["2026-11-14", "2026-11-16"], "2026-11-16"), ["2026-11-14"]);
  assert.equal(streak(["2026-11-14", "2026-11-15", "2026-11-16"], "2026-11-16"), 3);
  assert.equal(streak(["2026-11-14", "2026-11-15"], "2026-11-16"), 2, "hoy aún no cuenta como fallo");
  assert.equal(streak(["2026-11-13"], "2026-11-16"), 0);
  assert.equal(streak("no es lista", "2026-11-16"), 0);
  const t = readingTotals([{ cells: { "Leídos": 50, "Capítulos": 50 } }, { cells: { "Leídos": 7, "Capítulos": 40 } }, { cells: { "Leídos": "x", "Capítulos": 27 } }] as never, "Leídos", "Capítulos");
  assert.deepEqual(t, { read: 57, total: 117, done: 1, pct: 49 });
});
