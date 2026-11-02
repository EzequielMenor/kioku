// Calendario «panel de salidas» (propuesta A de docs/design/08-calendar.md): Día y Semana sobre la API en línea.
// Solo en línea: nada de cola sin conexión; si no hay red se dice y no se finge que se guardó.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import "./calendar.css";
import { DayGrid, QuickAdd } from "./calendar-grid.tsx";
import { api, lsGet, lsSet } from "./api.ts";
import { isMobile } from "./role.ts";
import { useApi } from "./hooks.ts";
import { localDate } from "../../src/core/dates.ts";
import {
  DEFAULT_TASK_MINUTES, OFFLINE_MESSAGE, TASK_MIME, addMinutes, areaLabel, areaTextColor, countdown, dayTimeline, defaultSlot, durationOf, filterAreas, fittingTasks, formatDuration, freeMinutes, freeSummary, gapBlock,
  moveToDay, nextUp, nowMarker, occupancy, overlapping, progress, projectLabel, rangeLabel, rowTimes, shiftDays, shiftView, stateGlyph,
  stateLabel, stateOf, validateArea, dropStart, pendingTasks, taskChanges, taskDraftBlock, taskDueLabel, taskInput, validateTimes, viewRange, viewTitle, weekdayName, weekDays, writeFailure, joinLocal, parseTime24, splitLocal, editChanges, duplicateRange, type WeekPrefs,
  type AreaLabel, type Draft, type EditFields, type ProjectLabel, type Scope, type TaskForm, type TaskPatch, type TaskValues,
} from "./calendar-model.ts";
import type { AreaRow, CalendarEntry, CalendarProject, CalendarResponse, CalendarTask, Gap } from "./types.ts";

type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;
type Say = (text: string, error?: boolean) => void;
type Panel = { kind: "detail"; path: string } | { kind: "gap"; gap: Gap } | { kind: "compose"; draft: Draft } | { kind: "areas" };

const enc = (p: string) => encodeURI(p);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const dayNumber = (day: string) => Number(day.slice(8, 10));
const dayName = (day: string) => `${cap(weekdayName(day))} ${dayNumber(day)}`;
const hm = (minute: string) => minute.slice(11);
const newId = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Reloj de la vista: la hora del servidor al cargar y el paso del tiempo desde entonces; se repinta cada 15 s. */
function useClock(serverNow: string | undefined): Date {
  const [, tick] = useState(0);
  const skew = useMemo(() => { const s = serverNow ? Date.parse(serverNow) - Date.now() : 0; return Number.isFinite(s) ? s : 0; }, [serverNow]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 15_000); return () => clearInterval(t); }, []);
  return new Date(Date.now() + skew);
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener("online", on); addEventListener("offline", off);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); };
  }, []);
  return online;
}

// ───────────────────────────── Hoja de detalle ─────────────────────────────

const FOCUSABLE = "button, input, select, textarea, a[href], summary";

/** Diálogo modal: foco dentro (y atrapado), Esc y clic fuera cierran, el foco vuelve a quien lo abrió. En pantallas estrechas es una hoja inferior.
 *  El teclado se atiende en el documento, no en el contenedor: si el control enfocado se elimina o se desactiva (completar la tarea, enviar un formulario),
 *  el foco cae en <body> y un onKeyDown del contenedor ya no recibiría ni Esc ni Tab. */
