// Lógica pura del calendario (sin DOM): fechas locales «YYYY-MM-DDTHH:mm», estados, huecos y movimientos.
// Los huecos y los estados salen del núcleo (src/core/calendar.ts); aquí solo se adaptan a lo que pinta la interfaz.
import { addDays, diffDays, localDate } from "../../src/core/dates.ts";
import { calendarState, freeGaps, localMinute, parseLocal } from "../../src/core/calendar.ts";
import type { CalendarEntry, CalendarState, CalendarTask, Gap } from "./types.ts";

export type Scope = "dia" | "semana";
export interface ProjectLabel { key: string; code: string; name: string }
/** `continued`: la actividad empezó un día anterior; `continues`: sigue después de este día. */
export type TimelineRow = { type: "item"; item: CalendarEntry; continued: boolean; continues: boolean } | { type: "gap"; gap: Gap };

export const DAY_START = "07:00";
export const DAY_END = "22:00";
const WINDOW_MINUTES = 15 * 60;

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const dateOf = (m: string) => m.slice(0, 10);
const timeOf = (m: string) => m.slice(11);
const round2 = (n: number) => Math.round(n * 100) / 100;
const minutesBetween = (a: string, b: string) => Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 60_000);
const calendarDay = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d); };

export const durationOf = (item: { start: string; end: string }): number => minutesBetween(item.start, item.end);

export function addMinutes(minute: string, n: number): string {
  return localMinute(new Date(parseLocal(minute).getTime() + n * 60_000));
}

