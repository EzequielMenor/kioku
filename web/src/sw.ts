// Service worker de la PWA: shell versionado por build y respaldo de lecturas de /api sin red.
import { API_CACHE, READ_TIMEOUT_MS, cacheableRead, isShell, shellCacheName } from "./sw-rules.ts";

// esbuild los sustituye en el build (scripts/build-web.mjs).
declare const __BUILD_ID__: string;
declare const __PRECACHE__: string[];

// Tipos mínimos: el proyecto compila con la librería DOM, no con la de workers.
interface ExtEvent { waitUntil(p: Promise<unknown>): void }
interface FetchEv { request: Request; respondWith(r: Promise<Response>): void }
interface SwScope {
  addEventListener(type: string, fn: (e: never) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; matchAll(o: { type: "window" }): Promise<{ postMessage(m: unknown): void }[]> };
  location: { origin: string };
}
const sw = self as unknown as SwScope;
const SHELL = shellCacheName(__BUILD_ID__);

sw.addEventListener("install", ((e: ExtEvent) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(__PRECACHE__);
    await sw.skipWaiting();
  })());
}) as (e: never) => void);

sw.addEventListener("activate", ((e: ExtEvent) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("kioku-shell-") && k !== SHELL) await caches.delete(k);
    await sw.clients.claim();
  })());
}) as (e: never) => void);

/**
 * Cuando el servidor no contesta la página no ve ningún fallo (el worker le sirve la copia), así que se lo decimos:
 * `online: false` si se respondió con una copia, `true` si el servidor contestó.
 */
async function tell(online: boolean): Promise<void> {
  for (const c of await sw.clients.matchAll({ type: "window" })) c.postMessage({ kioku: "net", online });
}

/** `fetch` con plazo: si el servidor no contesta a tiempo se corta y se recurre a la copia. */
async function fetchWithin(req: Request): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), READ_TIMEOUT_MS);
  try { return await fetch(req, { signal: ctl.signal }); } finally { clearTimeout(timer); }
}

async function readFirstNetwork(req: Request): Promise<Response> {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetchWithin(req);
    await tell(true);
    if (res.status === 401) await caches.delete(API_CACHE); // clave revocada o inválida: no se conserva nada
    else if (res.ok) await cache.put(req, res.clone());
    else await cache.delete(req); // 404/403: ya no existe o es privada; no se conserva la copia vieja
    return res;
  } catch (e) {
    await tell(false);
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}

async function navigation(req: Request): Promise<Response> {
  try { return await fetchWithin(req); }
  catch (e) {
    await tell(false);
    const hit = await caches.match("/", { cacheName: SHELL });
    if (hit) return hit;
    throw e;
  }
}

async function shellFirst(req: Request): Promise<Response> {
  return (await caches.match(req, { cacheName: SHELL, ignoreSearch: true })) ?? fetch(req);
}

sw.addEventListener("fetch", ((e: FetchEv) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  if (cacheableRead(req.method, url.pathname)) return e.respondWith(readFirstNetwork(req));
  if (!isShell(req.method, url.pathname)) return;
  if (req.mode === "navigate" && (url.pathname === "/" || url.pathname === "/index.html")) return e.respondWith(navigation(req));
  e.respondWith(shellFirst(req));
}) as (e: never) => void);
