// Cálculos de los seguimientos visuales (hábitos y lectura), sin interfaz: días, marcar/desmarcar, racha y totales.
import type { ResultRow } from "./types.ts";

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const at = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Los últimos `n` días hasta `today` (incluido), del más antiguo al más reciente. */
export function lastDays(today: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => iso(at(today) - (n - 1 - i) * DAY));
}

export const daysOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) : []);

/** Marca el día si no estaba y lo quita si estaba; la lista queda ordenada y sin repetidos. */
export function toggleDay(list: unknown, day: string): string[] {
  const set = new Set(daysOf(list));
  if (set.has(day)) set.delete(day); else set.add(day);
  return [...set].sort();
}

/** Días seguidos hasta hoy. Si hoy aún no está marcado, la racha que llega hasta ayer sigue viva. */
export function streak(list: unknown, today: string): number {
  const set = new Set(daysOf(list));
  let t = set.has(today) ? at(today) : at(today) - DAY;
  let n = 0;
  while (set.has(iso(t))) { n++; t -= DAY; }
  return n;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Capítulos leídos sobre el total, libros terminados y porcentaje entero. */
export function readingTotals(rows: Pick<ResultRow, "cells">[], track: string, total: string) {
  let read = 0, all = 0, done = 0;
  for (const r of rows) {
    const t = num(r.cells[total]);
    const v = Math.min(num(r.cells[track]), t || Infinity);
    read += v; all += t;
    if (t > 0 && v >= t) done++;
  }
  return { read, total: all, done, pct: all ? Math.round((read / all) * 100) : 0 };
}
