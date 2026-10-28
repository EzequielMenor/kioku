import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, type Store, type StoredNote } from "../web/src/offline/store.ts";
import { syncReplica, BATCH, type GetJson } from "../web/src/offline/replica.ts";

type N = { path: string; mtime: number; hash: string; text: string };
const note = (path: string, text = `texto de ${path}`, hash = `h:${text}`): N => ({ path, mtime: 1, hash, text });

/** Servidor falso: responde manifest y notes, cuenta llamadas y puede limitar cuántas notas devuelve por llamada. */
function fakeServer(initial: N[], opts: { perCall?: number; failOnCall?: number } = {}) {
  const notes = new Map(initial.map((n) => [n.path, n]));
  const calls = { manifest: 0, notes: 0, batches: [] as string[][] };
  const get: GetJson = async <T>(p: string): Promise<T> => {
    if (p === "/api/sync/manifest") {
      calls.manifest++;
      return [...notes.values()].map(({ path, mtime, hash }) => ({ path, mtime, hash })) as T;
    }
    const m = /^\/api\/sync\/notes\?paths=(.*)$/.exec(p);
    assert.ok(m, `ruta inesperada ${p}`);
    calls.notes++;
    if (opts.failOnCall === calls.notes) throw new Error("red caída");
    const paths = JSON.parse(decodeURIComponent(m[1])) as string[];
    calls.batches.push(paths);
    const take = opts.perCall ?? paths.length;
    const out: N[] = [], pending: string[] = [], gone: string[] = [];
    for (const x of paths) {
      const n = notes.get(x);
      if (!n) gone.push(x);
      else if (out.length < take) out.push(n);
      else pending.push(x);
    }
    return { notes: out, pending, gone } as T;
  };
  return { notes, calls, get };
}

test("primera sincronización: descarga todo y guarda lastSync", async () => {
  const srv = fakeServer([note("A.md"), note("B.md")]);
  const store = new MemoryStore();
  const r = await syncReplica(store, srv.get, () => 1234);
  assert.deepEqual({ added: r.added, updated: r.updated, removed: r.removed, at: r.at }, { added: 2, updated: 0, removed: 0, at: 1234 });
  assert.deepEqual((await store.allNotes()).map((n) => n.path).sort(), ["A.md", "B.md"]);
  assert.equal(await store.getMeta("lastSync"), 1234);
});

test("sin cambios: no pide /api/sync/notes", async () => {
  const srv = fakeServer([note("A.md")]);
  const store = new MemoryStore();
  await syncReplica(store, srv.get);
  const before = srv.calls.notes;
  const r = await syncReplica(store, srv.get);
  assert.equal(srv.calls.notes, before);
  assert.deepEqual([r.added, r.updated, r.removed], [0, 0, 0]);
});

test("cambia un hash: solo se vuelve a descargar esa nota", async () => {
  const srv = fakeServer([note("A.md"), note("B.md")]);
  const store = new MemoryStore();
  await syncReplica(store, srv.get);
  srv.notes.set("B.md", note("B.md", "nuevo texto"));
  srv.calls.batches.length = 0;
  const r = await syncReplica(store, srv.get);
  assert.deepEqual(srv.calls.batches, [["B.md"]]);
  assert.equal(r.updated, 1);
  assert.equal((await store.getNote("B.md"))!.text, "nuevo texto");
});

test("desaparece del manifest (borrada o ahora privada): se borra de la réplica", async () => {
  const srv = fakeServer([note("A.md"), note("Privado/B.md")]);
  const store = new MemoryStore();
  await syncReplica(store, srv.get);
  srv.notes.delete("Privado/B.md");
  const r = await syncReplica(store, srv.get);
  assert.equal(r.removed, 1);
  assert.equal(await store.getNote("Privado/B.md"), undefined);
  assert.ok(await store.getNote("A.md"));
});

test("gone se ignora y pending se vuelve a pedir hasta completar", async () => {
  const srv = fakeServer([note("A.md"), note("B.md"), note("C.md")], { perCall: 1 });
  const store = new MemoryStore();
  const orig = srv.get;
  // el manifest anuncia una nota que ya no existe al pedirla (borrada entre manifest y fetch)
  const get: GetJson = async <T>(p: string): Promise<T> => {
    const v = await orig<T>(p);
    if (p === "/api/sync/manifest") (v as { path: string; mtime: number; hash: string }[]).push({ path: "Fantasma.md", mtime: 1, hash: "x" });
    return v;
  };
  const r = await syncReplica(store, get);
  assert.deepEqual((await store.allNotes()).map((n) => n.path).sort(), ["A.md", "B.md", "C.md"]);
  assert.equal(r.added, 3);
  assert.equal(await store.getNote("Fantasma.md"), undefined);
});

test("120 notas nuevas: lotes de 50 como máximo", async () => {
  const many = Array.from({ length: 120 }, (_, i) => note(`N${i}.md`));
  const srv = fakeServer(many);
  const store = new MemoryStore();
  await syncReplica(store, srv.get);
  assert.equal(BATCH, 50);
  assert.equal(srv.calls.notes, 3);
  assert.ok(srv.calls.batches.every((b) => b.length <= 50));
  assert.equal((await store.allNotes()).length, 120);
});

test("nombres con comas, # y acentos viajan bien en paths", async () => {
  const names = ["Notas/Año, mes & #1.md", "Notas/ñandú, café.md", "Notas/100% (a+b).md"];
  const srv = fakeServer(names.map((n) => note(n)));
  const store = new MemoryStore();
  await syncReplica(store, srv.get);
  assert.deepEqual((await store.allNotes()).map((n) => n.path).sort(), [...names].sort());
});

test("error en el 2.º lote: el 1.º queda guardado, lastSync no cambia y el error se propaga", async () => {
  const many = Array.from({ length: 70 }, (_, i) => note(`N${String(i).padStart(2, "0")}.md`));
  const srv = fakeServer(many, { failOnCall: 2 });
  const store = new MemoryStore();
  await store.setMeta("lastSync", 1);
  await assert.rejects(syncReplica(store, srv.get, () => 99), /red caída/);
  assert.equal((await store.allNotes()).length, 50);
  assert.equal(await store.getMeta("lastSync"), 1);
});

test("putNotes lanza (cuota): syncReplica rechaza, lastSync no cambia y lo anterior sigue intacto", async () => {
  const srv = fakeServer([note("A.md")]);
  const base = new MemoryStore();
  await syncReplica(base, srv.get, () => 5);
  srv.notes.set("A.md", note("A.md", "v2"));
  srv.notes.set("B.md", note("B.md"));
  const full: Store = Object.create(base, { putNotes: { value: async (_: StoredNote[]) => { throw new DOMException("cuota", "QuotaExceededError"); } } });
  await assert.rejects(syncReplica(full, srv.get, () => 9), /cuota/);
  assert.equal(await base.getMeta("lastSync"), 5);
  assert.equal((await base.getNote("A.md"))!.text, "texto de A.md");
});
