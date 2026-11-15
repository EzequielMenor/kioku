// `kioku companion`: lanza, detiene y alterna a Kio en el escritorio (companion/overlay/kioku_companion.py).
// El overlay es un proceso aparte con una credencial limitada (`.kioku/secret-companion`): conversa, ve el estado y
// confirma, nada más. Aquí solo se gestiona su ciclo de vida; el modo (visible, concentración, oculto) vive en el
// daemon y lo comparten el personaje de escritorio y el de dentro de Kioku.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { loadOrCreateCompanionKey, readCompanionKey, revokeCompanionKey } from "../server/key.ts";
import { ensureDaemon, readRuntime, repoRoot } from "./desktop.ts";

export const OVERLAY_SCRIPT = path.join(repoRoot, "companion", "overlay", "kioku_companion.py");
const PID_FILE = "companion-overlay.pid";
export const USAGE = "uso: kioku companion [start|stop|toggle|focus|panel|status]   (stop --revoke retira también su credencial)";

type Mode = "active" | "focus" | "hidden";
interface View { mode: Mode; quiet: boolean; webForeground: boolean }
export interface Result { lines: string[]; code: number }

export interface CompanionDeps {
  home: string;
  /** URL base del daemon, arrancándolo si hace falta. */
  ensureDaemon(home: string): Promise<string>;
  /** URL base del daemon solo si ya está en marcha (no arranca nada). */
  runningDaemon(home: string): Promise<string | null>;
  fetch: typeof fetch;
  /** Comprueba que hay intérprete, GTK4 + layer-shell y sesión gráfica. */
  preflight(): { ok: true; python: string } | { ok: false; reason: string };
  spawnOverlay(python: string, home: string): void;
  /** ¿Ese pid es un overlay de Kioku vivo? */
  alive(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
  sleep(ms: number): Promise<void>;
}

const pidFile = (home: string) => path.join(home, ".kioku", PID_FILE);

export function overlayPid(d: Pick<CompanionDeps, "home" | "alive">): number | null {
  try {
    const pid = Number(readFileSync(pidFile(d.home), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 && d.alive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Llamada al daemon con la credencial del compañero (la misma que usa el overlay). */
async function call<T>(d: CompanionDeps, base: string, method: "GET" | "POST", p: string, body?: unknown): Promise<{ status: number; json: T | null }> {
  const key = readCompanionKey(d.home);
  const r = await d.fetch(base + p, {
    method, headers: { ...(key ? { "x-kioku-key": key } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as T | null };
}

const OLD_DAEMON = (base: string) => [
  `El daemon de Kioku que está en marcha (${base}) no reconoce al compañero: es de una versión anterior.`,
  "Reinícialo con esta versión (detén el que tienes — «systemctl --user restart kioku» si usas el servicio — y vuelve a lanzar «kioku companion»).",
];

/** Daemon listo para el compañero: arrancado, con la credencial creada y reconocida. */
async function connect(d: CompanionDeps): Promise<{ base: string } | { error: string[] }> {
  let base: string;
  try { base = await d.ensureDaemon(d.home); }
  catch (e) { return { error: [e instanceof Error ? e.message : String(e)] }; }
  loadOrCreateCompanionKey(d.home);
  try {
    const s = await call<{ role?: string }>(d, base, "GET", "/api/session");
    if (s.status !== 200 || s.json?.role !== "companion") return { error: OLD_DAEMON(base) };
  } catch {
    return { error: [`No pude hablar con el daemon de Kioku en ${base}.`] };
  }
  return { base };
}

async function setMode(d: CompanionDeps, base: string, mode: Mode): Promise<View | null> {
  return (await call<View>(d, base, "POST", "/api/assistant/companion", { mode })).json;
}

const MODE_TEXT: Record<Mode, string> = { active: "visible", focus: "en concentración", hidden: "oculto" };
const AGENT_TEXT: Record<string, string> = { idle: "en reposo", listening: "te escucha", thinking: "pensando", responding: "respondiendo", awaiting_confirmation: "espera tu decisión", success: "hecho", error: "algo falló" };

async function start(d: CompanionDeps): Promise<Result> {
  const pre = d.preflight();
  if (!pre.ok) return { lines: [pre.reason], code: 1 };
  const c = await connect(d);
  if ("error" in c) return { lines: c.error, code: 1 };
  // Pedir a Kio es querer verlo: si estaba oculto, vuelve.
  const view = (await call<View>(d, c.base, "GET", "/api/assistant/companion")).json;
  if (view?.mode === "hidden") await setMode(d, c.base, "active");
  const running = overlayPid(d);
  if (running) return { lines: [`Kio ya está en tu escritorio (pid ${running}).`], code: 0 };
  d.spawnOverlay(pre.python, d.home);
  for (let i = 0; i < 100; i++) {
    await d.sleep(100);
    const pid = overlayPid(d);
    if (pid) {
      return { code: 0, lines: [
        `Kio está en tu escritorio (pid ${pid}), conectado al mismo agente que Kioku.`,
        "  clic: abrir la conversación · arrastrar: moverlo · clic derecho: modo concentración",
        "  kioku companion toggle|focus|panel|stop   (asígnalos a atajos de Hyprland)",
      ] };
    }
  }
  return { lines: [`Kio no llegó a arrancar. Revisa ${path.join(d.home, ".kioku", "companion.log")}`], code: 1 };
}

async function stop(d: CompanionDeps, revoke: boolean): Promise<Result> {
  const pid = overlayPid(d);
  const lines: string[] = [];
  if (pid) {
    d.kill(pid, "SIGTERM");
    for (let i = 0; i < 30 && d.alive(pid); i++) await d.sleep(100);
    if (d.alive(pid)) d.kill(pid, "SIGKILL");
    lines.push("Kio se ha ido del escritorio.");
  } else lines.push("Kio no estaba en marcha.");
  rmSync(pidFile(d.home), { force: true });
  if (revoke) { revokeCompanionKey(d.home); lines.push("Credencial del compañero retirada."); }
  return { lines, code: 0 };
}

async function status(d: CompanionDeps): Promise<Result> {
  const pid = overlayPid(d);
  const lines = [pid ? `Kio: en el escritorio (pid ${pid})` : "Kio: detenido"];
  const base = await d.runningDaemon(d.home);
  if (!base) return { lines: [...lines, "Daemon de Kioku: detenido"], code: 0 };
  if (!readCompanionKey(d.home)) return { lines: [...lines, `Daemon de Kioku: ${base} (sin credencial del compañero todavía: lánzalo con «kioku companion»)`], code: 0 };
  try {
    const s = await call<{ agent?: { state?: string; label?: string | null }; companion?: View; engine?: { provider?: string | null; model?: string | null; local?: boolean } | null }>(d, base, "GET", "/api/assistant/state");
    if (s.status !== 200 || !s.json?.companion) return { lines: [...lines, ...OLD_DAEMON(base)], code: 1 };
    const v = s.json.companion, e = s.json.engine;
    lines.push(`Daemon de Kioku: ${base}`);
    lines.push(`Modo: ${MODE_TEXT[v.mode] ?? v.mode}${v.quiet && v.mode !== "focus" ? " (en silencio: hay una sesión de foco)" : ""}${v.webForeground ? " · Kioku está delante: el de escritorio se retira" : ""}`);
    lines.push(`Agente: ${s.json.agent?.label ?? AGENT_TEXT[s.json.agent?.state ?? ""] ?? s.json.agent?.state ?? "—"}${e?.model ? ` · ${e.local ? "local" : "remoto"} · ${e.provider ?? "?"} · ${e.model}` : ""}`);
  } catch {
    lines.push(`Daemon de Kioku: ${base} no responde`);
  }
  return { lines, code: 0 };
}

export async function companionCommand(sub: string | undefined, args: string[], d: CompanionDeps): Promise<Result> {
  switch (sub ?? "start") {
    case "start": return start(d);
    case "stop": return stop(d, args.includes("--revoke"));
    case "status": return status(d);
    case "toggle": {
      // Sin overlay: lo lanza. Con él: lo oculta o lo trae de vuelta (el modo es compartido con Kioku).
      if (!overlayPid(d)) return start(d);
      const c = await connect(d);
      if ("error" in c) return { lines: c.error, code: 1 };
      const view = (await call<View>(d, c.base, "GET", "/api/assistant/companion")).json;
      const next = await setMode(d, c.base, view?.mode === "hidden" ? "active" : "hidden");
      return next ? { lines: [`Kio: ${MODE_TEXT[next.mode]}`], code: 0 } : { lines: ["No pude cambiar el modo de Kio."], code: 1 };
    }
    case "focus": {
      const c = await connect(d);
      if ("error" in c) return { lines: c.error, code: 1 };
      const view = (await call<View>(d, c.base, "GET", "/api/assistant/companion")).json;
      const next = await setMode(d, c.base, view?.mode === "focus" ? "active" : "focus");
      return next ? { lines: [`Kio: ${MODE_TEXT[next.mode]}`], code: 0 } : { lines: ["No pude cambiar el modo de Kio."], code: 1 };
    }
    case "panel": {
      let pid = overlayPid(d);
      if (!pid) {
        const r = await start(d);
        if (r.code !== 0) return r;
        pid = overlayPid(d);
        await d.sleep(400); // que termine de dibujarse antes de pedirle el panel
      }
      if (pid) d.kill(pid, "SIGUSR1");
      return { lines: [], code: pid ? 0 : 1 };
    }
    default: return { lines: [USAGE], code: 1 };
  }
}

/* ───────── dependencias reales ───────── */

const MISSING = "Kio necesita GTK4 con gtk4-layer-shell y PyGObject. En Omarchy/Arch: sudo pacman -S --needed gtk4 gtk4-layer-shell python-gobject python-cairo";

function preflight(): { ok: true; python: string } | { ok: false; reason: string } {
  if (process.platform !== "linux") return { ok: false, reason: "El compañero de escritorio es para Linux con Wayland (Hyprland/Omarchy). En otros sistemas, Kio vive dentro de Kioku." };
  if (!process.env.WAYLAND_DISPLAY) return { ok: false, reason: "No hay sesión Wayland (WAYLAND_DISPLAY): lanza «kioku companion» desde tu escritorio." };
  // El Python del sistema es el que trae PyGObject; uno de pyenv/mise normalmente no.
  const candidates = [process.env.KIOKU_COMPANION_PYTHON, "/usr/bin/python3", "python3"].filter((p): p is string => !!p);
  let last = MISSING;
  for (const python of candidates) {
    if (path.isAbsolute(python) && !existsSync(python)) continue;
    const r = spawnSync(python, [OVERLAY_SCRIPT, "--check"], { encoding: "utf8", timeout: 20_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    if (r.error) continue;
    if (r.status === 0) return { ok: true, python };
    if (r.status === 3) last = "No hay sesión gráfica a la que conectarse: lanza «kioku companion» desde tu escritorio.";
    else if (r.status === 4) last = "Este compositor no ofrece wlr-layer-shell, que Kio necesita para flotar sobre las ventanas (Hyprland, Sway y similares sí).";
    else last = MISSING;
  }
  return { ok: false, reason: last };
}

function alive(pid: number): boolean {
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("kioku_companion.py"); }
  catch { return false; }
}

export function realDeps(home: string): CompanionDeps {
  return {
    home, ensureDaemon, fetch, preflight, alive,
    async runningDaemon(h) {
      const rt = readRuntime(h);
      if (!rt) return null;
      try { return (await fetch(`http://127.0.0.1:${rt.port}/api/health`, { signal: AbortSignal.timeout(800) })).ok ? `http://127.0.0.1:${rt.port}` : null; }
      catch { return null; }
    },
    spawnOverlay(python, h) {
      mkdirSync(path.join(h, ".kioku"), { recursive: true });
      const log = openSync(path.join(h, ".kioku", "companion.log"), "a");
      spawn(python, [OVERLAY_SCRIPT], { detached: true, stdio: ["ignore", log, log], env: { ...process.env, KIOKU_HOME: h, PYTHONDONTWRITEBYTECODE: "1" } }).unref();
    },
    kill(pid, signal) { try { process.kill(pid, signal); } catch { /* ya no existe */ } },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
