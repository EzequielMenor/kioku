import type { QueuedCapture, Store, StoredNote } from "./store.ts";

const DB_VERSION = 1;

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
      d.createObjectStore("notes", { keyPath: "path" });
      d.createObjectStore("meta", { keyPath: "key" });
      d.createObjectStore("queue", { keyPath: "opId" });
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
    clearReplica: () => tx(["notes", "meta"], "readwrite", (t) => { for (const n of ["notes", "meta"]) t.objectStore(n).clear(); }),
    clear: () => tx(["notes", "meta", "queue"], "readwrite", (t) => { for (const n of ["notes", "meta", "queue"]) t.objectStore(n).clear(); }),
  };
}
