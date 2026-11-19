// Publicación privada de esta instancia. Nunca instala Tailscale, inicia sesión ni usa Funnel.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type ConnectionRunner = (args: string[]) => Promise<string>;
export type ConnectionProbeFetch = (input: string, init?: RequestInit) => Promise<Response>;
export interface ConnectionCheck {
  id: "installed" | "signed_in" | "magic_dns" | "https" | "proxy" | "allowed_host";
  label: string;
  ok: boolean;
  detail: string;
}
export interface ConnectionProbeResult {
  ok: boolean;
  origin: string | null;
  ms?: number;
  reason?: "not-ready" | "http-error" | "timeout" | "tls" | "network";
  status?: number;
  detail: string;
}
export class ConnectionError extends Error {
  status: number;
  kind?: "missing" | "auth" | "stopped" | "dns" | "https" | "operator" | "other";
  constructor(status: number, message: string, kind?: ConnectionError["kind"]) { super(message); this.status = status; this.kind = kind; }
}
const execute = promisify(execFile);
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/;
const settingsFile = (home: string) => path.join(home, ".kioku", "remote-host.json");
export function savedRemoteHost(home: string): string | null {
  try { const host = JSON.parse(readFileSync(settingsFile(home), "utf8")).host; return typeof host === "string" && HOST.test(host) ? host : null; }
  catch { return null; }
}

function tailscaleError(e: unknown): ConnectionError {
  if (e instanceof ConnectionError) return e;
  const err = e as { stderr?: unknown; message?: unknown };
  const detail = `${typeof err?.stderr === "string" ? err.stderr : ""} ${typeof err?.message === "string" ? err.message : ""}`;
  if (/access denied|operator/i.test(detail)) {
    return new ConnectionError(503, "Tailscale necesita permiso para este usuario. En Linux ejecuta una vez: sudo tailscale set --operator=$USER", "operator");
  }
  return new ConnectionError(503, "Tailscale no responde o necesita autorización. Abre Tailscale, inicia sesión y habilita HTTPS en tu red privada.", "other");
}

const runTailscale: ConnectionRunner = async (args) => {
  const candidates = process.platform === "darwin" ? ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"] : ["tailscale"];
  for (const bin of candidates) {
    try { return (await execute(bin, args, { timeout: 8000, maxBuffer: 1_048_576 })).stdout; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw tailscaleError(e); }
  }
  throw new ConnectionError(503, "Instala Tailscale y abre la aplicación para iniciar sesión; Kioku no lo instala por su cuenta.", "missing");
};

function object(text: string): Record<string, any> {
  try { const value = JSON.parse(text); if (value && typeof value === "object" && !Array.isArray(value)) return value; } catch { /* fallar cerrado */ }
  throw new ConnectionError(503, "Tailscale no devolvió un estado válido", "other");
}
// Solo cuenta el HTTPS 443 de este equipo: otras publicaciones del usuario (8443, otros servicios, Funnel en otros
// puertos) no son de Kioku y no se tocan ni bloquean. Kioku nunca se publica con Funnel.
function state(config: Record<string, any>, host: string, port: number): "empty" | "ours" | "conflict" {
  const tcp = config.TCP?.["443"], service = config.Web?.[host + ":443"], funnel = config.AllowFunnel?.[host + ":443"];
  if (funnel) return "conflict";
  if (!tcp && !service) return "empty";
  if (!tcp || !service || tcp.HTTPS !== true || Object.keys(tcp).some((key) => key !== "HTTPS") || Object.keys(service).some((key) => key !== "Handlers")) return "conflict";
  const handlers = service.Handlers ?? {};
  const handler = handlers["/"];
  return Object.keys(handlers).length === 1 && handler && Object.keys(handler).length === 1 && handler.Proxy === `http://127.0.0.1:${port}` ? "ours" : "conflict";
}

