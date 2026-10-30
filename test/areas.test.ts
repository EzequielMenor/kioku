import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { parseColor, parseAreaTitle } from "../src/core/areas.ts";
import { tmpVault } from "./helpers.ts";

const NOW = () => new Date("2026-10-28T10:20:00");
const block = { id: "calendar-test-001", title: "Trabajo", kind: "block" as const, start: "2026-10-28T10:00", end: "2026-10-28T11:00" };
const AREA = { id: "area-jw-0001", title: "JW", color: "#1A2B3C" };

/** Markdown, registro de actividad y número de notas: todo lo que un rechazo debe dejar igual. */
function snapshot(root: string, j: Kioku): string {
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => (f.endsWith(".md") && !f.startsWith(".kioku")) || /^\.kioku\/log\/.*\.jsonl$/.test(f)).sort();
  return JSON.stringify([j.index.count(), files.map((f) => [f, readFileSync(path.join(root, f), "utf8")])]);
}

async function open(files: Record<string, string> = {}) {
  const { root, cleanup } = tmpVault(files);
  const j = await Kioku.open({ root, now: NOW });
  return { root, j, done: () => { j.close(); cleanup(); } };
}

test("color y título: validación estricta y color normalizado", () => {
  assert.equal(parseColor("#1A2B3C"), "#1a2b3c");
  assert.equal(parseColor("#abcdef"), "#abcdef");
  for (const bad of ["red", "#fff", "123456", "#12345g", "#12345678", " #123456", "#123456 ", "", 7, null, undefined, {}]) {
    assert.throws(() => parseColor(bad), /color/i, String(bad));
  }
  assert.equal(parseAreaTitle("  Estudio  "), "Estudio");
  for (const bad of ["", "   ", "a\nb", "a\u0000b", "x".repeat(61), 7, null, undefined]) {
    assert.throws(() => parseAreaTitle(bad), /título/i, String(bad));
  }
});

