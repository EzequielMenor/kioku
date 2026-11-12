// Publicación privada de esta instancia. Nunca instala Tailscale, inicia sesión ni usa Funnel.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type ConnectionRunner = (args: string[]) => Promise<string>;
export class ConnectionError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const execute = promisify(execFile);
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/;
const settingsFile = (home: string) => path.join(home, ".kioku", "remote-host.json");
export function savedRemoteHost(home: string): string | null {
  try { const host = JSON.parse(readFileSync(settingsFile(home), "utf8")).host; return typeof host === "string" && HOST.test(host) ? host : null; }
  catch { return null; }
}

const runTailscale: ConnectionRunner = async (args) => {
  const candidates = process.platform === "darwin" ? ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"] : ["tailscale"];
  for (const bin of candidates) {
    try { return (await execute(bin, args, { timeout: 8000, maxBuffer: 1_048_576 })).stdout; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new ConnectionError(503, "Tailscale no responde o necesita autorización. Abre Tailscale, inicia sesión y habilita HTTPS en tu red privada."); }
  }
  throw new ConnectionError(503, "Instala Tailscale y abre la aplicación para iniciar sesión; Kioku no lo instala por su cuenta.");
};

function object(text: string): Record<string, any> {
  try { const value = JSON.parse(text); if (value && typeof value === "object" && !Array.isArray(value)) return value; } catch { /* fallar cerrado */ }
  throw new ConnectionError(503, "Tailscale no devolvió un estado válido");
}
function state(config: Record<string, any>, host: string, port: number): "empty" | "ours" | "conflict" {
  const tcp = config.TCP ?? {}, web = config.Web ?? {}, funnel = config.AllowFunnel ?? {};
  if (Object.values(funnel).some(Boolean) || Object.keys(config).some((key) => !["TCP", "Web", "AllowFunnel"].includes(key))) return "conflict";
  if (!Object.keys(tcp).length && !Object.keys(web).length) return "empty";
  const service = web[host + ":443"];
  if (Object.keys(tcp).length !== 1 || tcp["443"]?.HTTPS !== true || Object.keys(web).length !== 1 || !service) return "conflict";
  if (Object.keys(tcp["443"]).some((key) => key !== "HTTPS") || Object.keys(service).some((key) => key !== "Handlers")) return "conflict";
  const handlers = service.Handlers ?? {};
  const handler = handlers["/"];
  return Object.keys(handlers).length === 1 && handler && Object.keys(handler).length === 1 && handler.Proxy === `http://127.0.0.1:${port}` ? "ours" : "conflict";
}

export class PrivateConnection {
  private home: string;
  private run: ConnectionRunner;
  private busy = false;
  constructor(home: string, run: ConnectionRunner = runTailscale) { this.home = home; this.run = run; }
  private async inspect(port: number) {
    const status = object(await this.run(["status", "--json"]));
    const host = typeof status.Self?.DNSName === "string" ? status.Self.DNSName.replace(/\.$/, "").toLowerCase() : "";
    if (status.BackendState !== "Running" || !HOST.test(host)) throw new ConnectionError(503, "Abre Tailscale, inicia sesión en la misma cuenta que tus dispositivos y activa MagicDNS y HTTPS.");
    return { host, proxy: state(object(await this.run(["serve", "status", "--json"])), host, port) };
  }
  async status(port: number, allowedHosts: Set<string>) {
    try {
      const { host, proxy } = await this.inspect(port);
      const ready = proxy === "ours" && allowedHosts.has(host);
      return { connected: true, host, ready, canConfigure: proxy !== "conflict", publicOrigin: ready ? `https://${host}` : null, problem: proxy === "conflict" ? "Tailscale ya tiene otra publicación o Funnel: Kioku no la sobrescribe. Revísala en el ordenador." : null };
    } catch (e) {
      return { connected: false, host: null, ready: false, canConfigure: false, publicOrigin: null, problem: e instanceof ConnectionError ? e.message : "No se pudo comprobar Tailscale" };
    }
  }
  async configure(port: number) {
    if (this.busy) throw new ConnectionError(409, "Ya se está configurando el acceso privado");
    this.busy = true;
    try {
      const found = await this.inspect(port);
      if (found.proxy === "conflict") throw new ConnectionError(409, "Tailscale ya publica otro servicio o Funnel; no se modifica ni reinicia esa configuración.");
      if (found.proxy === "empty") {
        await this.run(["serve", "--bg", "--https=443", `http://127.0.0.1:${port}`]);
        const checked = await this.inspect(port);
        if (checked.host !== found.host || checked.proxy !== "ours") throw new ConnectionError(503, "No se pudo verificar el proxy privado; no se guarda el nombre como permitido.");
      }
      const file = settingsFile(this.home);
      mkdirSync(path.dirname(file), { recursive: true });
      const temp = file + "." + randomUUID() + ".tmp";
      writeFileSync(temp, JSON.stringify({ host: found.host }), { mode: 0o600, flag: "wx" });
      renameSync(temp, file);
      return found.host;
    } finally { this.busy = false; }
  }
}