function buildChecks(o: {
  installed: boolean;
  signedIn: boolean;
  signedInDetail?: string;
  magicDns: boolean;
  magicDnsDetail?: string;
  https: boolean;
  httpsDetail?: string;
  proxy: "empty" | "ours" | "conflict" | "unknown";
  allowedHost: boolean;
  host: string | null;
}): ConnectionCheck[] {
  return [
    {
      id: "installed",
      label: "Tailscale instalado",
      ok: o.installed,
      detail: o.installed ? "Tailscale detectado en este ordenador." : "Descarga e instala Tailscale y ábrelo.",
    },
    {
      id: "signed_in",
      label: "Sesión iniciada en Tailscale",
      ok: o.signedIn,
      detail: o.signedIn ? "Tailscale está conectado." : (o.signedInDetail ?? "Abre la app Tailscale e inicia sesión con la misma cuenta que tus otros dispositivos."),
    },
    {
      id: "magic_dns",
      label: "MagicDNS activo",
      ok: o.magicDns,
      detail: o.magicDns ? (o.host ? `Nombre privado: ${o.host}` : "MagicDNS activo.") : (o.magicDnsDetail ?? "Activa MagicDNS en los ajustes DNS de tu cuenta de Tailscale."),
    },
    {
      id: "https",
      label: "Certificados HTTPS activos",
      ok: o.https,
      detail: o.https ? "Tailscale puede emitir certificado HTTPS privado." : (o.httpsDetail ?? "Activa HTTPS Certificates en los ajustes DNS de tu cuenta de Tailscale."),
    },
    {
      id: "proxy",
      label: "Acceso privado de Kioku (Tailscale Serve)",
      ok: o.proxy === "ours",
      detail: o.proxy === "ours"
        ? "Publicación privada activa en tu red Tailscale (sin puertos públicos ni Funnel)."
        : o.proxy === "conflict"
          ? "El HTTPS 443 de Tailscale ya lo usa otro servicio o Funnel; Kioku no lo sobrescribe."
          : o.proxy === "empty"
            ? "Falta pulsar «Activar acceso privado» para conectar Kioku a Tailscale."
            : "Completa los pasos anteriores de Tailscale y vuelve a comprobar.",
    },
    {
      id: "allowed_host",
      label: "Nombre privado autorizado en Kioku",
      ok: o.allowedHost,
      detail: o.allowedHost && o.host
        ? `Kioku acepta peticiones privadas para ${o.host}.`
        : "Pulsa «Activar acceso privado» para autorizar este ordenador en Kioku.",
    },
  ];
}

