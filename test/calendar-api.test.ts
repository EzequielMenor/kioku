import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { tmpVault } from "./helpers.ts";

const KEY = "b".repeat(64);
const FM = (extra: string) => `---\nid: 01HX${Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(22, "0")}\ncreated: 2026-10-27T00:00:00.000Z\n${extra}---\n`;
const BLOCK = (title: string, rel: string) => FM(`type: block\ntitle: ${title}\nkind: block\nstart: 2026-10-28T09:00\nend: 2026-10-28T09:30\n${rel}`) + "\n";
const SEED = {
  "Tareas/Escribir.md": FM("type: task\nstatus: todo\nestimate: 30\n") + "Escribir\n",
  "Tareas/Con proyecto oculto.md": FM("type: task\nstatus: todo\nproject: \"[[Proyecto oculto]]\"\n") + "x\n",
  "Proyectos/Publico.md": FM("type: project\nstatus: active\n") + "Público\n",
  "Privado/Tarea privada.md": FM("type: task\nstatus: todo\n") + "MARCASECRETA\n",
  "Privado/Proyecto oculto.md": FM("type: project\nstatus: active\n") + "MARCASECRETA\n",
  "Calendario/visible.md": BLOCK("Visible", ""),
  "Calendario/con-tarea-privada.md": BLOCK("ACTIVIDADOCULTA tarea", "task: \"[[Privado/Tarea privada]]\"\n"),
  "Calendario/con-proyecto-privado.md": BLOCK("ACTIVIDADOCULTA proyecto", "project: \"[[Privado/Proyecto oculto]]\"\n"),
  "Calendario/via-tarea.md": BLOCK("ACTIVIDADOCULTA via tarea", "task: \"[[Con proyecto oculto]]\"\n"),
  "Calendario/tarea-sin-resolver.md": BLOCK("ACTIVIDADOCULTA sin tarea", "task: \"[[No existe nada]]\"\n"),
  "Calendario/proyecto-sin-resolver.md": BLOCK("ACTIVIDADOCULTA sin proyecto", "project: \"[[No existe nada]]\"\n"),
  "Privado/Actividad.md": BLOCK("ACTIVIDADOCULTA carpeta", ""),
};
const HIDDEN = ["con-tarea-privada", "con-proyecto-privado", "via-tarea", "tarea-sin-resolver", "proyecto-sin-resolver"];
const ALL = { id: "calendar-api-001", title: "Trabajo", kind: "block", start: "2026-10-28T10:00", end: "2026-10-28T11:00" };
const DAY = "from=2026-10-28&to=2026-10-28";

