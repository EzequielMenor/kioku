import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { readCompanionKey } from "../src/server/key.ts";
import { FakeEngine } from "../src/assistant/fake-engine.ts";
import { companionCommand, overlayPid, USAGE, type CompanionDeps } from "../src/cli/companion.ts";
import { tmpVault } from "./helpers.ts";

/** Daemon real (aislado) y un overlay simulado: se comprueba la orquestación, no GTK. */
async function setup(o: { preflight?: CompanionDeps["preflight"]; fetch?: typeof fetch; spawns?: boolean } = {}) {
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: web, assistant: { engine: new FakeEngine() } });
  const alive = new Set<number>();
  const log = { spawned: 0, signals: [] as [number, string][], ensured: 0 };
  const pidFile = path.join(root, ".kioku", "companion-overlay.pid");
  const deps: CompanionDeps = {
    home: root,
    ensureDaemon: async () => { log.ensured++; return srv.url; },
    runningDaemon: async () => srv.url,
    fetch: o.fetch ?? fetch,
    preflight: o.preflight ?? (() => ({ ok: true, python: "/usr/bin/python3" })),
    spawnOverlay: () => { log.spawned++; if (o.spawns !== false) { const pid = 40_000 + log.spawned; alive.add(pid); writeFileSync(pidFile, `${pid}\n`); } },
    alive: (pid) => alive.has(pid),
    kill: (pid, sig) => { log.signals.push([pid, sig]); if (sig === "SIGTERM" || sig === "SIGKILL") alive.delete(pid); },
    sleep: () => new Promise((r) => setTimeout(r, 1)),
  };
  const mode = async () => (await srv.companion.view()).mode;
  return { root, srv, deps, log, alive, pidFile, mode, done: async () => { await srv.close(); j.close(); cleanup(); } };
}

test("kioku companion: lanza a Kio con su credencial limitada y no lo duplica", async () => {
  const t = await setup();
  try {
    const r = await companionCommand(undefined, [], t.deps);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.match(r.lines[0], /Kio está en tu escritorio \(pid 40001\)/);
    assert.equal(t.log.spawned, 1);
    const key = readCompanionKey(t.root);
    assert.match(key ?? "", /^[0-9a-f]{64}$/);
    assert.equal(statSync(path.join(t.root, ".kioku", "secret-companion")).mode & 0o777, 0o600, "la credencial solo la lee el usuario");
    assert.notEqual(key, t.srv.key, "no es la clave completa del daemon");
    assert.equal(overlayPid(t.deps), 40001);
    const again = await companionCommand("start", [], t.deps);
    assert.match(again.lines[0], /ya está en tu escritorio/);
    assert.equal(t.log.spawned, 1, "no se lanza un segundo overlay");
  } finally { await t.done(); }
});

test("kioku companion: pedirlo estando oculto lo devuelve al modo visible", async () => {
  const t = await setup();
  try {
    await t.srv.companion.update({ mode: "hidden" });
    await companionCommand("start", [], t.deps);
    assert.equal(await t.mode(), "active");
  } finally { await t.done(); }
});

test("kioku companion toggle: sin overlay lo lanza; con él alterna oculto y visible en el daemon compartido", async () => {
  const t = await setup();
  try {
    assert.equal((await companionCommand("toggle", [], t.deps)).code, 0);
    assert.equal(t.log.spawned, 1);
    assert.deepEqual((await companionCommand("toggle", [], t.deps)).lines, ["Kio: oculto"]);
    assert.equal(await t.mode(), "hidden");
    assert.deepEqual((await companionCommand("toggle", [], t.deps)).lines, ["Kio: visible"]);
    assert.equal(await t.mode(), "active");
    assert.equal(t.log.spawned, 1, "alternar no relanza el proceso");
  } finally { await t.done(); }
});

test("kioku companion focus: alterna el modo concentración", async () => {
  const t = await setup();
  try {
    assert.deepEqual((await companionCommand("focus", [], t.deps)).lines, ["Kio: en concentración"]);
    assert.equal(await t.mode(), "focus");
    assert.deepEqual((await companionCommand("focus", [], t.deps)).lines, ["Kio: visible"]);
    assert.equal(t.log.spawned, 0, "el modo es del agente compartido: no necesita el overlay");
  } finally { await t.done(); }
});

