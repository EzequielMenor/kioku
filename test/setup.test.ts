import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const cli = path.resolve(import.meta.dirname, "../src/cli/main.ts");
const host = "laptop.example.ts.net";
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "kioku-setup-"));
  const home = path.join(root, "vault");
  const bin = path.join(root, "bin");
  mkdirSync(home); mkdirSync(bin);
  function stub(status: unknown, serve: unknown) {
    writeFileSync(path.join(bin, "tailscale"), `#!${process.execPath}\nconst a=process.argv.slice(2); if(a.join(' ')==='status --json') console.log(${JSON.stringify(JSON.stringify(status))}); else if(a.join(' ')==='serve status --json') console.log(${JSON.stringify(JSON.stringify(serve))}); else process.exit(99);\n`, { mode: 0o755 });
  }
  async function run(...args: string[]) {
    const child = spawn(process.execPath, ["--no-warnings", cli, ...args], { env: { ...process.env, KIOKU_HOME: home, PATH: bin, KIOKU_PUBLIC_HOST: "", KIOKU_ALLOWED_HOSTS: "" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", c => { stdout += c; });
    child.stderr.on("data", c => { stderr += c; });
    const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    return { code, stdout, stderr };
  }
  return { root, home, stub, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("setup guides installation and pairing without changing the vault or running network mutations", async () => {
  const f = fixture();
  try {
    f.stub({ BackendState: "Stopped" }, {});
    const r = await f.run("setup");
    assert.equal(r.code, 0); assert.equal(r.stderr, "");
    for (const text of ["kioku open", "kioku doctor", "kioku pair", "Tailscale", "encendido", "Android", "Mac"]) assert.ok(r.stdout.includes(text), text);
    assert.deepEqual(readdirSync(f.home), []);
  } finally { f.cleanup(); }
});

test("doctor reports stopped prerequisites without creating keys or data", async () => {
  const f = fixture();
  try {
    f.stub({ BackendState: "Stopped", Self: { DNSName: host } }, {});
    const r = await f.run("doctor");
    assert.equal(r.code, 1); assert.equal(r.stderr, "");
    assert.match(r.stdout, /NO · Kioku/); assert.match(r.stdout, /NO · Tailscale/);
    assert.doesNotMatch(r.stdout, /\?k=/); assert.deepEqual(readdirSync(f.home), []);
  } finally { f.cleanup(); }
});

test("doctor checks the live Host gate and HTTPS proxy against the actual nondefault daemon port", async () => {
  const f = fixture();
  let allow = true;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.statusCode = req.headers.host === host && !allow ? 403 : 200;
    res.end(JSON.stringify({ ok: res.statusCode === 200 }));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  mkdirSync(path.join(f.home, ".kioku"));
  writeFileSync(path.join(f.home, ".kioku/runtime.json"), JSON.stringify({ pid: process.pid, port, startedAt: "now" }));
  const initial = readdirSync(path.join(f.home, ".kioku"));
  const serve = (p: number) => ({ TCP: { "443": { HTTPS: true } }, Web: { [`${host}:443`]: { Handlers: { "/": { Proxy: `http://127.0.0.1:${p}` } } } } });
  try {
    f.stub({ BackendState: "Running", Self: { DNSName: host + "." } }, serve(port));
    const ok = await f.run("doctor");
    assert.equal(ok.code, 0, ok.stdout + ok.stderr); assert.equal(ok.stderr, "");
    assert.match(ok.stdout, /OK · Nombre aceptado/); assert.match(ok.stdout, /OK · HTTPS privado/);
    assert.match(ok.stdout, /No comprueba el acceso desde otro dispositivo/);
    allow = false;
    const denied = await f.run("doctor");
    assert.equal(denied.code, 1); assert.equal(denied.stderr, "");
    assert.match(denied.stdout, /NO · Nombre aceptado/);
    assert.ok(denied.stdout.includes(`KIOKU_ALLOWED_HOSTS=${host}`));
    allow = true;
    f.stub({ BackendState: "Running", Self: { DNSName: host } }, serve(port + 1));
    const drift = await f.run("doctor");
    assert.equal(drift.code, 1); assert.equal(drift.stderr, "");
    assert.match(drift.stdout, /NO · HTTPS privado/);
    assert.ok(drift.stdout.includes(`tailscale serve --bg http://127.0.0.1:${port}`));
    f.stub({ BackendState: "Running", Self: { DNSName: host } }, { ...serve(port), AllowFunnel: { [`${host}:443`]: true } });
    const publicProxy = await f.run("doctor");
    assert.equal(publicProxy.code, 1); assert.equal(publicProxy.stderr, "");
    assert.match(publicProxy.stdout, /NO · HTTPS privado/);
    assert.deepEqual(readdirSync(path.join(f.home, ".kioku")), initial);
  } finally { await new Promise<void>(r => server.close(() => r())); f.cleanup(); }
});

test("doctor handles missing tools, malformed status and unsafe DNS without keys or command injection", async () => {
  const f = fixture();
  try {
    for (const status of [undefined, null, [], { BackendState: "Running", Self: { DNSName: "bad;touch injected.ts.net" } }]) {
      if (status !== undefined) f.stub(status, {});
      const r = await f.run("doctor");
      assert.equal(r.code, 1); assert.equal(r.stderr, "");
      assert.match(r.stdout, /NO · Tailscale/);
      assert.doesNotMatch(r.stdout, /touch injected|\?k=/);
      assert.deepEqual(readdirSync(f.home), []);
    }
  } finally { f.cleanup(); }
});

test("setup and doctor reject unknown arguments without writing data; old help remains available", async () => {
  const f = fixture();
  try {
    for (const command of ["setup", "doctor"]) {
      const r = await f.run(command, "--apply");
      assert.equal(r.code, 1); assert.equal(r.stdout, "");
      assert.equal(r.stderr, `kioku: uso: kioku ${command}\n`);
      assert.deepEqual(readdirSync(f.home), []);
    }
    const help = await f.run("--help");
    assert.equal(help.code, 0); assert.equal(help.stderr, "");
    assert.match(help.stdout, /pair \[--revoke\]/); assert.match(help.stdout, /service install\|uninstall\|status/);
  } finally { f.cleanup(); }
});
