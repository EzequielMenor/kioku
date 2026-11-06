import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildDockerArgs } from "../src/assistant/docker-jail.ts";

const args = (extra: Partial<Parameters<typeof buildDockerArgs>[0]> = {}) => buildDockerArgs({
  hermesDir: "/vault/.kioku/hermes", bridgePath: "/repo/src/assistant/bridge.mjs",
  image: "nousresearch/hermes-agent:stable", name: "kioku-hermes-test",
  cidFile: "/vault/.kioku/runs/run/container.id", uid: 501, gid: 20,
  args: ["chat", "-Q", "--oneshot", "-q", "hola"], ...extra,
});

test("Mac: Docker monta solo el estado de Hermes y el puente, nunca el vault, home ni socket", () => {
  const a = args();
  const mounts = a.flatMap((x, i) => x === "--mount" ? [a[i + 1]] : []);
  assert.deepEqual(mounts, [
    "type=bind,source=/vault/.kioku/hermes,target=/opt/data",
    "type=bind,source=/repo/src/assistant/bridge.mjs,target=/opt/kioku-mcp.mjs,readonly",
  ]);
  for (const unsafe of ["--privileged", "--publish", "--volume", "docker.sock"]) assert.ok(!a.includes(unsafe));
  for (const guard of ["--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pull=never"]) assert.ok(a.includes(guard));
  assert.equal(a[a.indexOf("--user") + 1], "501:20");
  assert.equal(a[a.indexOf("--network") + 1], "host");
  assert.deepEqual(a.slice(-5), ["chat", "-Q", "--oneshot", "-q", "hola"]);
});

test("Mac: claves elegidas por nombre, sin valor en argv; auth se monta solo con Codex", () => {
  const a = args({ secretNames: ["OPENROUTER_API_KEY"], realAuth: "/user/.hermes/auth.json", authLock: "/user/.hermes/auth.lock" });
  assert.ok(a.includes("OPENROUTER_API_KEY"));
  assert.ok(!a.some(x => x.startsWith("OPENROUTER_API_KEY=")));
  assert.ok(a.includes("type=bind,source=/user/.hermes/auth.json,target=/opt/data/auth.json"));
  assert.ok(a.includes("type=bind,source=/user/.hermes/auth.lock,target=/opt/data/auth.lock"));
  assert.ok(!args().join(" ").includes("auth.json"));
});

test("Mac: rechaza rutas ambiguas y parámetros que podrían inyectar opciones", () => {
  for (const hermesDir of ["/", "relative", "/vault/a,b", "/vault/a\nb"]) assert.throws(() => args({ hermesDir }));
  for (const image of ["--privileged", "image\n--privileged", "https://registry/image"]) assert.throws(() => args({ image }));
  assert.throws(() => args({ secretNames: ["KEY=value"] }));
  assert.throws(() => args({ name: "--bad" }));
});

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { HermesEngine } from "../src/assistant/engine.ts";
import { SessionRegistry } from "../src/assistant/session.ts";

async function dockerEngine(hang = false) {
  const root = mkdtempSync(path.join(tmpdir(), "kioku-docker-"));
  const homeDir = path.join(root, "vault"), userHome = path.join(root, "user");
  mkdirSync(path.join(homeDir, ".kioku"), { recursive: true });
  mkdirSync(path.join(userHome, ".docker/run"), { recursive: true });
  writeFileSync(path.join(userHome, ".docker/run/docker.sock"), "");
  writeFileSync(path.join(homeDir, ".kioku/assistant.json"), JSON.stringify({ model: { provider: "openrouter", default: "test/model" } }));
  const seen: { args: string[]; env: NodeJS.ProcessEnv; config?: string }[] = [];
  const spawnFn = ((_bin: string, a: string[], o: { env: NodeJS.ProcessEnv }) => {
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => setImmediate(() => child.emit("close", 137));
    const run = a.includes("run");
    const rec = { args: a, env: o.env, config: run ? readFileSync(path.join(homeDir, ".kioku/hermes/config.yaml"), "utf8") : undefined };
    seen.push(rec);
    if (run) writeFileSync(a[a.indexOf("--cidfile") + 1], "a".repeat(64));
    if (!hang || !run) setImmediate(() => { child.stdout.end(run ? "session_id: MAC1\nDesde Mac." : ""); child.emit("close", 0); });
    return child;
  }) as never;
  const engine = new HermesEngine({ homeDir, userHome, platform: "darwin", dockerBin: process.execPath, spawnFn,
    bwrapBin: "/no/bwrap", hermesBin: "/no/native/hermes", timeoutMs: hang ? 20 : 1000,
    env: { OPENROUTER_API_KEY: "sk-elegida", ANTHROPIC_API_KEY: "NO-REENVIAR" },
  });
  return { engine, root, homeDir, seen, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("Mac: ejecuta Hermes en Docker sin exigir bwrap ni Hermes nativo y limpia token y contenedor", async () => {
  const e = await dockerEngine();
  try {
    assert.deepEqual(await e.engine.available(), { ok: true });
    const session = new SessionRegistry().open();
    const result = await e.engine.ask({ message: "hola", conversation: "mac", session, daemonUrl: "http://127.0.0.1:47800" });
    assert.deepEqual(result, { answer: "Desde Mac." });
    assert.equal(e.seen.length, 2, "run y limpieza del único id creado");
    assert.ok(e.seen[0].args.includes("run"));
    assert.ok(!e.seen[0].args.join(" ").includes("sk-elegida"));
    assert.equal(e.seen[0].env.OPENROUTER_API_KEY, "sk-elegida");
    assert.equal(e.seen[0].env.ANTHROPIC_API_KEY, undefined);
    assert.match(e.seen[0].config!, /http:\/\/127.0.0.1:47800/);
    assert.match(e.seen[0].config!, new RegExp(session.token));
    assert.ok(!readFileSync(path.join(e.homeDir, ".kioku/hermes/config.yaml"), "utf8").includes(session.token));
    assert.deepEqual(e.seen[1].args.slice(-3), ["rm", "--force", "a".repeat(64)]);
  } finally { e.done(); }
});

test("Mac: un timeout también retira su contenedor, sin repetir la consulta", async () => {
  const e = await dockerEngine(true);
  try {
    await assert.rejects(e.engine.ask({ message: "hola", conversation: "mac", session: new SessionRegistry().open(), daemonUrl: "http://127.0.0.1:47800" }), /tardó demasiado/);
    assert.equal(e.seen.filter(x => x.args.includes("run")).length, 1);
    assert.deepEqual(e.seen.at(-1)!.args.slice(-3), ["rm", "--force", "a".repeat(64)]);
  } finally { e.done(); }
});