function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: ComponentChildren }) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = box.current!;
    const opener = document.activeElement as HTMLElement | null;
    const first = () => el.querySelector<HTMLElement>("[data-first]") ?? el;
    const tabbable = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.hasAttribute("disabled"));
    /** El foco está fuera de la hoja (p. ej. en <body>) o en un control ya desactivado. */
    const lost = () => { const at = document.activeElement as HTMLButtonElement | null; return !at || !el.contains(at) || at.disabled; };
    const keep = (e: FocusEvent) => { if (!el.contains(e.target as Node)) first().focus(); };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation(); // los atajos globales de la app no deben dispararse con la hoja abierta
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== "Tab") return;
      const els = tabbable();
      if (!els.length) { e.preventDefault(); el.focus(); return; }
      const at = document.activeElement;
      if (lost()) { e.preventDefault(); els[e.shiftKey ? els.length - 1 : 0].focus(); }
      else if (e.shiftKey && (at === els[0] || at === el)) { e.preventDefault(); els[els.length - 1].focus(); }
      else if (!e.shiftKey && at === els[els.length - 1]) { e.preventDefault(); els[0].focus(); }
    };
    // Un control que se elimina o se desactiva suelta el foco: se devuelve a la hoja para que el teclado siga dentro.
    const watch = new MutationObserver(() => { if (lost()) el.focus(); });
    first().focus();
    watch.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    document.addEventListener("focusin", keep);
    document.addEventListener("keydown", onKey);
    return () => {
      watch.disconnect();
      document.removeEventListener("focusin", keep);
      document.removeEventListener("keydown", onKey);
      (opener?.isConnected ? opener : document.querySelector<HTMLElement>(".cal h1"))?.focus();
    };
  }, []);
  return (
    <div class="scrim sheet-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) closeRef.current(); }}>
      <div class="modal sheet cal-sheet" role="dialog" aria-modal="true" aria-labelledby="cal-sheet-title" tabIndex={-1} ref={box}>
        <div class="cal-grab" aria-hidden="true" />
        <h2 id="cal-sheet-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ───────────────────────────── Piezas pequeñas ─────────────────────────────

const Badge = ({ p }: { p: ProjectLabel }) => <span class="cal-lname"><span class="cal-lb" aria-hidden="true">{p.code}</span>{p.name}</span>;
const AreaBadge = ({ area }: { area: AreaLabel }) => <span class="cal-lname"><span class="cal-lb" aria-hidden="true" style={area.color ? { backgroundColor: area.color, color: areaTextColor(area.color) } : undefined}>{area.code}</span>{area.name}</span>;

function AreaSelect({ areas, value, onChange }: { areas: AreaRow[]; value: string; onChange(value: string): void }) {
  return <label>Área <select value={value} onChange={(e) => onChange(e.currentTarget.value)}>
    <option value="">Sin área</option>
    {areas.map((area) => <option key={area.path} value={area.path}>{area.title}</option>)}
  </select></label>;
}
const Pill = ({ item }: { item: CalendarEntry }) => <span class={`cal-pill st-${item.state}`}><i aria-hidden="true">{stateGlyph(item.state)}</i> {stateLabel(item.state)}</span>;
const KindTag = ({ item }: { item: CalendarEntry }) => <span class={`cal-kd ${item.kind}`}>{item.kind === "event" ? "◆ Evento" : "Bloque"}</span>;

/** Fecha y hora siempre en 24 h: `datetime-local` pinta AM/PM según el idioma del navegador, así que la hora se escribe aparte (HH:mm). */
function DateTime24({ label, value, onChange, inputRef }: { label: string; value: string; onChange(value: string): void; inputRef?: { current: HTMLInputElement | null } }) {
  const { date, time } = splitLocal(value);
  const [text, setText] = useState(time);
  useEffect(() => { if (parseTime24(text) !== time && text !== time) setText(time); }, [time]);
  const bad = text !== "" && parseTime24(text) === null;
  return (
    <fieldset class="cal-dt">
      <legend>{label}</legend>
      <input ref={inputRef} type="date" aria-label={`${label}: fecha`} value={date} onInput={(e) => onChange(joinLocal(e.currentTarget.value, text))} />
      <input type="text" inputMode="numeric" autoComplete="off" size={5} maxLength={5} placeholder="HH:mm" aria-label={`${label}: hora en 24 h (HH:mm)`} aria-invalid={bad} value={text}
        onInput={(e) => { setText(e.currentTarget.value); onChange(joinLocal(date, e.currentTarget.value)); }}
        onBlur={() => { const t = parseTime24(text); if (t) setText(t); }} />
    </fieldset>
  );
}

/** Inicio y fin escritos a mano (fecha y hora en 24 h, el formato local que guarda el calendario). */
function Reschedule({ item, items, now, onSave, onCancel }: { item: CalendarEntry; items: CalendarEntry[]; now: Date; onSave(start: string, end: string): Promise<boolean>; onCancel(): void }) {
  const [start, setStart] = useState(item.start);
  const [end, setEnd] = useState(item.end);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => { first.current?.focus(); const o = opener.current; return () => { if (o?.isConnected) o.focus(); }; }, []);
  const check = validateTimes(start, end, now);
  const clash = check.ok ? overlapping(items, start, end, item.path) : [];
  const changeStart = (value: string) => {
    setStart(value);
    if (check.ok) try { setEnd(addMinutes(value, check.minutes)); } catch { /* campo a medio escribir */ }
  };
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!check.ok || busy) return;
    setBusy(true);
    if (!(await onSave(start, end))) setBusy(false);
  };
  return (
    <form class="cal-resched" onSubmit={(e) => void submit(e)}>
      <DateTime24 label="Empieza" inputRef={first} value={start} onChange={changeStart} />
      <DateTime24 label="Termina" value={end} onChange={setEnd} />
      {check.ok ? <p class="cal-note">Dura {formatDuration(check.minutes)}.</p> : <p class="cal-warn" role="alert">{check.error}</p>}
      {check.ok && check.past && <p class="cal-warn">△ Esa hora ya pasó. Puedes guardarla igualmente.</p>}
      {clash.length > 0 && <p class="cal-warn" role="status">△ Se cruza con {clash.map((c) => `«${c.title}» (${hm(c.start)}–${hm(c.end)})`).join(" y ")}. Puedes programarlo igual.</p>}
      <p class="cal-note">Reprogramar solo cambia el inicio y el fin: la tarea y sus otros bloques no cambian.</p>
      <div class="cal-acts"><button class="primary" disabled={!check.ok || busy}>Guardar</button><button type="button" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

/** Controles en línea del bloque en curso o sin terminar. */
/** Todos los campos de la actividad, editables en el sitio. Envía solo lo que cambió (título, tipo, inicio y fin por una vía; el área por otra). */
function EditForm({ item, items, areas, now, onSave }: { item: CalendarEntry; items: CalendarEntry[]; areas: AreaRow[]; now: Date; onSave(fields: Partial<EditFields>, areaPath: string | null | undefined): Promise<boolean> }) {
  const [title, setTitle] = useState(item.title);
  const [kind, setKind] = useState(item.kind);
  const [start, setStart] = useState(item.start);
  const [end, setEnd] = useState(item.end);
  const [areaPath, setAreaPath] = useState(item.areaPath ?? "");
  const [busy, setBusy] = useState(false);
  const check = validateTimes(start, end, now);
  const changes = editChanges(item, { title, kind, start, end });
  const areaChanged = areaPath !== (item.areaPath ?? "");
  const dirty = Object.keys(changes).length > 0 || areaChanged;
  const clash = check.ok ? overlapping(items, start, end, item.path) : [];
  const changeStart = (value: string) => {
    setStart(value);
    if (check.ok) try { setEnd(addMinutes(value, check.minutes)); } catch { /* campo a medio escribir */ }
  };
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!dirty || !check.ok || !title.trim() || busy) return;
    setBusy(true);
    await onSave(changes, areaChanged ? areaPath || null : undefined);
    setBusy(false);
  };
  return (
    <form class="cal-edit" onSubmit={(e) => void submit(e)}>
      <label>Título <input class="wide-input" value={title} onInput={(e) => setTitle(e.currentTarget.value)} /></label>
      <fieldset class="cal-kind">
        <legend>Tipo</legend>
        <label><input type="radio" name={`kind-${item.path}`} checked={kind === "block"} onChange={() => setKind("block")} /> Bloque</label>
        <label><input type="radio" name={`kind-${item.path}`} checked={kind === "event"} onChange={() => setKind("event")} /> Evento</label>
      </fieldset>
      <DateTime24 label="Empieza" value={start} onChange={changeStart} />
      <DateTime24 label="Termina" value={end} onChange={setEnd} />
      {check.ok ? <p class="cal-note">Dura {formatDuration(check.minutes)}.</p> : <p class="cal-warn" role="alert">{check.error}</p>}
      {clash.length > 0 && <p class="cal-warn" role="status">△ Se cruza con {clash.map((c) => `«${c.title}» (${hm(c.start)}–${hm(c.end)})`).join(" y ")}. Puedes dejarlo así.</p>}
      <AreaSelect areas={areas} value={areaPath} onChange={setAreaPath} />
      {!title.trim() && <p class="cal-warn" role="alert">Escribe un título.</p>}
      <div class="cal-acts"><button class="primary" disabled={!dirty || !check.ok || !title.trim() || busy}>Guardar cambios</button></div>
    </form>
  );
}

function LiveControls({ item, now, onFinish, onEdit }: { item: CalendarEntry; now: Date; onFinish(): void; onEdit(): void }) {
  const pct = progress(item, now);
  return (
    <div class="cal-live">
      {item.state === "active" && (
        <>
          <div class="cal-bar" role="progressbar" aria-label="Avance de la actividad en curso" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
          <div class="cal-barl"><span>{hm(item.start)}</span><span>{item.end.slice(0, 10) === item.start.slice(0, 10) ? hm(item.end) : rangeLabel(item).split(" → ")[1]}</span></div>
        </>
      )}
      {item.state === "unfinished" && <p class="cal-note">No se terminó a su hora. Nada se mueve solo: puedes terminarlo ahora o reprogramarlo.</p>}
      <div class="cal-acts">
        {item.kind === "block" && <button class="primary" onClick={onFinish}>Terminar bloque</button>}
        <button onClick={onEdit}>Reprogramar</button>
      </div>
    </div>
  );
}

// ───────────────────────────── Vista ─────────────────────────────

