import { test } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import { HermesEngine, buildJailArgs, hermesConfigYaml, parseHermesOutput, secretsFdPayload, soulText } from "../src/assistant/engine.ts";
import { SessionRegistry } from "../src/assistant/session.ts";

const jail = (over: Partial<Parameters<typeof buildJailArgs>[0]> = {}) => buildJailArgs({
  hermesDir: "/vault/.kioku/hermes", bridgePath: "/repo/src/assistant/bridge.mjs", realAuth: "/home/u/.hermes/auth.json",
  nodeDir: "/node/bin", hermesBin: "/home/u/.hermes/hermes-agent/venv/bin/hermes", args: ["chat", "-q", "hola"], home: "/home/u", ...over,
});

test("jaula: no monta el vault (solo su carpeta de Hermes) ni Documents ni ~/.config", () => {
  const a = jail();
  const binds = a.filter((x) => x.startsWith("/"));
  assert.ok(!binds.includes("/vault"), "el vault entero no se monta");
  assert.ok(binds.filter((x) => x.startsWith("/vault")).every((x) => x === "/vault/.kioku/hermes"));
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
  assert.equal(a[a.indexOf("/opt/kioku-mcp.mjs") - 2], "--ro-bind");
  assert.deepEqual(a.slice(-4), ["/home/u/.hermes/hermes-agent/venv/bin/hermes", "chat", "-q", "hola"]);
});

test("config de Hermes: solo clarify + MCP kioku; sin terminal/file/browser/code_execution/computer_use", () => {
  const y = hermesConfigYaml({ toolsets: ["clarify"], daemonUrl: "http://127.0.0.1:47800", token: "tok", bridgePath: "/opt/kioku-mcp.mjs" });
  for (const bad of ["terminal", "file", "browser", "code_execution", "computer_use"]) assert.ok(!y.includes(bad), bad);
  assert.match(y, /cli: \[clarify\]/);
  assert.match(y, /max_turns: 20/);
  assert.match(y, /provider: openai-codex/);
  assert.match(y, /KIOKU_TOKEN: "tok"/);
  assert.match(y, /KIOKU_URL: "http:\/\/127.0.0.1:47800"/);
});

test("SOUL: español, datos≠instrucciones, niveles y propose", () => {
  const t = soulText();
  assert.match(t, /español/);
  assert.match(t, /DATOS/);
  assert.match(t, /propose/);
  assert.match(t, /no inventes rutas/i);
  assert.match(t, /memoria/i);
});

test("SOUL: explica las bases de datos (consultar antes de contar, filas con create_row, definición intocable)", () => {
  const t = soulText();
  assert.match(t, /list_databases/);
  assert.match(t, /query_database/);
  assert.match(t, /create_row/);
  assert.match(t, /definición de una base/i);
});

test("parseHermesOutput descarta el aviso de tirith aunque venga sangrado (primera ejecución)", () => {
  const warn = "  ⚠ tirith security scanner enabled but not available — command scanning will use pattern matching only\r\n";
  assert.deepEqual(parseHermesOutput(`${warn}hola\n`), { sessionId: null, answer: "hola" });
});

