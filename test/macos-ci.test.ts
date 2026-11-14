import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";

// --- Estructura del workflow (corre en Linux): fija lo que el CI promete y lo que nunca debe hacer.

const workflowFile = path.resolve(".github/workflows/macos-validation.yml");
const BRANCH = "feat/JARV-38-private-setup-ui";
const SHA = /^[0-9a-f]{40}$/;
interface Step { name?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown>; [k: string]: unknown }
const load = () => {
  const text = readFileSync(workflowFile, "utf8");
  const doc = parse(text) as any;
  return { text, doc, job: doc.jobs.validate, steps: doc.jobs.validate.steps as Step[] };
};
const stepRunning = (steps: Step[], cmd: string) => steps.find((s) => s.run?.trim() === cmd);

test("macOS CI se dispara solo por push a la rama de trabajo y solo por ficheros del propio CI", () => {
  const { doc } = load();
  assert.deepEqual(Object.keys(doc.on).sort(), ["push", "workflow_dispatch"]);
  assert.deepEqual(doc.on.push.branches, [BRANCH]);
  assert.deepEqual(doc.on.push.paths, [".github/workflows/macos-validation.yml", "test/macos-ci.test.ts"]);
});

test("macOS CI corre en Apple Silicon e Intel, sin secretos, publicación ni artefactos", () => {
  const { text, doc, job, steps } = load();
  assert.deepEqual(doc.permissions, { contents: "read" });
  assert.equal(job.permissions, undefined);
  assert.equal(job["runs-on"], "${{ matrix.os }}");
  assert.equal(job["timeout-minutes"], 15);
  assert.equal(job.strategy["fail-fast"], false);
  assert.deepEqual(job.strategy.matrix.include, [{ os: "macos-15", arch: "arm64" }, { os: "macos-15-intel", arch: "x64" }]);
  assert.equal(job.environment, undefined);
  assert.doesNotMatch(text, /secrets\.|upload-artifact|download-artifact|gh release|npm publish|GITHUB_TOKEN|continue-on-error/);
  assert.equal(steps.some((s) => s.env && Object.keys(s.env).some((k) => /TOKEN|SECRET|KEY/i.test(k))), false);
});