async function setup(seed: Record<string, string> = SEED) {
  const { root, cleanup } = tmpVault(seed);
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  mkdirSync(path.join(root, ".kioku"), { recursive: true });
  writeFileSync(path.join(root, ".kioku", "mobile.json"), JSON.stringify({ exclude: ["Privado/"] }));
  const j = await Kioku.open({ root, now: () => new Date("2026-10-28T10:20:00") });
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
const read = (root: string, rel: string) => readFileSync(path.join(root, rel), "utf8");

test("API calendario: rango inclusivo, crear idempotente, mover con hash y terminar sin tocar la tarea", async () => {
  const t = await setup({ "Tareas/Escribir.md": SEED["Tareas/Escribir.md"] });
  try {
    assert.equal((await t.call("GET", "/api/calendar?" + DAY, undefined, null)).status, 401);
    const c = await t.call("POST", "/api/calendar/create", { ...ALL, taskPath: "Tareas/Escribir.md" });
    assert.equal(c.status, 200, c.text);
    assert.equal(c.json.path, "Calendario/calendar-api-001.md");
    assert.equal(c.json.taskPath, "Tareas/Escribir.md");
    assert.equal(c.json.state, "active");
    assert.ok(!("task" in c.json) && !("project" in c.json), "relaciones crudas fuera del DTO");
    const again = await t.call("POST", "/api/calendar/create", { ...ALL, taskPath: "Tareas/Escribir.md" });
    assert.deepEqual(again.json, c.json);
    const next = await t.call("POST", "/api/calendar/create", { ...ALL, id: "calendar-api-002", start: "2026-10-29T00:00", end: "2026-10-29T01:00" });
    assert.equal(next.status, 200);

    const day = await t.call("GET", "/api/calendar?" + DAY);
    assert.equal(day.status, 200);
    assert.deepEqual(day.json.items.map((i: { path: string }) => i.path), [c.json.path]);
    assert.deepEqual(day.json.tasks.map((x: { path: string; estimate: number }) => [x.path, x.estimate]), [["Tareas/Escribir.md", 30]]);
    assert.equal(day.json.items[0].hash, c.json.hash);
    // `to` es inclusivo: el 29 trae la actividad de las 00:00.
    const two = await t.call("GET", "/api/calendar?from=2026-10-28&to=2026-10-29");
    assert.equal(two.json.items.length, 2);

    const stale = await t.call("POST", "/api/calendar/move", { path: c.json.path, start: "2026-10-29T10:00", end: "2026-10-29T11:00", hash: "0".repeat(64) });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, "conflict");
    const moved = await t.call("POST", "/api/calendar/move", { path: c.json.path, start: "2026-10-29T10:00", end: "2026-10-29T11:00", hash: c.json.hash });
    assert.equal(moved.status, 200, moved.text);
    assert.equal(moved.json.start, "2026-10-29T10:00");
    assert.equal(moved.json.state, "pending");
    assert.notEqual(moved.json.hash, c.json.hash);
    assert.equal((await t.call("GET", "/api/calendar?" + DAY)).json.items.length, 0);

    const fin = await t.call("POST", "/api/calendar/finish", { path: c.json.path, hash: moved.json.hash });
    assert.equal(fin.status, 200, fin.text);
    assert.equal(fin.json.state, "done");
    assert.ok(fin.json.done_at);
    const fin2 = await t.call("POST", "/api/calendar/finish", { path: c.json.path, hash: moved.json.hash });
    assert.equal(fin2.json.done_at, fin.json.done_at);
    // Terminar el bloque no completa la tarea…
    const tasks = await t.call("GET", "/api/tasks");
    assert.equal(tasks.json.find((x: { path: string }) => x.path === "Tareas/Escribir.md").status, "todo");
    // …y completar la tarea no toca el bloque.
    assert.equal((await t.call("POST", "/api/task/status", { path: "Tareas/Escribir.md", status: "done" })).status, 200);
    const after = await t.call("POST", "/api/calendar/create", { ...ALL, id: "calendar-api-003", taskPath: "Tareas/Escribir.md" });
    assert.equal(after.json.done_at, undefined);
    const week = await t.call("GET", "/api/calendar?from=2026-10-28&to=2026-10-29");
    assert.deepEqual(week.json.tasks, []);
    assert.ok(week.json.items.every((i: { path: string; state: string }) => i.path !== after.json.path || i.state === "active"));
  } finally { await t.done(); }
});