test("parseHermesOutput extrae session_id y la respuesta", () => {
  assert.deepEqual(parseHermesOutput("session_id: 20261026_abc\nTienes 2 capturas.\nUna: x\n"), { sessionId: "20261026_abc", answer: "Tienes 2 capturas.\nUna: x" });
  assert.deepEqual(parseHermesOutput("Solo respuesta"), { sessionId: null, answer: "Solo respuesta" });
  assert.deepEqual(parseHermesOutput("Respuesta\nsession_id: zz9\n"), { sessionId: "zz9", answer: "Respuesta" });
  assert.equal(parseHermesOutput("⚠ tirith security scanner enabled but not available — command scanning will use pattern matching only\nHola\n").answer, "Hola");
  assert.equal(parseHermesOutput("⚠ tirith security scanner enabled but not available — x\r\nHola\r\n").answer, "Hola", "también con CRLF");
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
  const root = mkdtempSync(path.join(tmpdir(), "kioku-eng-"));
  const userHome = path.join(root, "userhome");
  mkdirSync(path.join(userHome, ".hermes/hermes-agent/venv/bin"), { recursive: true });
  writeFileSync(path.join(userHome, ".hermes/hermes-agent/venv/bin/hermes"), "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(path.join(userHome, ".hermes/auth.json"), "{}");
  const home = path.join(root, "vault");
  mkdirSync(home);
  return { root, userHome, home, cfg: path.join(home, ".kioku/hermes/config.yaml"), done: () => rmSync(root, { recursive: true, force: true }) };
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
    assert.match(seen[0].config, /cli: \[clarify, memory, skills\]/, "memoria y skills verificados (spec §7): sin terminal, ficheros ni navegador");
    assert.doesNotMatch(seen[0].config, /terminal|file|browser|code_execution|computer_use/);
    assert.ok(!seen[0].args.includes("--resume"));
    assert.ok(existsSync(path.join(e.home, ".kioku/hermes/SOUL.md")));
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

// ---------- Modelo configurable (JARV-34 T1) ----------

/** Como fakeSpawn, pero recoge también las opciones de spawn y lo que se escribe en el fd 3 (secretos del proveedor). */
function recordingSpawn(configPath: string, seen: { bin: string; args: string[]; opts: { stdio?: unknown; env?: unknown }; config: string; fd3: string }[], out = "session_id: S1\nOk.") {
  return ((bin: string, args: string[], opts: { stdio?: unknown; env?: unknown }) => {
    const rec = { bin, args, opts, config: existsSync(configPath) ? readFileSync(configPath, "utf8") : "", fd3: "" };
    seen.push(rec);
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdio: unknown[]; kill(): void };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const fd3 = new PassThrough();
    fd3.on("data", (d) => (rec.fd3 += d));
    child.stdio = [null, child.stdout, child.stderr, fd3];
    child.kill = () => undefined;
    setImmediate(() => { child.stdout.write(out); child.stdout.end(); child.emit("close", 0); });
    return child;
  }) as never;
}

const ask = (eng: HermesEngine, session = new SessionRegistry().open()) => eng.ask({ message: "hola", conversation: "c1", session, daemonUrl: "http://127.0.0.1:1" });

test("modelo: por defecto sigue siendo Codex (config igual que antes, auth.json montado, sin secretos por fd)", async () => {
  const e = engineEnv();
  try {
    const seen: Parameters<typeof recordingSpawn>[1] = [];
    const eng = new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", spawnFn: recordingSpawn(e.cfg, seen), env: { OPENROUTER_API_KEY: "sk-no" } });
    await ask(eng);
    assert.match(seen[0].config, /provider: openai-codex/);
    assert.match(seen[0].config, /base_url: ''/);
    assert.doesNotMatch(seen[0].config, /default:|api_mode:/);
    assert.ok(seen[0].args.includes(path.join(e.userHome, ".hermes/auth.json")), "auth.json de Codex montado");
    assert.ok(!seen[0].args.includes("--args"));
    assert.equal(seen[0].fd3, "");
    assert.equal((seen[0].opts.stdio as unknown[]).length, 3, "sin fd extra cuando no hay secretos");
  } finally { e.done(); }
});

test("modelo: assistant.json con texto fija default (compatibilidad) y sus exclusiones no cambian", async () => {
  const e = engineEnv();
  try {
    mkdirSync(path.join(e.home, ".kioku"), { recursive: true });
    writeFileSync(path.join(e.home, ".kioku/assistant.json"), JSON.stringify({ model: "gpt-5.5", exclude: ["Privado/"] }));
    const seen: Parameters<typeof recordingSpawn>[1] = [];
    await ask(new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", spawnFn: recordingSpawn(e.cfg, seen) }));
    assert.match(seen[0].config, /default: "gpt-5\.5"/);
    assert.match(seen[0].config, /provider: openai-codex/);
  } finally { e.done(); }
});

test("modelo: proveedor con clave → config con provider/modelo, clave solo por fd 3, sin auth.json de Codex y sin entorno ajeno", async () => {
  const e = engineEnv();
  try {
    mkdirSync(path.join(e.home, ".kioku"), { recursive: true });
    writeFileSync(path.join(e.home, ".kioku/assistant.json"), JSON.stringify({ model: { provider: "openrouter", default: "anthropic/claude-x" } }));
    writeFileSync(path.join(e.userHome, ".hermes/.env"), "OPENROUTER_API_KEY=sk-or-SECRETO\nTELEGRAM_BOT_TOKEN=ajeno\n");
    const seen: Parameters<typeof recordingSpawn>[1] = [];
    const eng = new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", spawnFn: recordingSpawn(e.cfg, seen), env: { AWS_SECRET_ACCESS_KEY: "ajeno2" } });
    const s = new SessionRegistry().open();
    await ask(eng, s);
    const r = seen[0];
    assert.match(r.config, /provider: openrouter/);
    assert.match(r.config, /default: "anthropic\/claude-x"/);
    assert.doesNotMatch(r.config, /openai-codex/);
    assert.ok(!r.config.includes("sk-or-SECRETO") && !readFileSync(e.cfg, "utf8").includes("sk-or-SECRETO"), "la clave no va al config del vault");
    assert.ok(!r.args.join(" ").includes("sk-or-SECRETO"), "ni a argv");
    assert.ok(!r.args.includes(path.join(e.userHome, ".hermes/auth.json")), "otro proveedor no necesita auth.json de Codex");
    const i = r.args.indexOf("--args");
    assert.ok(i > r.args.indexOf("--clearenv"), "--args va después de --clearenv");
    assert.equal(r.args[i + 1], "3");
    assert.equal(r.fd3, "--setenv\0OPENROUTER_API_KEY\0sk-or-SECRETO\0");
    assert.equal((r.opts.stdio as unknown[]).length, 4);
    assert.ok(!JSON.stringify(r.opts.env ?? {}).includes("ajeno"), "no se hereda el entorno del daemon");
    // el token y la config se limpian igual que antes
    assert.ok(!readFileSync(e.cfg, "utf8").includes(s.token));
    assert.ok(!readFileSync(e.cfg, "utf8").includes("sk-or-SECRETO"));
  } finally { e.done(); }
});

test("modelo: provider `custom` local sin clave y sin secretos; api_mode/base_url en config", async () => {
  const e = engineEnv();
  try {
    writeFileSync(path.join(e.userHome, ".hermes/config.yaml"), "model:\n  provider: custom\n  default: llama3.1\n  base_url: http://localhost:11434/v1\n  api_mode: chat_completions\n");
    const seen: Parameters<typeof recordingSpawn>[1] = [];
    await ask(new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", spawnFn: recordingSpawn(e.cfg, seen), env: {} }));
    assert.match(seen[0].config, /provider: custom/);
    assert.match(seen[0].config, /base_url: "http:\/\/localhost:11434\/v1"/);
    assert.match(seen[0].config, /api_mode: "chat_completions"/);
    assert.ok(!seen[0].args.includes("--args"));
  } finally { e.done(); }
});

test("modelo: configuración inválida o clave ausente → available() no ok con razón accionable y sin secretos; ask rechaza sin lanzar proceso", async () => {
  const e = engineEnv();
  try {
    mkdirSync(path.join(e.home, ".kioku"), { recursive: true });
    const seen: Parameters<typeof recordingSpawn>[1] = [];
    const mk = () => new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", spawnFn: recordingSpawn(e.cfg, seen), env: {} });
    writeFileSync(path.join(e.home, ".kioku/assistant.json"), JSON.stringify({ model: { provider: "openrouter", default: "m" } }));
    const noKey = await mk().available();
    assert.equal(noKey.ok, false);
    assert.match(noKey.reason!, /OPENROUTER_API_KEY/);
    writeFileSync(path.join(e.home, ".kioku/assistant.json"), JSON.stringify({ model: { provider: "openrouter", api_key: "sk-filtrada" } }));
    const bad = await mk().available();
    assert.equal(bad.ok, false);
    assert.ok(!bad.reason!.includes("sk-filtrada"));
    await assert.rejects(ask(mk()), (err: Error) => { assert.ok(!err.message.includes("sk-filtrada")); return true; });
    assert.equal(seen.length, 0, "no se lanza nada con configuración inválida");
  } finally { e.done(); }
});

test("modelo: Codex sigue exigiendo auth.json; otros proveedores no", async () => {
  const e = engineEnv();
  try {
    rmSync(path.join(e.userHome, ".hermes/auth.json"));
    const codex = await new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env" }).available();
    assert.match(codex.reason!, /autentica/);
    mkdirSync(path.join(e.home, ".kioku"), { recursive: true });
    writeFileSync(path.join(e.home, ".kioku/assistant.json"), JSON.stringify({ model: { provider: "deepseek", default: "m" } }));
    const ok = await new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", env: { DEEPSEEK_API_KEY: "k" } }).available();
    assert.deepEqual(ok, { ok: true });
  } finally { e.done(); }
});

test("modelo: un fallo con proveedor de clave también limpia el token y no filtra la clave en el error", async () => {
  const e = engineEnv();
  try {
    mkdirSync(path.join(e.home, ".kioku"), { recursive: true });
    writeFileSync(path.join(e.home, ".kioku/assistant.json"), JSON.stringify({ model: { provider: "anthropic", default: "m" } }));
    const spawnFn = (() => {
      const c = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdio: unknown[]; kill(): void };
      c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdio = [null, c.stdout, c.stderr, new PassThrough()]; c.kill = () => undefined;
      setImmediate(() => { c.stderr.write("401 invalid x-api-key"); c.emit("close", 1); });
      return c;
    }) as never;
    const eng = new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", spawnFn, env: { ANTHROPIC_API_KEY: "sk-ant-SECRETO" } });
    const s = new SessionRegistry().open();
    await assert.rejects(ask(eng, s), (err: Error) => { assert.match(err.message, /401/); assert.ok(!err.message.includes("sk-ant-SECRETO")); return true; });
    assert.ok(!readFileSync(e.cfg, "utf8").includes(s.token));
  } finally { e.done(); }
});

test("modelo: peticiones concurrentes siguen en cola (una a la vez) con proveedor configurable", async () => {
  const e = engineEnv();
  try {
    const seen: Parameters<typeof recordingSpawn>[1] = [];
    const eng = new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", spawnFn: recordingSpawn(e.cfg, seen) });
    const s = new SessionRegistry().open();
    const [a, b] = await Promise.all([ask(eng, s), ask(eng, s)]);
    assert.equal(a.answer, "Ok.");
    assert.equal(b.answer, "Ok.");
    assert.ok(!seen[0].args.includes("--resume"));
    assert.equal(seen[1].args[seen[1].args.indexOf("--resume") + 1], "S1", "la segunda reanuda la sesión de la primera");
  } finally { e.done(); }
});

test("móvil: estado de Hermes separado (.kioku/hermes-mobile): carpeta montada, sesiones, SOUL y config distintos del escritorio", async () => {
  const e = engineEnv();
  try {
    const seen: Parameters<typeof recordingSpawn>[1] = [];
    const eng = new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", spawnFn: recordingSpawn(e.cfg, seen, "session_id: SM\nOk.") });
    assert.equal(eng.isolatesMobile, true);
    const desktop = new SessionRegistry().open();
    const mobile = { ...new SessionRegistry().open(), role: "mobile" } as unknown as ReturnType<SessionRegistry["open"]>;
    await ask(eng, desktop);
    await eng.ask({ message: "desde el móvil", conversation: "mobile:c1", session: mobile, daemonUrl: "http://127.0.0.1:1" });
    const mounted = (a: string[]) => a[a.findIndex((x) => x.endsWith(".hermes-jail")) - 1];
    const d = path.join(e.home, ".kioku/hermes");
    const m = path.join(e.home, ".kioku/hermes-mobile", createHash("sha256").update(mobile.scope).digest("hex"));
    assert.equal(mounted(seen[0].args), d);
    assert.equal(mounted(seen[1].args), m);
    assert.ok(!seen[1].args.includes(d), "el móvil no ve la carpeta del escritorio");
    assert.ok(!seen[0].args.includes(m), "el escritorio no monta la del móvil");
    assert.ok(existsSync(path.join(m, "SOUL.md")) && existsSync(path.join(m, "config.yaml")));
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(d, "kioku-sessions.json"), "utf8"))), ["c1"]);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(m, "kioku-sessions.json"), "utf8"))), ["mobile:c1"]);
    assert.ok(!readFileSync(path.join(m, "config.yaml"), "utf8").includes(mobile.token), "token del móvil limpiado");
    assert.ok(!existsSync(path.join(m, "memories")) && !existsSync(path.join(d, "memories-mobile")));
  } finally { e.done(); }
});

