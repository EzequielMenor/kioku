import type { Store, StoredNote } from "./store.ts";

export type GetJson = <T>(path: string) => Promise<T>;
export interface SyncResult { added: number; updated: number; removed: number; at: number }

/** Máximo de rutas por petición a /api/sync/notes (el servidor impone el mismo tope). */
export const BATCH = 50;

interface ManifestEntry { path: string; mtime: number; hash: string }
interface NotesReply { notes: StoredNote[]; pending: string[]; gone: string[] }

/**
 * Pone la réplica al día con el servidor: baja lo nuevo o cambiado (por hash), borra lo que ya no
 * está en el manifest y solo entonces anota `lastSync`. Si algo falla, lo ya guardado se queda y
 * `lastSync` no avanza.
 */
export async function syncReplica(store: Store, get: GetJson, now: () => number = Date.now): Promise<SyncResult> {
  const manifest = await get<ManifestEntry[]>("/api/sync/manifest");
  const local = new Map((await store.allNotes()).map((n) => [n.path, n.hash]));
  const remote = new Set(manifest.map((m) => m.path));

  const todo = manifest.filter((m) => local.get(m.path) !== m.hash).map((m) => m.path);
  let added = 0, updated = 0;
  while (todo.length) {
    const batch = todo.splice(0, BATCH);
    const r = await get<NotesReply>(`/api/sync/notes?paths=${encodeURIComponent(JSON.stringify(batch))}`);
    if (!r.notes.length && !r.gone.length) throw new Error("El servidor no devolvió ninguna nota");
    await store.putNotes(r.notes);
    for (const n of r.notes) local.has(n.path) ? updated++ : added++;
    todo.unshift(...r.pending);
  }

  const gone = [...local.keys()].filter((p) => !remote.has(p));
  if (gone.length) await store.deleteNotes(gone);

  const at = now();
  await store.setMeta("lastSync", at);
  return { added, updated, removed: gone.length, at };
}
