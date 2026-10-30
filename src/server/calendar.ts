// API del calendario: validación de rango, DTO sin relaciones crudas y visibilidad para el rol `mobile`.
import type { Kioku } from "../core/kioku.ts";
import { relationTarget } from "../core/index.ts";
import { VaultError } from "../core/vault.ts";
import type { CalendarItem } from "../core/calendar.ts";
import type { CalendarInput } from "../core/calendar-store.ts";
import { calendarVisible, isPrivate } from "./mobile.ts";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** El resto de rutas devuelven errores de la bóveda; los de fecha del núcleo llegan como `Error` simples. */
function invalid<T>(fn: () => T): T {
  try { return fn(); }
  catch (e) { throw e instanceof VaultError ? e : new VaultError("invalid", (e as Error).message); }
}

/** La actividad sin `task`/`project` crudos: la UI solo usa las rutas ya resueltas. */
export function calendarDto(item: CalendarItem): Omit<CalendarItem, "task" | "project"> {
  const { task: _task, project: _project, ...rest } = item;
  return rest;
}

const resolver = (j: Kioku) => (raw: string) => j.index.resolve(relationTarget(raw) ?? "");

/** `exclude`: carpetas privadas del móvil; sin ella (rol completo) se devuelve todo. */
export function calendarRange(j: Kioku, from: unknown, to: unknown, exclude?: string[]) {
  if (typeof from !== "string" || typeof to !== "string" || !DAY.test(from) || !DAY.test(to)) throw new VaultError("invalid", "Indica «from» y «to» como YYYY-MM-DD");
  const r = invalid(() => j.calendar.range(from, to));
  const items = exclude ? r.items.filter((i) => calendarVisible(i, exclude, resolver(j))) : r.items;
  return { ...r, items: items.map(calendarDto) };
}

/** La actividad tal como la ve el núcleo (con sus relaciones crudas), o `null` si no es una actividad válida. */
function find(j: Kioku, path: string): CalendarItem | null {
  const start = j.index.getNote(path)?.fm.start;
  if (typeof start !== "string" || !DAY.test(start.slice(0, 10))) return null;
  try { return j.calendar.range(start.slice(0, 10), start.slice(0, 10)).items.find((i) => i.path === path) ?? null; }
  catch { return null; }
}

/** Mover o terminar desde el móvil: una actividad oculta (o inexistente) es indistinguible de una que no existe. */
export function assertMobileItem(j: Kioku, path: string, exclude: string[]): void {
  const item = find(j, path);
  if (!item || !calendarVisible(item, exclude, resolver(j))) throw new VaultError("not-found", "No existe");
}

/** Crear con una tarea visible cuyo proyecto es privado dejaría la actividad apuntando a lo privado (el proyecto se hereda de la tarea). */
export function createsPrivateLink(j: Kioku, input: CalendarInput, exclude: string[]): boolean {
  if (!input.taskPath || input.projectPath) return false;
  const project = j.index.getNote(input.taskPath)?.fm.project;
  const target = project ? j.index.resolve(relationTarget(project) ?? "") : null;
  return !!target && isPrivate(target, exclude);
}