test("API calendario: rango, entrada y hash inválidos fallan sin tocar el vault", async () => {
  const t = await setup({ "Tareas/Escribir.md": SEED["Tareas/Escribir.md"] });
  try {
    const c = await t.call("POST", "/api/calendar/create", ALL);
    const before = read(t.root, c.json.path);
    const notes = t.j.index.count();
    for (const qs of ["", "from=2026-10-28", "to=2026-10-28", "from=ayer&to=2026-10-28", "from=2026-02-30&to=2026-03-01", "from=2026-10-29&to=2026-10-28", "from=2025-01-01&to=2026-10-28"]) {
      const r = await t.call("GET", "/api/calendar?" + qs);
      assert.equal(r.status, 400, qs + " " + r.text);
      assert.ok(r.json.error);
    }
    const bad: [string, unknown][] = [
      ["id corto", { ...ALL, id: "x" }],
      ["sin título", { ...ALL, id: "calendar-api-010", title: "  " }],
      ["tipo", { ...ALL, id: "calendar-api-011", kind: "otro" }],
      ["fin antes del inicio", { ...ALL, id: "calendar-api-012", end: "2026-10-28T09:00" }],
      ["fecha mal formada", { ...ALL, id: "calendar-api-013", start: "2026-10-28 10:00" }],
      ["tarea inexistente", { ...ALL, id: "calendar-api-014", taskPath: "Tareas/Nada.md" }],
      ["tarea con ..", { ...ALL, id: "calendar-api-015", taskPath: "../x.md" }],
      ["tarea sin .md", { ...ALL, id: "calendar-api-016", taskPath: "Tareas/Escribir" }],
      ["tarea no es string", { ...ALL, id: "calendar-api-017", taskPath: 7 }],
      ["proyecto que es tarea", { ...ALL, id: "calendar-api-018", projectPath: "Tareas/Escribir.md" }],
      ["evento con tarea", { ...ALL, id: "calendar-api-019", kind: "event", taskPath: "Tareas/Escribir.md" }],
    ];
    for (const [name, body] of bad) {
      const r = await t.call("POST", "/api/calendar/create", body);
      assert.ok(r.status === 400, `${name}: ${r.status} ${r.text}`);
    }
    assert.equal(t.j.index.count(), notes);
    assert.equal(existsSync(path.join(t.root, "Calendario", "calendar-api-010.md")), false);
    const conflict = await t.call("POST", "/api/calendar/create", { ...ALL, title: "Otra cosa" });
    assert.equal(conflict.status, 409);

    const badMove: unknown[] = [
      { path: c.json.path, start: "2026-10-28T12:00", end: "2026-10-28T11:00", hash: c.json.hash },
      { path: c.json.path, start: "mañana", end: "2026-10-28T11:00", hash: c.json.hash },
      { path: c.json.path, start: "2026-10-29T10:00", end: "2026-10-29T11:00" },
      { path: c.json.path, start: "2026-10-29T10:00", end: "2026-10-29T11:00", hash: "" },
      { path: "Calendario/no-existe.md", start: "2026-10-29T10:00", end: "2026-10-29T11:00", hash: c.json.hash },
      { path: "../fuera.md", start: "2026-10-29T10:00", end: "2026-10-29T11:00", hash: c.json.hash },
      { path: "Tareas/Escribir.md", start: "2026-10-29T10:00", end: "2026-10-29T11:00", hash: c.json.hash },
    ];
    for (const body of badMove) assert.equal((await t.call("POST", "/api/calendar/move", body)).status, 400, JSON.stringify(body));
    for (const body of [{ path: c.json.path }, { path: c.json.path, hash: "" }, { hash: c.json.hash }, { path: "Calendario/no-existe.md", hash: c.json.hash }]) {
      assert.equal((await t.call("POST", "/api/calendar/finish", body)).status, 400, JSON.stringify(body));
    }
    const ev = await t.call("POST", "/api/calendar/create", { ...ALL, id: "calendar-api-020", kind: "event" });
    assert.equal((await t.call("POST", "/api/calendar/finish", { path: ev.json.path, hash: ev.json.hash })).status, 400);
    assert.equal(read(t.root, c.json.path), before);
    assert.equal((await t.call("GET", "/api/calendar?" + DAY)).json.items.find((i: { path: string }) => i.path === c.json.path).state, "active");
  } finally { await t.done(); }
});

