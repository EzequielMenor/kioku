// Arranque automático (opcional): en Linux, servicio de usuario de systemd; en macOS, LaunchAgents de launchd (launchd.ts).
// En Linux solo escribe ~/.config/systemd/user/kioku.service; no toca nada fuera de eso y es reversible con `uninstall`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRuntime, repoRoot } from "./desktop.ts";
import { installLaunchd, launchdStatus, realLaunchdDeps, uninstallLaunchd, type LaunchdStatus } from "./launchd.ts";

const UNIT = path.join(os.homedir(), ".config", "systemd", "user", "kioku.service");

/** `allowedHosts` (de KIOKU_ALLOWED_HOSTS) se escribe tal cual solo si son nombres de host: nada que pueda añadir líneas al unit. */
export function unitText(home: string, allowedHosts: string | undefined = process.env.KIOKU_ALLOWED_HOSTS): string {
  const hosts = allowedHosts && /^[A-Za-z0-9.,:\-]+$/.test(allowedHosts) ? `Environment=KIOKU_ALLOWED_HOSTS=${allowedHosts}\n` : "";
  const main = path.join(repoRoot, "src", "cli", "main.ts");
  return `[Unit]
Description=Kioku (daemon local, solo 127.0.0.1)
After=graphical-session.target

[Service]
Type=simple
ExecStart=${process.execPath} --no-warnings ${main} daemon
Environment=KIOKU_HOME=${home}
${hosts}Restart=on-failure
RestartSec=2

[Install]
WantedBy=graphical-session.target
`;
}

function ctl(...args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}

export function serviceInstalled(): boolean {
  return existsSync(UNIT);
}

export function installService(home: string): string[] {
  const log: string[] = [];
  // Si hay un daemon lanzado a mano, se detiene para que lo gestione systemd.
  const rt = readRuntime(home);
  if (rt) {
    try { process.kill(rt.pid, "SIGTERM"); log.push(`Detenido el daemon manual (pid ${rt.pid}).`); } catch { /* ya no existe */ }
  }
  mkdirSync(path.dirname(UNIT), { recursive: true });
  writeFileSync(UNIT, unitText(home));
  log.push(`Escrito ${UNIT}`);
  const steps: [string, string[]][] = [["recarga", ["daemon-reload"]], ["activación", ["enable", "--now", "kioku.service"]]];
  for (const [name, a] of steps) {
    const r = ctl(...a);
    if (!r.ok) throw new Error(`systemctl ${name} falló: ${r.out}`);
  }
  log.push("Servicio activado: arrancará con tu sesión.");
  return log;
}

export function uninstallService(): string[] {
  const log: string[] = [];
  if (!serviceInstalled()) return ["El servicio no está instalado."];
  ctl("disable", "--now", "kioku.service");
  unlinkSync(UNIT);
  ctl("daemon-reload");
  log.push(`Servicio desactivado y eliminado (${UNIT}).`);
  return log;
}

export function serviceStatus(): string {
  if (!serviceInstalled()) return "servicio no instalado (kioku service install)";
  const active = ctl("is-active", "kioku.service").out;
  const enabled = ctl("is-enabled", "kioku.service").out;
  return `servicio: ${active}, ${enabled}`;
}

/* ───────── por plataforma ───────── */

export interface ServiceOptions { app?: string; startApp?: boolean; replaceLegacy?: boolean }

/** Opciones de `kioku service install`: `--app RUTA/Kioku.app`, `--no-start-app`, `--replace-legacy` (solo macOS). */
export function parseServiceArgs(args: string[]): ServiceOptions {
  const o: ServiceOptions = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--app" && args[i + 1]) o.app = path.resolve(args[++i]);
    else if (a === "--no-start-app") o.startApp = false;
    else if (a === "--replace-legacy") o.replaceLegacy = true;
    else if (a !== "--json") throw new Error(`opción desconocida: ${a}`);
  }
  return o;
}

export function installFor(platform: NodeJS.Platform, home: string, o: ServiceOptions = {}): string[] {
  if (platform === "darwin") {
    return installLaunchd({ home, node: process.execPath, main: path.join(repoRoot, "src", "cli", "main.ts"), env: process.env, ...o }, realLaunchdDeps());
  }
  if (o.app || o.replaceLegacy) throw new Error("--app y --replace-legacy son solo para macOS");
  return installService(home);
}

export function uninstallFor(platform: NodeJS.Platform): string[] {
  return platform === "darwin" ? uninstallLaunchd(realLaunchdDeps()) : uninstallService();
}

export function statusFor(platform: NodeJS.Platform): { text: string; json: LaunchdStatus | { systemd: string } } {
  if (platform !== "darwin") { const t = serviceStatus(); return { text: t, json: { systemd: t } }; }
  const st = launchdStatus(realLaunchdDeps());
  const one = (s: { installed: boolean; loaded: boolean }) => (s.installed ? (s.loaded ? "activo" : "instalado (se carga al iniciar sesión)") : "no instalado");
  const legacy = st.legacy.length ? ` · arranque antiguo: ${st.legacy.map((l) => l.label).join(", ")} (sustitúyelo con kioku service install --replace-legacy)` : "";
  return { text: `launchd · daemon: ${one(st.daemon)} · app: ${one(st.app)}${legacy}`, json: st };
}
