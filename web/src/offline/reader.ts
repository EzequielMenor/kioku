import type { NoteInfo } from "../types.ts";
import { describeNote, searchNotes } from "./search.ts";
import type { Store } from "./store.ts";

/**
 * Responde desde la réplica a las lecturas que `api()` no pudo hacer por falta de red:
 * una nota (`/api/note`) y la búsqueda (`/api/search`). Para el resto devuelve `undefined`
 * y se queda el error de red (esas pantallas salen de la caché del service worker).
 */
export function makeOfflineReader(store: Store): (path: string) => Promise<unknown | undefined> {
  return async (path) => {
    const q = path.indexOf("?");
    const route = q < 0 ? path : path.slice(0, q);
    const params = new URLSearchParams(q < 0 ? "" : path.slice(q + 1));

    if (route === "/api/note") {
      const n = await store.getNote(params.get("path") ?? "");
      if (!n) return undefined;
      const { title, type } = describeNote(n.path, n.text);
      const info: NoteInfo = {
        path: n.path, text: n.text, hash: n.hash,
        note: { title, type, tags: [], fm: {}, fmError: false },
        backlinks: [], outgoing: [], unlinked: [],
      };
      return info;
    }
    if (route === "/api/search") {
      const limit = Number(params.get("limit"));
      return searchNotes(await store.allNotes(), params.get("q") ?? "", Number.isInteger(limit) && limit > 0 ? limit : undefined);
    }
    return undefined;
  };
}
