// Local calendar minutes are intentionally zone-less; only completion is an instant.
export interface BlockData {
  kind: "block" | "event";
  start: string;
  end: string;
  task?: string;
  project?: string;
  done_at?: string;
}
export interface CalendarItem extends BlockData {
  path: string;
  title: string;
  hash: string;
  taskPath: string | null;
  projectPath: string | null;
  projectTitle: string | null;
  state: CalendarState;
}
export type CalendarState = "pending" | "active" | "unfinished" | "past" | "done";
export interface Gap { start: string; end: string; minutes: number }

export function localMinute(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseLocal(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Fecha local inválida (YYYY-MM-DDTHH:mm)");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || localMinute(date) !== value) throw new Error("Fecha local inválida (YYYY-MM-DDTHH:mm)");
  return date;
}

export function parseBlock(fm: Record<string, unknown>): BlockData {
  if (fm.kind !== "block" && fm.kind !== "event") throw new Error("Tipo de actividad inválido");
  const start = parseLocal(fm.start), end = parseLocal(fm.end);
  if (end <= start) throw new Error("El fin debe ser posterior al inicio");
  if (fm.kind === "event" && (fm.task || fm.done_at)) throw new Error("Un evento no puede tener tarea ni terminarse como bloque");
  for (const key of ["task", "project", "done_at"] as const) {
    if (fm[key] !== undefined && fm[key] !== null && typeof fm[key] !== "string") throw new Error(`Propiedad inválida: ${key}`);
  }
  if (fm.done_at && !Number.isFinite(Date.parse(String(fm.done_at)))) throw new Error("Fecha de finalización inválida");
  return {
    kind: fm.kind, start: fm.start as string, end: fm.end as string,
    ...(fm.task ? { task: fm.task as string } : {}),
    ...(fm.project ? { project: fm.project as string } : {}),
    ...(fm.done_at ? { done_at: fm.done_at as string } : {}),
  };
}

export function taskEstimate(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function calendarState(block: BlockData, now: Date): CalendarState {
  if (block.done_at) return "done";
  if (now < parseLocal(block.start)) return "pending";
  if (now < parseLocal(block.end)) return "active";
  return block.kind === "event" ? "past" : "unfinished";
}

/** Union occupied ranges before finding gaps; overlapping activities never double-count. */
export function freeGaps(blocks: BlockData[], day: string): Gap[] {
  const start = `${day}T07:00`, end = `${day}T22:00`;
  parseLocal(start); parseLocal(end);
  const occupied = blocks.filter((b) => b.start < end && b.end > start)
    .map((b) => ({ start: b.start < start ? start : b.start, end: b.end > end ? end : b.end }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const gaps: Gap[] = [];
  let cursor = start;
  const add = (a: string, b: string) => {
    if (a < b) gaps.push({ start: a, end: b, minutes: Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 60_000) });
  };
  for (const b of occupied) {
    add(cursor, b.start);
    if (b.end > cursor) cursor = b.end;
  }
  add(cursor, end);
  return gaps;
}
