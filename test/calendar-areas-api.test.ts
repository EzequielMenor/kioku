import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { tmpVault } from "./helpers.ts";

const KEY = "c".repeat(64);
const FM = (extra: string) => `---\nid: 01HX${Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(22, "0")}\ncreated: 2026-10-27T00:00:00.000Z\n${extra}---\n`;
const AREA = (title: string, color: string) => FM(`type: area\ntitle: ${title}\ncolor: "${color}"\n`) + "\n";
const ACT = (title: string, kind: string, extra: string) =>
  FM(`type: block\ntitle: ${title}\nkind: ${kind}\nstart: 2026-10-28T09:00\nend: 2026-10-28T09:30\n${extra}`) + "\n";
const SEED = {
  "Areas/area-publica-01.md": AREA("Publica", "#112233"),
  "Privado/area-secreta.md": AREA("AREASECRETA", "#ff00aa"),
  "Tareas/Escribir.md": FM("type: task\nstatus: todo\n") + "x\n",
  "Calendario/visible.md": ACT("Visible", "block", ""),
  "Calendario/con-area.md": ACT("Con area", "block", 'area: "[[Areas/area-publica-01]]"\n'),
  "Calendario/evento-area.md": ACT("Evento con area", "event", 'area: "[[Areas/area-publica-01]]"\n'),
  "Calendario/area-privada.md": ACT("ACTIVIDADOCULTA area privada", "block", 'area: "[[Privado/area-secreta]]"\n'),
  "Calendario/area-sin-resolver.md": ACT("ACTIVIDADOCULTA area sin resolver", "event", 'area: "[[Areas/no-existe]]"\n'),
};
const HIDDEN = ["area-privada", "area-sin-resolver"];
const LEAKS = ["AREASECRETA", "ff00aa", "ACTIVIDADOCULTA", "Privado/", "no-existe", ...HIDDEN];
const ALL = { id: "calendar-area-001", title: "Trabajo", kind: "block", start: "2026-10-28T10:00", end: "2026-10-28T11:00" };
const NEW_AREA = { id: "area-nueva-0001", title: "Estudio", color: "#AABBCC" };
const DAY = "from=2026-10-28&to=2026-10-28";

async function setup(seed: Record<string, string> = SEED, exclude: string[] = ["Privado/"]) {
  const { root, cleanup } = tmpVault(seed);
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  mkdirSync(path.join(root, ".kioku"), { recursive: true });
  writeFileSync(path.join(root, ".kioku", "mobile.json"), JSON.stringify({ exclude }));
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
  return { j, root, call, mobile, srv, mk, done: async () => { await srv.close(); j.close(); cleanup(); rmSync(web, { recursive: true, force: true }); } };
}
const read = (root: string, rel: string) => readFileSync(path.join(root, rel), "utf8");
/** Todo lo observable de la bóveda: Markdown, registro de actividad y número de notas. */
function snapshot(t: { root: string; j: Kioku }): string {
  const files = readdirSync(t.root, { recursive: true, encoding: "utf8" })
    .filter((f) => (f.endsWith(".md") && !f.startsWith(".kioku")) || /^\.kioku\/log\/.*\.jsonl$/.test(f)).sort();
  return JSON.stringify([t.j.index.count(), files.map((f) => [f, read(t.root, f)])]);
}
type Row = { path: string; areaTitle: string | null; areaColor: string | null };
const itemOf = (r: { json: { items: Row[] } }, name: string) => r.json.items.find((i) => i.path === `Calendario/${name}.md`)!;

