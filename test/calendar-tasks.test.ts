// Tareas del calendario (JARV-27): crear solo con título, editar en el sitio, panel de pendientes, arrastrar a la agenda y enlazar tareas a eventos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { dropStart, minuteStamp, pendingTasks, taskChanges, taskDraftBlock, taskInput, TASK_MIME } from "../web/src/calendar-model.ts";
import type { CalendarEntry, CalendarTask } from "../web/src/types.ts";
import { tmpVault } from "./helpers.ts";

const NOW = new Date("2026-10-28T10:20:00");
const BLOCK = { id: "tarea-cal-001", title: "Trabajo", kind: "block" as const, start: "2026-10-28T10:00", end: "2026-10-28T11:00" };
const EVENT = { ...BLOCK, id: "tarea-cal-002", title: "Reunión", kind: "event" as const };
const LITERAL = "Llamar a Ana mañana 18h p1 #urgente @Casa !decisión";
const count = (j: Kioku) => j.index.count();
const logSize = async (j: Kioku) => (await j.vault.readInternal(`log/${NOW.toISOString().slice(0, 7)}.jsonl`)) ?? "";

async function open(files: Record<string, string> = {}) {
  const { root, cleanup } = tmpVault(files);
  const j = await Kioku.open({ root, now: () => NOW });
  return { j, root, done: () => { j.close(); cleanup(); } };
}

// ───────────── Núcleo: crear y editar tareas ─────────────

test("crear tarea: solo el título basta y se guarda literal, sin interpretar la sintaxis de captura", async () => {
  const t = await open();
  try {
    const task = await t.j.createTask({ title: `  ${LITERAL}  ` });
    assert.equal(task.type, "task");
    assert.equal(task.title, LITERAL);
    assert.equal(task.fm.status, "todo");
    for (const key of ["due", "estimate", "project", "priority", "tags"]) assert.equal(task.fm[key], undefined, key);
    assert.equal(task.tags.length, 0, "«#urgente» no es una etiqueta");
    assert.equal(t.j.index.tasks({ status: ["todo"] }).length, 1);
    assert.equal(t.j.index.tasks()[0].due, null, "«mañana» no es una fecha");
    assert.equal(t.j.index.tasks()[0].priority, null, "«p1» no es una prioridad");
    assert.equal(t.j.inbox().length, 0, "no cae en la Bandeja");
    assert.equal(count(t.j), 1, "no se crean proyectos ni decisiones");
    assert.match(await logSize(t.j), /"kind":"capture"/);
    await t.j.reindex();
    assert.equal(t.j.index.getNote(task.path)!.title, LITERAL, "sobrevive a reindexar");
  } finally { t.done(); }
});

test("crear tarea: fecha, estimación y proyecto opcionales se guardan y se resuelven", async () => {
  const t = await open();
  try {
    const project = await t.j.createNote({ title: "Casa", type: "project", fm: { status: "active" } });
    const task = await t.j.createTask({ title: "Pintar", due: "2026-11-05", estimate: 45, projectPath: project.path });
    assert.equal(task.fm.due, "2026-11-05");
    assert.equal(task.fm.estimate, 45);
    const row = t.j.index.tasks({ projectPath: project.path })[0];
    assert.deepEqual([row.path, row.due, row.projectTitle], [task.path, "2026-11-05", "Casa"]);
    assert.equal(t.j.calendar.range("2026-10-28", "2026-10-28").tasks.find((x) => x.path === task.path)!.estimate, 45);
    const nulls = await t.j.createTask({ title: "Sin extras", due: null, estimate: null, projectPath: null });
    assert.equal(nulls.fm.due, undefined);
  } finally { t.done(); }
});

test("crear tarea: lo inválido se rechaza sin escribir nada", async () => {
  const t = await open({ "Tareas/Otra.md": "---\ntype: task\nstatus: todo\n---\nx\n" });
  try {
    const before = [count(t.j), await logSize(t.j)];
    const bad: [string, Parameters<Kioku["createTask"]>[0], RegExp][] = [
      ["título vacío", { title: "   " }, /título/],
      ["título multilínea", { title: "a\nb" }, /título/],
      ["título enorme", { title: "x".repeat(201) }, /título/],
      ["título no texto", { title: 5 as never }, /título/],
      ["fecha imposible", { title: "a", due: "2026-02-30" }, /[Ff]echa/],
      ["fecha mal formada", { title: "a", due: "mañana" }, /[Ff]echa/],
      ["estimación cero", { title: "a", estimate: 0 }, /stimaci/],
      ["estimación decimal", { title: "a", estimate: 1.5 }, /stimaci/],
      ["estimación texto", { title: "a", estimate: "30" as never }, /stimaci/],
      ["estimación enorme", { title: "a", estimate: 1441 }, /stimaci/],
      ["proyecto inexistente", { title: "a", projectPath: "Proyectos/Nada.md" }, /royecto/],
      ["proyecto que es tarea", { title: "a", projectPath: "Tareas/Otra.md" }, /royecto/],
      ["proyecto con corchetes", { title: "a", projectPath: "Proyectos/[[x]].md" }, /royecto/],
    ];
    for (const [name, input, message] of bad) await assert.rejects(t.j.createTask(input), message, name);
    assert.deepEqual([count(t.j), await logSize(t.j)], before);
  } finally { t.done(); }
});

