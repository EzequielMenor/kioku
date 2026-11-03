// Cuadrícula horaria del día y línea de creación rápida. La lógica (posiciones, ajuste a 15 min) vive en calendar-grid.ts.
import { useEffect, useRef, useState } from "preact/hooks";
import { parseQuickAdd } from "../../src/core/quick-add.ts";
import { TASK_MIME, areaLabel, formatDuration, minuteStamp } from "./calendar-model.ts";
import { createRange, gridWindow, layoutDay, minuteToY, moveRange, resizeRange, yToMinute } from "./calendar-grid.ts";
import type { CalendarEntry } from "./types.ts";

/** Píxeles por minuto: 15 min = 18 px, el mínimo cómodo para un bloque con una línea de texto. */
export const PX = 1.2;
const pad = (n: number) => String(n).padStart(2, "0");
const hm = (minute: string) => minute.slice(11);

interface Draft { a: number; b: number; held: boolean; title: string }

/** Un arrastre de más de 4 px es mover o redimensionar; menos es un clic. */
const CLICK_SLOP = 4;
type Drag = { path: string; mode: "move" | "start" | "end"; pointer: number; y0: number; moved: boolean; start: string; end: string };

export function DayGrid({ day, items, now, today, onOpen, onCreate, onChange, onDropTask }: {
  day: string; items: CalendarEntry[]; now: Date; today: string;
  onOpen(path: string): void; onCreate(title: string, start: string, end: string): Promise<boolean>;
  onChange(item: CalendarEntry, start: string, end: string): Promise<boolean>;
  /** Una tarea del panel se soltó en la cuadrícula: `start` es la hora (ajustada a 15 min) bajo el puntero. */
  onDropTask?(taskPath: string, start: string): void;
}) {
  const win = gridWindow(items, day);
  const placed = layoutDay(items, day, win);
  const body = useRef<HTMLDivElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const gesture = useRef<{ pointer: number; a: number; b: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{ path: string; start: string; end: string } | null>(null);
  const hours = Array.from({ length: (win.to - win.from) / 60 + 1 }, (_, i) => win.from / 60 + i);
  const nowMin = day === today ? now.getHours() * 60 + now.getMinutes() : null;
  const minuteAt = (e: { clientY: number }) => yToMinute(e.clientY - body.current!.getBoundingClientRect().top, PX, win);
  // Arrastre HTML5 de una tarea del panel (con el ratón): no interfiere con los eventos de puntero de crear, mover y redimensionar.
  const taskDrag = (e: DragEvent) => !!onDropTask && Array.from(e.dataTransfer?.types ?? []).includes(TASK_MIME);
  const overTask = (e: DragEvent) => {
    if (!taskDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    setDropAt(minuteAt(e));
  };
  const leaveTask = (e: DragEvent) => { if (!body.current?.contains(e.relatedTarget as Node | null)) setDropAt(null); };
  const dropTask = (e: DragEvent) => {
    if (!taskDrag(e)) return;
    e.preventDefault();
    const taskPath = e.dataTransfer?.getData(TASK_MIME);
    const at = minuteAt(e);
    setDropAt(null);
    if (taskPath) onDropTask!(taskPath, minuteStamp(day, at));
  };

  useEffect(() => { gesture.current = null; setDraft(null); }, [day]);
  // Móvil: el día de hoy se abre en la hora actual, no a las 07:00 con la mañana vacía. Solo se desplaza si la hora queda abajo: por la mañana la cabecera sigue a la vista.
  useEffect(() => {
    if (day !== today || !matchMedia("(max-width: 720px)").matches) return;
    const line = body.current?.querySelector(".cal-gnow"), scroller = document.querySelector("main");
    if (!line || !scroller) return;
    const top = line.getBoundingClientRect().top;
    if (top > innerHeight - 200) scroller.scrollTop += top - innerHeight * 0.35; // 200 px: la barra inferior y algo de margen
  }, [day, today]);
  // `autoFocus` solo vale al montar la página: el campo aparece al soltar el puntero, así que se enfoca a mano.
  const typing = draft !== null && !draft.held;
  useEffect(() => { if (typing) titleInput.current?.focus(); }, [typing]);

  const down = (e: PointerEvent) => {
    if (e.button !== 0 || busy) return;
    const m = minuteAt(e);
    body.current!.setPointerCapture(e.pointerId);
    gesture.current = { pointer: e.pointerId, a: m, b: m };
    setDraft({ a: m, b: m, held: true, title: "" });
  };
  const move = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    g.b = minuteAt(e);
    setDraft({ a: g.a, b: g.b, held: true, title: "" });
  };
  const up = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    g.b = minuteAt(e);
    gesture.current = null;
    setDraft({ a: g.a, b: g.b, held: false, title: "" });
  };
  // Escape durante un arrastre lo cancela sin escribir nada.
  const dragging = preview !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { drag.current = null; suppressClick.current = true; setPreview(null); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dragging]);

  const evDown = (e: PointerEvent, item: CalendarEntry, editable: boolean) => {
    e.stopPropagation();
    if (e.button !== 0 || !editable || busy) return;
    const edge = (e.target as HTMLElement).dataset.edge;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { path: item.path, mode: edge === "start" || edge === "end" ? edge : "move", pointer: e.pointerId, y0: e.clientY, moved: false, start: item.start, end: item.end };
  };
  const rangeFor = (d: Drag, item: CalendarEntry, clientY: number) => {
    const delta = Math.round((clientY - d.y0) / PX);
    return d.mode === "move" ? moveRange(item, delta) : resizeRange(item, d.mode, delta);
  };
  const evMove = (e: PointerEvent, item: CalendarEntry) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId || d.path !== item.path) return;
    if (!d.moved && Math.abs(e.clientY - d.y0) < CLICK_SLOP) return;
    d.moved = true;
    setPreview({ path: item.path, ...rangeFor(d, item, e.clientY) });
  };
  const evUp = async (e: PointerEvent, item: CalendarEntry) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId || d.path !== item.path) return;
    drag.current = null;
    if (!d.moved) return; // un clic: lo atiende onClick
    suppressClick.current = true;
    const r = rangeFor(d, item, e.clientY);
    if (r.start === item.start && r.end === item.end) { setPreview(null); return; }
    await onChange(item, r.start, r.end);
    setPreview(null);
  };
  const evCancel = () => { if (drag.current) { drag.current = null; setPreview(null); } };

  const cancel = (e: PointerEvent) => { if (gesture.current?.pointer === e.pointerId) { gesture.current = null; setDraft(null); } };

  const range = draft ? createRange(day, draft.a, draft.b) : null;
  const rangeMinute = (value: string) => value.slice(0, 10) === day ? Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16)) : 1440;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!draft || !range || !draft.title.trim() || busy) return;
    setBusy(true);
    const ok = await onCreate(draft.title.trim(), range.start, range.end);
    setBusy(false);
    if (ok) setDraft(null);
  };

  return (
    <div class="cal-grid" style={{ height: `${(win.to - win.from) * PX}px` }}>
      <div class="cal-gutter" aria-hidden="true">
        {hours.slice(0, -1).map((h) => <span key={h} style={{ top: `${minuteToY(h * 60, PX, win)}px` }}>{pad(h % 24)}:00</span>)}
      </div>
      <div ref={body} class="cal-gbody" role="group" aria-label="Horas del día: arrastra en un hueco para crear una actividad o suelta una tarea del panel para programarla"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
        onDragOver={overTask} onDragLeave={leaveTask} onDrop={dropTask}>
        {hours.map((h) => <i key={h} class="cal-hline" style={{ top: `${minuteToY(h * 60, PX, win)}px` }} />)}
        {dropAt !== null && <i class="cal-gdrop" style={{ top: `${minuteToY(dropAt, PX, win)}px` }}><span>{hm(minuteStamp(day, dropAt))}</span></i>}
        {nowMin !== null && nowMin >= win.from && nowMin <= win.to && <i class="cal-gnow" style={{ top: `${minuteToY(nowMin, PX, win)}px` }} />}
        {placed.map((p) => {
          const item = items.find((i) => i.path === p.path)!;
          const area = areaLabel(item);
          const editable = !p.continued && !p.continues;
          const live = preview?.path === p.path ? preview : null;
          const top = live ? rangeMinute(live.start) - win.from : p.top, height = live ? rangeMinute(live.end) - rangeMinute(live.start) : p.height;
          return (
            <button key={p.path} type="button" class={`cal-ev st-${item.state} ${item.kind} ${p.continued ? "carried" : ""} ${editable ? "movable" : ""} ${live ? "dragging" : ""}`} aria-haspopup="dialog"
              style={{ top: `${top * PX}px`, height: `${height * PX - 2}px`, left: `calc(${(p.col / p.cols) * 100}% + 2px)`, width: `calc(${100 / p.cols}% - 4px)`, borderLeftColor: area.color ?? "var(--line2)" }}
              onPointerDown={(e) => evDown(e, item, editable)} onPointerMove={(e) => evMove(e, item)} onPointerUp={(e) => void evUp(e, item)} onPointerCancel={evCancel}
              onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onOpen(p.path); }}>
              {editable && <span class="cal-rz top" data-edge="start" aria-hidden="true" />}
              <b>{item.kind === "event" ? "◆ " : ""}{item.title}</b>
              <small>{live ? `${hm(live.start)}–${hm(live.end)}` : `${hm(item.start)}–${hm(item.end)}`} · {formatDuration(height)}</small>
              {editable && <span class="cal-rz bottom" data-edge="end" aria-hidden="true" />}
            </button>
          );
        })}
        {draft && range && (
          <form class="cal-ev draft" onSubmit={(e) => void submit(e)} onPointerDown={(e) => e.stopPropagation()}
            style={{ top: `${(rangeMinute(range.start) - win.from) * PX}px`, height: `${(rangeMinute(range.end) - rangeMinute(range.start)) * PX - 2}px` }}>
            {!draft.held && (
              <input ref={titleInput} aria-label={`Título de la nueva actividad, ${hm(range.start)} a ${hm(range.end)}`} placeholder={`${hm(range.start)}–${hm(range.end)} · Título y Enter`}
                value={draft.title} disabled={busy} onInput={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
                onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setDraft(null); } }}
                onBlur={() => { if (!draft.title.trim() && !busy && !gesture.current) setDraft(null); }} />
            )}
            {draft.held && <small>{hm(range.start)}–{hm(range.end)}</small>}
          </form>
        )}
      </div>
    </div>
  );
}

/** Una línea con texto natural: «gym mañana 18-19». Muestra lo que entendió antes de crear. */
export function QuickAdd({ now, onCreate }: { now: Date; onCreate(title: string, start: string, end: string): Promise<boolean> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = text.trim() ? parseQuickAdd(text, now) : null;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!parsed?.ok || busy) return;
    setBusy(true);
    const ok = await onCreate(parsed.title, parsed.start, parsed.end);
    setBusy(false);
    if (ok) setText("");
  };
  return (
    <form class="cal-quick" onSubmit={(e) => void submit(e)}>
      <label>
        <span class="cal-eyebrow">Añadir rápido</span>
        <input type="text" value={text} disabled={busy} placeholder="gym mañana 18-19" autoComplete="off" onInput={(e) => setText(e.currentTarget.value)} />
      </label>
      <p class="cal-note" role="status" aria-live="polite">
        {!parsed ? "Escribe qué, cuándo y a qué hora; Enter crea un evento." : parsed.ok ? `◆ ${parsed.title} · ${parsed.start.slice(0, 10)} · ${hm(parsed.start)}–${hm(parsed.end)}` : parsed.error}
      </p>
    </form>
  );
}