test("API áreas: crear, listar, editar y asignar a bloques y eventos con el rol completo", async () => {
  const t = await setup({ "Tareas/Escribir.md": SEED["Tareas/Escribir.md"] });
  try {
    assert.equal((await t.call("GET", "/api/calendar/areas", undefined, null)).status, 401);
    assert.deepEqual((await t.call("GET", "/api/calendar/areas")).json, [], "sin áreas inventadas");

    const c = await t.call("POST", "/api/calendar/areas/create", NEW_AREA);
    assert.equal(c.status, 200, c.text);
    assert.deepEqual(Object.keys(c.json).sort(), ["color", "hash", "path", "title"]);
    assert.deepEqual([c.json.path, c.json.title, c.json.color], ["Areas/area-nueva-0001.md", "Estudio", "#aabbcc"]);
    assert.deepEqual((await t.call("POST", "/api/calendar/areas/create", NEW_AREA)).json, c.json, "idempotente");
    assert.equal((await t.call("POST", "/api/calendar/areas/create", { ...NEW_AREA, title: "Otra" })).status, 409);
    assert.deepEqual((await t.call("GET", "/api/calendar/areas")).json, [c.json]);

    const blk = await t.call("POST", "/api/calendar/create", { ...ALL, taskPath: "Tareas/Escribir.md", areaPath: c.json.path });
    assert.equal(blk.status, 200, blk.text);
    assert.deepEqual([blk.json.areaPath, blk.json.areaTitle, blk.json.areaColor], [c.json.path, "Estudio", "#aabbcc"]);
    assert.ok(!("area" in blk.json) && !("task" in blk.json) && !blk.text.includes("[["), "relaciones crudas fuera del DTO");
    assert.deepEqual((await t.call("POST", "/api/calendar/create", { ...ALL, taskPath: "Tareas/Escribir.md", areaPath: c.json.path })).json, blk.json);
    const ev = await t.call("POST", "/api/calendar/create", { ...ALL, id: "calendar-area-002", kind: "event" });
    assert.deepEqual([ev.json.areaPath, ev.json.areaTitle, ev.json.areaColor], [null, null, null]);

    const set = await t.call("POST", "/api/calendar/area", { path: ev.json.path, areaPath: c.json.path, hash: ev.json.hash });
    assert.equal(set.status, 200, set.text);
    assert.equal(set.json.areaPath, c.json.path);
    assert.equal(set.json.kind, "event");
    assert.ok(!("area" in set.json) && !set.text.includes("[["));
    const same = await t.call("POST", "/api/calendar/area", { path: ev.json.path, areaPath: c.json.path, hash: "cualquiera" });
    assert.deepEqual(same.json, set.json, "mismo área: idempotente");

    // Renombrar y recolorear: la lectura por rango muestra el cambio en todas las actividades y devuelve las áreas.
    const up = await t.call("POST", "/api/calendar/areas/update", { path: c.json.path, title: "Estudios", color: "#00ff00", hash: c.json.hash });
    assert.equal(up.status, 200, up.text);
    assert.deepEqual([up.json.title, up.json.color], ["Estudios", "#00ff00"]);
    const day = await t.call("GET", "/api/calendar?" + DAY);
    assert.deepEqual(day.json.areas, [up.json]);
    assert.deepEqual(day.json.items.map((i: { areaTitle: string; areaColor: string }) => [i.areaTitle, i.areaColor]), [["Estudios", "#00ff00"], ["Estudios", "#00ff00"]]);
    assert.deepEqual(Object.keys(day.json).sort(), ["areas", "invalid", "items", "now", "tasks"]);

    const cleared = await t.call("POST", "/api/calendar/area", { path: ev.json.path, areaPath: null, hash: set.json.hash });
    assert.equal(cleared.status, 200, cleared.text);
    assert.deepEqual([cleared.json.areaPath, cleared.json.areaTitle, cleared.json.areaColor], [null, null, null]);
    assert.ok(!read(t.root, ev.json.path).includes("area:"));
    assert.equal(read(t.root, "Tareas/Escribir.md").includes("area"), false, "la tarea no se toca");
  } finally { await t.done(); }
});

