import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import { HermesEngine, buildJailArgs, hermesConfigYaml, parseHermesOutput, soulText } from "../src/assistant/engine.ts";
import { SessionRegistry } from "../src/assistant/session.ts";

const jail = (over: Partial<Parameters<typeof buildJailArgs>[0]> = {}) => buildJailArgs({
  hermesDir: "/vault/.jarvis/hermes", bridgePath: "/repo/src/assistant/bridge.mjs", realAuth: "/home/u/.hermes/auth.json",
  nodeDir: "/node/bin", hermesBin: "/home/u/.hermes/hermes-agent/venv/bin/hermes", args: ["chat", "-q", "hola"], home: "/home/u", ...over,
});

test("jaula: no monta el vault (solo su carpeta de Hermes) ni Documents ni ~/.config", () => {
  const a = jail();
  const binds = a.filter((x) => x.startsWith("/"));
  assert.ok(!binds.includes("/vault"), "el vault entero no se monta");
  assert.ok(binds.filter((x) => x.startsWith("/vault")).every((x) => x === "/vault/.jarvis/hermes"));
  assert.ok(!binds.some((x) => x.includes("Documents") || x.includes("/.config") || x === "/home/u"));
  assert.ok(!a.includes("--share-net") && !a.includes("--unshare-all"), "la red se hereda: hace falta para el modelo");
  for (const f of ["--unshare-pid", "--unshare-ipc", "--unshare-uts", "--die-with-parent", "--new-session", "--clearenv"]) assert.ok(a.includes(f), f);
});

test("jaula: incluye DNS (resolve), auth.json real y el puente en /opt", () => {
  const a = jail();
  assert.ok(a.includes("/run/systemd/resolve"));
  const i = a.indexOf("/home/u/.hermes/auth.json");
  assert.equal(a[i - 1], "--bind");
  assert.equal(a[i + 1], "/home/u/.hermes-jail/auth.json");
  assert.equal(a[a.indexOf("/opt/jarvis-mcp.mjs") - 2], "--ro-bind");
  assert.deepEqual(a.slice(-4), ["/home/u/.hermes/hermes-agent/venv/bin/hermes", "chat", "-q", "hola"]);
});

test("config de Hermes: solo clarify + MCP jarvis; sin terminal/file/browser/code_execution/computer_use", () => {
  const y = hermesConfigYaml({ toolsets: ["clarify"], daemonUrl: "http://127.0.0.1:47800", token: "tok", bridgePath: "/opt/jarvis-mcp.mjs" });
  for (const bad of ["terminal", "file", "browser", "code_execution", "computer_use"]) assert.ok(!y.includes(bad), bad);
  assert.match(y, /cli: \[clarify\]/);
  assert.match(y, /max_turns: 20/);
  assert.match(y, /provider: openai-codex/);
  assert.match(y, /JARVIS_TOKEN: "tok"/);
  assert.match(y, /JARVIS_URL: "http:\/\/127.0.0.1:47800"/);
});

test("SOUL: español, datos≠instrucciones, niveles y propose", () => {
  const t = soulText();
  assert.match(t, /español/);
  assert.match(t, /DATOS/);
  assert.match(t, /propose/);
  assert.match(t, /no inventes rutas/i);
});

test("parseHermesOutput extrae session_id y la respuesta", () => {
  assert.deepEqual(parseHermesOutput("session_id: 20261026_abc\nTienes 2 capturas.\nUna: x\n"), { sessionId: "20261026_abc", answer: "Tienes 2 capturas.\nUna: x" });
  assert.deepEqual(parseHermesOutput("Solo respuesta"), { sessionId: null, answer: "Solo respuesta" });
  assert.deepEqual(parseHermesOutput("Respuesta\nsession_id: zz9\n"), { sessionId: "zz9", answer: "Respuesta" });
  assert.equal(parseHermesOutput("⚠ tirith security scanner enabled but not available — command scanning will use pattern matching only\nHola\n").answer, "Hola");
  assert.equal(parseHermesOutput("⚠ Atención: esto vence hoy").answer, "⚠ Atención: esto vence hoy", "no se borra texto legítimo del modelo");
});

function fakeSpawn(outputs: string[], seen: { args: string[]; config: string }[], configPath: string) {
  let n = 0;
  return ((_bin: string, args: string[]) => {
    seen.push({ args, config: readFileSync(configPath, "utf8") });
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill(): void };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => undefined;
    const text = outputs[n++] ?? "";
    setImmediate(() => { child.stdout.write(text); child.stdout.end(); child.emit("close", 0); });
    return child;
  }) as never;
}

