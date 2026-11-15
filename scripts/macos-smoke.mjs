#!/usr/bin/env node
// Prueba de humo de Kioku.app nativa en un macOS REAL (la usa el CI de macOS; también sirve en un Mac a mano).
// Todo aislado: HOME y bóveda temporales, un Ollama de mentira en 127.0.0.1:11434 que anuncia qwen3.5:9b
// (scripts/mock-ollama.mjs: el camino real del motor nativo sin descargar 6 GB) y LaunchAgents que se retiran al terminar. Uso: node scripts/macos-smoke.mjs RUTA/Kioku.app CARPETA_DE_RESULTADOS
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.platform !== "darwin") { console.error("Solo en macOS."); process.exit(2); }
const [appArg, outArg] = process.argv.slice(2);
if (!appArg || !outArg) { console.error("uso: node scripts/macos-smoke.mjs Kioku.app RESULTADOS"); process.exit(2); }
const APP = path.resolve(appArg);
const OUT = path.resolve(outArg);
mkdirSync(OUT, { recursive: true });
const base = mkdtempSync(path.join(os.tmpdir(), "kioku-smoke-"));
const HOME = path.join(base, "home");
const VAULT = path.join(base, "vault");
const SMOKE = path.join(OUT, "app");
mkdirSync(HOME, { recursive: true });
mkdirSync(VAULT, { recursive: true });
mkdirSync(path.join(SMOKE, "cmd"), { recursive: true });
const NODE = path.join(APP, "Contents/Resources/runtime/node");
const MAIN = path.join(APP, "Contents/Resources/app/src/cli/main.ts");
const EXE = path.join(APP, "Contents/MacOS/Kioku");
const uid = process.getuid();
const env = { ...process.env, HOME, KIOKU_HOME: VAULT, NODE_NO_WARNINGS: "1" };

const results = [];
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? "OK " : "NO "} ${name}${detail ? ` — ${detail}` : ""}`);
}
const cli = (...args) => spawnSync(NODE, ["--no-warnings", MAIN, ...args], { env, encoding: "utf8", timeout: 60_000 });
const runtime = () => { try { return JSON.parse(readFileSync(path.join(VAULT, ".kioku/runtime.json"), "utf8")); } catch { return null; } };
const report = () => { try { return JSON.parse(readFileSync(path.join(SMOKE, "report.json"), "utf8")); } catch { return null; } };
async function until(what, fn, ms = 20_000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) { last = await fn(); if (last) return last; await sleep(150); }
  return null;
}
async function api(method, p, body) {
  const rt = runtime();
  const key = readFileSync(path.join(VAULT, ".kioku/secret"), "utf8").trim();
  const r = await fetch(`http://127.0.0.1:${rt.port}${p}`, { method, headers: { "x-kioku-key": key, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
let cmdSeq = 0;
async function cmd(c) {
  const name = String(++cmdSeq).padStart(3, "0");
  writeFileSync(path.join(SMOKE, "cmd", `${name}.json`), JSON.stringify(c));
  return until(`cmd ${c.do}`, () => existsSync(path.join(SMOKE, `cmd-${name}.done`)) && readFileSync(path.join(SMOKE, `cmd-${name}.done`), "utf8").trim(), 10_000);
}
const screenshot = (name) => spawnSync("/usr/sbin/screencapture", ["-x", "-C", path.join(OUT, `screen-${name}.png`)]);
const launchd = (label) => spawnSync("/bin/launchctl", ["print", `gui/${uid}/${label}`], { encoding: "utf8" });

