import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Entorno mínimo de un service worker: `self` registra los manejadores y `caches` es un mapa en memoria.
type Handler = (e: any) => void;
const handlers: Record<string, Handler> = {};
const store = new Map<string, Map<string, Response>>();
const key = (r: Request | string) => (typeof r === "string" ? new URL(r, "https://x").pathname + new URL(r, "https://x").search : new URL(r.url).pathname + new URL(r.url).search);
const fakeCaches = {
  async keys() { return [...store.keys()]; },
  async delete(n: string) { return store.delete(n); },
  async open(n: string) {
    if (!store.has(n)) store.set(n, new Map());
    const m = store.get(n)!;
    return {
      async addAll(urls: string[]) { for (const u of urls) m.set(key(u), new Response("shell:" + u)); },
      async put(r: Request, res: Response) { m.set(key(r), res); },
      async match(r: Request | string) { return m.get(key(r))?.clone(); },
    };
  },
  async match(r: Request | string, o?: { cacheName?: string }) {
    for (const [n, m] of store) if (!o?.cacheName || o.cacheName === n) { const h = m.get(key(r)); if (h) return h.clone(); }
    return undefined;
  },
};
let skipped = false, claimed = false;
Object.assign(globalThis, {
  self: { addEventListener: (t: string, h: Handler) => { handlers[t] = h; }, skipWaiting: async () => { skipped = true; }, clients: { claim: async () => { claimed = true; } }, location: { origin: "https://x" } },
  caches: fakeCaches,
  __BUILD_ID__: "nuevo",
  __PRECACHE__: ["/", "/app.js"],
});
await import("../web/src/sw.ts");

const realFetch = globalThis.fetch;
beforeEach(() => { store.clear(); skipped = claimed = false; globalThis.fetch = realFetch; });

const run = async (type: string, e: Record<string, unknown> = {}) => {
  let p: Promise<unknown> | undefined;
  handlers[type]({ ...e, waitUntil: (x: Promise<unknown>) => { p = x; } });
  await p;
};
const doFetch = async (url: string, init: RequestInit & { mode?: string } = {}) => {
  const req = new Request("https://x" + url, init);
  let out: Promise<Response> | undefined;
  handlers.fetch({ request: req, respondWith: (x: Promise<Response>) => { out = x; } });
  return out;
};

test("install: precarga el shell de este build y toma el control", async () => {
  await run("install");
  assert.deepEqual([...store.get("kioku-shell-nuevo")!.keys()].sort(), ["/", "/app.js"]);
  assert.equal(skipped, true);
});

test("activate: borra las cachés de shell antiguas y deja la actual y la de la API", async () => {
  for (const n of ["kioku-shell-viejo", "kioku-shell-nuevo", "kioku-api", "otra-cosa"]) store.set(n, new Map());
  await run("activate");
  assert.deepEqual([...store.keys()].sort(), ["kioku-api", "kioku-shell-nuevo", "otra-cosa"]);
  assert.equal(claimed, true);
});

test("lecturas: con red guarda copia; sin red sirve la última copia", async () => {
  globalThis.fetch = (async () => new Response('{"a":1}', { status: 200 })) as typeof fetch;
  assert.equal(await (await doFetch("/api/today"))!.text(), '{"a":1}');
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  assert.equal(await (await doFetch("/api/today"))!.text(), '{"a":1}');
  await assert.rejects(doFetch("/api/tasks")!.then((p) => p), TypeError);
});

test("un 401 en una lectura borra la caché de la API", async () => {
  store.set("kioku-api", new Map([["/api/today", new Response("x")]]));
  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  const res = await (await doFetch("/api/today"))!;
  assert.equal(res.status, 401);
  assert.equal(store.has("kioku-api"), false);
});

test("lo que no es shell ni lectura cacheable no se intercepta (escrituras, eventos, otro origen)", async () => {
  assert.equal(await doFetch("/api/capture", { method: "POST", body: "{}" }), undefined);
  assert.equal(await doFetch("/api/events"), undefined);
  let called = false;
  handlers.fetch({ request: new Request("https://otro.example/app.js"), respondWith: () => { called = true; } });
  assert.equal(called, false);
});

test("shell: se sirve de la caché del build y, sin red, la navegación devuelve el index guardado", async () => {
  await run("install");
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  assert.equal(await (await doFetch("/app.js"))!.text(), "shell:/app.js");
  const nav = new Request("https://x/", { headers: {} });
  Object.defineProperty(nav, "mode", { value: "navigate" });
  let out: Promise<Response> | undefined;
  handlers.fetch({ request: nav, respondWith: (x: Promise<Response>) => { out = x; } });
  assert.equal(await (await out!).text(), "shell:/");
});
