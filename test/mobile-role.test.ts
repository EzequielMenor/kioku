import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { exportVault } from "../src/core/portability.ts";
import { startServer } from "../src/server/server.ts";
import { loadOrCreateMobileKey, readMobileKey, revokeMobileKey, loadOrCreateKey } from "../src/server/key.ts";
import { tmpVault } from "./helpers.ts";

const KEY = "a".repeat(64);
const FM = (extra: string) => `---\nid: 01HX${Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(22, "0")}\ncreated: 2026-10-27T00:00:00.000Z\n${extra}---\n`;
const SEED = {
  "Notas/Publica.md": FM("type: note\n") + "Texto público. Enlace a [[Secreto]].\n",
  "Privado/Secreto.md": FM("type: note\n") + "MARCASECRETA contenido reservado\n",
  "Privado/Tarea privada.md": FM("type: task\nstatus: todo\ndue: 2020-01-01\npriority: 1\n") + "MARCASECRETA tarea\n",
  "Privado/Proyecto oculto.md": FM("type: project\nstatus: active\n") + "MARCASECRETA proyecto\n",
  "Tareas/Tarea publica.md": FM("type: task\nstatus: todo\n") + "Hacer algo\n",
};

async function setup(opts: { allowedHosts?: string[]; exclude?: string[] } = {}) {
  const { root, cleanup } = tmpVault(SEED);
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  writeFileSync(path.join(web, "manifest.webmanifest"), "{}");
  mkdirSync(path.join(root, ".kioku"), { recursive: true });
  writeFileSync(path.join(root, ".kioku", "mobile.json"), JSON.stringify({ exclude: opts.exclude ?? ["Privado/"] }));
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: web, key: KEY, allowedHosts: opts.allowedHosts });
  const mk = loadOrCreateMobileKey(root);
  const call = async (method: string, p: string, body?: unknown, key: string | null = mk, headers: Record<string, string> = {}) => {
    const r = await fetch(srv.url + p, {
      method, redirect: "manual",
      headers: { ...(key ? { "x-kioku-key": key } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, text: await r.text(), headers: r.headers, get json() { try { return JSON.parse(this.text); } catch { return null; } } };
  };
  return { j, srv, root, mk, call, done: async () => { await srv.close(); j.close(); cleanup(); } };
}

/** Petición con Host/Origin a medida (fetch no deja fijarlos). */
function raw(srv: { port: number }, p: string, headers: Record<string, string>, method = "GET"): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: srv.port, path: p, method, headers }, (r) => { r.resume(); resolve({ status: r.statusCode!, headers: r.headers }); });
    req.on("error", reject);
    req.end();
  });
}

test("móvil: la clave se crea una vez (0600), es distinta de la completa, y revocarla la borra", () => {
  const { root, cleanup } = tmpVault();
  try {
    assert.equal(readMobileKey(root), null);
    const k = loadOrCreateMobileKey(root);
    assert.match(k, /^[0-9a-f]{64}$/);
    assert.equal(statSync(path.join(root, ".kioku", "secret-mobile")).mode & 0o777, 0o600);
    assert.equal(loadOrCreateMobileKey(root), k);
    assert.notEqual(loadOrCreateKey(root), k);
    revokeMobileKey(root);
    assert.equal(readMobileKey(root), null);
    assert.equal(existsSync(path.join(root, ".kioku", "secret-mobile")), false);
    revokeMobileKey(root); // idempotente
  } finally { cleanup(); }
});

test("móvil: las copias de seguridad no incluyen secret-mobile", () => {
  const { root, cleanup } = tmpVault({ "Notas/a.md": "# a\n" });
  const out = mkdtempSync(path.join(tmpdir(), "kioku-exp-"));
  try {
    loadOrCreateMobileKey(root);
    const file = path.join(out, "x.tar.gz");
    exportVault(root, file);
    assert.doesNotMatch(spawnSync("tar", ["-tzf", file], { encoding: "utf8" }).stdout, /secret/);
  } finally { cleanup(); }
});

