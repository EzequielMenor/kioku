import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  addMinutes, countdown, dayTimeline, defaultSlot, filterItems, fittingTasks, formatDuration, freeMinutes, freeSummary, gapBlock,
  moveToDay, nextUp, nowMarker, occupancy, openGaps, overlapping, progress, projectLabel, projectOptions, shiftDays, shiftView,
  OFFLINE_MESSAGE, UNCONFIRMED_MESSAGE, rangeLabel, rowTimes, stateGlyph, stateLabel, stateOf, validateTimes, viewRange, viewTitle, weekdayName, weekDays, writeFailure,
} from "../web/src/calendar-model.ts";
import type { CalendarEntry, CalendarTask } from "../web/src/types.ts";

// Miércoles 28 de octubre de 2026, 10:20 (hora local: el modelo no usa zonas).
const DAY = "2026-10-28";
const NEXT = "2026-10-29";
const NOW = new Date(2026, 9, 28, 10, 20);

function on(day: string, from: string, to: string, over: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    path: `Calendario/${day}-${from}.md`, title: "Actividad", kind: "block", hash: "h", state: "pending",
    taskPath: null, projectPath: null, projectTitle: null, start: `${day}T${from}`, end: `${day}T${to}`, ...over,
  };
}
const block = (from: string, to: string, over: Partial<CalendarEntry> = {}) => on(DAY, from, to, over);

function task(over: Partial<CalendarTask> & { path: string }): CalendarTask {
  return {
    title: "Tarea", status: "todo", projectPath: null, projectTitle: null, due: null, priority: null, doneAt: null, mtime: 0, focus: null,
    estimate: 30, ...over,
  };
}
const rowText = (rows: ReturnType<typeof dayTimeline>) =>
  rows.map((r) => (r.type === "item" ? r.item.title : `libre ${r.gap.start.slice(11)}-${r.gap.end.slice(11)}`));

