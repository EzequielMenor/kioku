// Arranque automático en macOS con launchd (LaunchAgents del usuario): el daemon de Kioku y la app con Kio.
// Solo escribe `~/Library/LaunchAgents/local.kioku.{daemon,app}.plist` y `~/Library/Logs/Kioku/`. Un LaunchAgent
// antiguo de Kioku (p. ej. `com.ezequiel.kioku-server`) nunca se toca sin `--replace-legacy`, y entonces se guarda
// su plist tal cual en `~/Library/Application Support/Kioku/legacy/` para poder volver atrás.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRuntime } from "./desktop.ts";

export const DAEMON_LABEL = "local.kioku.daemon";
export const APP_LABEL = "local.kioku.app";
/** Mismo puerto que el servidor de siempre: `tailscale serve` y los móviles emparejados siguen apuntando bien. */
export const MAC_PORT = "47800";
const PATH_ENV = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const SAFE_HOSTS = /^[A-Za-z0-9.,:\-]+$/;

export interface LaunchdDeps {
  userHome: string;
  uid: number;
  launchctl(args: string[]): { ok: boolean; out: string };
  kill(pid: number): void;
  now(): Date;
}

export const realLaunchdDeps = (): LaunchdDeps => ({
  userHome: os.homedir(),
  uid: process.getuid?.() ?? 0,
  launchctl(args) {
    const r = spawnSync("/bin/launchctl", args, { encoding: "utf8", timeout: 15_000 });
    return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
  },
  kill(pid) { try { process.kill(pid, "SIGTERM"); } catch { /* ya no existe */ } },
  now: () => new Date(),
});

type PlistValue = string | number | boolean | string[] | { [k: string]: PlistValue };
export type Plist = Record<string, PlistValue>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function plistValue(v: PlistValue, indent: string): string {
  if (typeof v === "boolean") return `${indent}<${v}/>`;
  if (typeof v === "number") return `${indent}<integer>${Math.trunc(v)}</integer>`;
  if (typeof v === "string") return `${indent}<string>${esc(v)}</string>`;
  if (Array.isArray(v)) return `${indent}<array>\n${v.map((x) => plistValue(x, indent + "  ")).join("\n")}\n${indent}</array>`;
  return `${indent}<dict>\n${Object.entries(v).map(([k, x]) => `${indent}  <key>${esc(k)}</key>\n${plistValue(x, indent + "  ")}`).join("\n")}\n${indent}</dict>`;
}

export function plistXml(p: Plist): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plistValue(p, "")}\n</plist>\n`;
}

interface Agent { label: string; path: string; plist: Plist }

const agentsDir = (userHome: string) => path.join(userHome, "Library", "LaunchAgents");
const logsDir = (userHome: string) => path.join(userHome, "Library", "Logs", "Kioku");
const legacyDir = (userHome: string) => path.join(userHome, "Library", "Application Support", "Kioku", "legacy");

export function daemonAgent(o: { home: string; node: string; main: string; userHome: string; env: NodeJS.ProcessEnv }): Agent {
  const env: Record<string, string> = { KIOKU_HOME: o.home, KIOKU_PORT: MAC_PORT, PATH: PATH_ENV };
  for (const k of ["KIOKU_ALLOWED_HOSTS", "KIOKU_PUBLIC_HOST"]) {
    const v = o.env[k];
    if (v && SAFE_HOSTS.test(v)) env[k] = v;
  }
  const log = path.join(logsDir(o.userHome), "daemon.log");
  return {
    label: DAEMON_LABEL,
    path: path.join(agentsDir(o.userHome), `${DAEMON_LABEL}.plist`),
    plist: {
      Label: DAEMON_LABEL,
      ProgramArguments: [o.node, "--no-warnings", o.main, "daemon"],
      EnvironmentVariables: env,
      RunAtLoad: true,
      KeepAlive: { SuccessfulExit: false },
      ThrottleInterval: 5,
      ProcessType: "Background",
      StandardOutPath: log,
      StandardErrorPath: log,
    },
  };
}

export function appAgent(o: { app: string; userHome: string }): Agent {
  if (!o.app.endsWith(".app")) throw new Error("--app debe ser la ruta de Kioku.app");
  const log = path.join(logsDir(o.userHome), "app.log");
  return {
    label: APP_LABEL,
    path: path.join(agentsDir(o.userHome), `${APP_LABEL}.plist`),
    plist: {
      Label: APP_LABEL,
      ProgramArguments: [path.join(o.app, "Contents", "MacOS", "Kioku"), "--login"],
      RunAtLoad: true,
      // Se relanza si se cae; si la cierras tú (Salir), se queda cerrada hasta el próximo inicio de sesión.
      KeepAlive: { SuccessfulExit: false },
      ThrottleInterval: 10,
      LimitLoadToSessionType: "Aqua",
      ProcessType: "Interactive",
      StandardOutPath: log,
      StandardErrorPath: log,
    },
  };
}

const target = (d: LaunchdDeps, label: string) => `gui/${d.uid}/${label}`;
const loaded = (d: LaunchdDeps, label: string) => d.launchctl(["print", target(d, label)]).ok;

export interface LegacyAgent { label: string; path: string; loaded: boolean }

/** LaunchAgents de Kioku que no son los nuestros (instalaciones anteriores, como `com.ezequiel.kioku-server`). */
export function legacyAgents(d: LaunchdDeps): LegacyAgent[] {
  const dir = agentsDir(d.userHome);
  let files: string[] = [];
  try { files = readdirSync(dir); } catch { return []; }
  return files
    .filter((f) => f.endsWith(".plist") && /kioku/i.test(f) && !f.startsWith("local.kioku."))
    .sort()
    .map((f) => { const label = f.slice(0, -".plist".length); return { label, path: path.join(dir, f), loaded: loaded(d, label) }; });
}

function stamp(d: LaunchdDeps): string {
  return d.now().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
}

function retireLegacy(d: LaunchdDeps, l: LegacyAgent): string {
  if (l.loaded) d.launchctl(["bootout", target(d, l.label)]);
  const dir = legacyDir(d.userHome);
  mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${path.basename(l.path)}.${stamp(d)}`);
  try { renameSync(l.path, dest); }
  catch { copyFileSync(l.path, dest); unlinkSync(l.path); }
  return `Retirado ${l.label}; su plist queda guardado en ${dest} (para volver: muévelo a ~/Library/LaunchAgents y ejecuta launchctl bootstrap gui/$(id -u) <plist>).`;
}

