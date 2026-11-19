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

test("private setup: operator access denial surfaces actionable Tailscale operator hint", async () => {
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(os.tmpdir(), "kioku-private-op-"));
  const j = await Kioku.open({ root });
  const srv = await startServer(j, {
    port: 0, webDir: web, key: "a".repeat(64),
    connectionRunner: async (args) => {
      if (args[0] === "status") return JSON.stringify({ BackendState: "Running", Self: { DNSName: host + "." } });
      if (args[1] === "status") return JSON.stringify({});
      const err = new Error("Command failed") as Error & { stderr?: string };
      err.stderr = "Access denied: serve config denied; must be root or operator";
      throw err;
    },
  });
  try {
    const r = await fetch(srv.url + "/api/connections/configure", {
      method: "POST",
      headers: { "x-kioku-key": srv.key, "content-type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(r.status, 503);
    const body = await r.json() as { error: string };
    assert.match(body.error, /tailscale set --operator/);
  } finally { await srv.close(); j.close(); cleanup(); rmSync(web, { recursive: true, force: true }); }
});

// Caso real (Mac mini): Kioku publicado en 443 y otro servicio del usuario en 8443. Solo importa el 443.
test("private setup: otras publicaciones de Tailscale (8443, Funnel ajeno) no bloquean a Kioku en el 443", async () => {
  const { PrivateConnection } = await import("../src/server/private-connection.ts");
  const home = mkdtempSync(path.join(os.tmpdir(), "kioku-private-other-"));
  const port = 47800;
  const ours = { Handlers: { "/": { Proxy: `http://127.0.0.1:${port}` } } };
  const other = { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } };
  let config: Record<string, any> = {};
  const calls: string[][] = [];
  const conn = new PrivateConnection(home, async (args) => {
    calls.push(args);
    if (args[0] === "status") return JSON.stringify({ BackendState: "Running", Self: { DNSName: host + "." } });
    if (args[1] === "status") return JSON.stringify(config);
    config = { ...config, TCP: { ...config.TCP, "443": { HTTPS: true } }, Web: { ...config.Web, [host + ":443"]: ours } };
    return "";
  });
  const allowed = new Set([host]);
  try {
    config = { TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } }, Web: { [host + ":443"]: ours, [host + ":8443"]: other } };
    let s = await conn.status(port, allowed);
    assert.equal(s.ready, true, "443 ya apunta a Kioku: listo aunque exista 8443");
    assert.equal(s.problem, null);
    assert.equal(await conn.configure(port), host);
    assert.equal(calls.filter((a) => a.includes("--bg")).length, 0, "no reconfigura lo que ya está bien");

    config = { TCP: { "8443": { HTTPS: true } }, Web: { [host + ":8443"]: other }, AllowFunnel: { [host + ":8443"]: true } };
    s = await conn.status(port, allowed);
    assert.equal(s.canConfigure, true, "443 libre: se puede publicar Kioku sin tocar 8443");
    assert.equal(await conn.configure(port), host);
    assert.deepEqual(calls.filter((a) => a.includes("--bg")), [["serve", "--bg", "--https=443", `http://127.0.0.1:${port}`]]);
    assert.deepEqual(config.Web[host + ":8443"], other, "la publicación ajena sigue intacta");

    config = { TCP: { "443": { HTTPS: true } }, Web: { [host + ":443"]: ours }, AllowFunnel: { [host + ":443"]: true } };
    s = await conn.status(port, allowed);
    assert.equal(s.ready, false, "Kioku nunca se expone por Funnel");
    assert.match(s.problem ?? "", /443/);

    config = { TCP: { "443": { HTTPS: true } }, Web: { [host + ":443"]: other } };
    s = await conn.status(port, allowed);
    assert.equal(s.canConfigure, false, "el 443 ocupado por otro servicio no se sobrescribe");
    assert.match(s.problem ?? "", /443/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("private setup: checks detallan qué falta de Tailscale y /api/connections/probe verifica el acceso privado HTTPS", async () => {
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(os.tmpdir(), "kioku-private-probe-"));
  const j = await Kioku.open({ root });
  let tsStatus: Record<string, unknown> = { BackendState: "NeedsLogin", Self: { DNSName: "" } };
  let serveCfg: Record<string, unknown> = {};
  let port = 0;
  let probeMode: "ok" | "tls" | "http" = "ok";
  const connectionRunner = async (args: string[]) => {
    if (args[0] === "status") return JSON.stringify(tsStatus);
    if (args[1] === "status") return JSON.stringify(serveCfg);
    serveCfg = { TCP: { "443": { HTTPS: true } }, Web: { [host + ":443"]: { Handlers: { "/": { Proxy: `http://127.0.0.1:${port}` } } } } };
    return "";
  };
  const connectionProbeFetch = async (url: string) => {
    assert.equal(url, `https://${host}/api/health`);
    if (probeMode === "tls") throw new Error("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    if (probeMode === "http") return new Response("bad gateway", { status: 502 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const srv = await startServer(j, { port: 0, webDir: web, key: "a".repeat(64), connectionRunner, connectionProbeFetch });
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
    // 1. Falta iniciar sesión en Tailscale
    let st = await (await call("GET", "/api/connections/status")).json() as { checks: { id: string; ok: boolean }[]; canConfigure: boolean };
    assert.equal(st.checks.find((c) => c.id === "installed")?.ok, true);
    assert.equal(st.checks.find((c) => c.id === "signed_in")?.ok, false);
    assert.equal(st.canConfigure, false);

    // 2. Sesión iniciada, pero sin certificados HTTPS
    tsStatus = { BackendState: "Running", Self: { DNSName: host + "." }, CurrentTailnet: { MagicDNSEnabled: true }, CertDomains: [] };
    st = await (await call("GET", "/api/connections/status")).json();
    assert.equal(st.checks.find((c) => c.id === "signed_in")?.ok, true);
    assert.equal(st.checks.find((c) => c.id === "magic_dns")?.ok, true);
    assert.equal(st.checks.find((c) => c.id === "https")?.ok, false);
    assert.equal(st.canConfigure, false);

    // 3. Antes de activar acceso privado, probe devuelve not-ready
    const preProbe = await (await call("POST", "/api/connections/probe", {})).json() as { ok: boolean; reason: string };
    assert.equal(preProbe.ok, false);
    assert.equal(preProbe.reason, "not-ready");

    // 4. Con CertDomains activo, configurar y comprobar acceso privado
    tsStatus = { BackendState: "Running", Self: { DNSName: host + "." }, CurrentTailnet: { MagicDNSEnabled: true }, CertDomains: [host] };
    assert.equal((await call("POST", "/api/connections/configure", { confirm: true })).status, 200);
    const okProbe = await (await call("POST", "/api/connections/probe", {})).json() as { ok: boolean; origin: string; ms: number };
    assert.equal(okProbe.ok, true);
    assert.equal(okProbe.origin, `https://${host}`);
    assert.equal(typeof okProbe.ms, "number");

    probeMode = "tls";
    const tlsProbe = await (await call("POST", "/api/connections/probe", {})).json() as { ok: boolean; reason: string; detail: string };
    assert.equal(tlsProbe.ok, false);
    assert.equal(tlsProbe.reason, "tls");
    assert.match(tlsProbe.detail, /HTTPS|certificado/i);

    probeMode = "http";
    const httpProbe = await (await call("POST", "/api/connections/probe", {})).json() as { ok: boolean; reason: string; status: number };
    assert.equal(httpProbe.ok, false);
    assert.equal(httpProbe.reason, "http-error");
    assert.equal(httpProbe.status, 502);

    // 5. El móvil o acceso remoto no pueden lanzar la sonda local
    const mobile = loadOrCreateMobileKey(root);
    assert.equal((await call("POST", "/api/connections/probe", {}, mobile)).status, 403);
    assert.equal((await call("POST", "/api/connections/probe", {}, srv.key, { host })).status, 403);
  } finally { await srv.close(); j.close(); cleanup(); rmSync(web, { recursive: true, force: true }); }
});