test("editar tarea: cambia solo lo pedido, conserva el resto del Markdown y no escribe sin cambios", async () => {
  const t = await open();
  try {
    const project = await t.j.createNote({ title: "Casa", type: "project", fm: { status: "active" } });
    const other = await t.j.createNote({ title: "Taller", type: "project", fm: { status: "active" } });
    const created = await t.j.createTask({ title: "Pintar", due: "2026-11-05", estimate: 45, projectPath: project.path });
    await t.j.setProps(created.path, { custom: "preservar", priority: 2 });
    const task = (await t.j.readNote(created.path));
    const body = task.text.split("---\n").pop();
    const u = await t.j.updateTask(created.path, { title: "  Pintar la sala ", estimate: 90, projectPath: other.path }, task.hash);
    assert.equal(u.title, "Pintar la sala");
    assert.equal(u.fm.estimate, 90);
    assert.equal(u.fm.due, "2026-11-05", "lo no pedido no cambia");
    assert.equal(u.fm.custom, "preservar");
    assert.equal(u.fm.priority, 2);
    assert.equal(t.j.index.tasks({ projectPath: other.path }).length, 1);
    assert.equal((await t.j.readNote(created.path)).text.split("---\n").pop(), body);

    const cleared = await t.j.updateTask(created.path, { due: null, estimate: null, projectPath: null }, u.hash);
    for (const key of ["due", "estimate", "project"]) assert.equal(cleared.fm[key], undefined, key);
    assert.equal(cleared.fm.custom, "preservar");

    const same = await t.j.updateTask(created.path, { title: "Pintar la sala", due: null }, cleared.hash);
    assert.equal(same.hash, cleared.hash, "sin cambios no se escribe");
    // El mismo proyecto escrito de otra forma (`[[Título]]` de una captura) tampoco cuenta como cambio.
    await t.j.setProps(created.path, { project: "[[Casa]]" });
    const viaTitle = await t.j.updateTask(created.path, { projectPath: project.path }, (await t.j.readNote(created.path)).hash);
    assert.equal(viaTitle.fm.project, "[[Casa]]");
  } finally { t.done(); }
});

test("editar tarea: hash viejo, destino que no es tarea y datos inválidos fallan sin cambiar nada", async () => {
  const t = await open();
  try {
    const project = await t.j.createNote({ title: "Casa", type: "project", fm: { status: "active" } });
    const created = await t.j.createTask({ title: "Pintar", estimate: 30 });
    const hash = (await t.j.readNote(created.path)).hash;
    const before = [(await t.j.readNote(created.path)).text, count(t.j), await logSize(t.j)];
    await assert.rejects(t.j.updateTask(created.path, { title: "x" }, "0".repeat(64)), /cambió/);
    await assert.rejects(t.j.updateTask(created.path, { title: "x" }, ""), /hash/i);
    await assert.rejects(t.j.updateTask(created.path, { title: " " }, hash), /título/);
    await assert.rejects(t.j.updateTask(created.path, { due: "2026-02-30" }, hash), /[Ff]echa/);
    await assert.rejects(t.j.updateTask(created.path, { estimate: -5 }, hash), /stimaci/);
    await assert.rejects(t.j.updateTask(created.path, { projectPath: created.path }, hash), /royecto/);
    await assert.rejects(t.j.updateTask(project.path, { title: "x" }, (await t.j.readNote(project.path)).hash), /tarea/);
    await assert.rejects(t.j.updateTask("Tareas/nunca.md", { title: "x" }, hash), /tarea/);
    assert.deepEqual([(await t.j.readNote(created.path)).text, count(t.j), await logSize(t.j)], before);
  } finally { t.done(); }
});

test("task forms: create, edit and clear area, priority and status atomically through the API", async () => {
  const t = await setup();
  try {
    const area = await t.j.areas.create({ id: "task-area-001", title: "Casa", color: "#334455" });
    const created = await t.call("POST", "/api/task/create", { title: "Literal mañana p1", status: "doing", priority: 1, areaPath: area.path });
    assert.equal(created.status, 200, created.text);
    const read = () => t.call("GET", `/api/note?path=${encodeURIComponent(created.json.path)}`);
    let note = (await read()).json;
    assert.equal(note.note.fm.status, "doing");
    assert.equal(note.note.fm.priority, 1);
    assert.equal(note.note.fm.area, "[[Areas/task-area-001]]");
    assert.equal(note.note.fm.project, undefined, "area does not require a project");
    const changed = await t.call("POST", "/api/task/update", { path: created.json.path, hash: note.hash, status: "done", priority: 3 });
    assert.equal(changed.status, 200, changed.text);
    note = (await read()).json;
    assert.equal(note.note.fm.status, "done");
    assert.equal(note.note.fm.done_at, NOW.toISOString());
    assert.equal(note.note.fm.area, "[[Areas/task-area-001]]");
    const same = await t.call("POST", "/api/task/update", { path: created.json.path, hash: note.hash, status: "done" });
    assert.equal(same.json.hash, note.hash, "saving the same status preserves completion time");
    const cleared = await t.call("POST", "/api/task/update", { path: created.json.path, hash: note.hash, status: "todo", priority: null, areaPath: null });
    assert.equal(cleared.status, 200, cleared.text);
    note = (await read()).json;
    for (const key of ["area", "priority", "done_at"]) assert.equal(note.note.fm[key], undefined, key);
    const before = snapshot(t);
    for (const fields of [{ status: "invalid" }, { status: null }, { priority: 0 }, { priority: 4 }, { priority: "1" }, { areaPath: "Tareas/Escribir.md" }, { areaPath: "Areas/missing.md" }]) {
      for (const endpoint of ["create", "update"]) {
        const result = await t.call("POST", `/api/task/${endpoint}`, { title: "Rejected", path: created.json.path, hash: note.hash, ...fields });
        assert.equal(result.status, 400, result.text);
        assert.ok(result.json.error);
        assert.equal(snapshot(t), before, "rejection leaves notes, counters and log unchanged");
      }
    }
    assert.equal((await t.call("POST", "/api/task/update", { path: created.json.path, hash: created.json.hash, priority: 2 })).status, 409);
    assert.equal(snapshot(t), before);
  } finally { await t.done(); }
});

// ───────────── Núcleo: eventos con tarea ─────────────

test("un evento puede llevar tarea; seguir sin poder terminarse y la tarea y el bloque se completan por separado", async () => {
  const t = await open();
  try {
    const task = await t.j.createTask({ title: "Preparar" });
    const ev = await t.j.calendar.create({ ...EVENT, taskPath: task.path });
    assert.equal(ev.kind, "event");
    assert.equal(ev.taskPath, task.path);
    await assert.rejects(t.j.calendar.finish(ev.path, ev.hash), /evento/);
    await t.j.setTaskStatus(task.path, "done");
    const after = t.j.calendar.range("2026-10-28", "2026-10-28").items.find((i) => i.path === ev.path)!;
    assert.equal(after.done_at, undefined, "completar la tarea no toca el evento");
    assert.equal(after.taskPath, task.path);
    await t.j.reindex();
    assert.equal(t.j.calendar.range("2026-10-28", "2026-10-28").items[0].taskPath, task.path);
  } finally { t.done(); }
});

