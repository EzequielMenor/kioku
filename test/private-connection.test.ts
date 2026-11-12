import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { tmpVault } from "./helpers.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";

const host = "mac.example.ts.net";

test("private setup: local admin explicitly configures Serve, persists accepted host and is idempotent", async () => {
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(os.tmpdir(), "kioku-private-web-"));
  const j = await Kioku.open({ root });
  const calls: string[][] = [];
  let config: Record<string, unknown> = {};
  let port = 0;
  const connectionRunner = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "status") return JSON.stringify({ BackendState: "Running", Self: { DNSName: host + "." } });
    if (args[1] === "status") return JSON.stringify(config);
    assert.deepEqual(args, ["serve", "--bg", "--https=443", `http://127.0.0.1:${port}`]);
    config = { TCP: { "443": { HTTPS: true } }, Web: { [host + ":443"]: { Handlers: { "/": { Proxy: `http://127.0.0.1:${port}` } } } } };
    return "";
  };
  let srv = await startServer(j, { port: 0, webDir: web, key: "a".repeat(64), connectionRunner });
  port = srv.port;
  const call = (method: string, route: string, body?: unknown, key = srv.key, headers: Record<string, string> = {}): Promise<Response> => new Promise((resolve, reject) => {
    const req = http.request(srv.url + route, { method, headers: { "x-kioku-key": key, ...(body ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode })));
    });
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    const status = await (await call("GET", "/api/connections/status")).json();
    assert.equal(status.connected, true);
    assert.equal(status.ready, false);
    assert.equal(calls.some((args) => args.includes("--bg")), false, "GET never mutates Tailscale");
    assert.equal((await call("POST", "/api/connections/configure", {})).status, 400);
    const mobile = loadOrCreateMobileKey(root);
    assert.equal((await call("GET", "/api/connections/status", undefined, mobile)).status, 403);
    assert.equal((await call("POST", "/api/connections/configure", { confirm: true }, mobile)).status, 403);
    assert.equal((await call("POST", "/api/connections/configure", { confirm: true }, srv.key, { origin: "https://evil.invalid" })).status, 403);
    const configured = await call("POST", "/api/connections/configure", { confirm: true });
    assert.equal(configured.status, 200);
    assert.equal((await configured.json()).publicOrigin, "https://" + host);
    const again = await call("POST", "/api/connections/configure", { confirm: true });
    assert.equal(again.status, 200);
    assert.equal(calls.filter((args) => args.includes("--bg")).length, 1);
    const remote = await call("GET", "/api/health", undefined, srv.key, { host });
    assert.equal(remote.status, 200);
    assert.equal((await call("POST", "/api/connections/configure", { confirm: true }, srv.key, { host })).status, 403, "remote admin cannot reconfigure native network");
    await srv.close();
    srv = await startServer(j, { port: 0, webDir: web, key: "a".repeat(64), connectionRunner });
    assert.equal((await call("GET", "/api/health", undefined, srv.key, { host })).status, 200, "accepted hostname survives restart");
    config = { AllowFunnel: { [host + ":443"]: true } };
    assert.equal((await call("POST", "/api/connections/configure", { confirm: true })).status, 409);
    assert.equal(calls.filter((args) => args.includes("--bg")).length, 1, "never overwrite Funnel or reset anything");
    config = { Web: { [host + ":443"]: { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } } } };
    assert.equal((await call("POST", "/api/connections/configure", { confirm: true })).status, 409);
    assert.equal(calls.filter((args) => args.includes("--bg")).length, 1);
  } finally { await srv.close(); j.close(); cleanup(); rmSync(web, { recursive: true, force: true }); }
});
