// Lógica de la caja única («Escribe una idea, una tarea o pregúntale a Kio»), sin interfaz: a dónde va lo escrito y qué
// enseña Hoy de lo que ha hecho Kio. La interfaz está en kio-box.tsx.
import type { UndoRecord } from "./types.ts";
import { activityOrigin } from "./assistant-chat.ts";

export type Destination = "kio" | "capture" | "queue";

/**
 * Con Kio listo, el texto le llega a él y decide (guardar, crear, responder). Si no, se guarda tal cual en «Sin
 * organizar» y Kio lo ordena después: así nada depende del modelo. El móvil captura siempre por su cola sin conexión.
 */
export function destination(o: { kioReady: boolean | null; mobile: boolean; online: boolean }): Destination {
  if (o.kioReady && (!o.mobile || o.online)) return "kio";
  return o.mobile ? "queue" : "capture";
}

export function savedText(d: Exclude<Destination, "kio">, sent = true): string {
  if (d === "queue" && !sent) return "Guardado sin conexión: se enviará a «Sin organizar» al volver la red.";
  return "Guardado en «Sin organizar». Kio lo ordenará cuando esté disponible.";
}

const WINDOW_MS = 48 * 3_600_000;

/** Lo último que ha hecho Kio (no los cambios hechos desde una tabla), para revisarlo o deshacerlo desde Hoy. */
export function recentKioActions(list: UndoRecord[], now = Date.now(), max = 3): UndoRecord[] {
  return list
    .filter((a) => !a.undone && !activityOrigin(a) && now - Date.parse(a.ts) <= WINDOW_MS)
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, max);
}