test("móvil: la clave del móvil abre la API y /api/session dice qué rol tienes", async () => {
  const s = await setup();
  try {
    assert.equal((await s.call("GET", "/api/today")).status, 200);
    assert.deepEqual((await s.call("GET", "/api/session")).json, { role: "mobile" });
    assert.deepEqual((await s.call("GET", "/api/session", undefined, KEY)).json, { role: "full" });
    assert.equal((await s.call("GET", "/api/session", undefined, null)).status, 401);
    assert.equal((await s.call("GET", "/api/today", undefined, "b".repeat(64))).status, 401);
  } finally { await s.done(); }
});

test("móvil: solo puede leer y escribir lo permitido; borrar, asistente, escritorio, propuestas y mantenimiento → 403", async () => {
  const s = await setup();
  try {
    const forbidden: [string, string, unknown?][] = [
      ["POST", "/api/note/delete", { path: "Notas/Publica.md" }],
      ["POST", "/api/assistant/ask", { message: "hola" }], ["GET", "/api/assistant/memory"], ["GET", "/api/assistant/actions"], ["POST", "/api/assistant/undo", { id: "x" }],
      ["POST", "/api/desktop/open", { route: "/hoy" }], ["POST", "/api/desktop/quick/hide", {}],
      ["POST", "/api/proposals/01ABC/apply", {}], ["GET", "/api/proposals"],
      ["POST", "/api/reindex", {}], ["POST", "/api/triage", {}], ["GET", "/api/ai"], ["POST", "/api/ai/triage", {}],
      ["POST", "/api/focus/start", { taskPath: "Tareas/Tarea publica.md" }], ["POST", "/api/project/create", { title: "X" }],
      ["POST", "/api/database/create", { name: "X", template: "libros" }],
    ];
    for (const [m, p, b] of forbidden) assert.equal((await s.call(m, p, b)).status, 403, `${m} ${p}`);
    assert.ok(s.j.index.getNote("Notas/Publica.md"), "nada se borró");
    // lo permitido
    assert.equal((await s.call("POST", "/api/capture", { text: "desde el móvil" })).status, 200);
    assert.equal((await s.call("POST", "/api/task/status", { path: "Tareas/Tarea publica.md", status: "done" })).status, 200);
    const note = (await s.call("GET", "/api/note?path=Notas/Publica.md")).json;
    assert.equal((await s.call("PUT", "/api/note", { path: "Notas/Publica.md", text: note.text + "\nañadido", hash: note.hash })).status, 200);
    assert.equal((await s.call("POST", "/api/note/create", { title: "Nueva móvil", type: "note", body: "x" })).status, 200);
    assert.notEqual((await s.call("POST", "/api/database/query", { path: "Bases/Nada.md" })).status, 403, "database/query es lectura");
  } finally { await s.done(); }
});

test("móvil: las carpetas privadas no aparecen en NINGUNA lectura (la clave completa sí las ve)", async () => {
  const s = await setup();
  try {
    const reads = ["/api/notes", "/api/search?q=MARCASECRETA", "/api/search?q=Secreto", "/api/tasks?status=todo,doing,done", "/api/projects", "/api/inbox", "/api/today",
      "/api/graph", "/api/databases", "/api/focus", "/api/suggest-links?q=Secr", "/api/resolve?q=Secreto", "/api/note?path=Notas/Publica.md"];
    for (const r of reads) {
      const t = (await s.call("GET", r)).text;
      assert.doesNotMatch(t, /Privado|MARCASECRETA|Tarea privada|Proyecto oculto/, `fuga en ${r}`);
    }
    assert.equal((await s.call("GET", "/api/note?path=Privado/Secreto.md")).status, 404);
    assert.equal((await s.call("GET", "/api/note?path=privado/secreto.md")).status, 404, "insensible a mayúsculas");
    for (const trick of ["/Privado/Secreto.md", "//Privado/Secreto.md", "Privado//Secreto.md", "Notas/../Privado/Secreto.md"]) {
      const r = await s.call("GET", `/api/note?path=${encodeURIComponent(trick)}`);
      assert.ok(r.status === 404 || r.status === 400, `${trick} → ${r.status}`);
      assert.doesNotMatch(r.text, /MARCASECRETA/);
    }
    assert.equal((await s.call("GET", "/api/database?path=Privado/Secreto.md")).status, 404);
    assert.equal((await s.call("GET", "/api/project?path=Privado/Proyecto%20oculto.md")).status, 404);
    assert.equal((await s.call("GET", "/api/graph?focus=Privado/Secreto.md")).status, 404);
    // control: la clave completa sí ve lo privado
    assert.match((await s.call("GET", "/api/notes", undefined, KEY)).text, /Privado\/Secreto\.md/);
    assert.match((await s.call("GET", "/api/search?q=MARCASECRETA", undefined, KEY)).text, /Privado/);
  } finally { await s.done(); }
});