test("macOS CI fija las acciones oficiales por SHA y no persiste credenciales de git", () => {
  const { steps } = load();
  const uses = steps.filter((s) => s.uses);
  assert.deepEqual(uses.map((s) => s.uses), [
    "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  ]);
  for (const s of uses) assert.match(s.uses!.split("@")[1], SHA);
  assert.equal(uses[0].with?.["persist-credentials"], false);
  assert.equal(String(uses[1].with?.["node-version"]), "24");
});

test("macOS CI ejecuta instalación, web, pruebas y tipos en orden y sin ocultar códigos de salida", () => {
  const { steps } = load();
  const order = ["npm ci", "npm run build:web", "npm test", "npm run typecheck"];
  const idx = order.map((cmd) => steps.indexOf(stepRunning(steps, cmd)!));
  assert.ok(idx.every((i) => i >= 0), "falta algún comando obligatorio");
  assert.deepEqual([...idx].sort((a, b) => a - b), idx);
  for (const s of steps.filter((x) => x.run)) assert.doesNotMatch(s.run!, /\|\||\||;|&&|set \+e|\|\| true/, s.run!);
});

test("macOS CI aísla HOME y KIOKU_HOME bajo runner.temp y activa la prueba nativa", () => {
  const { steps } = load();
  const env = stepRunning(steps, "npm test")!.env!;
  assert.equal(env.HOME, "${{ runner.temp }}/kioku-ci/home");
  assert.equal(env.KIOKU_HOME, "${{ runner.temp }}/kioku-ci/data");
  assert.equal(env.KIOKU_MAC_SMOKE, "1");
  assert.equal(env.KIOKU_EXPECT_ARCH, "${{ matrix.arch }}");
  const prep = steps.find((s) => s.run?.includes("kioku-ci"))!;
  assert.match(prep.run!, /mkdir -p "\$RUNNER_TEMP\/kioku-ci\/home" "\$RUNNER_TEMP\/kioku-ci\/data"/);
  assert.ok(steps.indexOf(prep) < steps.indexOf(stepRunning(steps, "npm test")!));
});

// --- Arranque nativo (solo macOS, opt-in): construye la app real y usa su lanzador, sin simular la plataforma.

const nativeSkip = process.platform !== "darwin" ? "requiere macOS (Mach-O y /usr/bin/open reales)"
  : process.env.KIOKU_MAC_SMOKE !== "1" ? "opt-in: define KIOKU_MAC_SMOKE=1 (lo hace el workflow de macOS)" : false;

const snapshot = (dir: string, out: Record<string, string> = {}): Record<string, string> => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) snapshot(p, out); else out[p] = readFileSync(p, "utf8");
  }
  return out;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("la app Mac empaquetada arranca por su lanzador, sirve la interfaz autenticada y reutiliza el daemon", { skip: nativeSkip, timeout: 120_000 }, async () => {
  // Ruta canónica: en macOS /var es un enlace a /private/var y `ps` muestra la ruta real.
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "kioku-mac-ci-")));
  const home = path.join(root, "home");
  const app = path.join(root, "Kioku Mac CI", "Kioku.app");
  const contents = path.join(app, "Contents");
  const bundledNode = path.join(contents, "Resources", "runtime", "node");
  const bundledMain = path.join(contents, "Resources", "app", "src", "cli", "main.ts");
  const workspace = path.join(home, "Library", "Application Support", "Kioku", "Workspace");
  // Entorno mínimo y desechable; KIOKU_HOME lo fija el propio lanzador.
  const env = { PATH: "/usr/bin:/bin", HOME: home, TMPDIR: root, KIOKU_ASSISTANT_FAKE: "1" };
  const cli = (...args: string[]) => spawnSync(bundledNode, ["--no-warnings", bundledMain, ...args], { encoding: "utf8", env: { ...env, KIOKU_HOME: workspace }, timeout: 30_000 });
  const command = (pid: number) => spawnSync("/bin/ps", ["-p", String(pid), "-ww", "-o", "command="], { encoding: "utf8" }).stdout;
  // `status` es la interfaz pública para descubrir el daemon; nunca imprime la clave.
  const discover = () => {
    const r = cli("status");
    const m = r.status === 0 ? /daemon pid (\d+) en (http:\/\/127\.0\.0\.1:\d+)/.exec(r.stdout) : null;
    return m ? { pid: Number(m[1]), base: m[2] } : null;
  };
  const launch = () => spawnSync(path.join(contents, "MacOS", "Kioku"), [], { encoding: "utf8", env, timeout: 40_000 });
  const markers: Record<string, string> = {
    [path.join(home, "Documents", "Kioku", "nota.md")]: "# Nota sintética\n",
    [path.join(home, "Documents", "Kioku", ".kioku", "secret")]: "SINTETICO-NO-ES-UNA-CLAVE\n",
    [path.join(home, ".hermes", ".env")]: "SINTETICO=1\n",
  };
  try {
    if (process.env.KIOKU_EXPECT_ARCH) assert.equal(process.arch, process.env.KIOKU_EXPECT_ARCH, "arquitectura del runner");
    for (const [file, text] of Object.entries(markers)) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); }
    const before = { ...snapshot(path.join(home, "Documents")), ...snapshot(path.join(home, ".hermes")) };

    const built = spawnSync(process.execPath, [path.resolve("scripts/build-macos-app.mjs"), "--node", process.execPath, "--output", app], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);

    const first = launch();
    assert.equal(first.status, 0, "primer arranque del lanzador: " + first.stderr);
    const daemon = discover();
    assert.ok(daemon, "status debe encontrar el daemon del Workspace aislado");
    assert.ok(alive(daemon.pid));
    assert.ok(command(daemon.pid).includes(bundledNode), "el daemon debe usar el runtime del paquete, no el node del checkout");

    // `url` incluye la clave: se usa solo en memoria y no se imprime en ningún mensaje.
    const url = cli("url");
    const key = url.status === 0 ? /[?&]k=([0-9a-f]{64})(?:[&#]|$)/.exec(url.stdout)?.[1] : undefined;
    assert.ok(key, "kioku url debe ofrecer una URL con clave");
    assert.ok(url.stdout.startsWith(daemon.base + "/"), "kioku url debe apuntar al mismo daemon");

    assert.equal((await fetch(daemon.base + "/api/today")).status, 401, "la API exige clave");
    assert.equal((await fetch(daemon.base + "/api/today", { headers: { "x-kioku-key": key } })).status, 200, "la clave local autentica");
    const page = await fetch(daemon.base + "/");
    assert.equal(page.status, 200);
    assert.equal(await page.text(), readFileSync(path.join(contents, "Resources", "app", "dist", "web", "index.html"), "utf8"), "index.html del paquete");
    const js = await fetch(daemon.base + "/app.js");
    assert.equal(js.status, 200);
    assert.ok((await js.text()).length > 1000, "app.js servido");

    const second = launch();
    assert.equal(second.status, 0, "segundo arranque del lanzador: " + second.stderr);
    assert.deepEqual(discover(), daemon, "el segundo arranque reutiliza el mismo daemon");

    assert.deepEqual({ ...snapshot(path.join(home, "Documents")), ...snapshot(path.join(home, ".hermes")) }, before, "marcadores previos intactos");
  } finally {
    // Solo se detiene el proceso que `status` identificó en el Workspace desechable y cuyo comando apunta al paquete de esta prueba.
    const daemon = existsSync(app) ? discover() : null;
    if (daemon && command(daemon.pid).includes(bundledNode)) {
      process.kill(daemon.pid, "SIGTERM");
      for (let i = 0; i < 50 && alive(daemon.pid); i++) await sleep(100);
      if (alive(daemon.pid) && command(daemon.pid).includes(bundledNode)) { process.kill(daemon.pid, "SIGKILL"); await sleep(500); }
    }
    rmSync(root, { recursive: true, force: true });
  }
});
