import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDaemon, readRuntime } from "../src/cli/desktop.ts";

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Entorno desechable: HOME, KIOKU_HOME y asistente simulado; el daemon es el real, lanzado por `ensureDaemon`. */
async function withIsolatedDaemon(body: (home: string) => Promise<void>): Promise<void> {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "kioku-startup-")));
  const home = path.join(root, "vault");
  const saved = { HOME: process.env.HOME, KIOKU_ASSISTANT_FAKE: process.env.KIOKU_ASSISTANT_FAKE, KIOKU_HOME: process.env.KIOKU_HOME };
  process.env.HOME = path.join(root, "home");
  process.env.KIOKU_ASSISTANT_FAKE = "1";
  delete process.env.KIOKU_HOME;
  try {
    await body(home);
  } finally {
    // Solo se detiene el daemon que este test dejó en su propio vault temporal.
    const rt = readRuntime(home);
    if (rt && alive(rt.pid)) {
      process.kill(rt.pid, "SIGTERM");
      for (let i = 0; i < 50 && alive(rt.pid); i++) await sleep(100);
      if (alive(rt.pid)) { process.kill(rt.pid, "SIGKILL"); await sleep(300); }
    }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(root, { recursive: true, force: true });
  }
}

/** La primera sonda de salud falla (sondeo lento puntual); el resto pasa al servidor real. */
function failFirstHealthProbe(): { restore: () => void; failed: () => number } {
  const real = globalThis.fetch;
  let failed = 0;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (failed === 0 && String(input).endsWith("/api/health")) {
      failed++;
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    return real(input, init);
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = real; }, failed: () => failed };
}

test("arranque en frío: ensureDaemon lanza un daemon real y una segunda llamada lo reutiliza", { timeout: 60_000 }, () =>
  withIsolatedDaemon(async (home) => {
    const base = await ensureDaemon(home);
    const rt = readRuntime(home)!;
    assert.equal(base, `http://127.0.0.1:${rt.port}`);
    assert.ok(alive(rt.pid));
    assert.equal((await fetch(base + "/api/health")).status, 200);
    assert.equal((await fetch(base + "/api/today")).status, 401, "la API exige clave");

    assert.equal(await ensureDaemon(home), base);
    assert.deepEqual(readRuntime(home), rt, "sin segundo daemon ni runtime nuevo");
  }));

test("segundo arranque: una sonda de salud lenta no hace fallar ni sustituye al daemon ya sano", { timeout: 60_000 }, () =>
  withIsolatedDaemon(async (home) => {
    const base = await ensureDaemon(home);
    const rt = readRuntime(home)!;
    const log = path.join(home, ".kioku", "daemon.log");

    const probe = failFirstHealthProbe();
    const t0 = Date.now();
    try {
      assert.equal(await ensureDaemon(home), base, "debe devolver el daemon existente");
    } finally {
      probe.restore();
    }
    assert.equal(probe.failed(), 1, "la sonda inicial fallida es la condición reproducida");
    assert.ok(Date.now() - t0 < 5500, "no debe agotar la espera de arranque");
    // El hijo termina de arrancar después de la respuesta: se espera (acotado) a que declare que no duplica.
    for (let i = 0; i < 100 && !/Ya hay un daemon sirviendo/.test(readFileSync(log, "utf8")); i++) await sleep(100);
    assert.match(readFileSync(log, "utf8"), /Ya hay un daemon sirviendo/, "el daemon extra se negó a duplicarse");
    assert.deepEqual(readRuntime(home), rt, "el daemon original sigue siendo el activo");
    assert.ok(alive(rt.pid));
    assert.equal((await fetch(base + "/api/health")).status, 200);
  }));

test("CLI: url y assistant actions siguen devolviendo el mismo daemon, en frío y en caliente", { timeout: 90_000 }, () =>
  withIsolatedDaemon(async (home) => {
    const main = path.resolve("src/cli/main.ts");
    const cli = (...args: string[]) => spawnSync(process.execPath, ["--no-warnings", main, ...args], { encoding: "utf8", env: { ...process.env, KIOKU_HOME: home }, timeout: 30_000 });
    const cold = cli("url");
    assert.equal(cold.status, 0, cold.stderr);
    assert.equal(cold.stderr, "");
    const rt = readRuntime(home)!;
    assert.match(cold.stdout, new RegExp(`^http://127\\.0\\.0\\.1:${rt.port}/\\?k=[0-9a-f]{64}#/hoy\\n$`));
    const warm = cli("url");
    assert.equal(warm.status, 0, warm.stderr);
    assert.equal(warm.stdout, cold.stdout);
    assert.deepEqual(readRuntime(home), rt);
    const actions = cli("assistant", "actions");
    assert.equal(actions.status, 0, actions.stderr);
    assert.equal(actions.stdout, "El asistente aún no ha hecho cambios por su cuenta.\n");
    assert.deepEqual(readRuntime(home), rt);
  }));

