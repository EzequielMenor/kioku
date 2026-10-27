import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { exportVault } from "../src/core/portability.ts";
import { startServer } from "../src/server/server.ts";
import { loadOrCreateKey, readKey } from "../src/server/key.ts";
import { loginUrl } from "../src/cli/desktop.ts";
import { tmpVault } from "./helpers.ts";

const KEY = "a".repeat(64);

async function setup() {
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: web, key: KEY });
  const call = async (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(srv.url + p, {
      method, redirect: "manual",
      headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: await r.json().catch(() => null) as any, headers: r.headers };
  };
  return { j, srv, call, root, done: async () => { await srv.close(); j.close(); cleanup(); } };
}

test("seguridad: sin la clave del daemon ninguna ruta /api devuelve datos ni escribe", async () => {
  const s = await setup();
  try {
    const n = await s.j.createNote({ title: "Privada", body: "secreto" });
    const enc = encodeURIComponent(n.path);
    for (const [m, p, b] of [
      ["GET", `/api/note?path=${enc}`, undefined], ["GET", "/api/notes", undefined], ["GET", "/api/search?q=secreto", undefined],
      ["GET", "/api/today", undefined], ["GET", "/api/events", undefined],
      ["POST", "/api/note/delete", { path: n.path }], ["POST", "/api/capture", { text: "intruso" }],
      ["GET", "/api/assistant/memory", undefined], ["POST", "/api/assistant/undo", { id: "x" }],
    ] as const) {
      const r = await s.call(m, p, b);
      assert.equal(r.status, 401, `${m} ${p}`);
    }
    assert.ok(s.j.index.getNote(n.path), "la nota sigue ahí");
    assert.equal(s.j.index.search("intruso").length, 0);
  } finally { await s.done(); }
});

test("seguridad: una clave incorrecta tampoco vale (cabecera ni cookie)", async () => {
  const s = await setup();
  try {
    assert.equal((await s.call("GET", "/api/today", undefined, { "x-kioku-key": "b".repeat(64) })).status, 401);
    assert.equal((await s.call("GET", "/api/today", undefined, { "x-kioku-key": "corta" })).status, 401);
    assert.equal((await s.call("GET", "/api/today", undefined, { cookie: `kioku_key=${"b".repeat(64)}` })).status, 401);
  } finally { await s.done(); }
});

test("seguridad: con la clave (cabecera o cookie) todo funciona", async () => {
  const s = await setup();
  try {
    assert.equal((await s.call("GET", "/api/today", undefined, { "x-kioku-key": KEY })).status, 200);
    assert.equal((await s.call("GET", "/api/today", undefined, { cookie: `otra=1; kioku_key=${KEY}` })).status, 200);
    assert.equal((await s.call("POST", "/api/capture", { text: "hola" }, { "x-kioku-key": KEY })).status, 200);
  } finally { await s.done(); }
});

test("seguridad: /?k=<clave> fija una cookie HttpOnly SameSite=Strict y redirige sin la clave en la URL", async () => {
  const s = await setup();
  try {
    const r = await s.call("GET", `/?k=${KEY}`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/");
    const cookie = r.headers.get("set-cookie") ?? "";
    assert.match(cookie, new RegExp(`^kioku_key=${KEY};`));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\//);
    const bad = await s.call("GET", `/?k=${"b".repeat(64)}`);
    assert.equal(bad.status, 200, "con clave incorrecta se sirve la página, sin cookie");
    assert.equal(bad.headers.get("set-cookie"), null);
  } finally { await s.done(); }
});

test("seguridad: /api/health es público pero no revela la ruta del vault ni el número de notas", async () => {
  const s = await setup();
  try {
    const r = await s.call("GET", "/api/health");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
  } finally { await s.done(); }
});

test("seguridad: las herramientas del asistente siguen yendo por su token de sesión, sin la clave del daemon", async () => {
  const s = await setup();
  try {
    const sess = s.srv.sessions.open();
    const auth = { authorization: `Bearer ${sess.token}` };
    assert.equal((await s.call("GET", "/api/assistant/tools/list", undefined, auth)).status, 200);
    const made = await s.call("POST", "/api/assistant/tools/call", { name: "list_notes", args: {} }, auth);
    assert.notEqual(made.status, 401);
    assert.equal((await s.call("GET", "/api/assistant/tools/list")).status, 401);
  } finally { await s.done(); }
});

test("clave: se crea una vez con permisos 0600, es estable y se regenera si está corrupta", () => {
  const { root, cleanup } = tmpVault();
  try {
    assert.equal(readKey(root), null);
    const k = loadOrCreateKey(root);
    assert.match(k, /^[0-9a-f]{64}$/);
    assert.equal(statSync(path.join(root, ".kioku", "secret")).mode & 0o777, 0o600);
    assert.equal(loadOrCreateKey(root), k);
    assert.equal(readKey(root), k);
    writeFileSync(path.join(root, ".kioku", "secret"), "basura");
    assert.equal(readKey(root), null);
    const k2 = loadOrCreateKey(root);
    assert.match(k2, /^[0-9a-f]{64}$/);
    assert.notEqual(k2, k);
  } finally { cleanup(); }
});

test("clave: las copias de seguridad no incluyen .kioku/secret", () => {
  const { root, cleanup } = tmpVault({ "Notas/a.md": "# a\n" });
  const out = mkdtempSync(path.join(tmpdir(), "kioku-exp-"));
  try {
    loadOrCreateKey(root);
    assert.ok(existsSync(path.join(root, ".kioku", "secret")));
    const file = path.join(out, "x.tar.gz");
    exportVault(root, file);
    const list = spawnSync("tar", ["-tzf", file], { encoding: "utf8" }).stdout;
    assert.match(list, /Notas\/a\.md/);
    assert.doesNotMatch(list, /secret/);
  } finally { cleanup(); }
});

test("loginUrl: la URL de acceso lleva la clave en ?k= y conserva la ruta del cliente", () => {
  assert.equal(loginUrl("http://127.0.0.1:47800", KEY, "/#/hoy"), `http://127.0.0.1:47800/?k=${KEY}#/hoy`);
  assert.equal(loginUrl("http://127.0.0.1:47800", KEY, "/quick"), `http://127.0.0.1:47800/quick?k=${KEY}`);
  assert.equal(loginUrl("http://127.0.0.1:47800", null, "/quick"), "http://127.0.0.1:47800/quick");
});