test("convertir un bloque con tarea en evento conserva la tarea y suelta la finalización", async () => {
  const t = await open();
  try {
    const task = await t.j.createTask({ title: "Preparar" });
    const b = await t.j.calendar.create({ ...BLOCK, taskPath: task.path });
    const done = await t.j.calendar.finish(b.path, b.hash);
    assert.ok(done.done_at);
    const ev = await t.j.calendar.update(b.path, { kind: "event" }, done.hash);
    assert.equal(ev.kind, "event");
    assert.equal(ev.taskPath, task.path, "un evento ya puede llevar tarea");
    assert.equal(ev.done_at, undefined, "un evento no se termina");
    assert.equal(t.j.index.getNote(task.path)!.fm.status, "todo");
  } finally { t.done(); }
});

test("enlazar tarea existente: asigna, cambia y quita; no toca la tarea ni la finalización del bloque", async () => {
  const t = await open();
  try {
    const a = await t.j.createTask({ title: "A" });
    const b = await t.j.createTask({ title: "B" });
    const ev = await t.j.calendar.create(EVENT);
    const aText = (await t.j.readNote(a.path)).text;
    const linked = await t.j.calendar.linkTask(ev.path, a.path, ev.hash);
    assert.equal(linked.taskPath, a.path);
    assert.equal(linked.kind, "event");
    assert.equal((await t.j.calendar.linkTask(ev.path, a.path, linked.hash)).hash, linked.hash, "enlazar lo ya enlazado no escribe");
    const swapped = await t.j.calendar.linkTask(ev.path, b.path, linked.hash);
    assert.equal(swapped.taskPath, b.path);
    const none = await t.j.calendar.linkTask(ev.path, null, swapped.hash);
    assert.equal(none.taskPath, null);
    assert.equal((await t.j.calendar.linkTask(ev.path, null, none.hash)).hash, none.hash);
    assert.equal((await t.j.readNote(a.path)).text, aText, "la tarea no se modifica al enlazarla");

    const blk = await t.j.calendar.create({ ...BLOCK, taskPath: a.path });
    const fin = await t.j.calendar.finish(blk.path, blk.hash);
    const moved = await t.j.calendar.linkTask(blk.path, b.path, fin.hash);
    assert.equal(moved.done_at, fin.done_at, "cambiar la tarea de un bloque terminado no lo reabre");
    assert.equal(t.j.index.getNote(b.path)!.fm.status, "todo");
  } finally { t.done(); }
});

test("enlazar tarea: lo inválido o desactualizado se rechaza sin escribir", async () => {
  const t = await open();
  try {
    const task = await t.j.createTask({ title: "A" });
    const note = await t.j.createNote({ title: "Nota", type: "note" });
    const ev = await t.j.calendar.create(EVENT);
    const before = [(await t.j.readNote(ev.path)).text, count(t.j), await logSize(t.j)];
    await assert.rejects(t.j.calendar.linkTask(ev.path, task.path, "0".repeat(64)), /cambió/);
    await assert.rejects(t.j.calendar.linkTask(ev.path, task.path, ""), /hash/i);
    await assert.rejects(t.j.calendar.linkTask(ev.path, "Tareas/nada.md", ev.hash), /tarea/);
    await assert.rejects(t.j.calendar.linkTask(ev.path, note.path, ev.hash), /tarea/);
    await assert.rejects(t.j.calendar.linkTask(ev.path, "Tareas/[[x]].md", ev.hash), /tarea/);
    await assert.rejects(t.j.calendar.linkTask(task.path, task.path, ev.hash), /actividad/);
    assert.deepEqual([(await t.j.readNote(ev.path)).text, count(t.j), await logSize(t.j)], before);
  } finally { t.done(); }
});

test("crear y enlazar una tarea nueva dentro de un evento: título literal, una sola vez, y nada se crea si falla", async () => {
  const t = await open();
  try {
    const project = await t.j.createNote({ title: "Casa", type: "project", fm: { status: "active" } });
    const ev = await t.j.calendar.create(EVENT);
    const before = [count(t.j), (await t.j.readNote(ev.path)).text];
    await assert.rejects(t.j.calendar.linkNewTask(ev.path, { title: LITERAL }, "0".repeat(64)), /cambió/);
    await assert.rejects(t.j.calendar.linkNewTask(ev.path, { title: " " }, ev.hash), /título/);
    await assert.rejects(t.j.calendar.linkNewTask(ev.path, { title: "a", due: "2026-02-30" }, ev.hash), /[Ff]echa/);
    await assert.rejects(t.j.calendar.linkNewTask(ev.path, { title: "a", projectPath: "Proyectos/Nada.md" }, ev.hash), /royecto/);
    assert.deepEqual([count(t.j), (await t.j.readNote(ev.path)).text], before, "ni tarea huérfana ni cambios en el evento");

    const r = await t.j.calendar.linkNewTask(ev.path, { title: LITERAL, due: "2026-11-05", estimate: 20, projectPath: project.path }, ev.hash);
    const task = t.j.index.getNote(r.taskPath!)!;
    assert.equal(task.type, "task");
    assert.equal(task.title, LITERAL);
    assert.deepEqual([task.fm.due, task.fm.estimate, task.fm.status], ["2026-11-05", 20, "todo"]);
    assert.equal(r.projectPath, project.path, "la actividad muestra el proyecto de su tarea");
    assert.equal(count(t.j), before[0] as number + 1);
  } finally { t.done(); }
});

test("el rango trae el hash de cada tarea pendiente y hay una lista de proyectos para elegir", async () => {
  const t = await open();
  try {
    const project = await t.j.createNote({ title: "Casa", type: "project", fm: { status: "active" } });
    const task = await t.j.createTask({ title: "A" });
    const range = t.j.calendar.range("2026-10-28", "2026-10-28");
    assert.equal(range.tasks.find((x) => x.path === task.path)!.hash, (await t.j.readNote(task.path)).hash);
    assert.ok(!("projects" in range), "la forma del rango no cambia");
    assert.deepEqual(t.j.calendar.projects(), [{ path: project.path, title: "Casa" }]);
  } finally { t.done(); }
});

// ───────────── API ─────────────

const KEY = "b".repeat(64);
const FM = (extra: string) => `---\nid: 01HX${Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(22, "0")}\ncreated: 2026-10-27T00:00:00.000Z\n${extra}---\n`;
const SEED = {
  "Tareas/Escribir.md": FM("type: task\nstatus: todo\nestimate: 30\n") + "Escribir\n",
  "Tareas/Privada.md": FM("type: task\nstatus: todo\n") + "MARCASECRETA\n",
  "Proyectos/Publico.md": FM("type: project\nstatus: active\n") + "Público\n",
  "Privado/Proyecto oculto.md": FM("type: project\nstatus: active\n") + "MARCASECRETA\n",
};