test("áreas: crear, listar, renombrar y recolorear persisten en Markdown y sobreviven a reindexar", async () => {
  const t = await open();
  try {
    assert.deepEqual(t.j.areas.list(), [], "sin áreas de ejemplo ni inferidas");
    const a = await t.j.areas.create(AREA);
    assert.equal(a.path, "Areas/area-jw-0001.md");
    assert.equal(a.title, "JW");
    assert.equal(a.color, "#1a2b3c");
    assert.ok(a.hash);
    const text = (await t.j.readNote(a.path)).text;
    assert.match(text, /type: area/);
    assert.match(text, /color: ["']?#1a2b3c["']?/);
    assert.equal(t.j.index.getNote(a.path)!.type, "area");
    assert.deepEqual(t.j.areas.list(), [a]);

    // Un comentario y un cuerpo escritos a mano sobreviven a editar nombre y color.
    const edited = text.replace("\n---\n", "\n# comentario propio\n---\n") + "\nNotas sobre el área.\n";
    const saved = await t.j.saveNote(a.path, edited, a.hash);
    const b = await t.j.areas.update(a.path, "Estudio", "#00FF80", saved.hash);
    assert.deepEqual([b.path, b.title, b.color], [a.path, "Estudio", "#00ff80"]);
    const after = (await t.j.readNote(a.path)).text;
    assert.match(after, /# comentario propio/);
    assert.match(after, /Notas sobre el área\./);
    assert.match(after, /id: /);

    await t.j.reindex();
    assert.deepEqual(t.j.areas.list(), [{ ...b, hash: (await t.j.readNote(a.path)).hash }]);
    assert.equal((await t.j.areas.create({ ...AREA, id: "area-otra-0002", title: "Ocio", color: "#aa0000" })).path, "Areas/area-otra-0002.md");
    assert.deepEqual(t.j.areas.list().map((x) => x.title), ["Estudio", "Ocio"]);
  } finally { t.done(); }
});

test("áreas: crear con el mismo identificador es idempotente; con otro contenido, conflicto sin cambios", async () => {
  const t = await open();
  try {
    const a = await t.j.areas.create(AREA);
    const before = snapshot(t.root, t.j);
    assert.deepEqual(await t.j.areas.create(AREA), a);
    assert.deepEqual(await t.j.areas.create({ ...AREA, color: "#1a2b3c", title: " JW " }), a, "mismo contenido tras normalizar");
    assert.equal(snapshot(t.root, t.j), before);
    for (const other of [{ ...AREA, title: "Otra" }, { ...AREA, color: "#000000" }]) {
      await assert.rejects(t.j.areas.create(other), (e: { code?: string }) => e.code === "conflict");
    }
    assert.equal(snapshot(t.root, t.j), before);
  } finally { t.done(); }
});

test("áreas: entradas y hash inválidos se rechazan sin tocar Markdown, registro ni recuento", async () => {
  const t = await open();
  try {
    const a = await t.j.areas.create(AREA);
    const task = await t.j.createNote({ title: "Tarea", type: "task" });
    const before = snapshot(t.root, t.j);
    const bad = [
      { ...AREA, id: "corto" }, { ...AREA, id: "con espacios!!" }, { ...AREA, id: "area-nueva-0003", title: "  " },
      { ...AREA, id: "area-nueva-0003", title: "x".repeat(61) }, { ...AREA, id: "area-nueva-0003", color: "rojo" },
      { ...AREA, id: "area-nueva-0003", color: "#fff" }, { ...AREA, id: "area-nueva-0003", color: 5 as never },
    ];
    for (const input of bad) await assert.rejects(t.j.areas.create(input), (e: { code?: string }) => e.code === "invalid", JSON.stringify(input));
    for (const [title, color, hash] of [["", "#112233", a.hash], ["Ok", "azul", a.hash], ["Ok", "#abc", a.hash], ["Ok", "#112233", ""], ["Ok", "#112233", "0".repeat(40)]] as const) {
      await assert.rejects(t.j.areas.update(a.path, title, color, hash), (e: { code?: string }) => ["invalid", "conflict"].includes(e.code ?? ""), `${title}|${color}|${hash}`);
    }
    // No es un área: una tarea, una ruta que no existe y una actividad.
    await assert.rejects(t.j.areas.update(task.path, "Ok", "#112233", task.hash), (e: { code?: string }) => e.code === "invalid");
    await assert.rejects(t.j.areas.update("Areas/no-existe.md", "Ok", "#112233", a.hash), (e: { code?: string }) => e.code === "invalid");
    assert.equal(snapshot(t.root, t.j), before);
    assert.equal((await t.j.readNote(a.path)).hash, a.hash);
    assert.deepEqual(t.j.areas.list(), [a]);
  } finally { t.done(); }
});

test("áreas: un cambio sin efecto no reescribe el archivo y un hash obsoleto es conflicto", async () => {
  const t = await open();
  try {
    const a = await t.j.areas.create(AREA);
    const same = await t.j.areas.update(a.path, "JW", "#1A2B3C", a.hash);
    assert.deepEqual(same, a);
    await t.j.setProps(a.path, { nota: "x" });
    await assert.rejects(t.j.areas.update(a.path, "Nuevo", "#112233", a.hash), (e: { code?: string }) => e.code === "conflict");
    assert.equal(t.j.areas.list()[0].title, "JW");
  } finally { t.done(); }
});

test("actividades: asignar, cambiar y quitar el área de bloques y eventos; nombre y color siguen a la ruta estable", async () => {
  const t = await open();
  try {
    const jw = await t.j.areas.create(AREA);
    const work = await t.j.areas.create({ id: "area-trab-0002", title: "Trabajo", color: "#334455" });
    const project = await t.j.createNote({ title: "Proyecto X", type: "project" });
    const task = await t.j.createNote({ title: "Escribir", type: "task", fm: { project: "[[Proyecto X]]" } });
    const b = await t.j.calendar.create({ ...block, taskPath: task.path });
    assert.deepEqual([b.areaPath, b.areaTitle, b.areaColor], [null, null, null], "sin área, como antes");
    const ev = await t.j.calendar.create({ ...block, id: "calendar-test-002", kind: "event", areaPath: jw.path });
    assert.deepEqual([ev.areaPath, ev.areaTitle, ev.areaColor], [jw.path, "JW", "#1a2b3c"]);
    assert.equal(ev.projectPath, null);

    const withArea = await t.j.calendar.setArea(b.path, jw.path, b.hash);
    assert.deepEqual([withArea.areaPath, withArea.areaTitle, withArea.areaColor], [jw.path, "JW", "#1a2b3c"]);
    assert.equal(withArea.taskPath, task.path);
    assert.equal(withArea.projectPath, project.path, "el proyecto heredado de la tarea no depende del área");
    assert.notEqual(withArea.hash, b.hash);
    assert.equal(t.j.index.getNote(task.path)!.fm.area, undefined);

    const changed = await t.j.calendar.setArea(b.path, work.path, withArea.hash);
    assert.deepEqual([changed.areaPath, changed.areaTitle, changed.areaColor], [work.path, "Trabajo", "#334455"]);
    const evChanged = await t.j.calendar.setArea(ev.path, work.path, ev.hash);
    assert.equal(evChanged.areaPath, work.path);

    // Renombrar y recolorear llega a las actividades por la ruta estable tras reindexar.
    const renamed = await t.j.areas.update(work.path, "Oficina", "#FF0000", work.hash);
    assert.equal(renamed.path, work.path);
    await t.j.reindex();
    const { items } = t.j.calendar.range("2026-10-28", "2026-10-28");
    assert.deepEqual(items.map((i) => [i.areaPath, i.areaTitle, i.areaColor]), [[work.path, "Oficina", "#ff0000"], [work.path, "Oficina", "#ff0000"]]);

    const cleared = await t.j.calendar.setArea(b.path, null, (await t.j.readNote(b.path)).hash);
    assert.deepEqual([cleared.areaPath, cleared.areaTitle, cleared.areaColor], [null, null, null]);
    assert.equal(cleared.taskPath, task.path);
    assert.equal(t.j.index.getNote(b.path)!.fm.area, undefined);
  } finally { t.done(); }
});

test("actividades: setArea conserva cuerpo, comentarios y propiedades ajenas, y es idempotente sin escribir", async () => {
  const t = await open();
  try {
    const a = await t.j.areas.create(AREA);
    const b = await t.j.calendar.create(block);
    const text = (await t.j.readNote(b.path)).text.replace("\n---\n", "\n# mi comentario\ncustom: conservar\n---\n") + "\nCuerpo propio.\n";
    const saved = await t.j.saveNote(b.path, text, b.hash);
    const set = await t.j.calendar.setArea(b.path, a.path, saved.hash);
    const after = (await t.j.readNote(b.path)).text;
    assert.match(after, /# mi comentario/);
    assert.match(after, /custom: conservar/);
    assert.match(after, /Cuerpo propio\./);
    assert.match(after, /area: "?\[\[Areas\/area-jw-0001\]\]"?/);
    const none = await t.j.calendar.create({ ...block, id: "calendar-test-009" });
    const before = snapshot(t.root, t.j);
    assert.deepEqual(await t.j.calendar.setArea(b.path, a.path, "obsoleto"), set, "ya tiene esa área: no escribe");
    assert.deepEqual(await t.j.calendar.setArea(none.path, null, "obsoleto"), none, "ya sin área: no escribe");
    assert.equal(snapshot(t.root, t.j), before);
    assert.equal((await t.j.readNote(b.path)).text, after);
  } finally { t.done(); }
});

test("actividades: áreas inválidas y hash obsoleto se rechazan sin efectos; crear con área es idempotente", async () => {
  const t = await open();
  try {
    const a = await t.j.areas.create(AREA);
    const task = await t.j.createNote({ title: "Escribir", type: "task" });
    const b = await t.j.calendar.create({ ...block, areaPath: a.path });
    const old = await t.j.calendar.create({ ...block, id: "calendar-test-002" });
    const oldText = (await t.j.readNote(old.path)).text;
    const before = snapshot(t.root, t.j);
    for (const bad of [task.path, "Areas/no-existe.md", "../x.md", "Areas/area-jw-0001", "Areas/[[x]].md", "Calendario/calendar-test-002.md", 7 as never]) {
      await assert.rejects(t.j.calendar.create({ ...block, id: "calendar-test-010", areaPath: bad }), (e: { code?: string }) => e.code === "invalid", String(bad));
      await assert.rejects(t.j.calendar.setArea(old.path, bad, old.hash), (e: { code?: string }) => e.code === "invalid", String(bad));
    }
    await assert.rejects(t.j.calendar.setArea(old.path, a.path, "0".repeat(40)), (e: { code?: string }) => e.code === "conflict");
    await assert.rejects(t.j.calendar.setArea(old.path, a.path, ""), (e: { code?: string }) => e.code === "invalid");
    await assert.rejects(t.j.calendar.setArea(task.path, a.path, task.hash), (e: { code?: string }) => e.code === "invalid", "una tarea no es una actividad");
    await assert.rejects(t.j.calendar.setArea(a.path, a.path, a.hash), (e: { code?: string }) => e.code === "invalid", "un área no es una actividad");
    assert.equal(snapshot(t.root, t.j), before);
    assert.equal((await t.j.readNote(old.path)).text, oldText, "sin área, byte a byte igual");

    assert.deepEqual(await t.j.calendar.create({ ...block, areaPath: a.path }), b);
    await assert.rejects(t.j.calendar.create({ ...block, areaPath: undefined }), (e: { code?: string }) => e.code === "conflict");
    assert.equal(snapshot(t.root, t.j), before);
  } finally { t.done(); }
});

test("actividades: si el área desaparece o deja de ser válida, la actividad sigue y se muestra sin área", async () => {
  const t = await open();
  try {
    const a = await t.j.areas.create(AREA);
    const b = await t.j.calendar.create({ ...block, areaPath: a.path });
    await t.j.setProps(a.path, { color: "no-es-color" });
    assert.deepEqual(t.j.areas.list(), [], "un área con color roto no se ofrece");
    const item = t.j.calendar.range("2026-10-28", "2026-10-28").items[0];
    assert.deepEqual([item.path, item.areaPath, item.areaTitle, item.areaColor], [b.path, null, null, null]);
    assert.equal(t.j.calendar.range("2026-10-28", "2026-10-28").invalid.length, 0);
  } finally { t.done(); }
});

test("las actividades antiguas, sin área, no cambian de contenido al listar, crear o editar áreas", async () => {
  const old = "---\nid: 01HXOLD\ntype: block\ntitle: Antigua\nkind: block\nstart: 2026-10-28T09:00\nend: 2026-10-28T09:30\ncreated: 2026-10-27T00:00:00.000Z\n---\nCuerpo\n";
  const t = await open({ "Calendario/antigua.md": old });
  try {
    const a = await t.j.areas.create(AREA);
    await t.j.areas.update(a.path, "Otra", "#010203", a.hash);
    const item = t.j.calendar.range("2026-10-28", "2026-10-28").items[0];
    assert.deepEqual([item.areaPath, item.areaTitle, item.areaColor], [null, null, null]);
    assert.equal(readFileSync(path.join(t.root, "Calendario/antigua.md"), "utf8"), old);
  } finally { t.done(); }
});