test("semana: lunes a viernes; el fin de semana apunta a la semana que empieza", () => {
  assert.deepEqual(weekDays("2026-10-28"), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
  assert.equal(weekDays("2026-10-26")[0], "2026-10-26", "el lunes es su propio inicio");
  assert.deepEqual(weekDays("2026-10-31"), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
  assert.equal(weekDays("2026-11-01")[0], "2026-11-02");
});

test("vista: rango, título y desplazamiento de Día (±1 día) y Semana (±7 días)", () => {
  assert.deepEqual(viewRange("dia", DAY), { from: DAY, to: DAY });
  assert.deepEqual(viewRange("semana", DAY), { from: "2026-10-26", to: "2026-10-30" });
  assert.equal(shiftView("dia", DAY, 1), NEXT);
  assert.equal(shiftView("dia", DAY, -1), "2026-10-27");
  assert.equal(shiftView("semana", DAY, 1), "2026-11-04");
  assert.equal(shiftView("semana", "2026-10-26", -1), "2026-10-19");
  assert.equal(weekdayName(DAY), "miércoles");
  assert.equal(viewTitle("dia", DAY), "miércoles 28 de octubre");
  assert.equal(viewTitle("semana", DAY), "Semana del 26 al 30 de octubre");
  assert.equal(viewTitle("semana", "2026-10-29"), "Semana del 26 al 30 de octubre");
  assert.equal(viewTitle("semana", "2026-11-04"), "Semana del 2 al 6 de noviembre");
  assert.equal(viewTitle("semana", "2026-12-30"), "Semana del 28 de diciembre al 1 de enero", "una semana que cruza de mes");
});

test("duración: minutos y horas legibles", () => {
  assert.equal(formatDuration(45), "45 min");
  assert.equal(formatDuration(60), "1 h");
  assert.equal(formatDuration(90), "1 h 30 min");
  assert.equal(formatDuration(0), "0 min");
});

test("proyecto o área: letra + nombre; sin proyecto tiene su etiqueta; opciones únicas y ordenadas", () => {
  assert.deepEqual(projectLabel({ projectPath: "Proyectos/Kioku.md", projectTitle: "Kioku" }), { key: "Proyectos/Kioku.md", code: "K", name: "Kioku" });
  assert.deepEqual(projectLabel({ projectPath: null, projectTitle: null }), { key: "", code: "·", name: "Sin proyecto" });
  const opts = projectOptions(
    [block("09:00", "10:00", { projectPath: "P/b.md", projectTitle: "bici" }), block("11:00", "12:00", { projectPath: "P/b.md", projectTitle: "bici" }), block("13:00", "14:00")],
    [task({ path: "T/a.md", projectPath: "P/a.md", projectTitle: "Aprender japonés" })],
  );
  assert.deepEqual(opts.map((o) => [o.code, o.name]), [["A", "Aprender japonés"], ["B", "bici"]], "sin duplicados, por nombre, sin «Sin proyecto»");
});

test("filtro por proyecto: null deja todo; la clave vacía deja los sueltos", () => {
  const a = block("09:00", "10:00", { projectPath: "P/a.md", projectTitle: "A" });
  const b = block("10:00", "11:00");
  assert.deepEqual(filterItems([a, b], null), [a, b]);
  assert.deepEqual(filterItems([a, b], "P/a.md"), [a]);
  assert.deepEqual(filterItems([a, b], ""), [b]);
});

test("estado: se reevalúa con el reloj de la vista y tiene texto y glifo (no solo color)", () => {
  const b = block("10:00", "11:00", { state: "pending" });
  assert.equal(stateOf(b, NOW), "active");
  assert.equal(stateOf(b, new Date(2026, 9, 28, 9, 0)), "pending");
  const later = new Date(2026, 9, 28, 12, 0);
  assert.equal(stateOf(b, later), "unfinished");
  assert.equal(stateOf(block("10:00", "11:00", { kind: "event" }), later), "past");
  assert.equal(stateOf(block("10:00", "11:00", { done_at: "2026-10-28T10:50:00.000Z" }), later), "done");
  assert.deepEqual((["done", "active", "unfinished", "past", "pending"] as const).map(stateLabel), ["Hecho", "En curso", "Sin terminar", "Ya pasó", "Pendiente"]);
  const glyphs = (["done", "active", "unfinished", "past", "pending"] as const).map(stateGlyph);
  assert.equal(new Set(glyphs).size, 5, "cada estado tiene su glifo");
});

test("cuenta regresiva: en curso, por empezar (min / h:mm), otro día y ninguna al terminar", () => {
  assert.deepEqual(countdown(block("10:00", "11:00"), NOW), { big: "40", unit: "min restantes" });
  assert.deepEqual(countdown(block("11:05", "12:00"), NOW), { big: "45", unit: "min para empezar" });
  assert.deepEqual(countdown(block("11:30", "12:00"), NOW), { big: "1:10", unit: "h para empezar" });
  assert.deepEqual(countdown(on(NEXT, "09:00", "10:00"), NOW), { big: "09:00", unit: "mañana" });
  assert.deepEqual(countdown(on("2026-10-30", "09:00", "10:00"), NOW), { big: "09:00", unit: "viernes" });
  assert.equal(countdown(block("08:00", "09:00"), NOW), null, "sin terminar");
  assert.equal(countdown(block("08:00", "09:00", { kind: "event" }), NOW), null, "ya pasó");
  assert.equal(countdown(block("10:00", "11:00", { done_at: "2026-10-28T09:00:00.000Z" }), NOW), null, "hecho");
});

test("progreso: porcentaje transcurrido, acotado a 0–100", () => {
  assert.equal(progress(block("10:00", "11:00"), NOW), 33);
  assert.equal(progress(block("10:30", "11:00"), NOW), 0);
  assert.equal(progress(block("09:00", "10:00"), NOW), 100);
});

test("huecos: se unen los intervalos solapados y hoy solo cuenta lo que queda desde ahora", () => {
  const items = [block("09:00", "10:00"), block("09:30", "11:00"), block("09:45", "10:15", { kind: "event" })];
  const nextDay = items.map((i) => ({ ...i, start: i.start.replace(DAY, NEXT), end: i.end.replace(DAY, NEXT) }));
  assert.equal(freeMinutes(nextDay, NEXT, NOW), 15 * 60 - 120, "otro día: la ventana 07–22 menos la unión (09:00–11:00)");
  assert.deepEqual(openGaps(items, DAY, NOW).map((g) => [g.start.slice(11), g.end.slice(11), g.minutes]), [["11:00", "22:00", 660]], "hoy: lo anterior a las 10:20 ya pasó");
  assert.deepEqual(openGaps([], "2026-10-27", NOW), [], "un día pasado no ofrece huecos");
  assert.equal(freeMinutes([], "2026-10-27", NOW), 0);
  assert.deepEqual(openGaps([], DAY, new Date(2026, 9, 28, 5, 0)).map((g) => g.start.slice(11)), ["07:00"], "antes de las 07:00 el hueco sigue empezando a las 07:00");
  assert.deepEqual(openGaps([], DAY, new Date(2026, 9, 28, 23, 0)), [], "pasadas las 22:00 no queda nada");
});

test("línea de tiempo: actividades y todos los huecos positivos en orden; el filtro no inventa huecos", () => {
  const a = on(NEXT, "09:00", "10:30", { title: "A" });
  const b = on(NEXT, "10:40", "12:00", { title: "B", projectPath: "P/x.md", projectTitle: "X" });
  assert.deepEqual(rowText(dayTimeline([a, b], [a, b], NEXT, NOW)), ["libre 07:00-09:00", "A", "libre 10:30-10:40", "B", "libre 12:00-22:00"], "el hueco de 10 min también se muestra: el diseño no impone mínimo");
  assert.deepEqual(rowText(dayTimeline([a, b], [b], NEXT, NOW)), ["libre 07:00-09:00", "libre 10:30-10:40", "B", "libre 12:00-22:00"], "A oculta por el filtro sigue ocupando su tiempo");
  const tiny = [on(NEXT, "07:00", "21:59", { title: "Casi todo" })];
  assert.deepEqual(rowText(dayTimeline(tiny, tiny, NEXT, NOW)), ["Casi todo", "libre 21:59-22:00"], "incluso un hueco de 1 min");
  const today = block("11:00", "12:00", { title: "Hoy" });
  assert.deepEqual(rowText(dayTimeline([today], [today], DAY, NOW)), ["libre 10:20-11:00", "Hoy", "libre 12:00-22:00"], "hoy el hueco empieza ahora");
  const yesterday = on("2026-10-27", "08:00", "09:00", { title: "Ayer" });
  assert.deepEqual(rowText(dayTimeline([yesterday], [yesterday], "2026-10-27", NOW)), ["Ayer"], "un día pasado no tiene huecos");
});

test("línea de tiempo: lo que cruza la medianoche se lista en cada día que ocupa, marcado como continuación", () => {
  const spill = on(DAY, "23:00", "23:30", { title: "Noche", end: `${NEXT}T08:00` });
  assert.deepEqual(rowText(dayTimeline([spill], [spill], NEXT, NOW)), ["Noche", "libre 08:00-22:00"], "el día siguiente la muestra antes del primer hueco, que ya empieza a las 08:00");
  const flags = (day: string) => dayTimeline([spill], [spill], day, NOW).flatMap((r) => (r.type === "item" ? [[r.continued, r.continues]] : []));
  assert.deepEqual(flags(DAY), [[false, true]], "el día en que empieza sigue indicando que continúa");
  assert.deepEqual(flags(NEXT), [[true, false]]);
  assert.equal(rowText(dayTimeline([spill], [spill], "2026-10-30", NOW)).includes("Noche"), false, "dos días después ya no aparece");
  const three = on(DAY, "20:00", "21:00", { title: "Larga", end: "2026-10-30T10:00" });
  assert.deepEqual(dayTimeline([three], [three], NEXT, NOW).flatMap((r) => (r.type === "item" ? [[r.continued, r.continues]] : [])), [[true, true]], "un día intermedio la continúa y sigue");
  assert.deepEqual(rowText(dayTimeline([three], [three], NEXT, NOW)), ["Larga"], "ocupa todo el día: sin huecos");
  const ends = on(DAY, "22:00", "23:00", { title: "Hasta medianoche", end: `${NEXT}T00:00` });
  assert.deepEqual(rowText(dayTimeline([ends], [ends], NEXT, NOW)), ["libre 07:00-22:00"], "terminar a las 00:00 no ocupa el día siguiente");
  assert.equal(spill.start, `${DAY}T23:00`, "los datos originales no se tocan");
});

test("horas de la fila: la continuación no se hace pasar por una actividad que empieza esa mañana", () => {
  const spill = on(DAY, "23:00", "23:30", { end: `${NEXT}T08:00` });
  assert.deepEqual(rowTimes(block("09:00", "10:30"), DAY), { big: "09:00", small: "hasta 10:30" });
  assert.deepEqual(rowTimes(spill, DAY), { big: "23:00", small: "hasta jue 29 08:00" });
  assert.deepEqual(rowTimes(spill, NEXT), { big: "Sigue", small: "desde mié 28 23:00 · hasta 08:00" });
  assert.equal(rangeLabel(block("09:00", "10:30")), "09:00–10:30");
  assert.equal(rangeLabel(spill), "23:00 → jue 29 08:00");
});

test("fallos de escritura: sin red no se envía nada; un fallo de red ambiguo no afirma que no se guardó", () => {
  assert.equal(OFFLINE_MESSAGE, "Sin conexión: el calendario solo funciona en línea y no se ha guardado nada.");
  assert.equal(UNCONFIRMED_MESSAGE, "No se pudo confirmar el guardado. Recargá antes de reintentar.");
  const net = writeFailure(new TypeError("Failed to fetch"));
  assert.equal(net.message, UNCONFIRMED_MESSAGE);
  assert.doesNotMatch(net.message, /no se ha guardado/i);
  const server = new Error("La actividad cambió");
  assert.equal(writeFailure(server), server, "los errores del servidor salen tal cual");
});

test("siguiente: la próxima actividad sin hacer, minutos que faltan y tiempo libre antes", () => {
  const live = block("10:00", "11:00", { title: "Ahora" });
  const b = block("11:30", "12:30", { title: "B" });
  assert.deepEqual(nextUp([live, b], NOW), { item: b, minutes: 70, freeBefore: 30 });
  const tight = block("11:00", "12:00", { title: "Pegada" });
  assert.deepEqual(nextUp([live, tight], NOW), { item: tight, minutes: 40, freeBefore: null }, "sin hueco antes, no hay cifra");
  const done = block("11:30", "12:00", { done_at: "2026-10-28T09:00:00.000Z" });
  assert.equal(nextUp([live, done], NOW), null, "lo hecho no es «siguiente»");
  assert.equal(nextUp([block("08:00", "09:00")], NOW), null, "lo pasado tampoco");
  const tomorrow = on(NEXT, "09:00", "10:00");
  assert.deepEqual(nextUp([tomorrow], NOW), { item: tomorrow, minutes: 22 * 60 + 40, freeBefore: null });
});

test("ocupación 07–22: segmentos en %, recortados a la ventana, con el tipo de cada uno", () => {
  const segs = occupancy([
    on(NEXT, "07:00", "08:30"), on(NEXT, "12:00", "13:00", { kind: "event" }), on(NEXT, "21:00", "23:00"), on(NEXT, "05:00", "06:00"), block("09:00", "10:00"),
  ], NEXT);
  assert.deepEqual(segs.map((s) => [s.left, s.width, s.kind]), [[0, 10, "block"], [33.33, 6.67, "event"], [93.33, 6.67, "block"]]);
  assert.equal(nowMarker(DAY, NOW), 22.22);
  assert.equal(nowMarker(NEXT, NOW), null, "solo el día de hoy tiene marca");
  assert.equal(nowMarker(DAY, new Date(2026, 9, 28, 23, 0)), null, "fuera de la ventana");
});

test("cruces: dos actividades que se tocan no se cruzan; la propia se ignora", () => {
  const a = block("09:00", "10:00", { path: "a" }), b = block("10:00", "11:00", { path: "b" }), c = block("09:30", "10:30", { path: "c" });
  assert.deepEqual(overlapping([a, b, c], `${DAY}T09:30`, `${DAY}T10:30`).map((i) => i.path), ["a", "b", "c"]);
  assert.deepEqual(overlapping([a, b, c], `${DAY}T10:00`, `${DAY}T10:30`, "c").map((i) => i.path), ["b"]);
  assert.deepEqual(overlapping([a, b, c], `${DAY}T11:00`, `${DAY}T12:00`), []);
});

test("mover: otro día a la misma hora y con la misma duración, también si cruza la medianoche", () => {
  assert.deepEqual(moveToDay(block("09:00", "10:30"), "2026-10-30"), { start: "2026-10-30T09:00", end: "2026-10-30T10:30" });
  const night = { ...block("23:00", "23:30"), end: `${NEXT}T01:00` };
  assert.deepEqual(moveToDay(night, "2026-10-30"), { start: "2026-10-30T23:00", end: "2026-10-31T01:00" });
  assert.deepEqual(shiftDays(block("09:00", "10:00"), -1), { start: "2026-10-27T09:00", end: "2026-10-27T10:00" });
  assert.deepEqual(shiftDays(block("09:00", "10:00"), 1), { start: `${NEXT}T09:00`, end: `${NEXT}T10:00` });
});

test("fecha y hora manuales: válidas, fin posterior al inicio, y aviso (no bloqueo) si ya pasó", () => {
  assert.deepEqual(validateTimes(`${DAY}T11:00`, `${DAY}T12:15`, NOW), { ok: true, minutes: 75, past: false });
  assert.deepEqual(validateTimes(`${DAY}T09:00`, `${DAY}T09:30`, NOW), { ok: true, minutes: 30, past: true });
  assert.deepEqual(validateTimes(`${DAY}T11:00`, `${DAY}T11:00`, NOW), { ok: false, error: "El fin debe ser posterior al inicio" });
  assert.deepEqual(validateTimes(`${DAY}T12:00`, `${DAY}T11:00`, NOW), { ok: false, error: "El fin debe ser posterior al inicio" });
  assert.deepEqual(validateTimes("", `${DAY}T11:00`, NOW), { ok: false, error: "Indica un inicio y un fin válidos" });
  assert.deepEqual(validateTimes(`${DAY}T25:00`, `${DAY}T26:00`, NOW), { ok: false, error: "Indica un inicio y un fin válidos" });
});

test("sugerencias de hueco: solo tareas pendientes con estimación positiva que cabe, las más urgentes primero", () => {
  const tasks = [
    task({ path: "a", title: "A", estimate: 30, due: "2026-11-02" }),
    task({ path: "b", title: "B", estimate: 45 }),
    task({ path: "c", title: "C", estimate: 60 }),
    task({ path: "d", title: "D", estimate: null }),
    task({ path: "e", title: "E", estimate: 0 }),
    task({ path: "f", title: "F", estimate: 15, status: "done" }),
    task({ path: "g", title: "G", estimate: 20, due: "2026-10-30", status: "doing" }),
    task({ path: "h", title: "H", estimate: 45, status: "dropped" }),
  ];
  assert.deepEqual(fittingTasks(tasks, 45).map((t) => t.title), ["G", "A", "B"]);
  assert.deepEqual(fittingTasks(tasks, 10), []);
});

test("bloque desde un hueco: empieza donde empieza el hueco, dura la estimación y enlaza la tarea", () => {
  const t = task({ path: "Tareas/x.md", title: "Escribir", estimate: 30 });
  assert.deepEqual(gapBlock(t, { start: `${DAY}T11:00`, end: `${DAY}T12:00`, minutes: 60 }), { kind: "block", title: "Escribir", start: `${DAY}T11:00`, end: `${DAY}T11:30`, taskPath: "Tareas/x.md" });
  assert.equal(addMinutes(`${DAY}T23:50`, 20), `${NEXT}T00:10`);
});

test("hueco inicial al crear: el próximo cuarto de hora de hoy, o las 09:00 de otro día", () => {
  assert.deepEqual(defaultSlot(DAY, NOW), { start: `${DAY}T10:30`, end: `${DAY}T11:30` });
  assert.deepEqual(defaultSlot(DAY, new Date(2026, 9, 28, 10, 30)), { start: `${DAY}T10:45`, end: `${DAY}T11:45` });
  assert.deepEqual(defaultSlot(NEXT, NOW), { start: `${NEXT}T09:00`, end: `${NEXT}T10:00` });
  assert.deepEqual(defaultSlot(DAY, new Date(2026, 9, 28, 21, 50)), { start: `${DAY}T09:00`, end: `${DAY}T10:00` }, "tarde: no propone una hora a deshora");
});

test("resumen de tiempo libre del día", () => {
  const today = [block("11:00", "12:00")];
  assert.equal(freeSummary(today, DAY, NOW), "Hasta las 22:00 te quedan 10 h 40 min libres. Próximo hueco: 10:20–11:00 (40 min).");
  assert.equal(freeSummary([], NEXT, NOW), "Ese día tienes 15 h libres entre las 07:00 y las 22:00. Próximo hueco: 07:00–22:00 (15 h).");
  assert.equal(freeSummary([], "2026-10-27", NOW), "Día pasado: se muestra tal como quedó.");
  assert.equal(freeSummary([block("07:00", "22:00")], DAY, NOW), "Hasta las 22:00 te quedan 0 min libres. No quedan huecos.");
  assert.equal(freeSummary([on(NEXT, "07:00", "21:50")], NEXT, NOW), "Ese día tienes 10 min libres entre las 07:00 y las 22:00. Próximo hueco: 21:50–22:00 (10 min).", "un hueco corto sigue siendo un hueco");
  assert.equal(freeSummary([block("10:25", "22:00")], DAY, NOW), "Hasta las 22:00 te quedan 5 min libres. Próximo hueco: 10:20–10:25 (5 min).");
});

// ───────── Contrato de la interfaz (estático): sin red externa ni cola sin conexión ─────────

const src = (f: string) => readFileSync(path.join(import.meta.dirname, "..", "web", "src", f), "utf8");

test("calendario: sin peticiones externas, sin cola sin conexión y solo con las rutas del calendario y el estado de tarea", () => {
  for (const f of ["calendar.tsx", "calendar-model.ts", "calendar.css"]) assert.doesNotMatch(src(f), /https?:\/\/|fonts\.googleapis|@import/, `${f} no pide nada fuera`);
  const ui = src("calendar.tsx");
  assert.doesNotMatch(ui, /offline\/(runtime|store|queue)/, "las escrituras del calendario no pasan por la cola sin conexión");
  const routes = [...ui.matchAll(/["'`](\/api\/[^"'`?$]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(routes)].sort(), ["/api/calendar", "/api/calendar/create", "/api/calendar/finish", "/api/calendar/move", "/api/task/status"]);
});