test("API áreas: entradas inválidas y hash obsoleto fallan sin cambiar Markdown, registro ni recuento", async () => {
  const t = await setup();
  try {
    const before = snapshot(t);
    const fail = async (status: number, method: string, url: string, body?: unknown) => {
      const r = await t.call(method, url, body);
      assert.equal(r.status, status, `${url} ${JSON.stringify(body)} → ${r.status} ${r.text}`);
      assert.equal(snapshot(t), before, `${url} ${JSON.stringify(body)}`);
    };
    const pub = "Areas/area-publica-01.md";
    const hash = (await t.j.readNote(pub)).hash;
    for (const body of [
      { ...NEW_AREA, id: "x" }, { ...NEW_AREA, title: "  " }, { ...NEW_AREA, title: 5 }, { ...NEW_AREA, color: "rojo" }, { ...NEW_AREA, color: "#fff" },
      { ...NEW_AREA, color: "#12345g" }, { ...NEW_AREA, color: null }, { id: NEW_AREA.id, title: "Ok" }, { ...NEW_AREA, title: "x".repeat(200) },
    ]) await fail(400, "POST", "/api/calendar/areas/create", body);
    await fail(409, "POST", "/api/calendar/areas/create", { id: "area-publica-01", title: "Otra", color: "#112233" });
    for (const body of [
      { path: pub, title: "", color: "#112233", hash }, { path: pub, title: "Ok", color: "azul", hash }, { path: pub, title: "Ok", color: "#112233" },
      { path: pub, title: "Ok", color: "#112233", hash: "" }, { path: "Areas/no-existe.md", title: "Ok", color: "#112233", hash },
      { path: "Calendario/visible.md", title: "Ok", color: "#112233", hash }, { path: "../x.md", title: "Ok", color: "#112233", hash }, { title: "Ok", color: "#112233", hash },
    ]) await fail(400, "POST", "/api/calendar/areas/update", body);
    await fail(409, "POST", "/api/calendar/areas/update", { path: pub, title: "Ok", color: "#445566", hash: "0".repeat(40) });

    const visible = (await t.j.readNote("Calendario/visible.md")).hash;
    for (const body of [
      { path: "Calendario/visible.md", areaPath: "Tareas/Escribir.md", hash: visible }, { path: "Calendario/visible.md", areaPath: "Areas/no-existe.md", hash: visible },
      { path: "Calendario/visible.md", areaPath: "../x.md", hash: visible }, { path: "Calendario/visible.md", areaPath: 5, hash: visible },
      { path: "Calendario/visible.md", hash: visible }, { path: "Calendario/visible.md", areaPath: pub }, { path: "Calendario/visible.md", areaPath: pub, hash: "" },
      { path: "Tareas/Escribir.md", areaPath: pub, hash: (await t.j.readNote("Tareas/Escribir.md")).hash }, { path: pub, areaPath: pub, hash },
      { areaPath: pub, hash: visible },
    ]) await fail(400, "POST", "/api/calendar/area", body);
    await fail(409, "POST", "/api/calendar/area", { path: "Calendario/visible.md", areaPath: pub, hash: "0".repeat(40) });
    await fail(400, "POST", "/api/calendar/create", { ...ALL, areaPath: "Tareas/Escribir.md" });
    await fail(400, "POST", "/api/calendar/create", { ...ALL, areaPath: "Areas/no-existe.md" });
    await fail(400, "POST", "/api/calendar/create", { ...ALL, areaPath: 9 });
    assert.equal(read(t.root, "Calendario/visible.md").includes("area"), false);
  } finally { await t.done(); }
});

test("áreas no son tareas: /api/task/status las rechaza igual que a los bloques, sin cambiar nada", async () => {
  const t = await setup();
  try {
    const before = snapshot(t);
    for (const call of [t.call, t.mobile] as const) {
      for (const p of ["Areas/area-publica-01.md", "Calendario/visible.md"]) {
        const r = await call("POST", "/api/task/status", { path: p, status: "done" });
        assert.equal(r.status, 400, p + r.text);
        assert.equal(snapshot(t), before);
      }
    }
    assert.equal((await t.call("POST", "/api/task/status", { path: "Tareas/Escribir.md", status: "doing" })).status, 200);
  } finally { await t.done(); }
});

test("móvil áreas: lectura sin áreas privadas ni actividades con área privada o sin resolver", async () => {
  const t = await setup();
  try {
    const full = await t.call("GET", "/api/calendar?" + DAY);
    assert.equal(full.json.items.length, 5, "el rol completo ve todo");
    assert.ok(full.json.areas.some((a: { title: string }) => a.title === "AREASECRETA"));
    const sec = itemOf(full, "area-privada");
    assert.deepEqual([sec.areaTitle, sec.areaColor], ["AREASECRETA", "#ff00aa"]);

    const r = await t.mobile("GET", "/api/calendar?" + DAY);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.items.map((i: { path: string }) => i.path).sort(), ["Calendario/con-area.md", "Calendario/evento-area.md", "Calendario/visible.md"]);
    assert.deepEqual(r.json.areas.map((a: { path: string }) => a.path), ["Areas/area-publica-01.md"]);
    assert.deepEqual(itemOf(r, "con-area").areaColor, "#112233");
    for (const leak of LEAKS) assert.ok(!r.text.includes(leak), leak);
    const list = await t.mobile("GET", "/api/calendar/areas");
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.map((a: { path: string }) => a.path), ["Areas/area-publica-01.md"]);
    for (const leak of LEAKS) assert.ok(!list.text.includes(leak), leak);
  } finally { await t.done(); }
});

test("móvil áreas: con la lista de privados vacía, el área sin resolver sigue oculta y no se hereda nada", async () => {
  const t = await setup(SEED, []);
  try {
    const r = await t.mobile("GET", "/api/calendar?" + DAY);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.items.map((i: { path: string }) => i.path).sort(), ["Calendario/area-privada.md", "Calendario/con-area.md", "Calendario/evento-area.md", "Calendario/visible.md"]);
    assert.ok(!r.text.includes("area-sin-resolver") && !r.text.includes("no-existe"));
    const before = snapshot(t);
    const mv = await t.mobile("POST", "/api/calendar/area", { path: "Calendario/area-sin-resolver.md", areaPath: "Areas/area-publica-01.md", hash: "x" });
    assert.equal(mv.status, 404, mv.text);
    assert.equal(snapshot(t), before);
  } finally { await t.done(); }
});