test("móvil: el grafo sin lo privado conserva las aristas entre notas visibles", async () => {
  const s = await setup();
  try {
    await s.j.createNote({ title: "Otra pública", body: "ver [[Publica]]" });
    const g = (await s.call("GET", "/api/graph")).json as { nodes: { path: string; degree: number }[]; edges: [number, number][]; total: number; isolated: number };
    assert.ok(g.nodes.every((n) => !n.path.startsWith("Privado/")));
    assert.ok(g.edges.every(([a, b]) => g.nodes[a] && g.nodes[b]), "ninguna arista apunta a un nodo inexistente");
    const names = g.edges.map(([a, b]) => [g.nodes[a].path, g.nodes[b].path].sort().join("|"));
    assert.ok(names.some((n) => n.includes("Notas/Otra pública.md") && n.includes("Notas/Publica.md")), "se conserva el enlace visible");
    // los contadores tampoco delatan lo privado: 3 notas visibles, una aislada, y el grado cuenta solo vecinos visibles
    assert.equal(g.total, 3);
    assert.equal(g.isolated, 1);
    assert.equal(g.nodes.find((n) => n.path === "Notas/Publica.md")!.degree, 1, "el enlace a [[Secreto]] no cuenta");
  } finally { await s.done(); }
});

test("móvil: no puede escribir en carpetas privadas", async () => {
  const s = await setup();
  try {
    for (const [m, p, b] of [
      ["PUT", "/api/note", { path: "Privado/Secreto.md", text: "x", hash: "h" }],
      ["POST", "/api/note/props", { path: "Privado/Secreto.md", props: { a: 1 } }],
      ["POST", "/api/task/status", { path: "Privado/Tarea privada.md", status: "done" }],
      ["POST", "/api/note/open", { path: "Privado/Secreto.md" }],
    ] as const) assert.equal((await s.call(m, p, b)).status, 403, `${m} ${p}`);
  } finally { await s.done(); }
});

test("móvil: revocar la clave surte efecto al instante, sin reiniciar el daemon", async () => {
  const s = await setup();
  try {
    assert.equal((await s.call("GET", "/api/today")).status, 200);
    revokeMobileKey(s.root);
    assert.equal((await s.call("GET", "/api/today")).status, 401);
    const k2 = loadOrCreateMobileKey(s.root);
    assert.equal((await s.call("GET", "/api/today", undefined, k2)).status, 200, "una clave nueva funciona");
    assert.equal((await s.call("GET", "/api/today", undefined, s.mk)).status, 401, "la vieja no");
  } finally { await s.done(); }
});

