// Tipos compartidos con el backend (solo tipos: se borran al empaquetar).
export type { TodayView, ResumeCard, FocusState, Suggestion, CaptureResult } from "../../src/core/jarvis.ts";
export type { TaskRow, SearchHit, Backlink, NoteType, TaskStatus } from "../../src/core/index.ts";
export type { Proposal, Op } from "../../src/core/proposals.ts";

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