async function setup(seed: Record<string, string> = SEED) {
  const { root, cleanup } = tmpVault(seed);
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  mkdirSync(path.join(root, ".kioku"), { recursive: true });
  writeFileSync(path.join(root, ".kioku", "mobile.json"), JSON.stringify({ exclude: ["Privado/"] }));
  const j = await Kioku.open({ root, now: () => NOW });
  const srv = await startServer(j, { port: 0, webDir: web, key: KEY });
  const mk = loadOrCreateMobileKey(root);
  const call = async (method: string, p: string, body?: unknown, key: string | null = KEY) => {
    const r = await fetch(srv.url + p, {
      method,
      headers: { ...(key ? { "x-kioku-key": key } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, text: await r.text(), get json() { try { return JSON.parse(this.text); } catch { return null; } } };
  };
  const mobile = (method: string, p: string, body?: unknown) => call(method, p, body, mk);
  return { j, root, call, mobile, done: async () => { await srv.close(); j.close(); cleanup(); rmSync(web, { recursive: true, force: true }); } };
}
function snapshot(t: { root: string; j: Kioku }): string {
  const files = readdirSync(t.root, { recursive: true, encoding: "utf8" })
    .filter((f) => (f.endsWith(".md") && !f.startsWith(".kioku")) || /^\.kioku\/log\/.*\.jsonl$/.test(f)).sort();
  return JSON.stringify([t.j.index.count(), files.map((f) => [f, readFileSync(path.join(t.root, f), "utf8")])]);
}

test("API: crear y editar tarea en el sitio; errores como 400/409 sin cambios", async () => {
  const t = await setup();
  try {
    const c = await t.call("POST", "/api/task/create", { title: LITERAL, due: "2026-11-05", estimate: 25, projectPath: "Proyectos/Publico.md" });
    assert.equal(c.status, 200, c.text);
    assert.deepEqual(Object.keys(c.json).sort(), ["hash", "path", "title"]);
    assert.equal(c.json.title, LITERAL);
    const note = t.j.index.getNote(c.json.path)!;
    assert.deepEqual([note.fm.due, note.fm.estimate], ["2026-11-05", 25]);
    const range = await t.call("GET", "/api/calendar?from=2026-10-28&to=2026-10-28");
    const row = range.json.tasks.find((x: { path: string }) => x.path === c.json.path) as { estimate: number; hash: string; projectPath: string };
    assert.deepEqual([row.estimate, row.hash, row.projectPath], [25, c.json.hash, "Proyectos/Publico.md"]);

    const u = await t.call("POST", "/api/task/update", { path: c.json.path, hash: c.json.hash, title: "Nuevo", estimate: null, due: null, projectPath: null });
    assert.equal(u.status, 200, u.text);
    assert.equal(u.json.title, "Nuevo");
    assert.notEqual(u.json.hash, c.json.hash);
    assert.equal(t.j.index.getNote(c.json.path)!.fm.estimate, undefined);

    const before = snapshot(t);
    for (const [url, body, status] of [
      ["/api/task/create", { title: " " }, 400],
      ["/api/task/create", {}, 400],
      ["/api/task/create", { title: "a", due: 5 }, 400],
      ["/api/task/create", { title: "a", estimate: "30" }, 400],
      ["/api/task/create", { title: "a", projectPath: "../x.md" }, 400],
      ["/api/task/create", { title: "a", projectPath: "Proyectos/Nada.md" }, 400],
      ["/api/task/update", { path: c.json.path, hash: c.json.hash, title: "viejo" }, 409],
      ["/api/task/update", { path: c.json.path, title: "sin hash" }, 400],
      ["/api/task/update", { path: "Proyectos/Publico.md", hash: "h", title: "x" }, 400],
      ["/api/task/update", { path: c.json.path, hash: u.json.hash, title: 7 }, 400],
      ["/api/task/update", { path: c.json.path, hash: u.json.hash, due: "mañana" }, 400],
    ] as const) assert.equal((await t.call("POST", url, body)).status, status, `${url} ${JSON.stringify(body)}`);
    assert.equal(snapshot(t), before);
    assert.equal((await t.call("POST", "/api/task/create", { title: "x" }, null)).status, 401);
  } finally { await t.done(); }
});

test("API: enlazar tarea a un evento (existente o nueva) y quitarla", async () => {
  const t = await setup();
  try {
    const ev = await t.call("POST", "/api/calendar/create", { ...EVENT, kind: "event", taskPath: "Tareas/Escribir.md" });
    assert.equal(ev.status, 200, ev.text);
    assert.equal(ev.json.taskPath, "Tareas/Escribir.md");
    const none = await t.call("POST", "/api/calendar/link", { path: ev.json.path, taskPath: null, hash: ev.json.hash });
    assert.equal(none.status, 200, none.text);
    assert.equal(none.json.taskPath, null);
    assert.ok(!("task" in none.json), "relaciones crudas fuera del DTO");
    const again = await t.call("POST", "/api/calendar/link", { path: ev.json.path, taskPath: "Tareas/Escribir.md", hash: none.json.hash });
    assert.equal(again.json.taskPath, "Tareas/Escribir.md");
    const made = await t.call("POST", "/api/calendar/link", { path: ev.json.path, task: { title: LITERAL, estimate: 15 }, hash: again.json.hash });
    assert.equal(made.status, 200, made.text);
    assert.equal(t.j.index.getNote(made.json.taskPath)!.title, LITERAL);
    assert.equal(made.json.kind, "event");

    const before = snapshot(t);
    for (const [body, status] of [
      [{ path: ev.json.path, hash: made.json.hash }, 400],
      [{ path: ev.json.path, hash: made.json.hash, taskPath: "Tareas/Escribir.md", task: { title: "x" } }, 400],
      [{ path: ev.json.path, hash: made.json.hash, taskPath: "Tareas/Nada.md" }, 400],
      [{ path: ev.json.path, hash: made.json.hash, taskPath: 7 }, 400],
      [{ path: ev.json.path, hash: made.json.hash, task: { title: "  " } }, 400],
      [{ path: ev.json.path, hash: made.json.hash, task: "x" }, 400],
      [{ path: ev.json.path, hash: ev.json.hash, taskPath: "Tareas/Escribir.md" }, 409],
      [{ path: ev.json.path, taskPath: null }, 400],
      [{ path: "Tareas/Escribir.md", hash: "h", taskPath: null }, 400],
    ] as const) assert.equal((await t.call("POST", "/api/calendar/link", body)).status, status, JSON.stringify(body));
    assert.equal(snapshot(t), before);
  } finally { await t.done(); }
});

test("API: un cambio nulo exige igualmente un hash válido y vigente (400 sin hash o vacío, 409 si está viejo); el nulo vigente no escribe", async () => {
  const t = await setup();
  try {
    const task = await t.call("POST", "/api/task/create", { title: "Pintar", estimate: 30 });
    const ev = await t.call("POST", "/api/calendar/create", { ...EVENT, kind: "event", taskPath: "Tareas/Escribir.md" });
    const stale = "0".repeat(64);
    const same = { path: task.json.path, title: "Pintar" };
    const bad: [string, string, Record<string, unknown>, number, unknown][] = [
      ["task/update título igual, hash viejo", "/api/task/update", { ...same, hash: stale }, 409, { error: "La tarea cambió: recargá antes de modificarla", code: "conflict" }],
      ["task/update título igual, hash vacío", "/api/task/update", { ...same, hash: "" }, 400, { error: "Falta el hash de la tarea", code: "invalid" }],
      ["task/update título igual, sin hash", "/api/task/update", { ...same }, 400, { error: "Falta «hash»" }],
      ["task/update sin cambios, hash viejo", "/api/task/update", { path: task.json.path, hash: stale }, 409, { error: "La tarea cambió: recargá antes de modificarla", code: "conflict" }],
      ["task/update campos iguales, hash vacío", "/api/task/update", { ...same, estimate: 30, due: null, hash: "" }, 400, { error: "Falta el hash de la tarea", code: "invalid" }],
      ["link misma tarea, hash viejo", "/api/calendar/link", { path: ev.json.path, taskPath: "Tareas/Escribir.md", hash: stale }, 409, { error: "La actividad cambió: recargá antes de modificarla", code: "conflict" }],
      ["link misma tarea, hash vacío", "/api/calendar/link", { path: ev.json.path, taskPath: "Tareas/Escribir.md", hash: "" }, 400, { error: "Falta el hash de la actividad", code: "invalid" }],
      ["link misma tarea, sin hash", "/api/calendar/link", { path: ev.json.path, taskPath: "Tareas/Escribir.md" }, 400, { error: "Falta «hash»" }],
    ];
    const before = snapshot(t);
    for (const [name, url, body, status, expected] of bad) {
      const r = await t.call("POST", url, body);
      assert.equal(r.status, status, `${name}: ${r.text}`);
      assert.deepEqual(r.json, expected, name);
      assert.equal(snapshot(t), before, `${name}: no escribe nada`);
    }
    // Una actividad ya sin tarea: quitar el enlace tampoco salta la comprobación.
    const loose = await t.call("POST", "/api/calendar/create", { ...EVENT, id: "tarea-cal-003", kind: "event" });
    const before2 = snapshot(t);
    const absent = await t.call("POST", "/api/calendar/link", { path: loose.json.path, taskPath: null, hash: stale });
    assert.deepEqual([absent.status, absent.json], [409, { error: "La actividad cambió: recargá antes de modificarla", code: "conflict" }]);
    const empty = await t.call("POST", "/api/calendar/link", { path: loose.json.path, taskPath: null, hash: "" });
    assert.deepEqual([empty.status, empty.json], [400, { error: "Falta el hash de la actividad", code: "invalid" }]);
    assert.equal(snapshot(t), before2);

    // Con el hash vigente el cambio nulo sigue siendo 200 y no escribe.
    const ok = await t.call("POST", "/api/task/update", { ...same, hash: task.json.hash });
    assert.deepEqual([ok.status, ok.json], [200, task.json]);
    const okLink = await t.call("POST", "/api/calendar/link", { path: ev.json.path, taskPath: "Tareas/Escribir.md", hash: ev.json.hash });
    assert.deepEqual([okLink.status, okLink.json], [200, ev.json]);
    const okAbsent = await t.call("POST", "/api/calendar/link", { path: loose.json.path, taskPath: null, hash: loose.json.hash });
    assert.deepEqual([okAbsent.status, okAbsent.json], [200, loose.json]);
    assert.equal(snapshot(t), before2, "los cambios nulos vigentes no tocan Markdown, registro ni contador");
  } finally { await t.done(); }
});

test("API móvil: enlazar tareas a eventos sigue siendo solo de escritorio y no cambia nada; la lectura sigue sin filtrar lo privado", async () => {
  const t = await setup();
  try {
    const ev = await t.call("POST", "/api/calendar/create", { ...EVENT, kind: "event" });
    const before = snapshot(t);
    for (const [url, body] of [
      ["/api/calendar/link", { path: ev.json.path, hash: ev.json.hash, taskPath: "Tareas/Escribir.md" }],
      ["/api/calendar/link", { path: ev.json.path, hash: ev.json.hash, task: { title: "x" } }],
    ] as const) {
      const r = await t.mobile("POST", url, body);
      assert.equal(r.status, 403, `${url} ${r.text}`);
    }
    assert.equal(snapshot(t), before);
    // Lo anterior del móvil sigue igual.
    assert.equal((await t.mobile("POST", "/api/task/status", { path: "Tareas/Escribir.md", status: "doing" })).status, 200);
    assert.equal((await t.mobile("POST", "/api/capture", { text: "algo" })).status, 200);
    const range = await t.mobile("GET", "/api/calendar?from=2026-10-28&to=2026-10-28");
    assert.equal(range.status, 200);
    assert.ok(!range.text.includes("Proyecto oculto") && !range.text.includes("MARCASECRETA"));
    const projects = await t.mobile("GET", "/api/calendar/projects");
    assert.equal(projects.status, 200);
    assert.deepEqual(projects.json, [{ path: "Proyectos/Publico.md", title: "Publico" }]);
    assert.ok(!projects.text.includes("Proyecto oculto") && !projects.text.includes("MARCASECRETA"));
    // El rol completo ve los dos proyectos.
    assert.equal((await t.call("GET", "/api/calendar/projects")).json.length, 2);
  } finally { await t.done(); }
});

test("task forms: calendar/link keeps ignoring status, priority and area of the task it creates", async () => {
  const t = await setup();
  try {
    const area = await t.j.areas.create({ id: "task-area-002", title: "Casa", color: "#334455" });
    const ev = await t.call("POST", "/api/calendar/create", { ...EVENT, kind: "event" });
    const made = await t.call("POST", "/api/calendar/link", { path: ev.json.path, hash: ev.json.hash, task: { title: "Desde el evento", status: "done", priority: 1, areaPath: area.path } });
    assert.equal(made.status, 200, made.text);
    const fm = t.j.index.getNote(made.json.taskPath)!.fm;
    assert.equal(fm.status, "todo");
    for (const key of ["priority", "area", "done_at"]) assert.equal(fm[key], undefined, key);
    const bad = await t.call("POST", "/api/calendar/link", { path: ev.json.path, hash: made.json.hash, task: { title: "Otra", status: "invalid", priority: 9 } });
    assert.equal(bad.status, 200, "campos ajenos al enlace siguen sin validarse");
  } finally { await t.done(); }
});

const PRIVATE_SEED = {
  ...SEED,
  "Privado/Tarea oculta.md": FM("type: task\nstatus: todo\n") + "MARCASECRETA\n",
};

test("task forms: mobile role creates and edits visible tasks online with the new routes", async () => {
  const t = await setup(PRIVATE_SEED);
  try {
    const area = await t.j.areas.create({ id: "movil-area", title: "Casa", color: "#334455" });
    const made = await t.mobile("POST", "/api/task/create", { title: "Desde el móvil p1", status: "doing", priority: 2, areaPath: area.path, projectPath: "Proyectos/Publico.md", due: "2026-11-05", estimate: 20 });
    assert.equal(made.status, 200, made.text);
    assert.match(made.json.path, /^Tareas\//);
    const fm = t.j.index.getNote(made.json.path)!.fm;
    assert.deepEqual([fm.status, fm.priority, fm.due, fm.estimate], ["doing", 2, "2026-11-05", 20]);
    const read = await t.mobile("GET", `/api/note?path=${encodeURIComponent(made.json.path)}`);
    const edited = await t.mobile("POST", "/api/task/update", { path: made.json.path, hash: read.json.hash, status: "done", areaPath: null });
    assert.equal(edited.status, 200, edited.text);
    const after = t.j.index.getNote(made.json.path)!.fm;
    assert.deepEqual([after.status, after.area, after.done_at], ["done", undefined, NOW.toISOString()]);
  } finally { await t.done(); }
});

test("task forms: mobile role cannot create or edit tasks that touch private folders, and nothing is written", async () => {
  const t = await setup(PRIVATE_SEED);
  try {
    await t.j.areas.create({ id: "area-oculta-001", title: "Oculta", color: "#334455" });
    const visible = t.j.index.getNote("Tareas/Escribir.md")!;
    const read = (await t.call("GET", "/api/note?path=Tareas/Escribir.md")).json;
    // Privado/ además del área «oculta» y un fichero concreto de Tareas/.
    writeFileSync(path.join(t.root, ".kioku", "mobile.json"), JSON.stringify({ exclude: ["Privado/", "Areas/area-oculta-001.md", "Tareas/Secreta.md"] }));
    const before = snapshot(t);
    const attempts: [string, string, Record<string, unknown>][] = [
      ["create en proyecto privado", "/api/task/create", { title: "x", projectPath: "Privado/Proyecto oculto.md" }],
      ["create en área privada", "/api/task/create", { title: "x", areaPath: "Areas/area-oculta-001.md" }],
      ["create cuyo fichero sería privado", "/api/task/create", { title: "Secreta" }],
      ["create cuyo fichero sería privado (otras mayúsculas)", "/api/task/create", { title: "sECRETA" }],
      ["update de tarea privada", "/api/task/update", { path: "Privado/Tarea oculta.md", hash: "h", title: "x" }],
      ["update a proyecto privado", "/api/task/update", { path: visible.path, hash: read.hash, projectPath: "Privado/Proyecto oculto.md" }],
      ["update a área privada", "/api/task/update", { path: visible.path, hash: read.hash, areaPath: "Areas/area-oculta-001.md" }],
      ["update con ruta disfrazada", "/api/task/update", { path: "Tareas/../Privado/Tarea oculta.md", hash: "h", title: "x" }],
    ];
    for (const [name, url, body] of attempts) {
      const r = await t.mobile("POST", url, body);
      assert.equal(r.status, 403, `${name}: ${r.text}`);
      assert.equal(snapshot(t), before, `${name}: no escribe ni cuenta ni registra`);
    }
    // Carpeta por defecto excluida entera.
    writeFileSync(path.join(t.root, ".kioku", "mobile.json"), JSON.stringify({ exclude: ["Tareas/"] }));
    const r = await t.mobile("POST", "/api/task/create", { title: "Nueva" });
    assert.equal(r.status, 403, r.text);
    assert.equal(snapshot(t), before, "Tareas/ excluida: no se crea nada");
    // El escritorio no queda afectado por la configuración del móvil.
    assert.equal((await t.call("POST", "/api/task/create", { title: "Secreta" })).status, 200);
  } finally { await t.done(); }
});

test("task forms: mobile role cannot update a task whose existing project or area is private or unresolved", async () => {
  const t = await setup({
    ...SEED,
    "Tareas/Relacionada.md": FM("type: task\nstatus: todo\nproject: \"[[Privado/Proyecto oculto]]\"\n") + "MARCASECRETA\n",
    "Tareas/Rota.md": FM("type: task\nstatus: todo\nproject: \"[[Proyecto que no existe]]\"\n") + "x\n",
    "Tareas/Visible.md": FM("type: task\nstatus: todo\nproject: \"[[Proyectos/Publico]]\"\n") + "Visible\n",
  });
  try {
    const hash = async (rel: string) => (await t.call("GET", `/api/note?path=${encodeURIComponent(rel)}`)).json.hash as string;
    const area = await t.j.areas.create({ id: "area-privada-01", title: "Privada", color: "#334455" });
    const withArea = await t.call("POST", "/api/task/create", { title: "Con área", areaPath: area.path });
    writeFileSync(path.join(t.root, ".kioku", "mobile.json"), JSON.stringify({ exclude: ["Privado/", area.path] }));
    const listed = (await t.mobile("GET", "/api/tasks")).text;
    assert.ok(!listed.includes("Relacionada"), "la tarea con proyecto privado no sale en la lista móvil");
    const bodies: [string, Record<string, unknown>][] = [
      ["Tareas/Relacionada.md", { title: "Changed from mobile" }],
      ["Tareas/Relacionada.md", { projectPath: null }],
      ["Tareas/Relacionada.md", { projectPath: "Proyectos/Publico.md", areaPath: null }],
      ["Tareas/Rota.md", { title: "Changed from mobile" }],
      [withArea.json.path, { title: "Changed from mobile" }],
      [withArea.json.path, { areaPath: null }],
    ];
    const before = snapshot(t);
    for (const [rel, body] of bodies) {
      const r = await t.mobile("POST", "/api/task/update", { path: rel, hash: await hash(rel), ...body });
      assert.equal(r.status, 403, `${rel} ${JSON.stringify(body)}: ${r.text}`);
      assert.equal(snapshot(t), before, `${rel}: no escribe ni cuenta ni registra`);
    }
    // El escritorio sí puede, y una tarea visible se edita con normalidad desde el móvil.
    assert.equal((await t.call("POST", "/api/task/update", { path: "Tareas/Relacionada.md", hash: await hash("Tareas/Relacionada.md"), title: "Desde el portátil" })).status, 200);
    const ok = await t.mobile("POST", "/api/task/update", { path: "Tareas/Visible.md", hash: await hash("Tareas/Visible.md"), title: "Editada en el móvil", priority: 1 });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(t.j.index.getNote("Tareas/Visible.md")!.title, "Editada en el móvil");
    assert.equal(t.j.index.getNote("Tareas/Visible.md")!.fm.project, "[[Proyectos/Publico]]");
  } finally { await t.done(); }
});

test("API: completar una tarea la quita de pendientes sin cambiar su bloque enlazado", async () => {
  const t = await setup();
  try {
    const block = await t.call("POST", "/api/calendar/create", { ...BLOCK, taskPath: "Tareas/Escribir.md" });
    assert.equal(block.status, 200, block.text);
    const url = "/api/calendar?from=2026-10-28&to=2026-10-28";
    const before = await t.call("GET", url);
    assert.ok(pendingTasks(before.json.tasks).some((x) => x.path === "Tareas/Escribir.md"));
    const done = await t.call("POST", "/api/task/status", { path: "Tareas/Escribir.md", status: "done" });
    assert.equal(done.status, 200, done.text);
    const after = await t.call("GET", url);
    assert.ok(!pendingTasks(after.json.tasks).some((x) => x.path === "Tareas/Escribir.md"));
    assert.deepEqual(after.json.items.find((x: CalendarEntry) => x.path === block.json.path), before.json.items.find((x: CalendarEntry) => x.path === block.json.path));
  } finally { await t.done(); }
});

test("panel: completar es una acción accesible que reutiliza la escritura existente", () => {
  const ui = src("calendar.tsx");
  const row = ui.slice(ui.indexOf("function TaskRow("), ui.indexOf("/** Tareas pendientes junto al calendario"));
  assert.match(row, /aria-label=\{`Completar «\$\{task.title\}»`\}/);
  assert.match(row, /onComplete\(task.path\)/);
  assert.match(ui, /<TaskPanel[^>]*onComplete=\{completeTask\}/);
  assert.equal((ui.match(/\/api\/task\/status/g) ?? []).length, 1);
});

test("panel: fechas legibles relativas al día real, con límites y cambio de año", async () => {
  const model = await import("../web/src/calendar-model.ts");
  const label = (model as unknown as { taskDueLabel(due: string, today: string): string }).taskDueLabel;
  assert.equal(label("2026-12-30", "2026-12-31"), "vencida · 30 de diciembre de 2026");
  assert.equal(label("2026-12-31", "2026-12-31"), "vence hoy");
  assert.equal(label("2027-01-01", "2026-12-31"), "vence mañana");
  assert.equal(label("2027-01-06", "2026-12-31"), "vence miércoles");
  assert.equal(label("2027-01-07", "2026-12-31"), "vence 7 de enero de 2027");
  const ui = src("calendar.tsx");
  assert.match(ui, /<TaskPanel[^>]*today=\{today\}/);
  assert.match(ui, /taskDueLabel\(task.due, today\)/);
});

// ───────────── Interfaz: lógica pura ─────────────

const task = (over: Partial<CalendarTask> & { path: string }): CalendarTask => ({
  title: "Tarea", status: "todo", projectPath: null, projectTitle: null, due: null, priority: null, doneAt: null, mtime: 0, focus: null, estimate: 30, hash: "h", ...over,
});
const act = (from: string, to: string, over: Partial<CalendarEntry> = {}): CalendarEntry => ({
  path: `Calendario/${from}.md`, title: "A", kind: "block", hash: "h", state: "pending", taskPath: null, projectPath: null, projectTitle: null,
  start: `2026-10-28T${from}`, end: `2026-10-28T${to}`, ...over,
});

test("panel: solo pendientes, las que vencen antes primero y sin fecha al final", () => {
  const list = pendingTasks([
    task({ path: "c", title: "C" }), task({ path: "d", status: "done" }), task({ path: "x", status: "dropped" }),
    task({ path: "b", title: "B", due: "2026-11-02" }), task({ path: "a", title: "A", due: "2026-11-02", priority: 1 }), task({ path: "e", title: "E", status: "doing", due: "2026-10-30" }),
  ]);
  assert.deepEqual(list.map((x) => x.path), ["e", "a", "b", "c"]);
});

test("formulario de tarea: el título basta; fecha, estimación y proyecto se validan y se normalizan", () => {
  assert.deepEqual(taskInput({ title: "  Pintar ", due: "", estimate: "", projectPath: "" }), { ok: true, value: { title: "Pintar" } });
  assert.deepEqual(taskInput({ title: "x", due: "2026-11-05", estimate: " 45 ", projectPath: "Proyectos/A.md" }), { ok: true, value: { title: "x", due: "2026-11-05", estimate: 45, projectPath: "Proyectos/A.md" } });
  for (const [draft, error] of [
    [{ title: "  ", due: "", estimate: "", projectPath: "" }, /título/],
    [{ title: "x", due: "2026-02-30", estimate: "", projectPath: "" }, /fecha/],
    [{ title: "x", due: "", estimate: "0", projectPath: "" }, /stimaci/],
    [{ title: "x", due: "", estimate: "1.5", projectPath: "" }, /stimaci/],
    [{ title: "x", due: "", estimate: "abc", projectPath: "" }, /stimaci/],
    [{ title: "x", due: "", estimate: "1441", projectPath: "" }, /stimaci/],
  ] as const) {
    const r = taskInput(draft);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, error);
  }
  assert.equal((taskInput({ title: "a\nb", due: "", estimate: "", projectPath: "" }) as { ok: false }).ok, false);
});

test("edición en el sitio: solo viaja lo que cambió; vaciar un campo lo quita", () => {
  const t = task({ path: "Tareas/A.md", title: "A", due: "2026-11-05", estimate: 30, projectPath: "Proyectos/P.md" });
  const same = { title: "A", due: "2026-11-05", estimate: "30", projectPath: "Proyectos/P.md" };
  assert.deepEqual(taskChanges(t, same), { ok: true, value: {} });
  assert.deepEqual(taskChanges(t, { ...same, title: " B " }), { ok: true, value: { title: "B" } });
  assert.deepEqual(taskChanges(t, { title: "A", due: "", estimate: "", projectPath: "" }), { ok: true, value: { due: null, estimate: null, projectPath: null } });
  assert.deepEqual(taskChanges(t, { ...same, estimate: "45", projectPath: "Proyectos/Q.md" }), { ok: true, value: { estimate: 45, projectPath: "Proyectos/Q.md" } });
  assert.equal(taskChanges(t, { ...same, title: "" }).ok, false);
  assert.equal(taskChanges(t, { ...same, estimate: "-3" }).ok, false);
});

test("arrastrar una tarea a la agenda: bloque con su estimación (30 min si no tiene) y la tarea enlazada", () => {
  assert.equal(TASK_MIME, "application/x-kioku-task");
  assert.deepEqual(taskDraftBlock(task({ path: "Tareas/A.md", title: "A", estimate: 45 }), "2026-10-28T14:00"),
    { kind: "block", title: "A", start: "2026-10-28T14:00", end: "2026-10-28T14:45", taskPath: "Tareas/A.md" });
  assert.equal(taskDraftBlock(task({ path: "Tareas/A.md", estimate: null }), "2026-10-28T14:00").end, "2026-10-28T14:30");
  assert.equal(taskDraftBlock(task({ path: "Tareas/A.md", estimate: 60 }), "2026-10-28T23:30").end, "2026-10-29T00:30", "puede cruzar medianoche");
});

test("soltar en la cuadrícula: el minuto bajo el puntero da la hora de inicio, sin llegar a medianoche", () => {
  assert.equal(minuteStamp("2026-10-28", 14 * 60 + 15), "2026-10-28T14:15");
  assert.equal(minuteStamp("2026-10-28", 7 * 60), "2026-10-28T07:00");
  assert.equal(minuteStamp("2026-10-28", 24 * 60), "2026-10-28T23:45");
  assert.equal(minuteStamp("2026-10-28", -30), "2026-10-28T00:00");
});

test("soltar en un día sin hora: el primer hueco libre donde cabe; si no cabe, la hora inicial por defecto", () => {
  const day = "2026-10-29";
  const busy = (from: string, to: string) => act(from, to, { start: `${day}T${from}`, end: `${day}T${to}`, path: `Calendario/${from}.md` });
  assert.equal(dropStart([busy("07:00", "09:00"), busy("09:30", "12:00")], day, NOW, 30), `${day}T09:00`);
  assert.equal(dropStart([busy("07:00", "09:00"), busy("09:30", "12:00")], day, NOW, 60), `${day}T12:00`, "salta el hueco de 30 min");
  assert.equal(dropStart([], day, NOW, 60), `${day}T07:00`);
  assert.equal(dropStart([busy("07:00", "22:00")], day, NOW, 30), `${day}T09:00`, "día lleno: la hora por defecto, con aviso de cruce");
  assert.equal(dropStart([], "2026-10-28", NOW, 30), "2026-10-28T10:20", "hoy: desde ahora");
  assert.equal(dropStart([], "2026-10-27", NOW, 30), "2026-10-27T09:00", "día pasado: la hora por defecto");
});

// ───────────── Interfaz: contrato estático ─────────────

const src = (f: string) => readFileSync(path.join(import.meta.dirname, "..", "web", "src", f), "utf8");

test("interfaz: panel de pendientes con crear/editar en el sitio, alternativa de teclado y táctil y enlace dentro de la actividad", () => {
  const ui = src("calendar.tsx"), grid = src("calendar-grid.tsx"), css = src("calendar.css");
  assert.match(ui, /aria-label="Tareas pendientes"/);
  assert.match(ui, /\/api\/task\/create/);
  assert.match(ui, /\/api\/task\/update/);
  assert.match(ui, /\/api\/calendar\/link/);
  assert.match(ui, /draggable/, "las tareas se arrastran");
  assert.match(ui, /TASK_MIME/);
  assert.match(ui, />Programar</, "alternativa sin arrastrar (teclado y táctil)");
  assert.match(ui, /isMobile\(\)/, "las escrituras nuevas son de escritorio");
  assert.match(grid, /onDropTask/, "la cuadrícula del día acepta tareas");
  assert.match(grid, /TASK_MIME/);
  assert.match(grid, /onPointerDown=\{down\}/, "el movimiento con puntero de la cuadrícula sigue igual");
  assert.match(css, /\.cal-tasks\b/);
  assert.doesNotMatch(ui, /offline\/(runtime|store|queue)/);
  // `min=1` con `step=5` haría inválido «20»: el navegador bloquearía el envío sin decir nada.
  assert.doesNotMatch(ui, /type="number"[^>]*\bstep=/);
  // Esc en «Editar» desmonta el botón que abrió el formulario: el foco vuelve al botón nuevo de la misma fila, sin temporizadores.
  const row = ui.slice(ui.indexOf("function TaskRow("), ui.indexOf("/** Tareas pendientes junto al calendario"));
  assert.match(row, /editButton/, "la fila guarda una referencia a su botón Editar");
  assert.match(row, /useEffect\(/);
  assert.doesNotMatch(row, /setTimeout|requestAnimationFrame/);
});
