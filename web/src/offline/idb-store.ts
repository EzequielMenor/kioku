import type { Draft, QueuedCapture, Store, StoredMutation, StoredNote } from "./store.ts";

const DB_VERSION = 2;

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB de la PWA (réplica de notas, metadatos y cola de capturas). Se valida en el E2E del navegador. */
export async function openIdbStore(name = "kioku-offline"): Promise<Store> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const [name, keyPath] of [["notes", "path"], ["meta", "key"], ["queue", "opId"], ["drafts", "path"], ["mutations", "body.opId"]]) {
        if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB bloqueada"));
  });
  // Si otra pestaña pide actualizar o borrar la base, soltamos la conexión.
  db.onversionchange = () => db.close();

  /** Una transacción de lectura/escritura; resuelve al confirmarse (no al terminar cada petición). */
  const tx = <T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => T | Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out: T;
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new DOMException("Transacción cancelada", "AbortError"));
      Promise.resolve(fn(t)).then((v) => { out = v; }, (e) => { try { t.abort(); } catch { /* ya cerrada */ } reject(e); });
    });

  return {
    allNotes: () => tx(["notes"], "readonly", (t) => wrap<StoredNote[]>(t.objectStore("notes").getAll())),
    getNote: (path) => tx(["notes"], "readonly", (t) => wrap<StoredNote | undefined>(t.objectStore("notes").get(path))),
    putNotes: (notes) => tx(["notes"], "readwrite", (t) => { const s = t.objectStore("notes"); for (const n of notes) s.put(n); }),
    deleteNotes: (paths) => tx(["notes"], "readwrite", (t) => { const s = t.objectStore("notes"); for (const p of paths) s.delete(p); }),
    getMeta: async <T>(key: string) => (await tx(["meta"], "readonly", (t) => wrap<{ key: string; value: T } | undefined>(t.objectStore("meta").get(key))))?.value,
    setMeta: (key, value) => tx(["meta"], "readwrite", (t) => { t.objectStore("meta").put({ key, value }); }),
    queue: async () => (await tx(["queue"], "readonly", (t) => wrap<QueuedCapture[]>(t.objectStore("queue").getAll()))).sort((a, b) => a.createdAt - b.createdAt),
    putCapture: (c) => tx(["queue"], "readwrite", (t) => { t.objectStore("queue").put(c); }),
    deleteCapture: (opId) => tx(["queue"], "readwrite", (t) => { t.objectStore("queue").delete(opId); }),
    drafts: () => tx(["drafts"], "readonly", (t) => wrap<Draft[]>(t.objectStore("drafts").getAll())),
    getDraft: (path) => tx(["drafts"], "readonly", (t) => wrap<Draft | undefined>(t.objectStore("drafts").get(path))),
    putDraft: (draft) => tx(["drafts"], "readwrite", (t) => { t.objectStore("drafts").put(draft); }),
    deleteDraft: (path) => tx(["drafts"], "readwrite", (t) => { t.objectStore("drafts").delete(path); }),
    mutations: async () => (await tx(["mutations"], "readonly", (t) => wrap<StoredMutation[]>(t.objectStore("mutations").getAll()))).sort((a, b) => a.createdAt - b.createdAt),
    putMutation: (op) => tx(["mutations"], "readwrite", (t) => { t.objectStore("mutations").put(op); }),
    putMutationWithDraft: (op, draft) => tx(["mutations", "drafts"], "readwrite", (t) => { t.objectStore("mutations").put(op); t.objectStore("drafts").put(draft); }),
    prepareMutation: (op, previousText) => tx(["mutations", "drafts"], "readwrite", async (t) => {
      const mutations = t.objectStore("mutations"), drafts = t.objectStore("drafts");
      mutations.put(op);
      const draft = await wrap<Draft | undefined>(drafts.get(op.body.path));
      if (draft?.updatedAt === op.createdAt && draft.text === previousText) drafts.put({ ...draft, text: op.body.text, baseHash: op.body.baseHash });
    }),
    acknowledgeMutation: (op) => tx(["mutations", "drafts"], "readwrite", async (t) => {
      const mutations = t.objectStore("mutations"), drafts = t.objectStore("drafts");
      mutations.put(op);
      const [all, draft] = await Promise.all([wrap<StoredMutation[]>(mutations.getAll()), wrap<Draft | undefined>(drafts.get(op.body.path))]);
      const newer = all.some(o => o.body.path === op.body.path && o.body.opId !== op.body.opId && o.state !== "applied");
      if (op.state === "applied" && !newer && draft?.updatedAt === op.createdAt && draft.text === op.body.text) drafts.delete(op.body.path);
    }),
    deleteMutation: (id) => tx(["mutations"], "readwrite", (t) => { t.objectStore("mutations").delete(id); }),
    clearLocalPath: (path) => tx(["drafts", "mutations"], "readwrite", async (t) => {
      const drafts = t.objectStore("drafts"), mutations = t.objectStore("mutations");
      const all = await wrap<StoredMutation[]>(mutations.getAll());
      drafts.delete(path);
      for (const op of all) if (op.body.path === path) mutations.delete(op.body.opId);
    }),
    clearReplica: () => tx(["notes", "meta"], "readwrite", (t) => { for (const n of ["notes", "meta"]) t.objectStore(n).clear(); }),
    clear: () => tx(["notes", "meta", "queue", "drafts", "mutations"], "readwrite", (t) => { for (const n of ["notes", "meta", "queue", "drafts", "mutations"]) t.objectStore(n).clear(); }),
  };
}