// quick/open abren un navegador: en Linux fuera de Hyprland usan `chromium` del PATH. En macOS usarían /usr/bin/open (sin sustituto aquí).
const browserSkip = process.platform !== "linux" ? "requiere el camino Linux (navegador por PATH); en macOS el CLI llama a /usr/bin/open" : false;

test("CLI: ask, assistant undo, quick y open siguen igual con un daemon ya activo (navegador falso en un PATH desechable)", { skip: browserSkip, timeout: 120_000 }, () =>
  withIsolatedDaemon(async (home) => {
    const root = path.dirname(home);
    const bin = path.join(root, "bin");
    const browserLog = path.join(root, "browser.log");
    mkdirSync(bin, { recursive: true });
    // Navegador falso: solo anota la invocación y sus argumentos; nada de ello se imprime.
    writeFileSync(path.join(bin, "chromium"), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$FAKE_BROWSER_LOG"\n');
    chmodSync(path.join(bin, "chromium"), 0o755);
    const env: NodeJS.ProcessEnv = { ...process.env, KIOKU_HOME: home, PATH: `${bin}:${process.env.PATH}`, FAKE_BROWSER_LOG: browserLog };
    delete env.HYPRLAND_INSTANCE_SIGNATURE;
    const main = path.resolve("src/cli/main.ts");
    const cli = (...args: string[]) => spawnSync(process.execPath, ["--no-warnings", main, ...args], { encoding: "utf8", env, timeout: 30_000 });
    const browserArgs = async (): Promise<string[]> => {
      for (let i = 0; i < 100 && !existsSync(browserLog); i++) await sleep(100);
      assert.ok(existsSync(browserLog), "el navegador falso debía ser invocado");
      const args = readFileSync(browserLog, "utf8").split("\n");
      rmSync(browserLog);
      return args;
    };

    const base = await ensureDaemon(home);
    const rt = readRuntime(home)!;

    const ask = cli("ask", "hola");
    assert.deepEqual([ask.status, ask.stdout, ask.stderr], [0, "La Bandeja está vacía.\n", ""]);

    const undoMissing = cli("assistant", "undo", "no-existe");
    assert.deepEqual([undoMissing.status, undoMissing.stdout, undoMissing.stderr], [1, "", "kioku: Acción no encontrada\n"]);

    const quick = cli("quick");
    assert.deepEqual([quick.status, quick.stdout, quick.stderr], [0, "ventana abierta\n", ""]);
    const quickArgs = await browserArgs();
    // Sin volcar la URL (lleva la clave) en mensajes de fallo.
    assert.ok(new RegExp(`^--app=${base.replaceAll(".", "\\.")}/quick\\?k=[0-9a-f]{64}$`).test(quickArgs[0]), "quick abre /quick con la clave local");
    assert.ok(quickArgs.includes("--window-size=680,160") && quickArgs.includes("--window-name=Kioku Quick"));

    const open = cli("open");
    assert.deepEqual([open.status, open.stdout, open.stderr], [0, "", ""]);
    const openArgs = await browserArgs();
    assert.ok(new RegExp(`^--app=${base.replaceAll(".", "\\.")}/\\?k=[0-9a-f]{64}#/hoy$`).test(openArgs[0]), "open abre el Workspace con la clave local");
    assert.ok(openArgs.includes("--window-size=1280,820") && openArgs.includes("--window-name=Kioku"));

    const openConnections = cli("open", "/conexiones");
    assert.deepEqual([openConnections.status, openConnections.stdout, openConnections.stderr], [0, "", ""]);
    const connArgs = await browserArgs();
    assert.ok(new RegExp(`^--app=${base.replaceAll(".", "\\.")}/\\?k=[0-9a-f]{64}#/conexiones$`).test(connArgs[0]), "open /conexiones abre la ruta pedida");

    assert.deepEqual(readRuntime(home), rt, "ningún comando sustituyó al daemon");
    assert.ok(alive(rt.pid));
  }));