test("móvil: no hereda la sesión de Hermes del escritorio aunque la conversación se llame igual; el escritorio sigue reanudando la suya", async () => {
  const e = engineEnv();
  try {
    mkdirSync(path.join(e.home, ".kioku/hermes"), { recursive: true });
    writeFileSync(path.join(e.home, ".kioku/hermes/kioku-sessions.json"), JSON.stringify({ c1: "DESKTOP" }));
    const seen: Parameters<typeof recordingSpawn>[1] = [];
    const eng = new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", spawnFn: recordingSpawn(e.cfg, seen, "Ok.") });
    await eng.ask({ message: "x", conversation: "c1", session: { ...new SessionRegistry().open(), role: "mobile" } as never, daemonUrl: "http://127.0.0.1:1" });
    assert.ok(!seen[0].args.includes("--resume"), "sin estado heredado del escritorio");
    await ask(eng);
    assert.equal(seen[1].args[seen[1].args.indexOf("--resume") + 1], "DESKTOP");
  } finally { e.done(); }
});

test("móvil: rol desconocido cae en el estado móvil (nunca en el del escritorio); `full` usa el del escritorio", async () => {
  const e = engineEnv();
  try {
    const seen: Parameters<typeof recordingSpawn>[1] = [];
    const eng = new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", spawnFn: recordingSpawn(e.cfg, seen, "Ok.") });
    for (const role of ["full", "otro"]) await eng.ask({ message: "x", conversation: "c", session: { ...new SessionRegistry().open(), role } as never, daemonUrl: "http://127.0.0.1:1" });
    assert.ok(seen[0].args.includes(path.join(e.home, ".kioku/hermes")));
    assert.ok(seen[1].args.some(x => x.startsWith(path.join(e.home, ".kioku/hermes-mobile") + path.sep)));
  } finally { e.done(); }
});