export class PrivateConnection {
  private home: string;
  private run: ConnectionRunner;
  private busy = false;
  constructor(home: string, run: ConnectionRunner = runTailscale) { this.home = home; this.run = run; }
  private async inspectRaw(port: number) {
    const status = object(await this.run(["status", "--json"]));
    const backend = typeof status.BackendState === "string" ? status.BackendState : "";
    const host = typeof status.Self?.DNSName === "string" ? status.Self.DNSName.replace(/\.$/, "").toLowerCase() : "";
    const magicDnsExplicitlyOff = status.CurrentTailnet?.MagicDNSEnabled === false;
    const certDomains = Array.isArray(status.CertDomains)
      ? status.CertDomains.filter((d: unknown): d is string => typeof d === "string").map((d: string) => d.replace(/\.$/, "").toLowerCase())
      : null;
    if (backend !== "Running") {
      const needsLogin = backend === "NeedsLogin" || backend === "NeedsMachineAuth";
      const detail = needsLogin
        ? "Abre Tailscale e inicia sesión con la misma cuenta que tus dispositivos."
        : "Abre Tailscale y actívalo para conectar este ordenador a tu red privada.";
      return {
        ok: false as const,
        host: null,
        proxy: "unknown" as const,
        httpsOk: false,
        problem: "Abre Tailscale, inicia sesión en la misma cuenta que tus dispositivos y activa MagicDNS y HTTPS.",
        checks: buildChecks({ installed: true, signedIn: false, signedInDetail: detail, magicDns: false, https: false, proxy: "unknown", allowedHost: false, host: null }),
      };
    }
    if (magicDnsExplicitlyOff || !HOST.test(host)) {
      return {
        ok: false as const,
        host: null,
        proxy: "unknown" as const,
        httpsOk: false,
        problem: "Activa MagicDNS y los certificados HTTPS en tu cuenta de Tailscale y vuelve a comprobar.",
        checks: buildChecks({ installed: true, signedIn: true, magicDns: false, https: false, proxy: "unknown", allowedHost: false, host: null }),
      };
    }
    const httpsOk = certDomains === null || certDomains.includes(host);
    const proxy = state(object(await this.run(["serve", "status", "--json"])), host, port);
    return { ok: true as const, host, proxy, httpsOk, problem: httpsOk ? null : "Activa los certificados HTTPS en el panel DNS de Tailscale y vuelve a comprobar.", checks: null };
  }
  private async inspect(port: number) {
    const r = await this.inspectRaw(port);
    if (!r.ok) throw new ConnectionError(503, r.problem);
    if (!r.httpsOk) throw new ConnectionError(503, r.problem ?? "Activa HTTPS en tu cuenta de Tailscale.", "https");
    return { host: r.host, proxy: r.proxy };
  }
  async status(port: number, allowedHosts: Set<string>) {
    try {
      const r = await this.inspectRaw(port);
      if (!r.ok) {
        return { connected: false, host: null, ready: false, canConfigure: false, publicOrigin: null, problem: r.problem, checks: r.checks };
      }
      const allowedHost = allowedHosts.has(r.host);
      const ready = r.httpsOk && r.proxy === "ours" && allowedHost;
      const problem = !r.httpsOk
        ? r.problem
        : r.proxy === "conflict"
          ? "El HTTPS 443 de Tailscale ya lo usa otro servicio (o Funnel): Kioku no lo sobrescribe. Libéralo en el ordenador o publica ese servicio en otro puerto."
          : null;
      return {
        connected: true,
        host: r.host,
        ready,
        canConfigure: r.httpsOk && r.proxy !== "conflict",
        publicOrigin: ready ? `https://${r.host}` : null,
        problem,
        checks: buildChecks({ installed: true, signedIn: true, magicDns: true, https: r.httpsOk, proxy: r.proxy, allowedHost, host: r.host }),
      };
    } catch (e) {
      const err = e instanceof ConnectionError ? e : null;
      const missing = err?.kind === "missing";
      return {
        connected: false,
        host: null,
        ready: false,
        canConfigure: false,
        publicOrigin: null,
        problem: err ? err.message : "No se pudo comprobar Tailscale",
        checks: buildChecks({ installed: !missing, signedIn: false, magicDns: false, https: false, proxy: "unknown", allowedHost: false, host: null }),
      };
    }
  }
  async configure(port: number) {
    if (this.busy) throw new ConnectionError(409, "Ya se está configurando el acceso privado");
    this.busy = true;
    try {
      const found = await this.inspect(port);
      if (found.proxy === "conflict") throw new ConnectionError(409, "El HTTPS 443 de Tailscale ya lo usa otro servicio (o Funnel); Kioku no lo modifica.");
      if (found.proxy === "empty") {
        try { await this.run(["serve", "--bg", "--https=443", `http://127.0.0.1:${port}`]); }
        catch (e) { throw tailscaleError(e); }
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
  async probe(port: number, allowedHosts: Set<string>, fetchFn: ConnectionProbeFetch = fetch): Promise<ConnectionProbeResult> {
    const st = await this.status(port, allowedHosts);
    if (!st.ready || !st.host || !HOST.test(st.host)) {
      return {
        ok: false,
        origin: st.publicOrigin,
        reason: "not-ready",
        detail: st.problem ?? "Primero completa Tailscale y pulsa «Activar acceso privado».",
      };
    }
    const origin = `https://${st.host}`;
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, 5000);
    const t0 = Date.now();
    try {
      const r = await fetchFn(`${origin}/api/health`, { method: "GET", cache: "no-store", redirect: "error", signal: ctl.signal });
      const body = (await r.json().catch(() => null)) as { ok?: unknown } | null;
      const ms = Math.max(0, Date.now() - t0);
      if (r.ok && body?.ok === true) {
        return {
          ok: true,
          origin,
          ms,
          detail: `El acceso privado respondió en ${ms} ms desde este ordenador. Para confirmar del todo tu otro dispositivo, abre el QR o el enlace desde él con Tailscale activo.`,
        };
      }
      return {
        ok: false,
        origin,
        reason: "http-error",
        status: r.status,
        detail: `El acceso privado devolvió HTTP ${r.status}. Comprueba Tailscale y vuelve a pulsar «Activar acceso privado».`,
      };
    } catch (e) {
      if (timedOut) {
        return { ok: false, origin, reason: "timeout", detail: "La comprobación tardó demasiado. Comprueba que Tailscale esté conectado en este ordenador y vuelve a intentarlo." };
      }
      const msg = `${(e as Error)?.message ?? ""} ${((e as { cause?: Error })?.cause?.message) ?? ""}`;
      if (/cert|tls|ssl|handshake|self[-_ ]signed|unable[-_ ]to[-_ ]verify/i.test(msg)) {
        return { ok: false, origin, reason: "tls", detail: "El certificado HTTPS privado aún no respondió bien. Espera unos segundos (Tailscale puede estar emitiéndolo) y vuelve a comprobar." };
      }
      return { ok: false, origin, reason: "network", detail: "No se pudo alcanzar la dirección privada de Tailscale desde este ordenador. Comprueba que Tailscale esté activo y vuelve a intentarlo." };
    } finally {
      clearTimeout(timer);
    }
  }
}
