// Tipos compartidos con el backend (solo tipos: se borran al empaquetar).
export type { TodayView, ResumeCard, FocusState, Suggestion, CaptureResult } from "../../src/core/kioku.ts";
export type { TaskRow, SearchHit, Backlink, NoteType, TaskStatus } from "../../src/core/index.ts";
export type { Proposal, Op } from "../../src/core/proposals.ts";
import type { CalendarItem } from "../../src/core/calendar.ts";
import type { TaskRow } from "../../src/core/index.ts";
export type { CalendarState, Gap } from "../../src/core/calendar.ts";

/** Actividad tal como la devuelve la API: con las rutas ya resueltas y sin las relaciones crudas `task`/`project`. */
export type CalendarEntry = Omit<CalendarItem, "task" | "project">;
export type CalendarTask = TaskRow & { estimate: number | null };
export interface CalendarResponse { items: CalendarEntry[]; tasks: CalendarTask[]; invalid: { path: string }[]; now: string }

export interface NoteListItem { path: string; title: string; type: string; mtime: number; tags?: string[] }
export interface NoteInfo {
  path: string;
  text: string;
  hash: string;
  note: { title: string; type: string; tags: string[]; fm: Record<string, unknown>; fmError: boolean } | null;
  backlinks: { path: string; title: string; type: string; context: string }[];
  outgoing: { target: string; path: string | null; title: string | null }[];
  unlinked: { path: string; title: string; type: string; context: string }[];
}
export type { UndoRecord } from "../../src/assistant/undo.ts";
export type { Column, Filter, FilterOp, PropType, QueryResult, ResultRow, Sort, View } from "../../src/core/database.ts";