test("modelo: si el proveedor devuelve la clave en stderr, el error la oculta", async () => {
  const e = engineEnv();
  try {
    mkdirSync(path.join(e.home, ".kioku"), { recursive: true });
    writeFileSync(path.join(e.home, ".kioku/assistant.json"), JSON.stringify({ model: { provider: "anthropic", default: "m" } }));
    const spawnFn = (() => {
      const c = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdio: unknown[]; kill(): void };
      c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdio = [null, c.stdout, c.stderr, new PassThrough()]; c.kill = () => undefined;
      setImmediate(() => { c.stderr.write("invalid key sk-ant-SECRETO"); c.emit("close", 1); });
      return c;
    }) as never;
    const eng = new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", spawnFn, env: { ANTHROPIC_API_KEY: "sk-ant-SECRETO" } });
    await assert.rejects(ask(eng), (err: Error) => { assert.match(err.message, /invalid key \[clave\]/); return true; });
  } finally { e.done(); }
});

test("buildJailArgs: sin realAuth no monta auth.json; con secretos por fd añade --args 3 tras --clearenv y antes del binario", () => {
  const a = jail({ realAuth: undefined, secretEnvFd: true });
  assert.ok(!a.some((x) => x.includes("auth.json") || x.includes("auth.lock")));
  assert.ok(a.indexOf("--args") > a.indexOf("--clearenv"));
  assert.ok(a.indexOf("--args") < a.indexOf("/home/u/.hermes/hermes-agent/venv/bin/hermes"));
  assert.ok(!jail().includes("--args"), "comportamiento anterior intacto");
});

