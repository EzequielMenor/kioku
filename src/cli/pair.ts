// `kioku pair`: empareja el móvil. Crea la clave del rol `mobile` (o la revoca) y da la URL que se abre en el teléfono.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadOrCreateMobileKey, revokeMobileKey } from "../server/key.ts";
import { loginUrl } from "./desktop.ts";

/** Nombre DNS del equipo en la tailnet (`tailscale status --json`), sin el punto final. */
export function tailscaleHost(json: string): string | null {
  try {
    const dns = (JSON.parse(json) as { Self?: { DNSName?: string } }).Self?.DNSName;
    return dns ? dns.replace(/\.$/, "") : null;
  } catch {
    return null;
  }
}

const bareHost = (h: string) => h.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();

/** `KIOKU_ALLOWED_HOSTS`: hosts extra que acepta el daemon (lista cerrada separada por comas). */
export function allowedHostsFrom(v: string | undefined): string[] {
  return (v ?? "").split(",").map(bareHost).filter(Boolean);
}

/** Host público: `KIOKU_PUBLIC_HOST` o, si Tailscale está instalado, el nombre de este equipo. */
export function publicHost(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.KIOKU_PUBLIC_HOST?.trim()) return bareHost(env.KIOKU_PUBLIC_HOST);
  const r = spawnSync("tailscale", ["status", "--json"], { encoding: "utf8", timeout: 4000 });
  return r.status === 0 ? tailscaleHost(r.stdout) : null;
}

function hasPrivateFolders(home: string): boolean {
  try {
    const ex = (JSON.parse(readFileSync(path.join(home, ".kioku", "mobile.json"), "utf8")) as { exclude?: unknown }).exclude;
    return Array.isArray(ex) && ex.some((x) => typeof x === "string" && x.trim());
  } catch {
    return false;
  }
}

export function pairReport(o: { home: string; host: string | null; revoke?: boolean }): { lines: string[]; url?: string } {
  if (o.revoke) {
    revokeMobileKey(o.home);
    return { lines: ["Móvil desemparejado: su clave queda revocada al instante (no hace falta reiniciar nada).", "Lo que ya descargó el móvil sigue en el teléfono hasta que desinstales la app."] };
  }
  if (!o.host) {
    return { lines: [
      "No sé con qué nombre se llega a este equipo desde el móvil.",
      "  · Con Tailscale: instálalo, ejecuta `tailscale serve --bg 47800` y vuelve a lanzar `kioku pair`.",
      "  · O indícalo a mano: KIOKU_PUBLIC_HOST=portatil.tu-tailnet.ts.net kioku pair",
    ] };
  }
  const key = loadOrCreateMobileKey(o.home);
  const url = loginUrl(`https://${o.host}`, key, "/");
  const lines = [
    "Abre esta dirección en el móvil (lleva la clave del móvil: no la compartas):",
    "", `  ${url}`, "",
    "Después, en Safari: Compartir → «Añadir a pantalla de inicio».",
    `El daemon debe aceptar ese nombre: arráncalo con KIOKU_ALLOWED_HOSTS=${o.host} (con \`kioku service install\` se conserva).`,
    "El móvil puede leer, capturar, marcar tareas y editar notas; no puede borrar ni usar el asistente. Para desemparejarlo: `kioku pair --revoke`.",
  ];
  if (!hasPrivateFolders(o.home)) {
    lines.push("", "Aviso: no has marcado carpetas privadas. Para que algunas nunca salgan del portátil, crea .kioku/mobile.json con { \"exclude\": [\"Privado/\"] }.");
  }
  return { lines, url };
}