test("kioku companion stop: termina el proceso, limpia y con --revoke retira la credencial", async () => {
  const t = await setup();
  try {
    await companionCommand("start", [], t.deps);
    const key = readCompanionKey(t.root)!;
    const r = await companionCommand("stop", [], t.deps);
    assert.match(r.lines[0], /se ha ido/);
    assert.deepEqual(t.log.signals, [[40001, "SIGTERM"]]);
    assert.equal(existsSync(t.pidFile), false);
    assert.equal(overlayPid(t.deps), null);
    assert.match((await companionCommand("stop", [], t.deps)).lines[0], /no estaba en marcha/);
    assert.equal((await fetch(`${t.srv.url}/api/assistant/state`, { headers: { "x-kioku-key": key } })).status, 200, "sin --revoke la credencial sigue valiendo");
    await companionCommand("stop", ["--revoke"], t.deps);
    assert.equal(readCompanionKey(t.root), null);
    assert.equal((await fetch(`${t.srv.url}/api/assistant/state`, { headers: { "x-kioku-key": key } })).status, 401, "revocada: el daemon ya no la acepta");
  } finally { await t.done(); }
});

test("kioku companion stop: un pid que ya no es el overlay no recibe señales", async () => {
  const t = await setup();
  try {
    writeFileSync(t.pidFile, "12345\n"); // proceso ajeno (pid reutilizado)
    const r = await companionCommand("stop", [], t.deps);
    assert.match(r.lines[0], /no estaba en marcha/);
    assert.deepEqual(t.log.signals, []);
    assert.equal(existsSync(t.pidFile), false);
  } finally { await t.done(); }
});

test("kioku companion panel: pide al overlay que abra o cierre la conversación", async () => {
  const t = await setup();
  try {
    await companionCommand("start", [], t.deps);
    assert.equal((await companionCommand("panel", [], t.deps)).code, 0);
    assert.deepEqual(t.log.signals, [[40001, "SIGUSR1"]]);
  } finally { await t.done(); }
});

test("kioku companion status: proceso, modo y proveedor activo", async () => {
  const t = await setup();
  try {
    assert.deepEqual((await companionCommand("status", [], t.deps)).lines.slice(0, 1), ["Kio: detenido"]);
    await companionCommand("start", [], t.deps);
    await t.srv.companion.update({ mode: "focus" });
    const out = (await companionCommand("status", [], t.deps)).lines.join("\n");
    assert.match(out, /Kio: en el escritorio \(pid 40001\)/);
    assert.match(out, /Modo: en concentración/);
    assert.match(out, /Agente: en reposo · local · demo · motor de pruebas/);
  } finally { await t.done(); }
});

test("kioku companion: sin GTK/layer-shell explica qué falta y no arranca nada", async () => {
  const t = await setup({ preflight: () => ({ ok: false, reason: "Kio necesita GTK4 con gtk4-layer-shell" }) });
  try {
    const r = await companionCommand("start", [], t.deps);
    assert.equal(r.code, 1);
    assert.match(r.lines[0], /gtk4-layer-shell/);
    assert.equal(t.log.spawned + t.log.ensured, 0);
    assert.equal(readCompanionKey(t.root), null, "ni siquiera crea la credencial");
  } finally { await t.done(); }
});

test("kioku companion: un daemon anterior que no conoce al compañero se explica y no se lanza el overlay", async () => {
  // Un daemon de una versión previa responde 401 a la credencial del compañero.
  const old = (async () => new Response(JSON.stringify({ error: "Falta la clave de Kioku" }), { status: 401 })) as typeof fetch;
  const t = await setup({ fetch: old });
  try {
    const r = await companionCommand("start", [], t.deps);
    assert.equal(r.code, 1);
    assert.match(r.lines.join("\n"), /versión anterior/);
    assert.match(r.lines.join("\n"), /Reinícialo/);
    assert.equal(t.log.spawned, 0);
  } finally { await t.done(); }
});

test("kioku companion: si el overlay no llega a arrancar, lo dice y apunta al registro", async () => {
  const t = await setup({ spawns: false });
  try {
    const r = await companionCommand("start", [], t.deps);
    assert.equal(r.code, 1);
    assert.match(r.lines[0], /companion\.log/);
  } finally { await t.done(); }
});

test("kioku companion: una orden desconocida muestra el uso", async () => {
  const t = await setup();
  try {
    assert.deepEqual(await companionCommand("bailar", [], t.deps), { lines: [USAGE], code: 1 });
  } finally { await t.done(); }
});

test("el script del overlay existe donde la CLI lo busca", async () => {
  const { OVERLAY_SCRIPT } = await import("../src/cli/companion.ts");
  assert.match(readFileSync(OVERLAY_SCRIPT, "utf8"), /Gtk4LayerShell/);
});
