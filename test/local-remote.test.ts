import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const server = new URL("scripts/kioku-server.sh", root).pathname;
const local = new URL("scripts/kioku-local.sh", root).pathname;
const HOST = "mac-de-eze.tail1234.ts.net";

type Opts = { tailscale?: "ok" | "down" | "unsafe"; pbcopy?: boolean };

/** Entorno aislado: `tailscale`, `launchctl`, `curl` y `pbcopy` simulados; ningún dato ni red real. */
function sandbox(o: Opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "kioku-remote-"));
  const bin = path.join(dir, "bin");
  const sys = path.join(dir, "sys");
  mkdirSync(bin);
  mkdirSync(sys);
  // PATH cerrado: sin /usr/bin no hay `pbcopy` real ni binarios del sistema fuera del test.
  for (const name of ["bash", "cat", "dirname", "id", "mv", "sleep", "grep", "head", "mktemp", "readlink", "sed", "seq", "tail"]) {
    const from = [`/bin/${name}`, `/usr/bin/${name}`].find(existsSync);
    if (from) symlinkSync(from, path.join(sys, name));
  }
  symlinkSync(process.execPath, path.join(sys, "node"));
  const log = path.join(dir, "calls.log");
  const clip = path.join(dir, "clipboard");
  const envFile = path.join(dir, "kioku.env");
  const put = (name: string, body: string) => { writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(path.join(bin, name), 0o755); };
  const status = o.tailscale ?? "ok";
  const dnsName = status === "unsafe" ? `x;touch ${path.join(dir, "pwned")}.` : `${HOST}.`;
  put("tailscale", `echo "tailscale $*" >> "${log}"
if [ "$1" = "status" ]; then
  ${status === "down" ? "exit 1" : `echo '{"Self":{"DNSName":"${dnsName}"}}'`}
fi
exit 0`);
  put("launchctl", `echo "launchctl $*" >> "${log}"; exit 0`);
  put("curl", `echo "curl $*" >> "${log}"; exit 0`);
  if (o.pbcopy !== false) put("pbcopy", `cat > "${clip}"`);
  const run = (script: string, ...args: string[]) => spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { PATH: `${bin}:${sys}`, HOME: dir, KIOKU_ENV_FILE: envFile, KIOKU_PORT: "47800" },
  });
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  const key = () => readFileSync(path.join(dir, "Documents", "Kioku", ".kioku", "secret-mobile"), "utf8").trim();
  return { run, calls, envFile, clip, dir, key, remote: (...a: string[]) => run(server, "remote", ...a) };
}

test("remote: acepta el nombre de la tailnet, publica el proxy y copia el enlace sin imprimir la clave", () => {
  const s = sandbox();
  const r = s.remote();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(s.envFile, "utf8"), `KIOKU_ALLOWED_HOSTS=${HOST}\n`);
  const calls = s.calls();
  assert.match(calls, /launchctl kickstart -k gui\/\d+\/com\.ezequiel\.kioku-server/);
  assert.match(calls, /tailscale serve --bg http:\/\/127\.0\.0\.1:47800/);
  assert.doesNotMatch(calls, /funnel/i);
  assert.equal(readFileSync(s.clip, "utf8").trim(), `https://${HOST}/?k=${s.key()}`);
  assert.ok(!r.stdout.includes(s.key()) && !r.stderr.includes(s.key()), "la clave no debe llegar al terminal si se copió");
  assert.match(r.stdout, /portapapeles/i);
});

test("remote --show imprime el enlace aunque lo copie", () => {
  const s = sandbox();
  const r = s.remote("--show");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`https://${HOST}/?k=${s.key()}`));
  assert.equal(readFileSync(s.clip, "utf8").trim(), `https://${HOST}/?k=${s.key()}`);
});

test("remote: sin portapapeles imprime el enlace en lugar de perderlo", () => {
  const s = sandbox({ pbcopy: false });
  const r = s.remote();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`https://${HOST}/?k=${s.key()}`));
});

test("remote: sin Tailscale conectado se detiene antes de cambiar nada", () => {
  const s = sandbox({ tailscale: "down" });
  const r = s.remote();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Tailscale/);
  assert.equal(existsSync(s.envFile), false);
  assert.doesNotMatch(s.calls(), /tailscale serve/);
});

test("remote: rechaza un nombre DNS que no es un host simple", () => {
  const s = sandbox({ tailscale: "unsafe" });
  const r = s.remote();
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(s.envFile), false);
  assert.equal(existsSync(path.join(s.dir, "pwned")), false);
  assert.doesNotMatch(s.calls(), /tailscale serve/);
});

test("remote es idempotente: con el host ya aceptado no reinicia y conserva el resto del entorno", () => {
  const s = sandbox();
  writeFileSync(s.envFile, `KIOKU_ALLOWED_HOSTS=${HOST}\nKIOKU_PUBLIC_HOST=${HOST}\n`);
  assert.equal(s.remote().status, 0);
  assert.equal(s.remote().status, 0);
  assert.doesNotMatch(s.calls(), /launchctl kickstart/);
  assert.equal(readFileSync(s.envFile, "utf8"), `KIOKU_ALLOWED_HOSTS=${HOST}\nKIOKU_PUBLIC_HOST=${HOST}\n`);
});

test("el lanzador local delega remote en el daemon nativo y mantiene sus comandos", () => {
  const s = sandbox();
  const r = s.run(local, "remote");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(s.envFile, "utf8"), `KIOKU_ALLOWED_HOSTS=${HOST}\n`);
  assert.match(s.calls(), /tailscale serve --bg/);
  const bad = s.run(local, "nope");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Uso: .*remote/);
});
