// Read-only onboarding: never starts a daemon, creates credentials or configures Tailscale.
import { spawnSync } from "node:child_process";
import { request } from "node:http";
import { readRuntime } from "./desktop.ts";
import { tailscaleHost } from "./pair.ts";

type Check = { name: string; ok: boolean; detail: string };
interface Json {
  BackendState?: unknown;
  TCP?: Record<string, { HTTPS?: unknown }>;
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: unknown }> }>;
  AllowFunnel?: unknown;
}

function tailscaleJson(args: string[]): Json | null {
  const r = spawnSync("tailscale", args, { encoding: "utf8", timeout: 2000, maxBuffer: 256 * 1024 });
  if (r.error || r.status !== 0) return null;
  try {
    const data: unknown = JSON.parse(r.stdout);
    return data && typeof data === "object" && !Array.isArray(data) ? data as Json : null;
  } catch { return null; }
}

/** Check the live Host gate locally; do not trust the invoking shell's environment. */
async function health(port: number, host?: string): Promise<boolean> {
  return new Promise(resolve => {
    const req = request({ hostname: "127.0.0.1", port, path: "/api/health", headers: host ? { host } : undefined }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
      res.on("end", () => {
        try { resolve(res.statusCode === 200 && JSON.parse(body).ok === true); }
        catch { resolve(false); }
      });
      res.on("error", () => resolve(false));
    });
    const timer = setTimeout(() => req.destroy(new Error("Timeout")), 1500);
    req.on("close", () => clearTimeout(timer));
    req.on("error", () => resolve(false));
    req.end();
  });
}

function validPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535;
}

export async function connectionReport(home: string): Promise<{ checks: Check[]; port: number; host: string | null }> {
  const rt = readRuntime(home);
  const port = validPort(rt?.port) ? rt.port : 47800;
  const alive = !!rt && validPort(rt.port) && await health(port);
  const status = tailscaleJson(["status", "--json"]);
  const candidate = status ? tailscaleHost(JSON.stringify(status))?.toLowerCase() : null;
  // Strict DNS validation keeps both HTTP headers and displayed shell commands safe.
  const host = candidate && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/.test(candidate) ? candidate : null;
  const running = status?.BackendState === "Running" && !!host;
  const serve = tailscaleJson(["serve", "status", "--json"]);
  const web = host ? serve?.Web?.[`${host}:443`] : undefined;
  const proxy = web?.Handlers?.["/"]?.Proxy;
  const funnel = serve?.AllowFunnel;
  const privateOnly = funnel === undefined || (funnel !== null && typeof funnel === "object" &&
    !Array.isArray(funnel) && Object.values(funnel).every(value => value === false));
  const served = running && serve?.TCP?.["443"]?.HTTPS === true &&
    proxy === `http://127.0.0.1:${port}` && privateOnly;
  const accepted = alive && !!host && await health(port, host);
  return { port, host, checks: [
    { name: "Kioku", ok: alive, detail: alive ? `responde en 127.0.0.1:${port}` : "no responde; ejecuta kioku open (Mac con Docker: ./scripts/kioku-local.sh open)" },
    { name: "Tailscale", ok: running, detail: running ? host! : "instálalo e inicia sesión en este equipo y en el móvil; activa MagicDNS y HTTPS" },
    { name: "Nombre aceptado", ok: accepted, detail: accepted ? "el daemon en ejecución acepta el nombre privado" : host ? `reinicia Kioku con KIOKU_ALLOWED_HOSTS=${host}; en Linux reinstala el servicio con esa variable si lo usas` : "primero conecta Tailscale para conocer el nombre DNS" },
    { name: "HTTPS privado", ok: !!served, detail: served ? `proxy privado configurado hacia el puerto ${port}` : `revisa tailscale serve status; sin Funnel ni puertos públicos. Configuración manual: tailscale serve --bg http://127.0.0.1:${port}` },
  ] };
}

export async function doctorReport(home: string): Promise<{ lines: string[]; ok: boolean }> {
  const report = await connectionReport(home);
  return {
    ok: report.checks.every(c => c.ok),
    lines: ["Conexión privada · diagnóstico de solo lectura", ...report.checks.map(c => `${c.ok ? "OK" : "NO"} · ${c.name}: ${c.detail}`),
      "No comprueba el acceso desde otro dispositivo, sus permisos en Tailscale ni la instalación de la app.",
      "Si todo está correcto: kioku pair. Su enlace contiene una clave: no lo compartas.",
      "El ordenador debe permanecer encendido, sin suspensión y con Kioku y Tailscale activos."],
  };
}

export function setupGuide(): string[] {
  return [
    "Kioku · Tu ordenador como centro",
    "Esta guía no instala programas, cambia tu red ni genera claves. Ejecuta tú los pasos que correspondan.",
    "1. Instala Kioku desde el repositorio: Node.js 24 o superior, npm install y npm run build:web. Abre con bin/kioku open (o kioku open si ya está en tu PATH).",
    "   Mac con Docker Desktop: abre Kioku.command o ejecuta ./scripts/kioku-local.sh open. Ese acceso es solo local; el contenedor no incluye Tailscale.",
    "2. Linux: para arrancar con tu sesión puedes ejecutar kioku service install. No evita la suspensión ni garantiza seguir activo tras cerrar sesión.",
    "3. Instala Tailscale en el ordenador y en cada dispositivo con la misma cuenta. Activa MagicDNS y HTTPS en tu tailnet; mantén el acceso privado, sin Funnel ni puertos públicos.",
    "4. Ejecuta kioku doctor: muestra el puerto real y el nombre DNS, comprueba el proxy y si el daemon acepta ese nombre. Sigue sus indicaciones y repítelo tras reiniciar Kioku.",
    "   Configura KIOKU_ALLOWED_HOSTS con ese nombre antes de arrancar Kioku. En Linux, kioku service install conserva la variable; en Docker debes configurarla en Compose y recrear juntos los servicios según docs/connections.md.",
    '5. Antes de emparejar, marca carpetas privadas en .kioku/mobile.json: {"exclude":["Privado/"]}. Luego ejecuta kioku pair y abre su enlace solo en tu dispositivo.',
    "6. iPhone/iPad: Safari → Compartir → Añadir a pantalla de inicio. Android: Chrome → menú → Instalar aplicación o Añadir a pantalla de inicio. Abre siempre el mismo origen privado para conservar la cola local.",
    "7. En Kioku abre Conexiones y sincronización. Comprueba el acceso desde otro dispositivo y prueba una captura sin red; vuelve a abrir con red para enviarla.",
    "El ordenador debe estar encendido, sin suspensión. No hay sincronización móvil garantizada en segundo plano; notas, capturas y tareas usan la cola existente, calendario y asistente requieren red.",
    "Para revocar la clave móvil compartida: kioku pair --revoke (desconecta TODOS los móviles). No borra lo que ya descargaron. Para volver a conectar, ejecuta kioku pair otra vez.",
    "Guía completa y Mac/Docker: docs/connections.md",
  ];
}