export const weekdayName = (day: string): string => WEEKDAYS[calendarDay(day).getDay()];
const dayMonth = (day: string) => `${Number(day.slice(8))} de ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

// ───────────── Vista: día o semana laboral ─────────────

/** Lunes a viernes de la semana de `day`; un sábado o domingo apunta a la semana que empieza. */
export function weekDays(day: string): string[] {
  const dow = calendarDay(day).getDay();
  const monday = dow === 6 ? addDays(day, 2) : dow === 0 ? addDays(day, 1) : addDays(day, 1 - dow);
  return [0, 1, 2, 3, 4].map((n) => addDays(monday, n));
}

export function viewRange(scope: Scope, day: string): { from: string; to: string } {
  if (scope === "dia") return { from: day, to: day };
  const days = weekDays(day);
  return { from: days[0], to: days[4] };
}

export const shiftView = (scope: Scope, day: string, dir: 1 | -1): string => addDays(day, dir * (scope === "dia" ? 1 : 7));

export function viewTitle(scope: Scope, day: string): string {
  if (scope === "dia") return `${weekdayName(day)} ${dayMonth(day)}`;
  const { from, to } = viewRange("semana", day);
  const sameMonth = from.slice(5, 7) === to.slice(5, 7);
  return `Semana del ${sameMonth ? Number(from.slice(8)) : dayMonth(from)} al ${dayMonth(to)}`;
}

// ───────────── Proyecto o área ─────────────

export function projectLabel(p: { projectPath: string | null; projectTitle: string | null }): ProjectLabel {
  if (!p.projectPath) return { key: "", code: "·", name: "Sin proyecto" };
  const name = p.projectTitle ?? p.projectPath.replace(/^.*\//, "").replace(/\.md$/i, "");
  return { key: p.projectPath, code: name.match(/[\p{L}\p{N}]/u)?.[0].toUpperCase() ?? "·", name };
}

/** Proyectos que aparecen en las actividades y en las tareas pendientes cargadas, sin repetir. */
export function projectOptions(items: CalendarEntry[], tasks: CalendarTask[]): ProjectLabel[] {
  const found = new Map<string, ProjectLabel>();
  for (const p of [...items, ...tasks]) if (p.projectPath && !found.has(p.projectPath)) found.set(p.projectPath, projectLabel(p));
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

/** `null` = todos; la clave vacía = actividades sin proyecto. */
export const filterItems = (items: CalendarEntry[], key: string | null): CalendarEntry[] =>
  key === null ? items : items.filter((i) => (i.projectPath ?? "") === key);

// ───────────── Estado y cuenta regresiva ─────────────

/** El estado se recalcula con el reloj de la vista: el que trae la API se queda viejo al pasar los minutos. */
export const stateOf = (item: CalendarEntry, now: Date): CalendarState => calendarState(item, now);

const LABELS: Record<CalendarState, string> = { done: "Hecho", active: "En curso", unfinished: "Sin terminar", past: "Ya pasó", pending: "Pendiente" };
// El color nunca es el único indicador: cada estado lleva texto y un glifo distinto.
const GLYPHS: Record<CalendarState, string> = { done: "✓", active: "●", unfinished: "◌", past: "–", pending: "○" };
export const stateLabel = (s: CalendarState): string => LABELS[s];
export const stateGlyph = (s: CalendarState): string => GLYPHS[s];

const clock = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

/** Cifra grande y unidad de la columna derecha; `null` cuando ya no hay nada que contar. */
export function countdown(item: CalendarEntry, now: Date): { big: string; unit: string } | null {
  const state = stateOf(item, now), here = localMinute(now);
  if (state === "active") {
    const left = minutesBetween(here, item.end);
    return left < 60 ? { big: String(left), unit: "min restantes" } : { big: clock(left), unit: "h restantes" };
  }
  if (state !== "pending") return null;
  if (dateOf(item.start) === dateOf(here)) {
    const wait = minutesBetween(here, item.start);
    return wait < 60 ? { big: String(wait), unit: "min para empezar" } : { big: clock(wait), unit: "h para empezar" };
  }
  const ahead = diffDays(dateOf(here), dateOf(item.start));
  return { big: timeOf(item.start), unit: ahead === 1 ? "mañana" : ahead < 7 ? weekdayName(dateOf(item.start)) : dayMonth(dateOf(item.start)) };
}

export function progress(item: CalendarEntry, now: Date): number {
  const pct = (minutesBetween(item.start, localMinute(now)) / durationOf(item)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

// ───────────── Huecos y ocupación ─────────────

/** Huecos libres 07–22 con los intervalos unidos; hoy solo lo que queda desde ahora y un día pasado no ofrece ninguno. */
export function openGaps(items: CalendarEntry[], day: string, now: Date): Gap[] {
  const today = localDate(now);
  if (day < today) return [];
  const gaps = freeGaps(items, day);
  if (day > today) return gaps;
  const here = localMinute(now);
  return gaps.flatMap((g) => {
    const start = g.start < here ? here : g.start;
    return start < g.end ? [{ start, end: g.end, minutes: minutesBetween(start, g.end) }] : [];
  });
}

export const freeMinutes = (items: CalendarEntry[], day: string, now: Date): number =>
  openGaps(items, day, now).reduce((sum, g) => sum + g.minutes, 0);

/** Actividades (filtradas) que ocupan algún minuto del día, también las que vienen de la víspera, y todos los huecos positivos calculados con todas las actividades. */
export function dayTimeline(all: CalendarEntry[], shown: CalendarEntry[], day: string, now: Date): TimelineRow[] {
  const from = `${day}T00:00`, to = `${addDays(day, 1)}T00:00`;
  const items = shown.filter((i) => i.start < to && i.end > from)
    .map((item): TimelineRow => ({ type: "item", item, continued: item.start < from, continues: item.end > to }));
  const gaps = openGaps(all, day, now).map((gap): TimelineRow => ({ type: "gap", gap }));
  // Una continuación se ordena desde el inicio del día, no desde su inicio real (que es de otro día).
  const start = (r: TimelineRow) => (r.type === "item" ? (r.continued ? from : r.item.start) : r.gap.start);
  const path = (r: TimelineRow) => (r.type === "item" ? r.item.path : "");
  return [...items, ...gaps].sort((a, b) => start(a).localeCompare(start(b)) || path(a).localeCompare(path(b)));
}

/** La próxima actividad sin hacer y el tiempo libre justo antes de ella (solo si es hoy). */
export function nextUp(items: CalendarEntry[], now: Date): { item: CalendarEntry; minutes: number; freeBefore: number | null } | null {
  const here = localMinute(now);
  const item = items.filter((i) => !i.done_at && i.start > here).sort((a, b) => a.start.localeCompare(b.start) || a.path.localeCompare(b.path))[0];
  if (!item) return null;
  const gap = dateOf(item.start) === dateOf(here) ? openGaps(items, dateOf(here), now).find((g) => g.end === item.start) : undefined;
  return { item, minutes: minutesBetween(here, item.start), freeBefore: gap ? gap.minutes : null };
}

/** Tira de ocupación 07–22: cada actividad recortada a la ventana, en % del ancho. */
export function occupancy(items: CalendarEntry[], day: string): { left: number; width: number; kind: "block" | "event"; path: string }[] {
  const from = `${day}T${DAY_START}`, to = `${day}T${DAY_END}`;
  return items.flatMap((i) => {
    if (i.start >= to || i.end <= from) return [];
    const start = i.start < from ? from : i.start, end = i.end > to ? to : i.end;
    return [{ left: round2((minutesBetween(from, start) / WINDOW_MINUTES) * 100), width: round2((minutesBetween(start, end) / WINDOW_MINUTES) * 100), kind: i.kind, path: i.path }];
  });
}

export function nowMarker(day: string, now: Date): number | null {
  if (localDate(now) !== day) return null;
  const m = minutesBetween(`${day}T${DAY_START}`, localMinute(now));
  return m < 0 || m > WINDOW_MINUTES ? null : round2((m / WINDOW_MINUTES) * 100);
}

export function freeSummary(items: CalendarEntry[], day: string, now: Date): string {
  const today = localDate(now);
  if (day < today) return "Día pasado: se muestra tal como quedó.";
  const gaps = openGaps(items, day, now);
  const free = formatDuration(gaps.reduce((sum, g) => sum + g.minutes, 0));
  const first = gaps[0];
  const lead = day === today ? `Hasta las ${DAY_END} te quedan ${free} libres.` : `Ese día tienes ${free} libres entre las ${DAY_START} y las ${DAY_END}.`;
  return `${lead} ${first ? `Próximo hueco: ${timeOf(first.start)}–${timeOf(first.end)} (${formatDuration(first.minutes)}).` : "No quedan huecos."}`;
}

// ───────────── Mover, reprogramar y crear ─────────────

/** Actividades que ocupan algún minuto del intervalo; las que solo se tocan en el borde no se cruzan. */
export const overlapping = (items: CalendarEntry[], start: string, end: string, ignorePath?: string): CalendarEntry[] =>
  items.filter((i) => i.path !== ignorePath && i.start < end && i.end > start);

export function shiftDays(item: CalendarEntry, n: number): { start: string; end: string } {
  return { start: addDays(dateOf(item.start), n) + item.start.slice(10), end: addDays(dateOf(item.end), n) + item.end.slice(10) };
}

/** Misma hora y misma duración en otro día. */
export const moveToDay = (item: CalendarEntry, day: string): { start: string; end: string } => shiftDays(item, diffDays(dateOf(item.start), day));

export type TimesCheck = { ok: true; minutes: number; past: boolean } | { ok: false; error: string };

/** Comprobación de lo escrito a mano; que la hora ya haya pasado avisa pero no impide guardar. */
export function validateTimes(start: string, end: string, now: Date): TimesCheck {
  try { parseLocal(start); parseLocal(end); } catch { return { ok: false, error: "Indica un inicio y un fin válidos" }; }
  if (end <= start) return { ok: false, error: "El fin debe ser posterior al inicio" };
  return { ok: true, minutes: minutesBetween(start, end), past: start < localMinute(now) };
}

/** Tareas pendientes con estimación positiva que caben en el hueco, las que vencen antes primero. Nada se programa solo. */
export function fittingTasks(tasks: CalendarTask[], minutes: number): CalendarTask[] {
  return tasks
    .filter((t) => (t.status === "todo" || t.status === "doing") && t.estimate !== null && t.estimate > 0 && t.estimate <= minutes)
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || (a.priority ?? 9) - (b.priority ?? 9) || a.title.localeCompare(b.title));
}

export interface Draft { kind: "block" | "event"; title: string; start: string; end: string; taskPath?: string }

export function gapBlock(task: CalendarTask, gap: Gap): Draft {
  return { kind: "block", title: task.title, start: gap.start, end: addMinutes(gap.start, task.estimate ?? 30), taskPath: task.path };
}

/** Horas iniciales al crear: el próximo cuarto de hora de hoy, o las 09:00. */
export function defaultSlot(day: string, now: Date): { start: string; end: string } {
  let start = `${day}T09:00`;
  if (day === localDate(now)) {
    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setMinutes(Math.floor(next.getMinutes() / 15) * 15 + 15);
    const candidate = localMinute(next);
    if (dateOf(candidate) === day && timeOf(candidate) >= DAY_START && timeOf(candidate) < "21:00") start = candidate;
  }
  return { start, end: addMinutes(start, 60) };
}

// ───────────── Fechas en las filas y fallos de escritura ─────────────

const shortDay = (day: string) => `${weekdayName(day).slice(0, 3)} ${Number(day.slice(8))}`;

/** «09:00–10:30», o «23:00 → jue 29 08:00» si cruza la medianoche. */
export const rangeLabel = (item: { start: string; end: string }): string =>
  dateOf(item.start) === dateOf(item.end) ? `${timeOf(item.start)}–${timeOf(item.end)}` : `${timeOf(item.start)} → ${shortDay(dateOf(item.end))} ${timeOf(item.end)}`;

/** Hora grande y línea pequeña de la columna de la izquierda en el día `day`; una continuación no finge empezar esa mañana. */
export function rowTimes(item: { start: string; end: string }, day: string): { big: string; small: string } {
  const end = dateOf(item.end) === day ? timeOf(item.end) : `${shortDay(dateOf(item.end))} ${timeOf(item.end)}`;
  if (dateOf(item.start) < day) return { big: "Sigue", small: `desde ${shortDay(dateOf(item.start))} ${timeOf(item.start)} · hasta ${end}` };
  return { big: timeOf(item.start), small: `hasta ${end}` };
}

/** Antes de enviar: sabemos que no se escribió nada. */
export const OFFLINE_MESSAGE = "Sin conexión: el calendario solo funciona en línea y no se ha guardado nada.";
/** Tras enviar: la petición pudo llegar al servidor y perderse solo la respuesta. */
export const UNCONFIRMED_MESSAGE = "No se pudo confirmar el guardado. Recargá antes de reintentar.";

/** Un fallo de red (fetch lanza TypeError) es ambiguo: no se puede decir que no se guardó. Los errores del servidor son respuestas y salen tal cual. */
export const writeFailure = (e: unknown): Error => (e instanceof TypeError ? new Error(UNCONFIRMED_MESSAGE) : e instanceof Error ? e : new Error(String(e)));
