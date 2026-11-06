export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Se dispara cuando el daemon rechaza la petición por falta de clave (la página no se abrió con `kioku open`). */
export const UNAUTHORIZED_EVENT = "kioku:unauthorized";

type OfflineReader = (path: string) => Promise<unknown | undefined>;
let offlineReader: OfflineReader | null = null;

type DemoApiHandler = <T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown) => Promise<T>;
type DemoEventSubscriber = (cb: (e: ChangeEvent) => void) => () => void;
let demoApiHandler: DemoApiHandler | null = null;
let demoEventSubscriber: DemoEventSubscriber | null = null;
const activeChangeCallbacks = new Set<(e: ChangeEvent) => void>();
const activeEventSources = new Set<EventSource>();
let demoUnsubscribe: (() => void) | null = null;

/** Lector de respaldo para GET cuando no hay red (réplica local). `null` lo quita. */
export function setOfflineReader(fn: OfflineReader | null): void { offlineReader = fn; }

/** Conecta o desconecta el motor de demostración en el navegador (Vercel / portfolio). */
export function setDemoTransport(apiFn: DemoApiHandler | null, eventFn: DemoEventSubscriber | null = null): void {
  demoApiHandler = apiFn;
  demoEventSubscriber = eventFn;
  demoUnsubscribe?.();
  demoUnsubscribe = null;
  if (apiFn) {
    for (const es of activeEventSources) es.close();
    activeEventSources.clear();
  }
  if (eventFn) {
    demoUnsubscribe = eventFn((ev) => {
      for (const cb of activeChangeCallbacks) {
        try { cb(ev); } catch { /* ignorar */ }
      }
    });
  }
}

export async function api<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  if (demoApiHandler) return demoApiHandler<T>(method, path, body);
  // El daemon exige JSON en toda escritura: un POST sin datos (aplicar propuesta…) envía `{}`.
  const payload = method === "GET" ? undefined : JSON.stringify(body ?? {});
  let r: Response;
  try {
    r = await fetch(path, {
      method,
      headers: payload === undefined && !headers ? undefined : { ...(payload === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: payload,
    });
  } catch (e) {
    // Sin red: las lecturas pueden salir de la réplica local; las escrituras nunca.
    if (method === "GET" && offlineReader) {
      const local = await offlineReader(path).catch(() => undefined);
      if (local !== undefined) return local as T;
    }
    throw e;
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(r.status, data.error ?? `Error ${r.status}`, data.code);
  }
  return data as T;
}

export interface ChangeEvent { kind: string; path?: string | null; route?: string; tool?: string; level?: string }

/** Suscripción a cambios del vault (SSE) con reconexión, o en memoria en modo Demo. */
export function onChange(cb: (e: ChangeEvent) => void): () => void {
  activeChangeCallbacks.add(cb);
  if (demoEventSubscriber || typeof EventSource === "undefined") {
    return () => { activeChangeCallbacks.delete(cb); };
  }
  let es: EventSource | null = null;
  let closed = false;
  const open = () => {
    if (demoEventSubscriber || closed) return;
    es = new EventSource("/api/events");
    activeEventSources.add(es);
    es.onmessage = (m) => { try { cb(JSON.parse(m.data)); } catch { /* ignorar */ } };
    es.onerror = () => {
      if (es) activeEventSources.delete(es);
      es?.close();
      if (!closed && !demoEventSubscriber) setTimeout(open, 1500);
    };
  };
  open();
  return () => {
    closed = true;
    activeChangeCallbacks.delete(cb);
    if (es) activeEventSources.delete(es);
    es?.close();
  };
}

export function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ }
}
