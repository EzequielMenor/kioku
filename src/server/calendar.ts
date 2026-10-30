// API del calendario: validación de rango, DTO sin relaciones crudas y visibilidad para el rol `mobile`.
import type { Kioku } from "../core/kioku.ts";
import { relationTarget } from "../core/index.ts";
import { VaultError } from "../core/vault.ts";
import { AREA_FOLDER } from "../core/areas.ts";
import type { CalendarItem } from "../core/calendar.ts";
import type { CalendarInput } from "../core/calendar-store.ts";
import { isPrivate } from "./mobile.ts";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** El resto de rutas devuelven errores de la bóveda; los de fecha del núcleo llegan como `Error` simples. */
function invalid<T>(fn: () => T): T {
  try { return fn(); }
  catch (e) { throw e instanceof VaultError ? e : new VaultError("invalid", (e as Error).message); }
}

/** La actividad sin `task`/`project`/`area` crudos: la UI solo usa las rutas ya resueltas. */
export function calendarDto(item: CalendarItem): Omit<CalendarItem, "task" | "project" | "area"> {
  const { task: _task, project: _project, area: _area, ...rest } = item;
  return rest;
}

const FOLDER = "Calendario";

/** Una relación cruda (`[[Nota]]`) es inaccesible desde el móvil si no se resuelve (podría apuntar a algo privado) o cae en una carpeta privada. */
function hiddenRef(j: Kioku, raw: unknown, exclude: string[]): boolean {
  if (!raw) return false;
  const target = relationTarget(raw);
  const path = target ? j.index.resolve(target) : null;
  return !path || isPrivate(path, exclude);
}

/** ¿La tarea (ruta ya resuelta) tiene un proyecto que el móvil no puede ver? La actividad hereda ese proyecto. */
function taskProjectHidden(j: Kioku, taskPath: string, exclude: string[]): boolean {
  return hiddenRef(j, j.index.getNote(taskPath)?.fm.project, exclude);
}

/**
 * Rutas de actividades de calendario que el móvil no ve aunque su carpeta no sea privada: su tarea, su proyecto (también el
 * heredado de la tarea) o su área es privado o no se resuelve. Se suman a las carpetas privadas, así que todas las rutas genéricas
 * (listas, búsqueda, sincronización, nota, grafo, eventos…) las tratan igual que a una nota privada.
 */
export function hiddenCalendarPaths(j: Kioku, exclude: string[]): string[] {
  const hidden: string[] = [];
  for (const { path } of j.index.listNotes({ type: "block", limit: 1_000_000 })) {
    if (isPrivate(path, exclude)) continue;
    const fm = j.index.getNote(path)?.fm ?? {};
    const task = fm.task ? j.index.resolve(relationTarget(fm.task) ?? "") : null;
    if (hiddenRef(j, fm.task, exclude) || hiddenRef(j, fm.project, exclude) || hiddenRef(j, fm.area, exclude) || (task && taskProjectHidden(j, task, exclude))) hidden.push(path);
  }
  return hidden;
}

/** `exclude` ya incluye las actividades ocultas; el filtrado de lo privado lo hace `mobileView`. */
export function calendarRange(j: Kioku, from: unknown, to: unknown) {
  if (typeof from !== "string" || typeof to !== "string" || !DAY.test(from) || !DAY.test(to)) throw new VaultError("invalid", "Indica «from» y «to» como YYYY-MM-DD");
  const r = invalid(() => j.calendar.range(from, to));
  // `areas` viaja con el rango para que la UI pinte etiquetas y filtros con una sola lectura; `mobileView` quita las privadas.
  return { ...r, items: r.items.map(calendarDto), areas: j.areas.list() };
}

/** Mover o terminar desde el móvil: lo que no es una actividad es indistinguible de una oculta (404). Las ocultas ya las corta `touchesPrivate`. */
export function assertMobileItem(j: Kioku, path: string): void {
  if (j.index.getNote(path)?.type !== "block") throw new VaultError("not-found", "No existe");
}

/**
 * Crear desde el móvil queda denegado si el destino cae en una carpeta privada (`"private"`, 403), si el identificador ya es de una
 * actividad oculta (`"taken"`, 409: igual que un conflicto normal) o si la tarea tiene un proyecto privado o sin resolver, porque la
 * actividad nacería oculta para quien la crea (`"private"`).
 */
export function mobileCreateDenied(j: Kioku, input: CalendarInput, config: string[], effective: string[]): "private" | "taken" | null {
  const target = `${FOLDER}/${input.id}.md`;
  if (isPrivate(target, config)) return "private";
  if (isPrivate(target, effective)) return "taken";
  const task = input.taskPath ? j.index.getNote(input.taskPath) : null;
  return task && taskProjectHidden(j, task.path, config) ? "private" : null;
}

/** Crear un área desde el móvil: su ruta (`Areas/<id>.md`) la fija el identificador, así que si cae en una carpeta privada se deniega antes de escribir. */
export function mobileAreaCreateDenied(id: string, config: string[]): boolean {
  return isPrivate(`${AREA_FOLDER}/${id}.md`, config);
}
