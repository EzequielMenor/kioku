import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { tmpVault } from "./helpers.ts";

test("device enrollment expires at five minutes, bounds pending codes, and rejects reuse/restart without changing inventory", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-12T10:00:00Z") });
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(os.tmpdir(), "kioku-expiry-web-"));
  writeFileSync(path.join(web, "index.html"), "Kioku");
  const j = await Kioku.open({ root });
  let srv = await startServer(j, { port: 0, webDir: web, key: "a".repeat(64) });
  const call = (url: string, body: unknown, authenticated = true) => fetch(srv.url + url, {
    method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { "x-kioku-key": srv.key } : {}) },
    body: JSON.stringify(body),
  });
  const listing = async () => {
    const r = await fetch(srv.url + "/api/devices", { headers: { "x-kioku-key": srv.key } });
    assert.equal(r.status, 200);
    return r.text();
  };
  try {
    const before = await listing();
    const created = await call("/api/devices/enrollments", {});
    assert.equal(created.status, 201);
    const first = await created.json();
    assert.equal(first.expiresAt, "2026-11-12T10:05:00.000Z");
    for (let i = 1; i < 20; i++) assert.equal((await call("/api/devices/enrollments", {})).status, 201);
    const bounded = await call("/api/devices/enrollments", {});
    assert.equal(bounded.status, 409);
    assert.equal(await listing(), before);
    t.mock.timers.tick(5 * 60_000);
    const expired = await call("/api/devices/redeem", { token: first.token, name: "iPhone" }, false);
    assert.equal(expired.status, 401);
    assert.equal(expired.headers.get("set-cookie"), null);
    assert.equal(await listing(), before);
    const fresh = await call("/api/devices/enrollments", {});
    assert.equal(fresh.status, 201, "expired codes free capacity");
    const pending = await fresh.json();
    await srv.close();
    srv = await startServer(j, { port: 0, webDir: web, key: "a".repeat(64) });
    const afterRestart = await call("/api/devices/redeem", { token: pending.token, name: "iPhone" }, false);
    assert.equal(afterRestart.status, 401);
    assert.equal(afterRestart.headers.get("set-cookie"), null);
    assert.equal(await listing(), before);
  } finally { await srv.close(); j.close(); cleanup(); rmSync(web, { recursive: true, force: true }); }
});
