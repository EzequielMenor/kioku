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

/** Lector de respaldo para GET cuando no hay red (réplica local). `null` lo quita. */
export function setOfflineReader(fn: OfflineReader | null): void { offlineReader = fn; }

export async function api<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
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

/** Suscripción a cambios del vault (SSE) con reconexión. */
export function onChange(cb: (e: ChangeEvent) => void): () => void {
  let es: EventSource | null = null;
  let closed = false;
  const open = () => {
    es = new EventSource("/api/events");
    es.onmessage = (m) => { try { cb(JSON.parse(m.data)); } catch { /* ignorar */ } };
    es.onerror = () => { es?.close(); if (!closed) setTimeout(open, 1500); };
  };
  open();
  return () => { closed = true; es?.close(); };
}

export function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ }
}
