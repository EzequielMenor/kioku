import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { PushStore } from "../src/server/webpush.ts";
import { pairReport } from "../src/cli/pair.ts";
import { tmpVault } from "./helpers.ts";

const KEY = "a".repeat(64);

async function setup(withPush = true) {
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  mkdirSync(path.join(root, ".kioku"), { recursive: true });
  const j = await Kioku.open({ root });
  const push = await PushStore.open(root);
  const srv = await startServer(j, { port: 0, webDir: web, key: KEY, push: withPush ? push : undefined });
  const mk = loadOrCreateMobileKey(root);
  const call = async (method: string, p: string, body?: unknown, key: string | null = mk) => {
    const r = await fetch(srv.url + p, { method, headers: { ...(key ? { "x-kioku-key": key } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const ua = createECDH("prime256v1"); ua.generateKeys();
  const sub = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 3).toString("base64url") } };
  return { root, push, call, sub, done: async () => { await srv.close(); j.close(); cleanup(); } };
}

test("push API: el móvil lee la clave pública, se suscribe y se da de baja", async () => {
  const { push, call, sub, done } = await setup();
  try {
    const k = await call("GET", "/api/push/key");
    assert.equal(k.status, 200);
    assert.equal(k.json.publicKey, push.vapid.publicKey);
    assert.equal(JSON.stringify(k.json).includes(push.vapid.privateKey), false);
    assert.equal((await call("POST", "/api/push/subscribe", { subscription: sub })).status, 200);
    assert.equal(push.list().length, 1);
    assert.equal((await call("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint })).status, 200);
    assert.equal(push.list().length, 0);
    await done();
  } catch (e) { await done(); throw e; }
});

test("push API: rechaza endpoints ajenos, cuerpos inválidos y peticiones sin clave; nada se guarda", async () => {
  const { push, call, sub, done } = await setup();
  try {
    assert.equal((await call("POST", "/api/push/subscribe", { subscription: { ...sub, endpoint: "https://127.0.0.1:47800/x" } })).status, 400);
    assert.equal((await call("POST", "/api/push/subscribe", { subscription: { endpoint: sub.endpoint } })).status, 400);
    assert.equal((await call("POST", "/api/push/subscribe", { subscription: sub }, null)).status, 401);
    assert.equal((await call("GET", "/api/push/key", undefined, null)).status, 401);
    assert.equal(push.list().length, 0);
    await done();
  } catch (e) { await done(); throw e; }
});

test("push API: sin soporte push configurado responde 404 y no rompe lo demás", async () => {
  const { call, done } = await setup(false);
  try {
    assert.equal((await call("GET", "/api/push/key")).status, 404);
    assert.equal((await call("GET", "/api/health", undefined, null)).status, 200);
    await done();
  } catch (e) { await done(); throw e; }
});

test("desemparejar el móvil borra sus suscripciones push al instante", async () => {
  const { root, push, sub, done } = await setup();
  try {
    await push.add(sub);
    assert.equal(push.list().length, 1);
    pairReport({ home: root, host: null, revoke: true });
    assert.equal(push.list().length, 0);
    assert.equal(existsSync(path.join(root, ".kioku", "push-subscriptions.json")), false);
    await done();
  } catch (e) { await done(); throw e; }
});