export function CalendarView({ rev, guard, say }: { rev: number; guard: Guard; say: Say }) {
  const [scope, setScopeRaw] = useState<Scope>(() => (lsGet("calendar.scope") === "semana" ? "semana" : "dia"));
  const [day, setDay] = useState(() => localDate(new Date()));
  const [dayView, setDayViewRaw] = useState<"grid" | "list">(() => lsGet("calendar.dayView") === "list" ? "list" : "grid");
  const setDayView = (view: "grid" | "list") => { setDayViewRaw(view); lsSet("calendar.dayView", view); };
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [freed, setFreed] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ path: string; title: string } | null>(null);
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 10_000); return () => clearTimeout(t); }, [undo]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const online = useOnline();
  const [week, setWeekRaw] = useState<WeekPrefs>(() => ({ start: lsGet("calendar.weekStart") === "domingo" ? "domingo" : "lunes", weekend: lsGet("calendar.weekend") !== "oculto" }));
  const setWeek = (w: WeekPrefs) => { setWeekRaw(w); lsSet("calendar.weekStart", w.start); lsSet("calendar.weekend", w.weekend ? "visible" : "oculto"); };
  const range = viewRange(scope, day, week);
  const { data, error, reload } = useApi<CalendarResponse>(`/api/calendar?from=${range.from}&to=${range.to}`, rev);
  const projectsData = useApi<CalendarProject[]>("/api/calendar/projects", rev).data;
  const projects = projectsData ?? [];
  const readOnly = isMobile(); // crear y editar tareas es de escritorio; el servidor lo impone, aquí solo se ocultan los controles
  const now = useClock(data?.now);
  const today = localDate(now);
  const days = scope === "dia" ? [day] : weekDays(day, week);
  const items = (data?.items ?? []).map((i) => ({ ...i, state: stateOf(i, now) }));
  const tasks = data?.tasks ?? [];
  const areas = data?.areas ?? [];
  const shown = filterAreas(items, areaFilter);
  const setScope = (s: Scope) => { setScopeRaw(s); lsSet("calendar.scope", s); };
  const openDay = (d: string) => { setDay(d); setScope("dia"); };
  const closePanel = () => { setPanel(null); setEditing(null); };

  /** Escritura con la API. Sin red no se envía nada y se dice; si la red falla a mitad, el resultado es incierto (la respuesta pudo perderse) y se recarga para ver la verdad. Los errores del servidor salen tal cual por `guard`. */
  const write = <T,>(fn: () => Promise<T>) => guard(async () => {
    if (!navigator.onLine) throw new Error(OFFLINE_MESSAGE);
    try { return await fn(); } catch (e) { if (e instanceof TypeError) reload(); throw writeFailure(e); }
  });

  /** Un segundo clic mientras la petición sigue en vuelo no repite la acción (el `hash` ya habría cambiado: sería un 409). */
  const inflight = useRef(new Set<string>());
  const once = async <T,>(key: string, fn: () => Promise<T | undefined>): Promise<T | undefined> => {
    if (inflight.current.has(key)) return undefined;
    inflight.current.add(key);
    try { return await fn(); } finally { inflight.current.delete(key); }
  };

  const announce = (r: CalendarEntry, verb: string) => {
    const clash = overlapping(items, r.start, r.end, r.path);
    say(`«${r.title}» ${verb} ${weekdayName(r.start.slice(0, 10))} ${dayNumber(r.start)} a las ${hm(r.start)}.`);
    setNotice(clash.length ? `△ «${r.title}» se cruza con ${clash.map((c) => `«${c.title}» (${hm(c.start)}–${hm(c.end)})`).join(" y ")}. Puedes dejarlo así.` : null);
  };

  const finish = async (item: CalendarEntry) => {
    const r = await once("finish:" + item.path, () => write(() => api<CalendarEntry>("POST", "/api/calendar/finish", { path: item.path, hash: item.hash })));
    if (r) say(item.taskPath ? "Bloque terminado. La tarea sigue como estaba." : "Bloque terminado.");
    reload();
  };
  const reschedule = async (item: CalendarEntry, start: string, end: string): Promise<boolean> => {
    const r = await once("move:" + item.path, () => write(() => api<CalendarEntry>("POST", "/api/calendar/move", { path: item.path, start, end, hash: item.hash })));
    reload();
    if (!r) return false;
    announce(r, "pasó al");
    setEditing(null);
    return true;
  };
  const create = async (d: Draft, id: string): Promise<boolean> => {
    const r = await write(() => api<CalendarEntry>("POST", "/api/calendar/create", {
      id, title: d.title.trim(), kind: d.kind, start: d.start, end: d.end, ...(d.taskPath ? { taskPath: d.taskPath } : {}), ...(d.areaPath ? { areaPath: d.areaPath } : {}),
    }));
    if (!r) return false;
    reload();
    if (!days.includes(r.start.slice(0, 10))) setDay(r.start.slice(0, 10));
    announce(r, "queda el");
    closePanel();
    return true;
  };
  const saveArea = async (area: AreaRow | null, title: string, color: string, id: string): Promise<boolean> => {
    const result = await once("area:" + (area?.path ?? id), () => write(() => area
      ? api<AreaRow>("POST", "/api/calendar/areas/update", { path: area.path, title: title.trim(), color: color.toLowerCase(), hash: area.hash })
      : api<AreaRow>("POST", "/api/calendar/areas/create", { id, title: title.trim(), color: color.toLowerCase() })));
    reload();
    if (!result) return false;
    say(area ? "Área actualizada." : "Área creada.");
    return true;
  };
  /** Guarda lo editado: título, tipo, inicio y fin con una petición; el área con otra (el `hash` cambia entre las dos). `undefined` = el área no cambió. */
  const saveEdit = async (item: CalendarEntry, fields: Partial<EditFields>, areaPath: string | null | undefined): Promise<boolean> => {
    let hash = item.hash;
    if (Object.keys(fields).length) {
      const r = await once("edit:" + item.path, () => write(() => api<CalendarEntry>("POST", "/api/calendar/update", { path: item.path, hash, ...fields })));
      if (!r) { reload(); return false; }
      hash = r.hash;
    }
    if (areaPath !== undefined) {
      const r = await once("assign:" + item.path, () => write(() => api<CalendarEntry>("POST", "/api/calendar/area", { path: item.path, areaPath, hash })));
      if (!r) { reload(); return false; }
    }
    reload();
    say("Actividad actualizada.");
    return true;
  };
  const duplicate = async (item: CalendarEntry) => {
    const t = duplicateRange(item);
    await create({ kind: item.kind, title: item.title, start: t.start, end: t.end, ...(item.areaPath ? { areaPath: item.areaPath } : {}) }, newId());
  };
  /** Borrar manda la actividad a la papelera; la barra «Deshacer» la devuelve. No hay diálogo de confirmación: es recuperable. */
  const remove = async (item: CalendarEntry) => {
    const r = await once("delete:" + item.path, () => write(async () => { await api("POST", "/api/calendar/delete", { path: item.path, hash: item.hash }); return true; }));
    reload();
    if (!r) return;
    closePanel();
    setUndo({ path: item.path, title: item.title });
  };
  const restore = async () => {
    if (!undo) return;
    const r = await once("restore:" + undo.path, () => write(() => api<CalendarEntry>("POST", "/api/calendar/restore", { path: undo.path })));
    reload();
    if (!r) return;
    setUndo(null);
    say(`«${r.title}» vuelve a estar en el calendario.`);
  };
  const completeTask = async (path: string) => {
    if (await once("task:" + path, () => write(async () => { await api("POST", "/api/task/status", { path, status: "done" }); return true; }))) say("Tarea completada. El bloque no cambia.");
    reload();
  };
  /** Tareas nuevas y editadas desde el panel o desde una actividad. Terminar un bloque o completar una tarea siguen siendo acciones separadas. */
  const createTask = async (input: TaskValues): Promise<boolean> => {
    const r = await once("task:create", () => write(() => api<{ path: string; title: string }>("POST", "/api/task/create", input)));
    reload();
    if (!r) return false;
    say(`Tarea «${r.title}» creada.`);
    return true;
  };
  const updateTask = async (task: CalendarTask, patch: TaskPatch): Promise<boolean> => {
    const r = await once("task:edit:" + task.path, () => write(() => api<{ title: string }>("POST", "/api/task/update", { path: task.path, hash: task.hash, ...patch })));
    reload();
    if (!r) return false;
    say(`Tarea «${r.title}» actualizada.`);
    return true;
  };
  const linkTask = async (item: CalendarEntry, taskPath: string | null): Promise<boolean> => {
    const r = await once("link:" + item.path, () => write(() => api<CalendarEntry>("POST", "/api/calendar/link", { path: item.path, hash: item.hash, taskPath })));
    reload();
    if (!r) return false;
    say(taskPath ? "Tarea enlazada. La tarea y la actividad se completan por separado." : "Enlace quitado. La tarea no cambia.");
    return true;
  };
  const linkNewTask = async (item: CalendarEntry, task: TaskValues): Promise<boolean> => {
    const r = await once("link:" + item.path, () => write(() => api<CalendarEntry>("POST", "/api/calendar/link", { path: item.path, hash: item.hash, task })));
    reload();
    if (!r) return false;
    say(`Tarea «${task.title}» creada y enlazada.`);
    return true;
  };
  /** Una tarea del panel se convierte en un bloque con hora: bajo el puntero en la cuadrícula, o en el primer hueco donde cabe. */
  const scheduleTask = async (taskPath: string, onDay: string, start?: string): Promise<void> => {
    const t = tasks.find((x) => x.path === taskPath);
    if (!t) return;
    await create(taskDraftBlock(t, start ?? dropStart(items, onDay, now, t.estimate ?? DEFAULT_TASK_MINUTES)), newId());
  };
  const isTaskDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(TASK_MIME);
  const dropOn = (target: string) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    if (isTaskDrag(e)) {
      const taskPath = e.dataTransfer?.getData(TASK_MIME);
      if (taskPath) void scheduleTask(taskPath, target);
      return;
    }
    const item = items.find((i) => i.path === (e.dataTransfer?.getData("text/plain") || dragging));
    setDragging(null);
    if (!item || item.start.slice(0, 10) === target) return;
    const t = moveToDay(item, target);
    void reschedule(item, t.start, t.end);
  };
  const dropZone = (d: string) => ({
    onDragOver: (e: DragEvent) => { if (dragging || isTaskDrag(e)) { e.preventDefault(); setOver(d); } },
    onDragLeave: () => setOver((o) => (o === d ? null : o)),
    onDrop: dropOn(d),
  });
  const compose = (draft?: Draft) => setPanel({ kind: "compose", draft: draft ?? { kind: "block", title: "", ...defaultSlot(day, now) } });

  /** Día al que apunta «Programar»: el que se ve, o hoy dentro de una semana que lo incluye. */
  const targetDay = scope === "dia" ? day : days.includes(today) ? today : days[0];
  const programTask = (t: CalendarTask) => compose(taskDraftBlock(t, dropStart(items, targetDay, now, t.estimate ?? DEFAULT_TASK_MINUTES)));

  const upcoming = days.includes(today) ? nextUp(items, now) : null;
  const detail = panel?.kind === "detail" ? items.find((i) => i.path === panel.path) : undefined;

  return (
    <div class="page cal">
      <header class="page-head">
        <div>
          <h1 tabIndex={-1}>Calendario</h1>
          <div class="muted small" aria-live="polite">{viewTitle(scope, day, week)}</div>
        </div>
        <div class="row cal-tools">
          <div class="seg" role="group" aria-label="Alcance">
            {(["dia", "semana"] as const).map((s) => <button key={s} class={scope === s ? "on" : ""} aria-pressed={scope === s} onClick={() => setScope(s)}>{s === "dia" ? "Día" : "Semana"}</button>)}
          </div>
          {scope === "dia" && <div class="seg" role="group" aria-label="Vista del día">
            {(["grid", "list"] as const).map((view) => <button key={view} class={dayView === view ? "on" : ""} aria-pressed={dayView === view} onClick={() => setDayView(view)}>{view === "grid" ? "Cuadrícula" : "Lista"}</button>)}
          </div>}
          {scope === "semana" && (
            <div class="cal-weekopts row" role="group" aria-label="Opciones de la semana">
              <label><input type="checkbox" checked={week.weekend} onChange={(e) => setWeek({ ...week, weekend: e.currentTarget.checked })} /> Fin de semana</label>
              <label>Empieza el <select value={week.start} disabled={!week.weekend} onChange={(e) => setWeek({ ...week, start: e.currentTarget.value === "domingo" ? "domingo" : "lunes" })}><option value="lunes">lunes</option><option value="domingo">domingo</option></select></label>
            </div>
          )}
          <div class="cal-step" role="group" aria-label="Moverse por el calendario">
            <button aria-label={scope === "dia" ? "Día anterior" : "Semana anterior"} onClick={() => setDay(shiftView(scope, day, -1))}>‹</button>
            <button onClick={() => setDay(today)}>Hoy</button>
            <button aria-label={scope === "dia" ? "Día siguiente" : "Semana siguiente"} onClick={() => setDay(shiftView(scope, day, 1))}>›</button>
          </div>
          {!readOnly && <button onClick={() => setPanel({ kind: "areas" })}>Áreas</button>}
          <button class="primary" onClick={() => compose()}>{readOnly ? "+ Actividad" : "Nueva actividad"}</button>
        </div>
      </header>

      {!online && <p class="cal-alert" role="status">Sin conexión: el calendario solo funciona en línea. Mover, terminar o crear no está disponible hasta que vuelva la red.</p>}
      {error && (
        <div class="cal-alert" role="alert">
          <span><b>No se pudo cargar el calendario.</b> {online ? error : "Sin conexión: el calendario solo funciona en línea."}</span>
          <button onClick={reload}>Reintentar</button>
        </div>
      )}
      {data && data.invalid.length > 0 && (
        <p class="cal-warn" role="status">
          △ {data.invalid.length === 1 ? "Una nota de Calendario/ no se puede leer y no aparece" : `${data.invalid.length} notas de Calendario/ no se pueden leer y no aparecen`}:{" "}
          {data.invalid.map((n, i) => <span key={n.path}>{i > 0 && ", "}<a href={`#/nota/${enc(n.path)}`}>{n.path}</a></span>)}. Revisa su fecha, fin o tipo.
        </p>
      )}
      {undo && <p class="cal-undo" role="status">«{undo.title}» borrada. <button onClick={() => void restore()}>Deshacer</button> <button class="mini" onClick={() => setUndo(null)}>Cerrar</button></p>}
      {notice && <p class="cal-warn" role="status">{notice} <button class="mini" onClick={() => setNotice(null)}>Entendido</button></p>}
      {!data && !error && <div class="empty muted">Cargando…</div>}

      {data && (
        <div class="cal-layout">
          <div class="cal-body">
          {upcoming && (
            <p class="cal-ticker" role="status">
              <span class="cal-eyebrow">Siguiente</span>
              <b>{upcoming.item.start.slice(0, 10) === today ? "" : `${weekdayName(upcoming.item.start.slice(0, 10))} `}{hm(upcoming.item.start)} · {upcoming.item.title}</b>
              <span>en {formatDuration(upcoming.minutes)}.</span>
              {upcoming.freeBefore !== null && <span class="muted">Antes tienes {formatDuration(upcoming.freeBefore)} libres.</span>}
            </p>
          )}
          {!(readOnly && areas.length === 0) && <div class="chips" role="group" aria-label="Filtrar por área">
            <button class={`chip btn ${areaFilter === null ? "on" : ""}`} aria-pressed={areaFilter === null} onClick={() => setAreaFilter(null)}>Todos</button>
            {areas.map((a) => (
              <button key={a.path} class={`chip btn ${areaFilter === a.path ? "on" : ""}`} aria-pressed={areaFilter === a.path} onClick={() => setAreaFilter(a.path)}><AreaBadge area={areaLabel({ areaPath: a.path, areaTitle: a.title, areaColor: a.color })} /></button>
            ))}
            <button class={`chip btn ${areaFilter === "" ? "on" : ""}`} aria-pressed={areaFilter === ""} onClick={() => setAreaFilter("")}><AreaBadge area={areaLabel({ areaPath: null, areaTitle: null, areaColor: null })} /></button>
          </div>}

          {scope === "semana" && (
            <>
              <div class="cal-wstrip" role="group" aria-label="Resumen de la semana" style={{ "--cal-days": days.length }}>
                {days.map((d) => {
                  const marker = nowMarker(d, now), free = d < today ? "Pasado" : `${formatDuration(freeMinutes(items, d, now))} libres`;
                  return (
                    <button key={d} class={`cal-wsd ${d === today ? "today" : ""} ${over === d ? "over" : ""}`} aria-label={`${dayName(d)}: ${free}. Ver solo este día`} onClick={() => openDay(d)} {...dropZone(d)}>
                      <span class="cal-wsn"><b>{dayName(d).slice(0, 3)} {dayNumber(d)}</b>{d === today && <small>Hoy</small>}</span>
                      <span class="cal-wbar" aria-hidden="true">
                        {occupancy(items, d).map((s) => <i key={s.path} class={`cal-sg ${s.kind}`} style={{ left: `${s.left}%`, width: `${s.width}%`, color: s.color ?? "var(--muted)" }} />)}
                        {marker !== null && <i class="cal-wnow" style={{ left: `${marker}%` }} />}
                      </span>
                      <small class="cal-wsf">{free}</small>
                    </button>
                  );
                })}
              </div>
              <p class="cal-legend">Cada barra es el día de 07:00 a 22:00: lo lleno está ocupado, lo vacío está libre y la marca es ahora. Toca un día para verlo solo o arrastra una actividad sobre un día para moverla; con el teclado, usa «Un día antes / después» en su detalle.</p>
            </>
          )}
          {scope === "dia" && <p class="cal-free">{freeSummary(items, day, now)}{!readOnly && <> <span class="muted">No hace falta llenar los huecos.</span></>}</p>}

          {!readOnly && <QuickAdd now={now} onCreate={(title, start, end) => create({ kind: "event", title, start, end }, newId())} />}
          {scope === "dia" && dayView === "grid" ? <DayGrid day={day} items={shown} now={now} today={today} onOpen={(path) => setPanel({ kind: "detail", path })} onCreate={(title, start, end) => create({ kind: "event", title, start, end }, newId())} onChange={reschedule} onDropTask={(taskPath, start) => void scheduleTask(taskPath, day, start)} /> : <section class="cal-board" aria-label={scope === "dia" ? "Actividades del día en orden" : "Actividades de la semana en orden"}>
            {days.map((d) => {
              const rows = dayTimeline(items, shown, d, now);
              return (
                <div key={d} class={scope === "dia" && over === d ? "over" : ""} {...(scope === "dia" ? dropZone(d) : {})}>
                  {scope === "semana" && (
                    <div class={`cal-dayhead ${over === d ? "over" : ""}`} {...dropZone(d)}>
                      <b>{dayName(d)}</b>{d === today && <span class="cal-pill st-active">Hoy</span>}
                      <span class="cal-dhs">{d < today ? "Día pasado" : `${formatDuration(freeMinutes(items, d, now))} libres`}</span>
                      <button class="mini" onClick={() => openDay(d)}>Ver solo este día</button>
                    </div>
                  )}
                  <ul class="cal-list">
                    {!rows.some((r) => r.type === "item") && <li class="cal-empty">{areaFilter === null ? "Nada programado." : "Nada de esta área."}</li>}
                    {rows.map((r) => r.type === "gap" ? (
                      <li key={`g${r.gap.start}`} class="cal-gap">
                        <span class="cal-time"><b>{hm(r.gap.start)}</b><small>hasta {hm(r.gap.end)}</small></span>
                        <span class="cal-gapt">Tiempo libre · {formatDuration(r.gap.minutes)}{freed.has(r.gap.start) && <em class="muted"> · libre a propósito</em>}</span>
                        <button class="mini" aria-label={`Usar el hueco de ${hm(r.gap.start)} a ${hm(r.gap.end)}`} onClick={() => setPanel({ kind: "gap", gap: r.gap })}>Usar este hueco</button>
                      </li>
                    ) : (
                      <ActivityRow key={`${r.item.path}@${d}`} item={r.item} day={d} continued={r.continued} taskTitle={tasks.find((t) => t.path === r.item.taskPath)?.title} now={now} draggable={scope === "semana"}
                        onOpen={() => setPanel({ kind: "detail", path: r.item.path })}
                        onDragStart={(e) => { e.dataTransfer?.setData("text/plain", r.item.path); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; setDragging(r.item.path); }}
                        onDragEnd={() => { setDragging(null); setOver(null); }}>
                        {(r.item.state === "active" || r.item.state === "unfinished") && <LiveControls item={r.item} now={now} onFinish={() => void finish(r.item)} onEdit={() => setEditing(`${r.item.path}@${d}`)} />}
                        {editing === `${r.item.path}@${d}` && !detail && <Reschedule item={r.item} items={items} now={now} onSave={(s, e) => reschedule(r.item, s, e)} onCancel={() => setEditing(null)} />}
                      </ActivityRow>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>}
          </div>
          <TaskPanel tasks={tasks} projects={projects} readOnly={readOnly} today={today} onComplete={completeTask} onCreate={createTask} onSave={updateTask} onSchedule={programTask} />
        </div>
      )}

      {detail && (
        <Sheet title={detail.title} onClose={closePanel}>
          <Detail item={detail} items={items} tasks={tasks} projects={projects} areas={areas} now={now} readOnly={readOnly}
            onLink={(taskPath) => linkTask(detail, taskPath)} onLinkNew={(task) => linkNewTask(detail, task)}
            onFinish={() => void finish(detail)} onSave={(f, a) => saveEdit(detail, f, a)} onDuplicate={() => void duplicate(detail)} onDelete={() => void remove(detail)} onShift={(n) => { const t = shiftDays(detail, n); void reschedule(detail, t.start, t.end); }}
            onCompleteTask={(p) => void completeTask(p)} onClose={closePanel} />
        </Sheet>
      )}
      {panel?.kind === "gap" && (
        <Sheet title={`Tiempo libre · ${formatDuration(panel.gap.minutes)}`} onClose={closePanel}>
          <GapBody gap={panel.gap} tasks={tasks} areas={areas}
            onPick={(t, id, areaPath) => create({ ...gapBlock(t, panel.gap), areaPath }, id)}
            onCompose={(areaPath) => compose({ kind: "block", title: "", start: panel.gap.start, end: addMinutes(panel.gap.start, Math.min(panel.gap.minutes, 60)), areaPath })}
            onLeave={() => { setFreed(new Set(freed).add(panel.gap.start)); say("Hueco libre. Está bien así."); closePanel(); }} />
        </Sheet>
      )}
      {panel?.kind === "areas" && (
        <Sheet title="Áreas" onClose={closePanel}>
          <AreasManager areas={areas} onSave={saveArea} onClose={closePanel} />
        </Sheet>
      )}
      {panel?.kind === "compose" && (
        <Sheet title="Nueva actividad" onClose={closePanel}>
          <Compose initial={panel.draft} tasks={tasks} areas={areas} items={items} now={now} onSubmit={create} onCancel={closePanel} />
        </Sheet>
      )}
    </div>
  );
}

// ───────────────────────────── Fila de actividad ─────────────────────────────

function ActivityRow({ item, day, continued, taskTitle, now, draggable, onOpen, onDragStart, onDragEnd, children }: {
  item: CalendarEntry; day: string; continued: boolean; taskTitle?: string; now: Date; draggable: boolean; onOpen(): void; onDragStart(e: DragEvent): void; onDragEnd(): void; children?: ComponentChildren;
}) {
  const cd = countdown(item, now), area = areaLabel(item), times = rowTimes(item, day);
  return (
    <li class={`cal-item st-${item.state} ${item.kind} ${continued ? "carried" : ""}`} style={{ borderLeft: `5px solid ${area.color ?? "var(--line2)"}` }}>
      <button type="button" class="cal-main" aria-haspopup="dialog" draggable={draggable} onClick={onOpen} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <span class="cal-time"><b class={continued ? "word" : ""}>{times.big}</b><small>{times.small}</small></span>
        <span class="cal-act">
          <span class="cal-at">{item.title}</span>
          <span class="cal-sub"><KindTag item={item} /><span class="cal-mdur">{formatDuration(durationOf(item))}</span>{item.taskPath && <span class="cal-tk">→ {taskTitle ?? "con tarea"}</span>}</span>
        </span>
        <span class="cal-proj"><AreaBadge area={area} /></span>
        <span class="cal-dur">{formatDuration(durationOf(item))}</span>
        <span class="cal-when">
          {cd && <><span class="cal-big">{cd.big}</span><span class="cal-unit">{cd.unit}</span></>}
          <Pill item={item} />
        </span>
      </button>
      {children}
    </li>
  );
}

// ───────────────────────────── Contenido de las hojas ─────────────────────────────

function AreasManager({ areas, onSave, onClose }: { areas: AreaRow[]; onSave(area: AreaRow | null, title: string, color: string, id: string): Promise<boolean>; onClose(): void }) {
  const [selected, setSelected] = useState<AreaRow | null>(null);
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("#4f46e5");
  const [busy, setBusy] = useState(false);
  const id = useRef(newId());
  const valid = validateArea(title, color);
  const select = (area: AreaRow | null) => {
    setSelected(area);
    setTitle(area?.title ?? "");
    setColor(area?.color ?? "#4f46e5");
    id.current = newId();
  };
  const submit = async (event: Event) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    const saved = await onSave(selected, title, color, id.current);
    setBusy(false);
    if (saved) select(null);
  };
  return <>
    <p class="cal-note">Las áreas son independientes de los proyectos. Las actividades anteriores siguen sin área hasta que la elijas.</p>
    {areas.length ? <ul class="cal-areas">{areas.map((area) => <li key={area.path}>
      <AreaBadge area={areaLabel({ areaPath: area.path, areaTitle: area.title, areaColor: area.color })} />
      <button type="button" disabled={busy} onClick={() => select(area)} aria-label={`Editar ${area.title}`}>Editar</button>
    </li>)}</ul> : <p class="cal-note">Todavía no hay áreas.</p>}
    <form class="cal-compose" onSubmit={(e) => void submit(e)}>
      <h3>{selected ? "Editar área" : "Nueva área"}</h3>
      <label>Nombre <input data-first value={title} maxLength={60} onInput={(e) => setTitle(e.currentTarget.value)} /></label>
      <label>Color <input value={color} onInput={(e) => setColor(e.currentTarget.value)} placeholder="#RRGGBB" /></label>
      <label>Elegir color <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#000000"} onInput={(e) => setColor(e.currentTarget.value)} /></label>
      {!valid && <p class="cal-note">Indica un nombre de 1 a 60 caracteres en una línea y un color #RRGGBB.</p>}
      <div class="cal-acts"><button class="primary" disabled={!valid || busy}>{selected ? "Guardar cambios" : "Crear área"}</button>{selected && <button type="button" disabled={busy} onClick={() => select(null)}>Nueva área</button>}<button type="button" onClick={onClose}>Cerrar</button></div>
    </form>
  </>;
}

function Detail({ item, items, tasks, projects, areas, now, readOnly, onFinish, onSave, onShift, onDuplicate, onDelete, onCompleteTask, onLink, onLinkNew, onClose }: {
  item: CalendarEntry; items: CalendarEntry[]; tasks: CalendarTask[]; projects: CalendarProject[]; areas: AreaRow[]; now: Date; readOnly: boolean; onFinish(): void;
  onSave(fields: Partial<EditFields>, areaPath: string | null | undefined): Promise<boolean>; onShift(n: number): void; onDuplicate(): void; onDelete(): void; onCompleteTask(path: string): void;
  onLink(taskPath: string | null): Promise<boolean>; onLinkNew(task: TaskValues): Promise<boolean>; onClose(): void;
}) {
  const task = item.taskPath ? tasks.find((t) => t.path === item.taskPath) : undefined;
  const cd = countdown(item, now);
  const noun = item.kind === "event" ? "evento" : "bloque";
  return (
    <>
      <div class="cal-sub"><KindTag item={item} /><Pill item={item} /><AreaBadge area={areaLabel(item)} /><Badge p={projectLabel(item)} /></div>
      <EditForm key={item.hash} item={item} items={items} areas={areas} now={now} onSave={onSave} />
      <p class="cal-when-line">{dayName(item.start.slice(0, 10))} · {rangeLabel(item)} · {formatDuration(durationOf(item))}{cd ? ` · ${cd.big} ${cd.unit}` : ""}</p>
      {item.projectPath && <p class="small"><a href={`#/proyecto/${enc(item.projectPath)}`}>Abrir proyecto</a></p>}

      {item.taskPath ? (
        <section class="cal-rel">
          <span class="cal-eyebrow">Trabaja sobre la tarea</span>
          <a class="cal-ttl" href={`#/nota/${enc(item.taskPath)}`}>{task?.title ?? item.taskPath.replace(/^.*\//, "").replace(/\.md$/i, "")}</a>
          <p class="muted small">
            {task ? [task.status === "doing" ? "En curso" : "Pendiente", task.estimate ? `~${formatDuration(task.estimate)}` : null, task.due ? `vence ${task.due}` : null].filter(Boolean).join(" · ") : "Ya no está pendiente (hecha o descartada)."}
          </p>
        </section>
      ) : (
        <section class="cal-rel loose">
          <span class="cal-eyebrow">{item.kind === "event" ? "Evento" : "Sin tarea asociada"}</span>
          <span class="cal-note">{item.kind === "event" ? "Los eventos son compromisos con horario y no necesitan una tarea; puedes enlazar una cuando quieras." : "Es un bloque suelto: reserva tiempo sin estar atado a una tarea."}</span>
        </section>
      )}
      {!readOnly && <TaskLinker key={item.hash} item={item} tasks={tasks} projects={projects} onLink={onLink} onLinkNew={onLinkNew} />}

      <section class="cal-sect">
        <span class="cal-fl">El {noun}</span>
        <div class="cal-acts">
          {item.kind === "block" && !item.done_at && <button class="primary" onClick={onFinish}>Terminar bloque</button>}
          {item.done_at && <span class="cal-note">Terminado.</span>}
          <button onClick={() => onShift(-1)}>← Un día antes</button>
          <button onClick={() => onShift(1)}>Un día después →</button>
          <button onClick={onDuplicate}>Duplicar</button>
          <button class="danger" onClick={onDelete}>Borrar</button>
        </div>
      </section>

      {item.taskPath && (
        <section class="cal-sect">
          <span class="cal-fl">La tarea</span>
          <div class="cal-acts">
            {task && <button onClick={() => onCompleteTask(task.path)}>Completar tarea</button>}
            <a class="cal-linkbtn" href={`#/nota/${enc(item.taskPath)}`}>Abrir tarea</a>
          </div>
          <p class="cal-note">{item.kind === "event" ? "Completar la tarea no cambia el evento: son cosas separadas." : "Terminar el bloque no completa la tarea ni al revés: son acciones separadas."}</p>
        </section>
      )}
      <div class="cal-acts end"><button onClick={onClose}>Cerrar</button></div>
    </>
  );
}

function GapBody({ gap, tasks, areas, onPick, onCompose, onLeave }: { gap: Gap; tasks: CalendarTask[]; areas: AreaRow[]; onPick(t: CalendarTask, id: string, areaPath: string): Promise<boolean>; onCompose(areaPath: string): void; onLeave(): void }) {
  const [areaPath, setAreaPath] = useState("");
  const fits = fittingTasks(tasks, gap.minutes);
  const [busy, setBusy] = useState(false);
  const ids = useRef(new Map<string, string>()); // un id estable por tarea: reintentar no duplica el bloque
  const pick = async (t: CalendarTask) => {
    if (busy) return;
    if (!ids.current.has(t.path)) ids.current.set(t.path, newId());
    setBusy(true);
    if (!(await onPick(t, ids.current.get(t.path)!, areaPath))) setBusy(false);
  };
  return (
    <>
      <p>{dayName(gap.start.slice(0, 10))} · {hm(gap.start)}–{hm(gap.end)}</p>
      <p class="cal-note">Puedes dejarlo libre: no hace falta llenarlo. Solo se sugieren tareas pendientes con estimación que caben en el hueco.</p>
      <div class="cal-sect"><AreaSelect areas={areas} value={areaPath} onChange={setAreaPath} /></div>
      {fits.length > 0 ? (
        <ul class="cal-sugs">
          {fits.map((t, i) => (
            <li key={t.path}>
              <button class="cal-sug" data-first={i === 0 ? "" : undefined} disabled={busy} onClick={() => void pick(t)}>
                <span class="cal-ttl">{t.title}</span>
                <span class="muted small">{t.projectTitle ? `${t.projectTitle} · ` : ""}~{formatDuration(t.estimate!)}{t.due ? ` · vence ${t.due}` : ""}</span>
                <span class="small">Programar en este hueco →</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p class="cal-warn">△ Ninguna tarea pendiente con estimación entra en {formatDuration(gap.minutes)}.</p>}
      <div class="cal-acts">
        <button data-first={fits.length === 0 ? "" : undefined} onClick={onLeave}>Dejarlo libre</button>
        <button onClick={() => onCompose(areaPath)}>Crear bloque o evento…</button>
      </div>
    </>
  );
}

function Compose({ initial, tasks, areas, items, now, onSubmit, onCancel }: {
  initial: Draft; tasks: CalendarTask[]; areas: AreaRow[]; items: CalendarEntry[]; now: Date; onSubmit(d: Draft, id: string): Promise<boolean>; onCancel(): void;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const id = useRef(newId()); // el mismo id en cada reintento: un doble envío no duplica la actividad
  const endEdited = useRef(false);
  const check = validateTimes(d.start, d.end, now);
  const clash = check.ok ? overlapping(items, d.start, d.end) : [];
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));
  const pickTask = (path: string) => {
    const t = tasks.find((x) => x.path === path);
    const patch: Partial<Draft> = { taskPath: path || undefined };
    if (t && !d.title.trim()) patch.title = t.title;
    if (t?.estimate && !endEdited.current && check.ok) patch.end = addMinutes(d.start, t.estimate);
    set(patch);
  };
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!check.ok || !d.title.trim() || busy) return;
    setBusy(true);
    if (!(await onSubmit(d, id.current))) setBusy(false);
  };
  return (
    <form class="cal-compose" onSubmit={(e) => void submit(e)}>
      <fieldset class="cal-kind">
        <legend>Tipo</legend>
        <label><input type="radio" name="kind" checked={d.kind === "block"} onChange={() => set({ kind: "block" })} /> Bloque</label>
        <label><input type="radio" name="kind" checked={d.kind === "event"} onChange={() => set({ kind: "event" })} /> Evento</label>
      </fieldset>
      <label>Título <input data-first class="wide-input" value={d.title} onInput={(e) => set({ title: e.currentTarget.value })} /></label>
      <DateTime24 label="Empieza" value={d.start} onChange={(start) => set({ start })} />
      <DateTime24 label="Termina" value={d.end} onChange={(end) => { endEdited.current = true; set({ end }); }} />
      <AreaSelect areas={areas} value={d.areaPath ?? ""} onChange={(areaPath) => set({ areaPath })} />
      <label>Tarea
        <select value={d.taskPath ?? ""} onChange={(e) => pickTask(e.currentTarget.value)}>
          <option value="">{d.kind === "block" ? "Sin tarea (bloque suelto)" : "Sin tarea"}</option>
          {[...tasks].sort((a, b) => a.title.localeCompare(b.title)).map((t) => <option key={t.path} value={t.path}>{t.title}{t.estimate ? ` · ~${formatDuration(t.estimate)}` : ""}</option>)}
        </select>
      </label>
      {check.ok ? <p class="cal-note">Dura {formatDuration(check.minutes)}.</p> : <p class="cal-warn" role="alert">{check.error}</p>}
      {check.ok && check.past && <p class="cal-warn">△ Esa hora ya pasó. Puedes guardarla igualmente.</p>}
      {clash.length > 0 && <p class="cal-warn" role="status">△ Se cruza con {clash.map((c) => `«${c.title}» (${hm(c.start)}–${hm(c.end)})`).join(" y ")}. Puedes programarlo igual.</p>}
      <div class="cal-acts"><button class="primary" disabled={!check.ok || !d.title.trim() || busy}>Crear</button><button type="button" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

// ───────────────────────────── Tareas: panel lateral y enlace dentro de una actividad ─────────────────────────────

const EMPTY_TASK: TaskForm = { title: "", due: "", estimate: "", projectPath: "" };
const formOf = (t: CalendarTask): TaskForm => ({ title: t.title, due: t.due ?? "", estimate: t.estimate ? String(t.estimate) : "", projectPath: t.projectPath ?? "" });

/** Fecha, estimación y proyecto: opcionales, comunes a crear, editar y crear-y-enlazar. */
function TaskFields({ form, projects, onChange }: { form: TaskForm; projects: CalendarProject[]; onChange(patch: Partial<TaskForm>): void }) {
  return (
    <>
      <label>Fecha <input type="date" value={form.due} onInput={(e) => onChange({ due: e.currentTarget.value })} /></label>
      <label>Estimación (minutos) <input type="number" inputMode="numeric" min={1} max={1440} placeholder="30" value={form.estimate} onInput={(e) => onChange({ estimate: e.currentTarget.value })} /></label>
      <label>Proyecto
        <select value={form.projectPath} onChange={(e) => onChange({ projectPath: e.currentTarget.value })}>
          <option value="">Sin proyecto</option>
          {/* un proyecto que ya no existe en la lista (borrado) se conserva visible en vez de cambiarlo sin avisar */}
          {form.projectPath && !projects.some((p) => p.path === form.projectPath) && <option value={form.projectPath}>{form.projectPath.replace(/^.*\//, "").replace(/\.md$/i, "")}</option>}
          {projects.map((p) => <option key={p.path} value={p.path}>{p.title}</option>)}
        </select>
      </label>
    </>
  );
}

/** Solo el título es obligatorio. El título se guarda tal cual: «mañana», «p1» o «#etiqueta» no se interpretan. */
function NewTask({ projects, onCreate }: { projects: CalendarProject[]; onCreate(task: TaskValues): Promise<boolean> }) {
  const [form, setForm] = useState(EMPTY_TASK);
  const [busy, setBusy] = useState(false);
  const check = form.title.trim() ? taskInput(form) : null;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!check?.ok || busy) return;
    setBusy(true);
    const ok = await onCreate(check.value);
    setBusy(false);
    if (ok) setForm(EMPTY_TASK);
  };
  return (
    <form class="cal-tnew" onSubmit={(e) => void submit(e)}>
      <label>
        <span class="cal-eyebrow">Nueva tarea</span>
        <input type="text" autoComplete="off" placeholder="Solo el título basta" aria-label="Título de la nueva tarea" value={form.title} disabled={busy} onInput={(e) => setForm({ ...form, title: e.currentTarget.value })} />
      </label>
      <details>
        <summary>Fecha, estimación y proyecto (opcionales)</summary>
        <div class="cal-tfields"><TaskFields form={form} projects={projects} onChange={(patch) => setForm({ ...form, ...patch })} /></div>
      </details>
      {check && !check.ok && <p class="cal-warn" role="alert">{check.error}</p>}
      <p class="cal-note">El título se guarda tal cual, sin interpretar fechas ni etiquetas.</p>
      <button class="primary" disabled={!check?.ok || busy}>Añadir tarea</button>
    </form>
  );
}

/** Edición en el sitio de una tarea del panel: solo se envía lo que cambió. Esc cancela. */
function TaskEdit({ task, projects, onSave, onCancel }: { task: CalendarTask; projects: CalendarProject[]; onSave(patch: TaskPatch): Promise<boolean>; onCancel(): void }) {
  const [form, setForm] = useState(formOf(task));
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => { first.current?.focus(); const o = opener.current; return () => { if (o?.isConnected) o.focus(); }; }, []);
  const check = taskChanges(task, form);
  const dirty = check.ok && Object.keys(check.value).length > 0;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!check.ok || !dirty || busy) return;
    setBusy(true);
    const ok = await onSave(check.value);
    setBusy(false);
    if (ok) onCancel();
  };
  return (
    <form class="cal-tedit" onSubmit={(e) => void submit(e)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}>
      <label>Título <input ref={first} type="text" autoComplete="off" value={form.title} onInput={(e) => setForm({ ...form, title: e.currentTarget.value })} /></label>
      <TaskFields form={form} projects={projects} onChange={(patch) => setForm({ ...form, ...patch })} />
      {!check.ok && <p class="cal-warn" role="alert">{check.error}</p>}
      <div class="cal-acts"><button class="primary" disabled={!dirty || busy}>Guardar</button><button type="button" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

function TaskRow({ task, projects, readOnly, today, onComplete, onSave, onSchedule }: { task: CalendarTask; projects: CalendarProject[]; readOnly: boolean; today: string; onComplete(path: string): Promise<void>; onSave(task: CalendarTask, patch: TaskPatch): Promise<boolean>; onSchedule(task: CalendarTask): void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const completing = useRef(false);
  const complete = async (button: HTMLButtonElement) => {
    if (completing.current) return;
    completing.current = true;
    // La fila puede desaparecer al recargar: dejar el foco en otra fila o en el encabezado estable.
    if (document.activeElement === button) {
      const row = button.closest("li");
      const target = row?.nextElementSibling?.querySelector<HTMLElement>("button") ?? row?.previousElementSibling?.querySelector<HTMLElement>("button") ?? button.closest("aside")?.querySelector<HTMLElement>("h2");
      target?.focus();
    }
    setBusy(true);
    try { await onComplete(task.path); } finally { completing.current = false; setBusy(false); }
  };
  // Cerrar la edición desmonta el botón «Editar» que la abrió: al volver a pintarse la fila, el foco pasa al botón nuevo de esta misma fila.
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing || !restoreFocus.current) return;
    restoreFocus.current = false;
    editButton.current?.focus();
  }, [editing]);
  if (editing) return <li class="cal-task editing"><TaskEdit task={task} projects={projects} onSave={(patch) => onSave(task, patch)} onCancel={() => { restoreFocus.current = true; setEditing(false); }} /></li>;
  const meta = [task.status === "doing" ? "En curso" : null, task.projectTitle, task.estimate ? `~${formatDuration(task.estimate)}` : null, task.due ? taskDueLabel(task.due, today) : null].filter(Boolean);
  return (
    <li class="cal-task" draggable
      onDragStart={(e) => { e.dataTransfer?.setData(TASK_MIME, task.path); if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy"; }}>
      <span class="cal-grip" aria-hidden="true">⠿</span>
      <span class="cal-tbody"><b>{task.title}</b>{meta.length > 0 && <small title={task.due ?? undefined}>{meta.join(" · ")}</small>}</span>
      <span class="cal-tacts">
        <button type="button" class="mini" disabled={busy} aria-label={`Completar «${task.title}»`} onClick={(e) => void complete(e.currentTarget)}>Completar</button>
        <button class="mini" aria-label={`Programar «${task.title}» en el calendario`} onClick={() => onSchedule(task)}>Programar</button>
        {!readOnly && <button ref={editButton} class="mini" aria-label={`Editar «${task.title}»`} onClick={() => setEditing(true)}>Editar</button>}
      </span>
    </li>
  );
}

/** Tareas pendientes junto al calendario. Arrastrar una a la cuadrícula del día o a un día de la semana la convierte en un bloque con hora; «Programar» hace lo mismo con teclado o táctil. */
function TaskPanel({ tasks, projects, readOnly, today, onComplete, onCreate, onSave, onSchedule }: {
  tasks: CalendarTask[]; projects: CalendarProject[]; readOnly: boolean; today: string; onComplete(path: string): Promise<void>; onCreate(task: TaskValues): Promise<boolean>; onSave(task: CalendarTask, patch: TaskPatch): Promise<boolean>; onSchedule(task: CalendarTask): void;
}) {
  const pending = pendingTasks([...tasks]);
  return (
    <aside class="cal-tasks" aria-label="Tareas pendientes">
      <h2 tabIndex={-1}>Tareas pendientes <span class="muted small">{pending.length}</span></h2>
      {!readOnly && <NewTask projects={projects} onCreate={onCreate} />}
      <p class="cal-note">Arrastra una tarea al calendario para darle hora, o usa «Programar». La tarea y su bloque se completan por separado.</p>
      {pending.length ? <ul class="cal-tlist">{pending.map((t) => <TaskRow key={t.path} task={t} projects={projects} readOnly={readOnly} today={today} onComplete={onComplete} onSave={onSave} onSchedule={onSchedule} />)}</ul> : <p class="cal-note">No hay tareas pendientes.</p>}
    </aside>
  );
}

/** Dentro de una actividad (también un evento): enlazar una tarea existente, cambiarla, quitarla o crear una nueva, en cualquier momento. */
function TaskLinker({ item, tasks, projects, onLink, onLinkNew }: {
  item: CalendarEntry; tasks: CalendarTask[]; projects: CalendarProject[]; onLink(taskPath: string | null): Promise<boolean>; onLinkNew(task: TaskValues): Promise<boolean>;
}) {
  const [open, setOpen] = useState(!item.taskPath);
  const [pick, setPick] = useState("");
  const [form, setForm] = useState(EMPTY_TASK);
  const [busy, setBusy] = useState(false);
  const options = pendingTasks([...tasks]).filter((t) => t.path !== item.taskPath);
  const check = form.title.trim() ? taskInput(form) : null;
  const run = async (fn: () => Promise<boolean>) => { if (busy) return; setBusy(true); const ok = await fn(); setBusy(false); if (ok) setOpen(false); };
  return (
    <section class="cal-sect cal-linker">
      <span class="cal-fl">Tarea de {item.kind === "event" ? "este evento" : "este bloque"}</span>
      {item.taskPath && !open && (
        <div class="cal-acts">
          <button disabled={busy} onClick={() => setOpen(true)}>Cambiar tarea</button>
          <button disabled={busy} onClick={() => void run(() => onLink(null))}>Quitar enlace</button>
        </div>
      )}
      {open && (
        <>
          <div class="cal-lrow">
            <label>{item.taskPath ? "Otra tarea existente" : "Enlazar una tarea existente"}
              <select value={pick} disabled={busy || options.length === 0} onChange={(e) => setPick(e.currentTarget.value)}>
                <option value="">{options.length ? "Elegir tarea…" : "No hay otras tareas pendientes"}</option>
                {options.map((t) => <option key={t.path} value={t.path}>{t.title}{t.estimate ? ` · ~${formatDuration(t.estimate)}` : ""}</option>)}
              </select>
            </label>
            <button disabled={!pick || busy} onClick={() => void run(() => onLink(pick))}>Enlazar</button>
          </div>
          <form class="cal-lnew" onSubmit={(e) => { e.preventDefault(); if (check?.ok) void run(() => onLinkNew(check.value)); }}>
            <label>O crear una tarea nueva <input type="text" autoComplete="off" placeholder="Solo el título basta" value={form.title} disabled={busy} onInput={(e) => setForm({ ...form, title: e.currentTarget.value })} /></label>
            <details>
              <summary>Fecha, estimación y proyecto (opcionales)</summary>
              <div class="cal-tfields"><TaskFields form={form} projects={projects} onChange={(patch) => setForm({ ...form, ...patch })} /></div>
            </details>
            {check && !check.ok && <p class="cal-warn" role="alert">{check.error}</p>}
            <div class="cal-acts"><button class="primary" disabled={!check?.ok || busy}>Crear y enlazar</button>{item.taskPath && <button type="button" onClick={() => setOpen(false)}>Cancelar</button>}</div>
          </form>
        </>
      )}
    </section>
  );
}
