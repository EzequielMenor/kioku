import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { tmpVault } from "./helpers.ts";
import { exportVault } from "../src/core/portability.ts";
import { spawnSync } from "node:child_process";
import { createECDH } from "node:crypto";
import { PushStore, pushChannel } from "../src/server/webpush.ts";

async function fixture() {
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(os.tmpdir(), "kioku-enroll-web-"));
  writeFileSync(path.join(web, "index.html"), "Kioku");
  const j = await Kioku.open({ root });
  const push = await PushStore.open(root);
  const srv = await startServer(j, { port: 0, webDir: web, key: "a".repeat(64), push });
  const call = (method: string, url: string, body?: unknown, key: string | null = srv.key, headers: Record<string, string> = {}) =>
    fetch(srv.url + url, { method, headers: { ...(key ? { "x-kioku-key": key } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  return { root, j, push, srv, web, call, done: async () => { await srv.close(); j.close(); cleanup(); rmSync(web, { recursive: true, force: true }); } };
}

test("enrollment: desktop creates one-use code, device receives only mobile cookie, individual revocation preserves peers and legacy", async () => {
  const f = await fixture();
  try {
    const legacy = loadOrCreateMobileKey(f.root);
    const devices: { id: string; cookie: string; token: string }[] = [];
    for (const name of ["iPhone", "iPad"]) {
      const created = await f.call("POST", "/api/devices/enrollments", {});
      assert.equal(created.status, 201);
      const enrollment = await created.json();
      assert.match(enrollment.token, /^[0-9a-f]{64}$/);
      assert.ok(Date.parse(enrollment.expiresAt) > Date.now());
      const redeemed = await f.call("POST", "/api/devices/redeem", { token: enrollment.token, name }, null);
      assert.equal(redeemed.status, 201);
      const body = await redeemed.json();
      const cookie = redeemed.headers.get("set-cookie")!;
      assert.match(cookie, /HttpOnly; SameSite=Strict/);
      assert.doesNotMatch(JSON.stringify(body), /token|key|hash/i);
      devices.push({ id: body.id, cookie: cookie.split(";")[0], token: enrollment.token });
      assert.equal((await f.call("GET", "/api/session", undefined, null, { cookie })).status, 200);
      assert.equal((await f.call("GET", "/api/devices", undefined, null, { cookie })).status, 403);
      assert.equal((await f.call("POST", "/api/devices/redeem", { token: enrollment.token, name }, null)).status, 401);
    }
    const listing = await f.call("GET", "/api/devices");
    assert.equal(listing.status, 200);
    const text = await listing.text();
    assert.doesNotMatch(text, /token|key|hash/i);
    assert.deepEqual(JSON.parse(text).devices.map((d: { name: string }) => d.name), ["iPhone", "iPad"]);
    const store = readFileSync(path.join(f.root, ".kioku", "device-credentials.json"), "utf8");
    assert.equal(statSync(path.join(f.root, ".kioku", "device-credentials.json")).mode & 0o777, 0o600);
    const exportDir = mkdtempSync(path.join(os.tmpdir(), "kioku-enroll-export-"));
    try {
      const archive = path.join(exportDir, "vault.tar.gz");
      exportVault(f.root, archive);
      const tar = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
      assert.equal(tar.status, 0, tar.stderr);
      assert.doesNotMatch(tar.stdout, /device-credentials|secret-mobile/);
    } finally { rmSync(exportDir, { recursive: true, force: true }); }
    for (const device of devices) {
      assert.ok(!store.includes(device.token));
      assert.ok(!store.includes(device.cookie.split("=")[1]));
    }
    assert.equal((await f.call("DELETE", "/api/devices/" + devices[0].id, {})).status, 200);
    assert.equal((await f.call("GET", "/api/session", undefined, null, { cookie: devices[0].cookie })).status, 401);
    assert.equal((await f.call("GET", "/api/session", undefined, null, { cookie: devices[1].cookie })).status, 200);
    assert.equal((await f.call("GET", "/api/session", undefined, legacy)).status, 200);
  } finally { await f.done(); }
});

test("enrollment: revocation closes SSE and stops only that device's push deliveries", async () => {
  const f = await fixture();
  const abort = new AbortController();
  try {
    const peers: { id: string; cookie: string }[] = [];
    for (const name of ["iPhone", "iPad"]) {
      const enrollment = await (await f.call("POST", "/api/devices/enrollments", {})).json();
      const r = await f.call("POST", "/api/devices/redeem", { token: enrollment.token, name }, null);
      assert.equal(r.status, 201);
      peers.push({ id: (await r.json()).id, cookie: r.headers.get("set-cookie")!.split(";")[0] });
      const ua = createECDH("prime256v1"); ua.generateKeys();
      const subscribed = await f.call("POST", "/api/push/subscribe", { subscription: {
        endpoint: "https://web.push.apple.com/" + name,
        keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 3).toString("base64url") },
      } }, null, { cookie: peers.at(-1)!.cookie });
      assert.equal(subscribed.status, 200);
    }
    const stream = await fetch(f.srv.url + "/api/events", { headers: { cookie: peers[0].cookie }, signal: abort.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body!.getReader();
    const sent: string[] = [];
    const ch = pushChannel(f.j, f.push, { exclude: async () => [], fetch: (async (url: string | URL | Request) => { sent.push(String(url)); return new Response("", { status: 201 }); }) as typeof fetch });
    const notification = { id: "test", kind: "event" as const, title: "Prueba", body: "Aviso", paths: [] };
    await ch.send(notification);
    assert.deepEqual(sent.sort(), ["https://web.push.apple.com/iPad", "https://web.push.apple.com/iPhone"].sort());
    sent.length = 0;
    assert.equal((await f.call("DELETE", "/api/devices/" + peers[0].id, {})).status, 200);
    await ch.send(notification);
    assert.deepEqual(sent, ["https://web.push.apple.com/iPad"]);
    const end = (async () => { for (;;) { if ((await reader.read()).done) return "closed"; } })();
    const timeout = AbortSignal.timeout(1500);
    const timedOut = new Promise<string>((resolve) => timeout.addEventListener("abort", () => resolve("timed out"), { once: true }));
    assert.equal(await Promise.race([end, timedOut]), "closed");
    assert.equal((await f.call("GET", "/api/session", undefined, null, { cookie: peers[0].cookie })).status, 401);
    assert.equal((await f.call("GET", "/api/session", undefined, null, { cookie: peers[1].cookie })).status, 200);
  } finally { abort.abort(); await f.done(); }
});

test("enrollment: unauthenticated/mobile administration and foreign Origin are rejected without changing inventory", async () => {
  const f = await fixture();
  try {
    const legacy = loadOrCreateMobileKey(f.root);
    const before = await (await f.call("GET", "/api/devices")).text();
    for (const key of [null, legacy]) {
      assert.equal((await f.call("POST", "/api/devices/enrollments", {}, key)).status, key ? 403 : 401);
    }
    assert.equal((await f.call("POST", "/api/devices/redeem", { token: "b".repeat(64), name: "X" }, null, { origin: "https://evil.invalid" })).status, 403);
    assert.equal((await f.call("POST", "/api/devices/redeem", { token: "b".repeat(64), name: "X" }, null)).status, 401);
    assert.equal(await (await f.call("GET", "/api/devices")).text(), before);
    const enrollment = await (await f.call("POST", "/api/devices/enrollments", {})).json();
    assert.equal((await f.call("POST", "/api/devices/redeem", { token: enrollment.token, name: "" }, null)).status, 400);
    assert.equal(await (await f.call("GET", "/api/devices")).text(), before);
    assert.equal((await f.call("POST", "/api/devices/redeem", { token: enrollment.token, name: "Válido" }, null)).status, 201);
  } finally { await f.done(); }
});
