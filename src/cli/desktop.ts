// Integración con el escritorio: daemon en segundo plano, ventana Quick (Hyprland) y ventana Workspace.
// No modifica NINGUNA configuración del usuario: usa reglas inline de `hyprctl dispatch exec`.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const QUICK_TITLE = "Kioku Quick";
export const WORKSPACE_TITLE = "Kioku";
const SPECIAL = "kioku";

export function kiokuHome(): string {
  return path.resolve(process.env.KIOKU_HOME ?? path.join(os.homedir(), "Documents", "Kioku"));
}

export const repoRoot = path.resolve(import.meta.dirname, "..", "..");
export const webDir = path.join(repoRoot, "dist", "web");

interface Runtime { pid: number; port: number; startedAt: string }

export function readRuntime(home: string): Runtime | null {
  try {
    return JSON.parse(readFileSync(path.join(home, ".kioku", "runtime.json"), "utf8")) as Runtime;
  } catch {
    return null;
  }
}

export const daemonAlive = (port: number) => healthy(port);

async function healthy(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Devuelve la URL base del daemon, arrancándolo (desacoplado) si no está. */
export async function ensureDaemon(home: string): Promise<string> {
  const rt = readRuntime(home);
  if (rt && (await healthy(rt.port))) return `http://127.0.0.1:${rt.port}`;
  mkdirSync(path.join(home, ".kioku"), { recursive: true });
  const log = openSync(path.join(home, ".kioku", "daemon.log"), "a");
  const child = spawn(process.execPath, ["--no-warnings", path.join(repoRoot, "src", "cli", "main.ts"), "daemon"], {
    detached: true, stdio: ["ignore", log, log], env: { ...process.env, KIOKU_HOME: home },
  });
  child.unref();
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    await new Promise((r) => setTimeout(r, 60));
    const r2 = readRuntime(home);
    if (r2 && r2.pid === child.pid && (await healthy(r2.port))) return `http://127.0.0.1:${r2.port}`;
  }
  throw new Error(`El daemon no arrancó. Revisa ${path.join(home, ".kioku", "daemon.log")}`);
}

function browser(): string {
  for (const b of ["chromium", "google-chrome-stable", "chromium-browser", "brave"]) {
    if (spawnSync("sh", ["-c", `command -v ${b}`]).status === 0) return b;
  }
  throw new Error("No encontré Chromium/Chrome para abrir la interfaz");
}

/** Perfil propio por ventana: con un perfil compartido Chromium delega en el proceso ya abierto y las reglas de Hyprland no se aplican. */
function browserArgs(url: string, title: string, profileName: string): string[] {
  const profile = path.join(os.homedir(), ".cache", "kioku", profileName);
  mkdirSync(profile, { recursive: true });
  return [
    `--app=${url}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-features=Translate", `--window-name=${title}`,
  ];
}

const inHyprland = () => !!process.env.HYPRLAND_INSTANCE_SIGNATURE;

interface Client { title: string; workspace: { name: string }; address: string }

function hyprClients(): Client[] {
  const r = spawnSync("hyprctl", ["clients", "-j"], { encoding: "utf8" });
  if (r.status !== 0) return [];
  try {
    return JSON.parse(r.stdout) as Client[];
  } catch {
    return [];
  }
}

const findClient = (title: string) => hyprClients().find((c) => c.title === title);

/** Hyprland ≥0.55 se configura y controla en Lua: `hyprctl eval` ejecuta una expresión. */
const luaStr = (v: string) => `"${[...v].map((c) => (c === '"' || c === "\\" ? "\\" + c : c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126 ? "\\" + c.charCodeAt(0).toString().padStart(3, "0") : c)).join("")}"`;

function lua(code: string): void {
  spawnSync("hyprctl", ["eval", code]);
}

const toggleSpecial = () => lua(`hl.dispatch(hl.dsp.workspace.toggle_special(${luaStr(SPECIAL)}))`);

/** Abre/alterna la ventana Quick. En Hyprland se mantiene "caliente" en un workspace especial. */
export async function toggleQuick(base: string): Promise<string> {
  const url = `${base}/quick`;
  if (!inHyprland()) {
    spawn(browser(), [...browserArgs(url, QUICK_TITLE, "browser-quick"), "--window-size=680,160"], { detached: true, stdio: "ignore" }).unref();
    return "ventana abierta";
  }
  const existing = findClient(QUICK_TITLE);
  if (existing) {
    const visible = existing.workspace.name === `special:${SPECIAL}` && (await specialVisible());
    toggleSpecial();
    return visible ? "oculta" : "mostrada";
  }
  const cmd = [browser(), ...browserArgs(url, QUICK_TITLE, "browser-quick")].map((a) => `'${a.replaceAll("'", "'\\''")}'`).join(" ");
  lua(`hl.dispatch(hl.dsp.exec_cmd(${luaStr(cmd)}, { float = true, center = true, size = "700 150", workspace = ${luaStr("special:" + SPECIAL)} }))`);
  // Hyprland muestra el workspace especial al abrir en él una ventana; si no, lo mostramos.
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (findClient(QUICK_TITLE)) break;
  }
  await new Promise((r) => setTimeout(r, 150));
  if (!(await specialVisible())) toggleSpecial();
  return "creada";
}

async function specialVisible(): Promise<boolean> {
  const r = spawnSync("hyprctl", ["monitors", "-j"], { encoding: "utf8" });
  try {
    return (JSON.parse(r.stdout) as { specialWorkspace: { name: string } }[]).some((m) => m.specialWorkspace?.name === `special:${SPECIAL}`);
  } catch {
    return false;
  }
}

/** Oculta Quick (lo llama la propia página al terminar). */
export async function hideQuick(): Promise<void> {
  if (inHyprland() && (await specialVisible())) toggleSpecial();
}

/** Abre el Workspace en `route`; si ya hay ventana, la enfoca (la propia página navega vía evento SSE). */
export function openWorkspace(base: string, route: string): void {
  if (inHyprland()) {
    const c = findClient(WORKSPACE_TITLE);
    if (c) { lua(`hl.dispatch(hl.dsp.focus({ window = ${luaStr("address:" + c.address)} }))`); return; }
  }
  spawn(browser(), [...browserArgs(`${base}/#${route}`, WORKSPACE_TITLE, "browser"), "--window-size=1280,820"], { detached: true, stdio: "ignore" }).unref();
}

export const hasBrowserProfile = () => existsSync(path.join(os.homedir(), ".cache", "kioku", "browser"));