function load(d: LaunchdDeps, a: Agent, start: boolean): void {
  mkdirSync(path.dirname(a.path), { recursive: true });
  if (loaded(d, a.label)) d.launchctl(["bootout", target(d, a.label)]);
  writeFileSync(a.path, plistXml(a.plist));
  if (!start) return;
  const r = d.launchctl(["bootstrap", `gui/${d.uid}`, a.path]);
  if (!r.ok) throw new Error(`launchctl bootstrap ${a.label} falló: ${r.out}`);
}

export interface InstallOptions {
  home: string;
  node: string;
  main: string;
  env: NodeJS.ProcessEnv;
  /** Kioku.app que se abrirá al iniciar sesión (Kio y la ventana de Kioku). */
  app?: string;
  /** Escribe el agente de la app pero no la lanza ahora (la propia app es quien lo instala). */
  startApp?: boolean;
  replaceLegacy?: boolean;
}

export function installLaunchd(o: InstallOptions, d: LaunchdDeps): string[] {
  const log: string[] = [];
  const legacy = legacyAgents(d);
  if (legacy.length && !o.replaceLegacy) {
    throw new Error(
      `Ya hay otro arranque automático de Kioku: ${legacy.map((l) => `${l.label}${l.loaded ? " (en marcha)" : ""}`).join(", ")}.\n` +
      "Dos daemons sobre la misma bóveda chocarían. Para sustituirlo por el de esta versión (se guarda una copia del antiguo):\n" +
      "  kioku service install --replace-legacy");
  }
  for (const l of legacy) log.push(retireLegacy(d, l));
  mkdirSync(logsDir(d.userHome), { recursive: true });
  const daemon = daemonAgent({ home: o.home, node: o.node, main: o.main, userHome: d.userHome, env: o.env });
  // Un daemon lanzado a mano se detiene para que lo gestione launchd (si ya lo gestionaba, bootout lo para).
  const rt = readRuntime(o.home);
  if (rt && !loaded(d, DAEMON_LABEL)) { d.kill(rt.pid); log.push(`Detenido el daemon manual (pid ${rt.pid}).`); }
  load(d, daemon, true);
  log.push(`Daemon: ${daemon.path} (arranca con tu sesión y se relanza si cae; log en ${daemon.plist.StandardOutPath}).`);
  if (o.app) {
    const app = appAgent({ app: o.app, userHome: d.userHome });
    load(d, app, o.startApp !== false);
    log.push(`Kioku.app: ${app.path} (se abre al iniciar sesión).`);
  }
  return log;
}

export function uninstallLaunchd(d: LaunchdDeps): string[] {
  const log: string[] = [];
  for (const label of [APP_LABEL, DAEMON_LABEL]) {
    const file = path.join(agentsDir(d.userHome), `${label}.plist`);
    if (loaded(d, label)) d.launchctl(["bootout", target(d, label)]);
    if (existsSync(file)) { unlinkSync(file); log.push(`Retirado ${label}.`); }
  }
  return log.length ? log : ["El arranque automático no estaba instalado."];
}

export interface LaunchdStatus {
  daemon: { installed: boolean; loaded: boolean; program: string | null };
  app: { installed: boolean; loaded: boolean; program: string | null };
  legacy: LegacyAgent[];
}

function readPlistProgram(file: string): string | null {
  try {
    const xml = readFileSync(file, "utf8");
    const m = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/.exec(xml);
    return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"') : null;
  } catch {
    return null;
  }
}

export function launchdStatus(d: LaunchdDeps): LaunchdStatus {
  const one = (label: string) => {
    const file = path.join(agentsDir(d.userHome), `${label}.plist`);
    const installed = existsSync(file);
    return { installed, loaded: loaded(d, label), program: installed ? readPlistProgram(file) : null };
  };
  return { daemon: one(DAEMON_LABEL), app: one(APP_LABEL), legacy: legacyAgents(d) };
}