test("móvil: /?k=<clave móvil> fija una cookie persistente y la cookie sirve como credencial", async () => {
  const s = await setup();
  try {
    const r = await s.call("GET", `/?k=${s.mk}`, undefined, null);
    assert.equal(r.status, 302);
    const cookie = r.headers.get("set-cookie") ?? "";
    assert.match(cookie, new RegExp(`^kioku_key=${s.mk};`));
    assert.match(cookie, /Max-Age=\d{7,}/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.doesNotMatch(cookie, /Secure/i, "en local (http) no lleva Secure");
    assert.equal((await s.call("GET", "/api/today", undefined, null, { cookie: `kioku_key=${s.mk}` })).status, 200);
  } finally { await s.done(); }
});

test("hosts: un host de la lista (Tailscale) se acepta, con Secure en la cookie; los demás siguen rechazados", async () => {
  const host = "portatil.tail1234.ts.net";
  const s = await setup({ allowedHosts: [host] });
  try {
    assert.equal((await raw(s.srv, "/api/health", { host })).status, 200);
    assert.equal((await raw(s.srv, "/api/health", { host: "evil.example" })).status, 403);
    assert.equal((await raw(s.srv, "/api/health", { host: `${host}.evil.example` })).status, 403, "coincidencia exacta, no por sufijo");
    assert.equal((await raw(s.srv, "/api/health", { host, origin: `https://${host}` })).status, 200);
    assert.equal((await raw(s.srv, "/api/health", { host, origin: "https://evil.example" })).status, 403);
    const r = await raw(s.srv, `/?k=${s.mk}`, { host });
    assert.equal(r.status, 302);
    assert.match(String(r.headers["set-cookie"]), /Secure/i);
    // sin lista, ese host no vale
    const t = await setup();
    try { assert.equal((await raw(t.srv, "/api/health", { host })).status, 403); } finally { await t.done(); }
  } finally { await s.done(); }
});

test("PWA: el manifiesto se sirve con su tipo MIME", async () => {
  const s = await setup();
  try {
    const r = await s.call("GET", "/manifest.webmanifest", undefined, null);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /application\/manifest\+json/);
  } finally { await s.done(); }
});

test("móvil: el SSE no deja pasar eventos de rutas privadas ni de escritorio/asistente", async () => {
  const s = await setup();
  try {
    const ac = new AbortController();
    const res = await fetch(s.srv.url + "/api/events", { headers: { "x-kioku-key": s.mk }, signal: ac.signal });
    const reader = res.body!.getReader();
    let seen = "";
    const pump = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; seen += new TextDecoder().decode(value); } } catch { /* abortado */ } })();
    await new Promise((r) => setTimeout(r, 150));
    s.j.bus.emit("change", { kind: "updated", path: "Privado/Secreto.md" });
    s.j.bus.emit("change", { kind: "assistant.tool", tool: "read_note", path: "Notas/Publica.md" });
    s.j.bus.emit("change", { kind: "navigate", route: "/hoy" });
    s.j.bus.emit("change", { kind: "updated", path: "Notas/Publica.md" });
    await new Promise((r) => setTimeout(r, 300));
    ac.abort(); await pump;
    assert.match(seen, /Notas\/Publica\.md/);
    assert.doesNotMatch(seen, /Privado|assistant\.tool|navigate/);
  } finally { await s.done(); }
});

test("móvil: «Hoy» sin lo privado conserva la forma que espera la interfaz (siguiente paso = la mejor tarea visible, foco ajeno oculto)", async () => {
  const s = await setup();
  try {
    await s.j.startFocus({ taskPath: "Privado/Tarea privada.md" });
    const full = (await s.call("GET", "/api/today", undefined, KEY)).json;
    assert.equal(full.suggestion.task.path, "Privado/Tarea privada.md", "control: con la clave completa la privada es la sugerida");
    const t = (await s.call("GET", "/api/today")).json;
    assert.equal(t.suggestion?.task.path, "Tareas/Tarea publica.md", "se promociona la mejor tarea visible");
    assert.ok(t.alternatives.every((a: { task: { path: string } } | null) => a && !a.task.path.startsWith("Privado/")));
    assert.deepEqual(t.focus, { active: false }, "no se revela el foco sobre una tarea privada");
    assert.ok(t.resume.every((r: { project: { path: string } } | null) => r && r.project && !r.project.path.startsWith("Privado/")));
    assert.ok(Array.isArray(t.inbox.items));
    assert.deepEqual((await s.call("GET", "/api/focus")).json, { active: false });
    assert.doesNotMatch(JSON.stringify(t), /Privado|MARCASECRETA|Tarea privada/);
  } finally { await s.done(); }
});