function engineEnv() {
  const root = mkdtempSync(path.join(tmpdir(), "jarvis-eng-"));
  const userHome = path.join(root, "userhome");
  mkdirSync(path.join(userHome, ".hermes/hermes-agent/venv/bin"), { recursive: true });
  writeFileSync(path.join(userHome, ".hermes/hermes-agent/venv/bin/hermes"), "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(path.join(userHome, ".hermes/auth.json"), "{}");
  const home = path.join(root, "vault");
  mkdirSync(home);
  return { root, userHome, home, cfg: path.join(home, ".jarvis/hermes/config.yaml"), done: () => rmSync(root, { recursive: true, force: true }) };
}

test("HermesEngine: escribe config con token, reanuda la conversación y limpia el token", async () => {
  const e = engineEnv();
  try {
    const seen: { args: string[]; config: string }[] = [];
    const eng = new HermesEngine({
      homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env",
      spawnFn: fakeSpawn(["session_id: S1\nPrimera.", "session_id: S1\nSegunda."], seen, e.cfg),
    });
    const s = new SessionRegistry().open();
    const a1 = await eng.ask({ message: "hola", conversation: "c1", session: s, daemonUrl: "http://127.0.0.1:1" });
    assert.equal(a1.answer, "Primera.");
    assert.ok(seen[0].config.includes(s.token), "durante la ejecución el config lleva el token");
    assert.ok(!seen[0].args.includes("--resume"));
    assert.ok(existsSync(path.join(e.home, ".jarvis/hermes/SOUL.md")));
    assert.ok(!readFileSync(e.cfg, "utf8").includes(s.token), "al terminar se borra el token");
    await eng.ask({ message: "otra", conversation: "c1", session: s, daemonUrl: "http://127.0.0.1:1" });
    const args = seen[1].args;
    assert.equal(args[args.indexOf("--resume") + 1], "S1");
    for (const f of ["chat", "-Q", "--oneshot", "--max-turns", "--run-budget", "-q"]) assert.ok(args.includes(f), f);
    assert.equal(args[args.length - 1], "otra");
    assert.ok(!args.includes(e.home), "el vault no se pasa al motor");
  } finally { e.done(); }
});

test("HermesEngine: un fallo del proceso se informa y limpia el token", async () => {
  const e = engineEnv();
  try {
    const spawnFn = (() => {
      const c = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill(): void };
      c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.kill = () => undefined;
      setImmediate(() => { c.stderr.write("quota exceeded"); c.emit("close", 1); });
      return c;
    }) as never;
    const eng = new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", spawnFn });
    const s = new SessionRegistry().open();
    await assert.rejects(eng.ask({ message: "x", conversation: "c", session: s, daemonUrl: "http://127.0.0.1:1" }), /quota exceeded/);
    assert.ok(!readFileSync(e.cfg, "utf8").includes(s.token));
  } finally { e.done(); }
});

test("HermesEngine.available(): razón clara si faltan bwrap, hermes o la autenticación", async () => {
  const e = engineEnv();
  try {
    const ok = await new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env" }).available();
    assert.equal(ok.ok, true);
    const noBwrap = await new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/no/existe/bwrap" }).available();
    assert.equal(noBwrap.ok, false);
    assert.match(noBwrap.reason!, /bwrap/);
    const noHermes = await new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", hermesBin: "/no/existe/hermes" }).available();
    assert.match(noHermes.reason!, /Hermes/);
    const noAuth = await new HermesEngine({ homeDir: e.home, userHome: path.join(e.root, "otro"), bwrapBin: "/usr/bin/env", hermesBin: "/usr/bin/env" }).available();
    assert.match(noAuth.reason!, /autentica/);
  } finally { e.done(); }
});

const realHome = os.homedir();
const haveJail = spawnSync("bwrap", ["--version"]).status === 0 && existsSync(path.join(realHome, ".hermes/hermes-agent")) && existsSync("/usr/bin/bash");

test("jaula (regresión): ni un fichero señuelo ni ~/Documents ni ~/.config son alcanzables", { skip: !haveJail && "bwrap o hermes no instalados" }, () => {
  const work = mkdtempSync(path.join(tmpdir(), "jarvis-jail-"));
  try {
    const hermesDir = path.join(work, "hermes");
    mkdirSync(hermesDir);
    const decoy = path.join(work, "secreto.txt");
    writeFileSync(decoy, "TOP SECRET");
    const fakeAuth = path.join(work, "auth.json"); // nunca se usan credenciales reales en el test
    writeFileSync(fakeAuth, "{}");
    const run = (cmd: string) => spawnSync("bwrap", jail({
      hermesDir, bridgePath: path.resolve("src/assistant/bridge.mjs"), realAuth: fakeAuth, nodeDir: path.dirname(process.execPath),
      hermesBin: "/usr/bin/bash", args: ["-c", cmd], home: realHome,
    }), { encoding: "utf8" });
    const sanity = run("echo vivo");
    assert.equal(sanity.stdout.trim(), "vivo", sanity.stderr);
    for (const cmd of [`cat ${decoy}`, `ls ${realHome}/Documents`, `ls ${realHome}/.config`, `ls ${realHome}/Proyectos`, `cat ${realHome}/.hermes/config.yaml`]) {
      const r = run(cmd);
      assert.notEqual(r.status, 0, cmd);
      assert.ok(!r.stdout.includes("TOP SECRET"), cmd);
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
});
