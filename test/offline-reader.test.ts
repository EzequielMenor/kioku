import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../web/src/offline/store.ts";
import { makeOfflineReader } from "../web/src/offline/reader.ts";
import { api, setOfflineReader, ApiError } from "../web/src/api.ts";
import type { NoteInfo, SearchHit } from "../web/src/types.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; setOfflineReader(null); });

async function withNotes() {
  const s = new MemoryStore();
  await s.putNotes([
    { path: "Notas/Año, mes & #1.md", mtime: 1, hash: "h1", text: "---\nid: X\ntype: project\n---\n# Título uno\ncuerpo con cohete" },
    { path: "Notas/Dos.md", mtime: 2, hash: "h2", text: "sin cabecera, también cohete" },
  ]);
  return s;
}
const offline = () => { globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch; };

test("reader: /api/note devuelve el texto y el hash de la réplica, con relaciones vacías", async () => {
  const read = makeOfflineReader(await withNotes());
  const n = (await read(`/api/note?path=${encodeURIComponent("Notas/Año, mes & #1.md")}`)) as NoteInfo;
  assert.equal(n.path, "Notas/Año, mes & #1.md");
  assert.equal(n.hash, "h1");
  assert.match(n.text, /cuerpo con cohete/);
  assert.deepEqual(n.note, { title: "Título uno", type: "project", tags: [], fm: {}, fmError: false });
  assert.deepEqual([n.backlinks, n.outgoing, n.unlinked], [[], [], []]);
  const d = (await read("/api/note?path=Notas%2FDos.md")) as NoteInfo;
  assert.equal(d.note!.title, "Dos");
  assert.equal(d.note!.type, "note");
});

test("reader: nota ausente → undefined", async () => {
  const read = makeOfflineReader(await withNotes());
  assert.equal(await read("/api/note?path=Notas%2FNo.md"), undefined);
});

test("reader: /api/search usa searchNotes y respeta limit", async () => {
  const read = makeOfflineReader(await withNotes());
  const all = (await read("/api/search?q=cohete&limit=6")) as SearchHit[];
  assert.equal(all.length, 2);
  const one = (await read("/api/search?q=cohete&limit=1")) as SearchHit[];
  assert.equal(one.length, 1);
});

test("reader: otras rutas → undefined", async () => {
  const read = makeOfflineReader(await withNotes());
  for (const p of ["/api/today", "/api/tasks", "/api/capture", "/api/notes"]) assert.equal(await read(p), undefined, p);
});

test("api(): si fetch falla con TypeError y hay lector que responde, devuelve su valor", async () => {
  offline();
  setOfflineReader(async (p) => (p === "/api/x" ? { ok: 1 } : undefined));
  assert.deepEqual(await api("GET", "/api/x"), { ok: 1 });
});

test("api(): sin lector, o si el lector devuelve undefined, relanza el error", async () => {
  offline();
  await assert.rejects(api("GET", "/api/x"), TypeError);
  setOfflineReader(async () => undefined);
  await assert.rejects(api("GET", "/api/x"), TypeError);
  setOfflineReader(async () => { throw new Error("lector roto"); });
  await assert.rejects(api("GET", "/api/x"), TypeError);
});

test("api(): una respuesta HTTP de error (404) NO usa el lector", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "No existe" }), { status: 404 })) as typeof fetch;
  let used = false;
  setOfflineReader(async () => { used = true; return { x: 1 }; });
  await assert.rejects(api("GET", "/api/x"), (e: unknown) => e instanceof ApiError && e.status === 404);
  assert.equal(used, false);
});

test("api(): una escritura sin red no consulta el lector", async () => {
  offline();
  let used = false;
  setOfflineReader(async () => { used = true; return { x: 1 }; });
  await assert.rejects(api("POST", "/api/capture", { text: "a" }), TypeError);
  assert.equal(used, false);
});

test("api(): envía las cabeceras extra en un POST", async () => {
  let seen: Headers | undefined;
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => { seen = new Headers(init?.headers); return new Response("{}", { status: 200 }); }) as typeof fetch;
  await api("POST", "/api/capture", { text: "a" }, { "x-kioku-op": "3f2a9c1e-5b7d" });
  assert.equal(seen!.get("x-kioku-op"), "3f2a9c1e-5b7d");
  assert.equal(seen!.get("content-type"), "application/json");
});
