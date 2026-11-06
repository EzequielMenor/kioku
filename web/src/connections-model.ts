// Panel de conexión: sondeo de salud, textos del estado y guía de instalación. Sin DOM ni red propia: `fetch` se inyecta.

export const HEALTH_PATH = "/api/health";
export const HEALTH_TIMEOUT_MS = 5000;

export const DEMO_NOTICE = "Simulación: esto es una demostración en el navegador. No hay ningún ordenador ni conexión real, y no se comprueba ninguna red.";

export type HealthState =
  | { state: "checking" }
  | { state: "simulated" }
  | { state: "ok"; ms: number }
  | { state: "unreachable"; reason: "network" | "timeout" }
  | { state: "error"; status: number };

/** Origen que se puede mostrar: solo esquema y host, sin usuario, ruta, consulta (`?k=`) ni fragmento. */
export function safeOrigin(l: { protocol: string; host: string }): string {
  if (l.protocol !== "http:" && l.protocol !== "https:") return "";
  const host = l.host.slice(l.host.lastIndexOf("@") + 1);
  return host ? `${l.protocol}//${host}` : "";
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** GET /api/health solo por red (sin caché ni respaldo offline), con tiempo máximo. Nunca lanza. */
export async function probeHealth(
  fetchFn: Fetch,
  opts: { timeoutMs?: number; now?: () => number } = {},
): Promise<Exclude<HealthState, { state: "checking" | "simulated" }>> {
  const now = opts.now ?? Date.now;
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, opts.timeoutMs ?? HEALTH_TIMEOUT_MS);
  const t0 = now();
  try {
    const r = await fetchFn(HEALTH_PATH, { method: "GET", cache: "no-store", signal: ctl.signal });
    const body = (await r.json().catch(() => null)) as { ok?: unknown } | null;
    return r.ok && body?.ok === true ? { state: "ok", ms: now() - t0 } : { state: "error", status: r.status };
  } catch {
    return { state: "unreachable", reason: timedOut ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

export interface HealthView { tone: "ok" | "bad" | "wait" | "demo"; title: string; detail: string }

export function describeHealth(h: HealthState): HealthView {
  switch (h.state) {
    case "checking": return { tone: "wait", title: "Comprobando…", detail: "Preguntando a Kioku si responde." };
    case "simulated": return { tone: "demo", title: "Simulación: sin conexión real", detail: DEMO_NOTICE };
    case "ok": return { tone: "ok", title: "Kioku responde", detail: `El ordenador contestó en ${h.ms} ms. Que responda ahora no garantiza que siga encendido más tarde.` };
    case "error": return { tone: "bad", title: "Kioku respondió con un error", detail: `El servidor devolvió ${h.status} en lugar de «todo bien». El ordenador se alcanza, pero Kioku o su proxy no están sanos: ejecuta kioku doctor en él.` };
    case "unreachable": return {
      tone: "bad",
      title: "No se pudo llegar a Kioku",
      detail: `${h.reason === "timeout" ? "La respuesta tardó demasiado." : "La petición falló."} Puede que el ordenador esté dormido o apagado, o que este dispositivo no tenga red o Tailscale activo: desde aquí no se puede distinguir. Comprueba ambos y reintenta.`,
    };
  }
}

export interface GuideItem { text: string; command?: string }
export interface GuideSection { title: string; items: GuideItem[] }

const HOW_IT_WORKS: GuideSection = {
  title: "Cómo funciona",
  items: [
    { text: "Tu ordenador es el centro: las notas viven en él y el móvil las lee y las envía a través de él." },
    { text: "El ordenador debe estar encendido y despierto, con Kioku en marcha. Si está dormido o apagado, el móvil no conecta." },
    { text: "Tailscale debe estar instalado y con sesión iniciada en ambos dispositivos, el ordenador y el móvil, en la misma tailnet." },
    { text: "No hay sincronización garantizada en segundo plano: los cambios se envían al abrir Kioku con red, no cuando la app está cerrada." },
    { text: "El móvil usa una única clave compartida. Revocarla desempareja todos los dispositivos a la vez; no se gestiona cada uno por separado. No es un borrado remoto: los datos descargados pueden permanecer en el teléfono." },
  ],
};

const DESKTOP: GuideSection[] = [
  {
    title: "En el ordenador",
    items: [
      { text: "Guía de instalación y emparejado paso a paso (no cambia tu red ni tus archivos):", command: "kioku setup" },
      { text: "Diagnóstico de lo que falta o falla (daemon, Tailscale, host permitido):", command: "kioku doctor" },
      { text: "Da la URL de emparejamiento del móvil con su clave limitada. Ábrela solo en tu teléfono y no la compartas:", command: "kioku pair" },
      { text: "Revoca la clave del móvil; todos los dispositivos emparejados tendrán que volver a emparejarse:", command: "kioku pair --revoke" },
    ],
  },
  {
    title: "Arranque según el sistema",
    items: [
      { text: "Mac: abre Kioku.command con doble clic, o desde la terminal:", command: "./scripts/kioku-local.sh open" },
      { text: "Linux: el servicio de usuario es opcional y arranca con tu sesión; no evita que el ordenador duerma ni garantiza seguir tras cerrar sesión:", command: "kioku service install" },
    ],
  },
];

const MOBILE: GuideSection[] = [
  {
    title: "Instalar en el móvil",
    items: [
      { text: "iPhone o iPad (Safari): toca Compartir y elige «Añadir a pantalla de inicio». Abre Kioku desde ese icono y pega la clave: la app instalada no comparte la cookie de Safari." },
      { text: "Android (Chrome): menú ⋮ y «Instalar aplicación» o «Añadir a pantalla de inicio»." },
    ],
  },
  {
    title: "Si pierdes la conexión",
    items: [
      { text: "En el ordenador, ejecuta el diagnóstico y, si hace falta, vuelve a emparejar:", command: "kioku doctor" },
      { text: "Para emparejar de nuevo, genera la URL y ábrela en este teléfono:", command: "kioku pair" },
    ],
  },
];

/** Guía de conexión: la del ordenador (órdenes) o la del móvil (instalar la PWA y recuperar el acceso). */
export function connectionGuide(mobile: boolean): GuideSection[] {
  return [HOW_IT_WORKS, ...(mobile ? MOBILE : DESKTOP)];
}