test("secretsFdPayload: pares --setenv separados por NUL", () => {
  assert.equal(secretsFdPayload({ A_KEY: "v1", B_KEY: "v2" }).toString(), "--setenv\0A_KEY\0v1\0--setenv\0B_KEY\0v2\0");
});

const realHome = os.homedir();
const haveJail = spawnSync("bwrap", ["--version"]).status === 0 && existsSync(path.join(realHome, ".hermes/hermes-agent")) && existsSync("/usr/bin/bash");

test("jaula (regresión): ni un fichero señuelo ni ~/Documents ni ~/.config son alcanzables", { skip: !haveJail && "bwrap o hermes no instalados" }, () => {
  const work = mkdtempSync(path.join(tmpdir(), "kioku-jail-"));
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

test("jaula real: la clave entra por el fd 3 como única variable ajena y no aparece en argv", { skip: !haveJail && "bwrap o hermes no instalados" }, async () => {
  const work = mkdtempSync(path.join(tmpdir(), "kioku-jail-"));
  try {
    const hermesDir = path.join(work, "hermes");
    mkdirSync(hermesDir);
    const args = jail({
      hermesDir, bridgePath: path.resolve("src/assistant/bridge.mjs"), realAuth: undefined, nodeDir: path.dirname(process.execPath),
      hermesBin: "/usr/bin/env", args: [], home: realHome, secretEnvFd: true,
    });
    assert.ok(!args.join(" ").includes("sk-fd-SECRETO"));
    const { spawn } = await import("node:child_process");
    const out = await new Promise<string>((resolve, reject) => {
      const c = spawn("bwrap", args, { stdio: ["ignore", "pipe", "pipe", "pipe"], env: { AJENA: "no" } });
      let o = "";
      c.stdout!.on("data", (d) => (o += d));
      c.once("error", reject);
      c.once("close", () => resolve(o));
      (c.stdio[3] as import("node:stream").Writable).end(secretsFdPayload({ OPENROUTER_API_KEY: "sk-fd-SECRETO" }));
    });
    const vars = out.split("\n").filter(Boolean).map((l) => l.split("=")[0]).sort();
    assert.ok(out.includes("OPENROUTER_API_KEY=sk-fd-SECRETO"), out);
    assert.ok(!vars.includes("AJENA"));
    assert.deepEqual(vars, ["HERMES_HOME", "HOME", "LANG", "OPENROUTER_API_KEY", "PATH", "PWD", "TERM"]);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test("móvil: cambiar el alcance separa también memorias y skills, no solo el id de conversación", async () => {
  const e = engineEnv();
  try {
    const seen: Parameters<typeof recordingSpawn>[1] = [];
    const eng = new HermesEngine({ homeDir: e.home, userHome: e.userHome, bwrapBin: "/usr/bin/env", spawnFn: recordingSpawn(e.cfg, seen) });
    for (const scope of ["antes", "ahora"]) await ask(eng, new SessionRegistry().open("mobile", scope));
    const mount = (a: string[]) => a[a.findIndex(x => x.endsWith(".hermes-jail")) - 1];
    assert.notEqual(mount(seen[0].args), mount(seen[1].args));
    assert.ok(!seen[1].args.includes("--resume"), "sin conversación anterior con otra privacidad");
    assert.ok(!seen[1].args.includes(mount(seen[0].args)), "memoria y skills anteriores no están montados");
  } finally { e.done(); }
});
