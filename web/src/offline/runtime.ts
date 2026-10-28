// Pegamento de la capa offline del móvil: abre el almacén local, sincroniza la réplica, envía la cola de
// capturas y expone el estado a la interfaz. La lógica con reglas propias vive en replica/queue/capture.
import { useEffect, useState } from "preact/hooks";
import { ApiError, UNAUTHORIZED_EVENT, api, onChange, setOfflineReader } from "../api.ts";
import { isMobile } from "../role.ts";
import type { CaptureResult, ResumeCard } from "../types.ts";
import { isRetryable, submitCapture } from "./capture.ts";
import { openIdbStore } from "./idb-store.ts";
import { CaptureQueue, SendError, backoffMs } from "./queue.ts";
import { makeOfflineReader } from "./reader.ts";
import { syncReplica } from "./replica.ts";
import { MemoryStore, type QueuedCapture, type Store } from "./store.ts";

export interface OfflineState { online: boolean; pending: number; failed: number; lastSync: number | null; syncing: boolean }

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** «ahora», «hace 5 min», «hace 2 h», «hace 3 d». Un instante futuro (reloj desajustado) se lee «ahora». */
export function formatAgo(from: number, now: number): string {
  const d = now - from;
  if (d < MIN) return "ahora";
  if (d < HOUR) return `hace ${Math.floor(d / MIN)} min`;
  if (d < DAY) return `hace ${Math.floor(d / HOUR)} h`;
  return `hace ${Math.floor(d / DAY)} d`;
}

// ───────────── estado observable ─────────────

let state: OfflineState = { online: typeof navigator === "undefined" || navigator.onLine !== false, pending: 0, failed: 0, lastSync: null, syncing: false };
const listeners = new Set<() => void>();
function set(patch: Partial<OfflineState>): void {
  state = { ...state, ...patch };
  for (const f of listeners) f();
}

export function useOffline(): OfflineState {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return state;
}

// ───────────── almacén y cola ─────────────

interface Ready { store: Store; queue: CaptureQueue }
let ready: Promise<Ready> | null = null;

/** Abre IndexedDB una sola vez; si el navegador no la ofrece (modo privado…) se trabaja en memoria. */
function ensure(): Promise<Ready> {
  ready ??= (async () => {
    const store = await openIdbStore().catch(() => new MemoryStore());
    return { store, queue: new CaptureQueue(store) };
  })();
  return ready;
}

async function refresh(): Promise<void> {
  const { store, queue } = await ensure();
  const list = await queue.list();
  set({
    pending: list.filter((c) => c.state === "pending").length,
    failed: list.filter((c) => c.state === "failed").length,
    lastSync: (await store.getMeta<number>("lastSync")) ?? null,
  });
}

export async function loadQueue(): Promise<QueuedCapture[]> { return (await ensure()).queue.list(); }
export async function retryCapture(opId: string): Promise<void> { await (await ensure()).queue.retry(opId); await refresh(); void flushQueue(); }
export async function discardCapture(opId: string): Promise<void> { await (await ensure()).queue.discard(opId); await refresh(); }

const postCapture = (text: string, opId: string) => api<CaptureResult>("POST", "/api/capture", { text }, { "x-kioku-op": opId });

let attempt = 0;
let retryTimer = 0;
const scheduleRetry = () => { clearTimeout(retryTimer); retryTimer = window.setTimeout(() => void flushQueue(), backoffMs(attempt++)); };

/** Envía las capturas pendientes por orden; si el envío se corta, vuelve a intentarlo con espera creciente. */
async function flushQueue(): Promise<void> {
  const { queue } = await ensure();
  clearTimeout(retryTimer);
  const r = await queue.flush(async (c) => {
    try { await postCapture(c.text, c.opId); set({ online: true }); }
    catch (e) {
      if (!(e instanceof ApiError)) set({ online: false });
      throw new SendError(e instanceof Error ? e.message : String(e), isRetryable(e));
    }
  });
  await refresh();
  if (r.stopped) scheduleRetry(); else attempt = 0;
}

/** Captura desde el móvil: se envía con su `opId`; sin red o con el servidor ocupado queda en la cola. */
export async function submit(text: string) {
  const { queue } = await ensure();
  const r = await submitCapture({ post: postCapture, queue, newId: () => crypto.randomUUID() }, text);
  if (r.sent) set({ online: true }); else scheduleRetry();
  await refresh();
  return r;
}

// ───────────── sincronización ─────────────

const WARM = ["/api/focus", "/api/today", "/api/tasks", "/api/projects", "/api/inbox", "/api/notes", "/api/graph?max=400"];

/** En la primera visita el worker se activa después de cargar la página: hasta que la controla no guarda nada. */
async function swControlsPage(): Promise<void> {
  const container = navigator.serviceWorker;
  if (!container) return;
  await container.ready.catch(() => undefined);
  if (container.controller) return;
  await new Promise<void>((done) => {
    const timer = window.setTimeout(done, 3000);
    container.addEventListener("controllerchange", () => { clearTimeout(timer); done(); }, { once: true });
  });
}

/** Recorre las pantallas principales para que el service worker tenga su última respuesta guardada. */
async function warm(): Promise<void> {
  await swControlsPage(); // la primera vez, esperar a que el service worker pueda guardarlas
  const ok = (p: string) => api<unknown>("GET", p).catch(() => undefined);
  const results = await Promise.all(WARM.map(ok));
  const projects = results[WARM.indexOf("/api/projects")] as ResumeCard[] | undefined;
  await Promise.all((projects ?? []).map((c) => ok(`/api/project?path=${encodeURIComponent(c.project.path)}`)));
}

export async function syncNow(): Promise<void> {
  if (state.syncing) return;
  const { store } = await ensure();
  set({ syncing: true });
  try {
    const r = await syncReplica(store, (p) => api("GET", p));
    set({ lastSync: r.at, online: true });
    await warm();
  } catch (e) {
    if (!(e instanceof ApiError)) set({ online: false });
  } finally {
    set({ syncing: false });
  }
}

const cycle = async () => { await flushQueue(); await syncNow(); };

/** Vacía la réplica y las lecturas guardadas (clave revocada o inválida). Las capturas aún sin enviar se conservan. */
export async function wipeOffline(): Promise<void> {
  clearTimeout(retryTimer);
  await caches.delete("kioku-api").catch(() => false);
  if (!ready && !isMobile()) return;
  const { store, queue } = await ensure();
  const pending = await queue.list();
  await store.clear();
  for (const c of pending) await store.putCapture(c);
  await refresh();
}

let started = false;

/** Solo en el móvil: service worker, almacenamiento persistente, lector offline y ciclos de envío y sincronización. */
export function startOffline(): void {
  if (started || !isMobile()) return;
  started = true;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  void navigator.storage?.persist?.().catch(() => {});
  // El worker sirve la copia cuando no hay servidor y la página no ve el fallo: él nos avisa (ver sw.ts).
  navigator.serviceWorker?.addEventListener("message", (e: MessageEvent) => {
    if (e.data?.kioku === "net") set({ online: !!e.data.online });
  });
  navigator.serviceWorker?.startMessages?.();
  void ensure().then(async ({ store }) => {
    setOfflineReader(makeOfflineReader(store));
    await refresh();
    addEventListener("online", () => { set({ online: true }); void cycle(); });
    addEventListener("offline", () => set({ online: false }));
    let timer = 0;
    onChange(() => { clearTimeout(timer); timer = window.setTimeout(() => void syncNow(), 2000); });
    await cycle();
  });
}
