import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);
const script = new URL("scripts/kioku-local.sh", root).pathname;
const HOST = "mac-de-eze.tail1234.ts.net";
const KEY = "a".repeat(64);

type Opts = { tailscale?: "ok" | "down" | "unsafe"; pbcopy?: boolean };

/** Entorno aislado: `docker`, `tailscale` y `pbcopy` simulados; ningún dato ni red real. */
function sandbox(o: Opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "kioku-remote-"));
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  const log = path.join(dir, "calls.log");
  const clip = path.join(dir, "clipboard");
  const envFile = path.join(dir, "local.env");
  const put = (name: string, body: string) => { writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(path.join(bin, name), 0o755); };
  put("docker", `echo "docker $*" >> "${log}"
case "$1" in info) exit 0 ;; esac
args=("$@"); i=0
while [ $i -lt \${#args[@]} ] && [ "\${args[$i]}" != "kioku" ]; do i=$((i+1)); done
if [ "\${args[$((i+1))]:-}" = "node" ] && [[ " $* " == *" exec "* ]]; then
  if [[ " $* " == *" pair"* ]]; then
    pub=""; for a in "$@"; do case "$a" in KIOKU_PUBLIC_HOST=*) pub="\${a#KIOKU_PUBLIC_HOST=}";; esac; done
    echo "Abre esta dirección en el móvil:"; echo; echo "  https://$pub/?k=${KEY}"; echo
  else
    exec "\${args[@]:$((i+1))}"
  fi
fi
exit 0`);
  const status = o.tailscale ?? "ok";
  put("tailscale", `echo "tailscale $*" >> "${log}"
if [ "$1" = "status" ]; then
  ${status === "down" ? "exit 1" : `echo '{"Self":{"DNSName":"${status === "unsafe" ? "x;touch /tmp/pwned." : HOST + "."}"}}'`}
fi
exit 0`);
  if (o.pbcopy !== false) put("pbcopy", `cat > "${clip}"`);
  const run = (...args: string[]) => spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { PATH: `${bin}:/usr/bin:/bin:${path.dirname(process.execPath)}`, KIOKU_LOCAL_ENV_FILE: envFile, HOME: dir },
  });
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  return { run, calls, envFile, clip };
}

test("remote: allows the tailnet name, publishes the private proxy and copies the pairing link without printing the key", () => {
  const s = sandbox();
  const r = s.run("remote");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(s.envFile, "utf8"), `KIOKU_ALLOWED_HOSTS=${HOST}\n`);
  const calls = s.calls();
  assert.ok(calls.indexOf(`docker compose`) >= 0 && /up -d --no-build/.test(calls));
  assert.match(calls, /tailscale serve --bg http:\/\/127\.0\.0\.1:47800/);
  assert.doesNotMatch(calls, /funnel/i);
  assert.doesNotMatch(calls, /down|-v\b/);
  assert.equal(readFileSync(s.clip, "utf8").trim(), `https://${HOST}/?k=${KEY}`);
  assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY), "the key must not reach the terminal when it was copied");
  assert.match(r.stdout, /portapapeles/i);
});

test("remote: without a clipboard tool it prints the link instead of losing it", () => {
  const s = sandbox({ pbcopy: false });
  const r = s.run("remote");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`https://${HOST}/?k=${KEY}`));
});

test("remote: Tailscale not connected stops before changing anything", () => {
  const s = sandbox({ tailscale: "down" });
  const r = s.run("remote");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Tailscale/);
  assert.equal(existsSync(s.envFile), false);
  assert.doesNotMatch(s.calls(), /tailscale serve/);
});

test("remote: refuses a DNS name that is not a plain host name", () => {
  const s = sandbox({ tailscale: "unsafe" });
  const r = s.run("remote");
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(s.envFile), false);
  assert.doesNotMatch(s.calls(), /tailscale serve|pair/);
});

test("local launcher keeps its previous commands: status and usage", () => {
  const s = sandbox();
  const st = s.run("status");
  assert.equal(st.status, 0, st.stderr);
  assert.match(s.calls(), /docker compose -f .*compose\.local\.yml ps/);
  const bad = s.run("nope");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Uso: /);
  for (const cmd of ["open", "start", "stop", "status"]) assert.match(bad.stderr, new RegExp(cmd));
});

test("remote --show prints the link even when it was copied", () => {
  const s = sandbox();
  const r = s.run("remote", "--show");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`https://${HOST}/?k=${KEY}`));
  assert.equal(readFileSync(s.clip, "utf8").trim(), `https://${HOST}/?k=${KEY}`);
});

test("compose.local.yml passes the allowed host through and stays loopback-only", () => {
  const c = parse(readFileSync(new URL("compose.local.yml", root), "utf8"));
  assert.equal(c.services.kioku.environment.KIOKU_ALLOWED_HOSTS, "${KIOKU_ALLOWED_HOSTS:-}");
  assert.deepEqual(c.services.gateway.ports, ["127.0.0.1:47800:47801"]);
  assert.notEqual(c.services.kioku.network_mode, "host");
  assert.equal(c.services.kioku.cap_add, undefined);
});