test("móvil áreas: crear, editar y asignar solo con lo visible; lo oculto se deniega antes de escribir", async () => {
  const t = await setup();
  try {
    const c = await t.mobile("POST", "/api/calendar/areas/create", NEW_AREA);
    assert.equal(c.status, 200, c.text);
    const up = await t.mobile("POST", "/api/calendar/areas/update", { path: c.json.path, title: "Estudios", color: "#010203", hash: c.json.hash });
    assert.equal(up.status, 200, up.text);
    const blk = await t.mobile("POST", "/api/calendar/create", { ...ALL, areaPath: c.json.path });
    assert.equal(blk.status, 200, blk.text);
    assert.equal(blk.json.areaTitle, "Estudios");
    const asg = await t.mobile("POST", "/api/calendar/area", { path: "Calendario/visible.md", areaPath: c.json.path, hash: (await t.j.readNote("Calendario/visible.md")).hash });
    assert.equal(asg.status, 200, asg.text);
    const clr = await t.mobile("POST", "/api/calendar/area", { path: "Calendario/visible.md", areaPath: null, hash: asg.json.hash });
    assert.deepEqual([clr.status, clr.json.areaPath], [200, null]);

    const before = snapshot(t);
    const secret = "Privado/area-secreta.md";
    const secretHash = (await t.j.readNote(secret)).hash;
    const denied: [string, string, unknown, number[]][] = [
      ["POST", "/api/calendar/areas/update", { path: secret, title: "Robada", color: "#000000", hash: secretHash }, [403]],
      ["POST", "/api/calendar/areas/update", { path: "Privado/../Privado/area-secreta.md", title: "Robada", color: "#000000", hash: secretHash }, [403]],
      ["POST", "/api/calendar/create", { ...ALL, id: "calendar-area-100", areaPath: secret }, [403]],
      ["POST", "/api/calendar/create", { ...ALL, id: "calendar-area-101", areaPath: "Privado/./area-secreta.md" }, [403]],
      ["POST", "/api/calendar/area", { path: "Calendario/visible.md", areaPath: secret, hash: (await t.j.readNote("Calendario/visible.md")).hash }, [404]],
      ...HIDDEN.map((h): [string, string, unknown, number[]] => ["POST", "/api/calendar/area", { path: `Calendario/${h}.md`, areaPath: c.json.path, hash: "x" }, [404]]),
      ...HIDDEN.map((h): [string, string, unknown, number[]] => ["POST", "/api/calendar/area", { path: `Calendario/${h}.md`, areaPath: null, hash: "x" }, [404]]),
    ];
    for (const [method, url, body, ok] of denied) {
      const r = await t.mobile(method, url, body);
      assert.ok(ok.includes(r.status), `${url} ${JSON.stringify(body)} → ${r.status}`);
      for (const leak of ["AREASECRETA", "ACTIVIDADOCULTA"]) assert.ok(!r.text.includes(leak));
      assert.equal(snapshot(t), before, `${url} ${JSON.stringify(body)}`);
    }
    assert.equal((await t.call("POST", "/api/calendar/areas/delete", {})).status, 404, "no hay borrado de áreas");
    assert.equal((await t.mobile("POST", "/api/calendar/areas/delete", {})).status, 403);
    assert.equal(snapshot(t), before);
  } finally { await t.done(); }
});

test("móvil áreas: si la carpeta de áreas es privada, el móvil no lee ni escribe áreas ni ve actividades que las usan", async () => {
  const t = await setup(SEED, ["Areas/"]);
  try {
    const list = await t.mobile("GET", "/api/calendar/areas");
    assert.deepEqual(list.json.map((a: { path: string }) => a.path), ["Privado/area-secreta.md"], "solo queda la que no está en la carpeta privada");
    const r = await t.mobile("GET", "/api/calendar?" + DAY);
    assert.deepEqual(r.json.items.map((i: { path: string }) => i.path).sort(), ["Calendario/area-privada.md", "Calendario/visible.md"].sort());
    assert.ok(!r.text.includes("Publica") && !r.text.includes("#112233"));
    const before = snapshot(t);
    assert.equal((await t.mobile("POST", "/api/calendar/areas/create", NEW_AREA)).status, 403);
    assert.equal(snapshot(t), before);
    assert.equal((await t.call("POST", "/api/calendar/areas/create", NEW_AREA)).status, 200, "el rol completo conserva el acceso");
  } finally { await t.done(); }
});