test("móvil calendario: lectura sin actividades, tareas ni proyectos privados o sin resolver", async () => {
  const t = await setup();
  try {
    const full = await t.call("GET", "/api/calendar?" + DAY);
    assert.equal(full.json.items.length, 7, "el rol completo ve todo");
    assert.ok(full.json.items.every((i: Record<string, unknown>) => !("task" in i) && !("project" in i)));

    const r = await t.mobile("GET", "/api/calendar?" + DAY);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.items.map((i: { path: string }) => i.path), ["Calendario/visible.md"]);
    for (const leak of ["MARCASECRETA", "ACTIVIDADOCULTA", "Privado/", "Proyecto oculto", "Tarea privada", "No existe nada", ...HIDDEN]) assert.ok(!r.text.includes(leak), leak);
    assert.deepEqual(r.json.tasks.map((x: { path: string }) => x.path), ["Tareas/Escribir.md"]);
    assert.equal(r.json.invalid.length, 0);
  } finally { await t.done(); }
});

test("móvil calendario: crear, mover y terminar solo lo visible; lo oculto no existe y no cambia", async () => {
  const t = await setup();
  try {
    const c = await t.mobile("POST", "/api/calendar/create", { ...ALL, taskPath: "Tareas/Escribir.md", projectPath: "Proyectos/Publico.md" });
    assert.equal(c.status, 200, c.text);
    assert.equal(c.json.projectPath, "Proyectos/Publico.md");
    const m = await t.mobile("POST", "/api/calendar/move", { path: c.json.path, start: "2026-10-28T12:00", end: "2026-10-28T13:00", hash: c.json.hash });
    assert.equal(m.status, 200, m.text);
    const f = await t.mobile("POST", "/api/calendar/finish", { path: c.json.path, hash: m.json.hash });
    assert.equal(f.json.state, "done");

    const notes = t.j.index.count();
    for (const body of [
      { ...ALL, id: "calendar-api-100", taskPath: "Privado/Tarea privada.md" },
      { ...ALL, id: "calendar-api-101", projectPath: "Privado/Proyecto oculto.md" },
      { ...ALL, id: "calendar-api-102", taskPath: "Privado/../Privado/Tarea privada.md" },
      { ...ALL, id: "calendar-api-103", taskPath: "Tareas/Con proyecto oculto.md" }, // su proyecto es privado
    ]) {
      const r = await t.mobile("POST", "/api/calendar/create", body);
      assert.equal(r.status, 403, JSON.stringify(body) + r.text);
      assert.ok(!r.text.includes("MARCASECRETA") && !r.text.includes("Proyecto oculto"));
    }
    assert.equal(t.j.index.count(), notes);

    for (const name of [...HIDDEN.map((h) => `Calendario/${h}.md`), "Privado/Actividad.md"]) {
      const before = read(t.root, name);
      const hash = (await t.j.readNote(name)).hash;
      const mv = await t.mobile("POST", "/api/calendar/move", { path: name, start: "2026-10-29T09:00", end: "2026-10-29T09:30", hash });
      const fi = await t.mobile("POST", "/api/calendar/finish", { path: name, hash });
      assert.ok([403, 404].includes(mv.status) && [403, 404].includes(fi.status), `${name}: ${mv.status} ${fi.status}`);
      assert.ok(!mv.text.includes("ACTIVIDADOCULTA") && !fi.text.includes("ACTIVIDADOCULTA"));
      assert.equal(read(t.root, name), before, name);
    }
  } finally { await t.done(); }
});

test("móvil calendario: las operaciones móviles anteriores siguen igual y el resto de la API sigue vetada", async () => {
  const t = await setup();
  try {
    assert.equal((await t.mobile("POST", "/api/task/status", { path: "Tareas/Escribir.md", status: "doing" })).status, 200);
    assert.equal((await t.mobile("POST", "/api/task/status", { path: "Privado/Tarea privada.md", status: "done" })).status, 403);
    assert.equal((await t.mobile("POST", "/api/capture", { text: "algo" })).status, 200);
    assert.equal((await t.mobile("GET", "/api/note?path=Privado/Actividad.md")).status, 404);
    assert.equal((await t.mobile("POST", "/api/calendar/delete", {})).status, 403);
    assert.equal((await t.mobile("POST", "/api/note/delete", { path: "Notas/x.md" })).status, 403);
  } finally { await t.done(); }
});
