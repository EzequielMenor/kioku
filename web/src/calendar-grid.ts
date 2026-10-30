// Cuadrícula horaria del día: disposición de actividades y conversión entre píxeles y minutos (sin DOM).
// Una actividad se edita con minutos dentro de su día; lo que cruza medianoche se recorta en cada día y no se arrastra.
import { addDays } from "../../src/core/dates.ts";

export const SNAP = 15;
const MIN_CREATE = 30;
const DAY_MIN = 24 * 60;
const pad = (n: number) => String(n).padStart(2, "0");

export interface GridItem { path: string; start: string; end: string }
export interface GridWindow { from: number; to: number }
export interface PlacedItem { path: string; top: number; height: number; col: number; cols: number; continued: boolean; continues: boolean }

const dateOf = (m: string) => m.slice(0, 10);
const minutesOf = (m: string) => Number(m.slice(11, 13)) * 60 + Number(m.slice(14, 16));
/** Inicio y fin de la actividad dentro de `day`, en minutos desde la medianoche (`null` si no toca ese día). */
function clip(item: GridItem, day: string): { from: number; to: number; continued: boolean; continues: boolean } | null {
  const sd = dateOf(item.start), ed = dateOf(item.end);
  if (sd > day || ed < day) return null;
  const from = sd < day ? 0 : minutesOf(item.start);
  const to = ed > day ? DAY_MIN : minutesOf(item.end);
  if (to <= from && !(sd === day && ed === day && to === from)) return null; // termina justo a las 00:00 de `day`
  return { from, to, continued: sd < day, continues: ed > day };
}

/** 07:00–22:00 por defecto; se ensancha por horas enteras para que quepa lo que haya fuera. */
export function gridWindow(items: GridItem[], day: string): GridWindow {
  let from = 7 * 60, to = 22 * 60;
  for (const item of items) {
    const c = clip(item, day);
    if (!c) continue;
    from = Math.min(from, Math.floor(c.from / 60) * 60);
    to = Math.max(to, Math.ceil(c.to / 60) * 60);
  }
  return { from, to };
}

/** Colocación en minutos (1 px por minuto; la interfaz escala). Las que se solapan se reparten en columnas. */
export function layoutDay(items: GridItem[], day: string, win: GridWindow): PlacedItem[] {
  const list = items.flatMap((item) => { const c = clip(item, day); return c ? [{ item, ...c }] : []; })
    .sort((a, b) => a.from - b.from || b.to - a.to || a.item.path.localeCompare(b.item.path));
  const placed: PlacedItem[] = [];
  let cluster: { entry: PlacedItem; to: number }[] = [], columnEnds: number[] = [], clusterEnd = -1;
  const close = () => { for (const c of cluster) c.entry.cols = columnEnds.length; cluster = []; columnEnds = []; };
  for (const e of list) {
    if (e.from >= clusterEnd) close();
    let col = columnEnds.findIndex((end) => end <= e.from);
    if (col < 0) col = columnEnds.length;
    columnEnds[col] = e.to;
    clusterEnd = cluster.length ? Math.max(clusterEnd, e.to) : e.to;
    const entry: PlacedItem = { path: e.item.path, top: e.from - win.from, height: Math.max(e.to - e.from, SNAP), col, cols: 1, continued: e.continued, continues: e.continues };
    cluster.push({ entry, to: e.to });
    placed.push(entry);
  }
  close();
  return placed;
}

const snap = (min: number) => Math.round(min / SNAP) * SNAP;
export const minuteToY = (minute: number, pxPerMin: number, win: GridWindow): number => (minute - win.from) * pxPerMin;
/** Minuto (ajustado a 15) bajo una posición vertical, sin salirse de la ventana. */
export function yToMinute(y: number, pxPerMin: number, win: GridWindow): number {
  return Math.min(win.to, Math.max(win.from, snap(win.from + y / pxPerMin)));
}

/** Minutos desde la medianoche de `day` → «YYYY-MM-DDTHH:mm» (1440 es la medianoche del día siguiente). */
function stamp(day: string, minute: number): string {
  return minute >= DAY_MIN ? `${addDays(day, 1)}T00:00` : `${day}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** Crear arrastrando entre dos minutos (en cualquier orden); un clic sin arrastre da una hora; nunca menos de 30 min ni más allá de medianoche. */
export function createRange(day: string, a: number, b: number): { start: string; end: string } {
  let from = Math.min(a, b), to = Math.max(a, b);
  if (to === from) to = from + 60;
  to = Math.min(DAY_MIN, Math.max(to, from + MIN_CREATE));
  from = Math.min(from, DAY_MIN - MIN_CREATE);
  return { start: stamp(day, from), end: stamp(day, to) };
}

/** Mover `deltaMin` minutos conservando la duración, ajustado a 15 y dentro del día de su inicio. */
export function moveRange(item: GridItem, deltaMin: number): { start: string; end: string } {
  const day = dateOf(item.start), from = minutesOf(item.start);
  const length = (dateOf(item.end) > day ? DAY_MIN : 0) + minutesOf(item.end) - from;
  if (!deltaMin) return { start: item.start, end: item.end };
  const start = Math.min(DAY_MIN - length, Math.max(0, snap(from + deltaMin)));
  return { start: stamp(day, start), end: stamp(day, start + length) };
}

/** Mover el borde `edge` `deltaMin` minutos; la actividad nunca baja de 15 min ni sale de su día. */
export function resizeRange(item: GridItem, edge: "start" | "end", deltaMin: number): { start: string; end: string } {
  const day = dateOf(item.start), from = minutesOf(item.start);
  const to = (dateOf(item.end) > day ? DAY_MIN : 0) + minutesOf(item.end);
  if (edge === "end") return { start: item.start, end: stamp(day, Math.min(DAY_MIN, Math.max(from + SNAP, snap(to + deltaMin)))) };
  return { start: stamp(day, Math.max(0, Math.min(to - SNAP, snap(from + deltaMin)))), end: item.end };
}