let app;
let mock;
try {
  // ───────── 0. «Ollama» local y el modelo del asistente, como en el Mac mini ─────────
  mock = spawn(process.execPath, [path.join(import.meta.dirname, "mock-ollama.mjs"), "11434"], { stdio: "ignore" });
  check("Ollama (simulado) responde en 127.0.0.1:11434", !!(await until("ollama", async () => { try { return (await fetch("http://127.0.0.1:11434/api/tags")).ok; } catch { return false; } }, 10_000)));
  const use = cli("assistant", "model", "ollama");
  check("kioku assistant model ollama → qwen3.5:9b en localhost", use.status === 0 && /ollama · qwen3\.5:9b · http:\/\/localhost:11434/.test(use.stdout), use.stdout.trim().split("\n")[0]);

  // ───────── 1. launchd: el daemon arranca, se relanza si cae ─────────
  const inst = cli("service", "install", "--app", APP, "--no-start-app");
  check("kioku service install (launchd)", inst.status === 0, (inst.stdout + inst.stderr).trim().split("\n").join(" | "));
  const plist = path.join(HOME, "Library/LaunchAgents/local.kioku.daemon.plist");
  check("plist del daemon apunta al runtime y la CLI de la app", existsSync(plist) && readFileSync(plist, "utf8").includes(NODE) && readFileSync(plist, "utf8").includes(VAULT));
  check("plutil valida los plists", spawnSync("/usr/bin/plutil", ["-lint", plist, path.join(HOME, "Library/LaunchAgents/local.kioku.app.plist")]).status === 0);
  const rt1 = await until("daemon", async () => { const r = runtime(); if (!r) return null; try { return (await fetch(`http://127.0.0.1:${r.port}/api/health`)).ok && r; } catch { return null; } }, 30_000);
  check("launchd arranca el daemon (puerto 47800)", rt1 && rt1.port === 47800, JSON.stringify(rt1));
  check("launchctl lo ve en marcha", /state = running/.test(launchd("local.kioku.daemon").stdout));
  const status = cli("service", "status", "--json");
  let st = null; try { st = JSON.parse(status.stdout.trim().split("\n").pop()); } catch { /* */ }
  check("service status --json", st?.daemon?.loaded === true && st?.app?.installed === true && st?.app?.loaded === false, status.stdout.trim());

  // ───────── 2. la app: Kio conectado al mismo daemon ─────────
  await api("POST", "/api/capture", { text: "Idea suelta de la prueba" });
  app = spawn(EXE, [], { env: { ...env, KIOKU_MAC_SMOKE_DIR: SMOKE }, stdio: ["ignore", "pipe", "pipe"] });
  let appLog = "";
  app.stdout.on("data", (d) => { appLog += d; });
  app.stderr.on("data", (d) => { appLog += d; });
  const r0 = await until("conectado", () => { const r = report(); return r?.connected && r?.ready && r; }, 30_000);
  check("Kio se conecta al daemon con su credencial limitada", !!r0, r0 ? `motor ${JSON.stringify(r0.engine)}` : appLog.slice(-400));
  const ck = readFileSync(path.join(VAULT, ".kioku/secret-companion"), "utf8").trim();
  check("la app creó secret-companion (0600) y no es la clave completa", /^[0-9a-f]{64}$/.test(ck) && ck !== readFileSync(path.join(VAULT, ".kioku/secret"), "utf8").trim()
    && (spawnSync("/usr/bin/stat", ["-f", "%Lp", path.join(VAULT, ".kioku/secret-companion")], { encoding: "utf8" }).stdout.trim() === "600"));
  const pidFile = path.join(VAULT, ".kioku/companion-overlay.pid");
  check("escribe su pid (contrato de kioku companion)", existsSync(pidFile) && Number(readFileSync(pidFile, "utf8")) === app.pid);
  if (r0) {
    check("Kio visible, flotante, en todos los escritorios y sin tapar pantalla completa",
      r0.kioVisible && r0.kioLevel === 3 && r0.kioAllSpaces && !r0.kioFullScreenAux && !r0.kioCanBecomeKey, JSON.stringify({ level: r0.kioLevel, frame: r0.kioFrame, screen: r0.screen }));
    const [kx, ky, kw] = r0.kioFrame, [sx, sy, sw] = r0.screen;
    check("en la esquina inferior derecha con 24 px de margen", Math.round(sx + sw - (kx + kw)) === 24 && Math.round(ky - sy) === 24, JSON.stringify(r0.kioFrame));
    check("app de barra de menús (sin Dock) con su menú y ⌥⌘K", r0.activationPolicy === 1 && r0.statusItem && r0.hotKey, JSON.stringify({ policy: r0.activationPolicy, hotKey: r0.hotKey }));
    check("motor informado: local · qwen3.5:9b", r0.engine?.model === "qwen3.5:9b" && r0.engine?.local === true && r0.engine?.provider === "ollama", JSON.stringify(r0.engine));
  }
  await sleep(600);
  await cmd({ do: "snapshot", name: "01-reposo" });
  screenshot("01-reposo");

  // Segunda instancia: se retira sin tocar la primera.
  const second = spawnSync(EXE, [], { env: { ...env, KIOKU_MAC_SMOKE_DIR: "" }, timeout: 15_000 });
  check("una segunda Kioku.app se retira (una Kio por bóveda)", second.status === 0 && Number(readFileSync(pidFile, "utf8")) === app.pid);

  // ───────── 3. conversación: el mismo agente, mismos estados ─────────
  await cmd({ do: "ack" });
  await cmd({ do: "open" });
  const r1 = await until("panel", () => { const r = report(); return r?.panelOpen && r; });
  check("el panel se abre encima de Kio y dentro de la pantalla", r1 && r1.panelFrame[1] >= r1.kioFrame[1] + r1.kioFrame[3] && r1.panelFrame[0] >= r1.screen[0], JSON.stringify(r1?.panelFrame));
  check("el panel toma el teclado (sin activar la app)", r1?.panelIsKey === true, JSON.stringify({ key: r1?.panelIsKey, active: r1?.appActive }));
  await cmd({ do: "send", text: "¿Qué hay en mi bandeja?" });
  const seen = new Set();
  const answered = await until("respuesta", () => { const r = report(); if (r) seen.add(r.faceState); return r?.lastAssistant && !r.busy && r; }, 30_000);
  check("responde desde la app (pregunta → respuesta del agente)", /Bandeja/.test(answered?.lastAssistant ?? ""), answered?.lastAssistant);
  check("Kio pasa por pensando/respondiendo", seen.has("thinking") || seen.has("responding"), [...seen].join(","));
  const conv = await api("GET", "/api/assistant/conversation");
  check("la conversación vive en el daemon (la ve la web)", conv.json?.messages?.some((m) => m.surface === "desktop" && /bandeja/i.test(m.text)));
  await cmd({ do: "snapshot", name: "02-conversacion" });
  screenshot("02-conversacion");

  await cmd({ do: "send", text: "crea una tarea: comprar café" });
  const withAction = await until("acción", () => { const r = report(); return r?.undoable >= 1 && !r.busy && r; }, 30_000);
  check("una acción del agente trae Deshacer", !!withAction);
  await cmd({ do: "undo" });
  check("Deshacer funciona desde el panel", !!(await until("deshecho", () => { const r = report(); return r?.undoable === 0 && r; })));

  await cmd({ do: "send", text: "borra la primera captura" });
  const awaiting = await until("propuesta", () => { const r = report(); return r?.pendingProposals >= 1 && r.faceState === "awaiting_confirmation" && r; }, 30_000);
  check("borrar llega como propuesta y Kio espera tu decisión", !!awaiting, awaiting?.agentLabel);
  await cmd({ do: "snapshot", name: "03-propuesta" });
  await cmd({ do: "close" });
  const peek = await until("aviso", () => { const r = report(); return r?.peekVisible && r; });
  check("con el panel cerrado asoma el aviso", !!peek, peek?.peekText);
  await cmd({ do: "snapshot", name: "04-aviso" });
  screenshot("04-aviso");
  await cmd({ do: "open" });
  const armed = await cmd({ do: "decide", what: "apply" });
  check("borrar pide una segunda confirmación", /armed=true/.test(armed ?? ""), armed);
  await cmd({ do: "snapshot", name: "05-confirmar" });
  await cmd({ do: "decide", what: "apply" });
  check("«Confirmar: aplicar» aplica la propuesta", !!(await until("aplicada", () => { const r = report(); return r?.pendingProposals === 0 && r; })));

  // ───────── 4. modos compartidos, posición y señales ─────────
  await cmd({ do: "close" });
  await api("POST", "/api/assistant/companion", { mode: "focus" });
  const quiet = await until("concentración", () => { const r = report(); return r?.quiet && r.kioFrame[2] < 60 && r; });
  check("concentración (puesta desde la web/API): Kio pequeño y quieto", quiet?.faceState === "quiet", JSON.stringify(quiet?.kioFrame));
  await cmd({ do: "snapshot", name: "06-concentracion" });
  await api("POST", "/api/assistant/companion", { mode: "hidden" });
  check("oculto desde otra interfaz: desaparece", !!(await until("oculto", () => { const r = report(); return r && !r.kioVisible && r; })));
  await api("POST", "/api/assistant/companion", { mode: "active", overlay: { x: 200, y: 150 } });
  const moved = await until("movido", () => { const r = report(); return r?.kioVisible && Math.round(r.kioFrame[1] - r.screen[1]) === 150 && r; });
  check("vuelve y respeta la posición guardada en el daemon", !!moved, JSON.stringify(moved?.kioFrame));
  process.kill(app.pid, "SIGUSR1");
  check("SIGUSR1 abre la conversación (kioku companion panel)", !!(await until("usr1", () => { const r = report(); return r?.panelOpen && r; })));
  const status2 = cli("companion", "status");
  check("kioku companion status reconoce la app", new RegExp(`pid ${app.pid}`).test(status2.stdout), status2.stdout.trim().split("\n")[0]);
  const panel2 = cli("companion", "panel");
  check("kioku companion panel la alterna", panel2.status === 0 && !!(await until("panel cerrado", () => { const r = report(); return r && !r.panelOpen && r; })));

  // ───────── 5. la ventana de Kioku (web dentro de la app) ─────────
  await cmd({ do: "workspace", route: "/hoy" });
  const ws = await until("ventana", () => { const r = report(); return r?.workspaceOpen && r.workspaceURL && r; }, 15_000);
  check("Abrir Kioku: ventana nativa con la web local, sin la clave en la URL", ws && /^http:\/\/127\.0\.0\.1:47800\//.test(ws.workspaceURL) && !/[?&]k=/.test(ws.workspaceURL), ws?.workspaceURL);
  check("con una ventana abierta aparece en el Dock", ws?.activationPolicy === 0);
  await sleep(2500);
  await cmd({ do: "snapshot", name: "07-kioku" });
  screenshot("07-kioku");
  const fg = await until("Kioku delante", () => { const r = report(); return r?.webForeground && r; }, 15_000);
  check("con Kioku delante el Kio de escritorio se retira", fg && !fg.kioVisible, JSON.stringify({ webForeground: fg?.webForeground, kio: fg?.kioVisible }));
  await cmd({ do: "closeWorkspace" });
  check("al cerrar la ventana vuelve a la barra de menús", !!(await until("accesoria", () => { const r = report(); return r && !r.workspaceOpen && r.activationPolicy === 1 && r; })));
  await api("POST", "/api/desktop/open", { route: "/asistente" });
  const nav = await until("navegar", () => { const r = report(); return r?.workspaceOpen && r; }, 15_000);
  check("«abrir en Kioku» (evento navigate del daemon) abre la ventana nativa", !!nav, nav?.workspaceURL);
  await cmd({ do: "closeWorkspace" });
  await cmd({ do: "setup" });
  await until("setup", () => { const r = report(); return r?.setupOpen && r; });
  await sleep(2500);
  await cmd({ do: "snapshot", name: "08-configuracion" });
  screenshot("08-configuracion");

  // ───────── 6. el daemon cae: launchd lo relanza y Kio se reconecta ─────────
  const before = runtime();
  process.kill(before.pid, "SIGKILL");
  const dropped = await until("sin daemon", () => { const r = report(); return r && !r.connected && r; }, 15_000);
  check("sin daemon, Kio descansa (sin conexión)", dropped?.faceState === "quiet");
  const rt2 = await until("relanzado", async () => { const r = runtime(); if (!r || r.pid === before.pid) return null; try { return (await fetch(`http://127.0.0.1:${r.port}/api/health`)).ok && r; } catch { return null; } }, 40_000);
  check("launchd relanza el daemon caído", !!rt2, JSON.stringify(rt2));
  check("Kio se reconecta solo", !!(await until("reconectado", () => { const r = report(); return r?.connected && r.ready && r; }, 30_000)));

  await cmd({ do: "quit" });
  const exited = await until("salida", () => app.exitCode !== null || app.signalCode !== null, 10_000);
  check("Salir cierra la app y retira su pid", exited && !existsSync(pidFile));
  writeFileSync(path.join(OUT, "app.log"), appLog);
} catch (e) {
  check("sin excepciones", false, e.stack);
} finally {
  if (app && app.exitCode === null) app.kill("SIGKILL");
  mock?.kill();
  const un = cli("service", "uninstall");
  check("kioku service uninstall retira los agentes", un.status === 0 && !existsSync(path.join(HOME, "Library/LaunchAgents/local.kioku.daemon.plist")) && launchd("local.kioku.daemon").status !== 0, un.stdout.trim());
  writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ failed, results }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`);
  process.exit(failed ? 1 : 0);
}