test("móvil áreas: las rutas genéricas de lectura no filtran áreas privadas ni actividades ocultas", async () => {
  const t = await setup();
  try {
    for (const url of ["/api/notes", "/api/notes?type=area", "/api/notes?type=block", "/api/search?q=AREASECRETA", "/api/search?q=ACTIVIDADOCULTA", "/api/sync/manifest",
      "/api/suggest-links?q=AREASECRETA", "/api/suggest-links?q=area-sec", "/api/graph", "/api/resolve?q=area-secreta", "/api/resolve?q=area-privada"]) {
      const r = await t.mobile("GET", url);
      assert.equal(r.status, 200, url + r.text);
      for (const leak of LEAKS) assert.ok(!r.text.includes(leak), `${url} filtra ${leak}`);
    }
    assert.ok((await t.mobile("GET", "/api/notes?type=area")).text.includes("Areas/area-publica-01.md"), "el área pública sigue apareciendo");
    for (const name of ["Privado/area-secreta.md", ...HIDDEN.map((h) => `Calendario/${h}.md`)]) {
      assert.equal((await t.mobile("GET", "/api/note?path=" + encodeURIComponent(name))).status, 404, name);
    }
    assert.equal((await t.mobile("GET", "/api/note?path=Areas/area-publica-01.md")).status, 200);
  } finally { await t.done(); }
});

test("móvil áreas: las escrituras genéricas sobre áreas y actividades ocultas siguen fallando sin cambios", async () => {
  const t = await setup();
  try {
    const before = snapshot(t);
    for (const name of ["Privado/area-secreta.md", ...HIDDEN.map((h) => `Calendario/${h}.md`)]) {
      const { hash, text } = await t.j.readNote(name);
      for (const [method, url, body] of [
        ["PUT", "/api/note", { path: name, text: text + "\nCAMBIO\n", hash }],
        ["POST", "/api/note/props", { path: name, props: { color: "#000000", area: "[[Areas/area-publica-01]]" } }],
        ["POST", "/api/note/open", { path: name }],
        ["POST", "/api/task/status", { path: name, status: "done" }],
      ] as const) {
        const r = await t.mobile(method, url, body);
        assert.ok([403, 404].includes(r.status), `${method} ${url} ${name}: ${r.status}`);
        assert.equal(snapshot(t), before, `${method} ${url} ${name}`);
      }
    }
  } finally { await t.done(); }
});

test("móvil áreas: el flujo en vivo no emite áreas privadas ni actividades que pasan a usarlas", async () => {
  const t = await setup();
  const ctl = new AbortController();
  try {
    const res = await fetch(t.srv.url + "/api/events", { headers: { "x-kioku-key": t.mk }, signal: ctl.signal });
    const reader = res.body!.getReader();
    let seen = "";
    void (async () => { for (;;) { const { value, done } = await reader.read(); if (done) return; seen += new TextDecoder().decode(value); } })().catch(() => {});
    const hash = async (name: string) => (await t.j.readNote(name)).hash;
    // El área privada se edita con el flujo abierto; una actividad visible pasa a apuntar a ella.
    const sec = "Privado/area-secreta.md";
    assert.equal((await t.call("POST", "/api/calendar/areas/update", { path: sec, title: "AREASECRETA2", color: "#000001", hash: await hash(sec) })).status, 200);
    assert.equal((await t.call("POST", "/api/calendar/area", { path: "Calendario/visible.md", areaPath: sec, hash: await hash("Calendario/visible.md") })).status, 200);
    assert.equal((await t.call("POST", "/api/calendar/area", { path: "Calendario/area-privada.md", areaPath: null, hash: await hash("Calendario/area-privada.md") })).status, 200);
    // Una actividad oculta que deja de apuntar a lo privado se vuelve visible; el área pública se edita a la vista.
    const pub = "Areas/area-publica-01.md";
    assert.equal((await t.call("POST", "/api/calendar/areas/update", { path: pub, title: "Publica visible", color: "#000002", hash: await hash(pub) })).status, 200);
    for (let i = 0; i < 40 && !seen.includes(pub); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(seen.includes(pub), "los cambios del área pública llegan: " + seen);
    assert.ok(seen.includes("Calendario/area-privada.md"), "la actividad ya sin área privada es visible");
    for (const leak of ["area-secreta", "Calendario/visible.md", "area-sin-resolver"]) assert.ok(!seen.includes(leak), leak + " en " + seen);
  } finally { ctl.abort(); await t.done(); }
});
