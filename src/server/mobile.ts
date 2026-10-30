// Acceso desde el móvil: lista blanca del rol `mobile` (la impone el servidor, la UI solo la refleja),
// privacidad (`.kioku/mobile.json`: carpetas que nunca salen del portátil) y filtrado de respuestas.
import path from "node:path";
import { isExcludedPath, parseAssistantConfig } from "../assistant/policy.ts";

export type Role = "full" | "mobile";

/** Lo único que el móvil puede escribir: capturar, tareas y notas. Borrar, asistente, escritorio y mantenimiento quedan fuera. */
const WRITES = new Set([
  "POST /api/capture", "POST /api/capture/convert", "POST /api/note/create", "PUT /api/note", "POST /api/note/props",
  "POST /api/task/status", "POST /api/journal", "POST /api/note/open",
  "POST /api/database/query", // lectura que viaja por POST
  "POST /api/calendar/create", "POST /api/calendar/move", "POST /api/calendar/finish", // calendario en línea; sin cola sin conexión
]);

const under = (p: string, base: string) => p === base || p.startsWith(`${base}/`);

export function mobileAllowed(method: string, p: string): boolean {
  if (method === "GET") return !(under(p, "/api/assistant") || under(p, "/api/proposals") || under(p, "/api/ai"));
  return WRITES.has(`${method} ${p}`);
}

/** Parámetros que nombran una nota: si alguno cae en una carpeta privada, la petición no se atiende. */
const PATH_PARAMS = ["path", "focus", "project", "taskPath", "projectPath"];

/** Ruta sin trucos (`//`, `./`, `a/../b`, `\`) antes de compararla con las carpetas privadas. */
const canonical = (p: string) => path.posix.normalize(p.replace(/\\/g, "/")).replace(/^(\.?\/)+/, "");

export const isPrivate = (p: string, exclude: string[]) => isExcludedPath(p, exclude) || isExcludedPath(canonical(p), exclude);

export function touchesPrivate(sources: (URLSearchParams | Record<string, unknown>)[], exclude: string[]): boolean {
  return sources.some((s) => PATH_PARAMS.some((k) => {
    const v = s instanceof URLSearchParams ? s.get(k) : s[k];
    return typeof v === "string" && isPrivate(v, exclude);
  }));
}

/** `.kioku/mobile.json`: `{ "exclude": ["Privado/"] }`. Sin fichero = nada privado; roto = falla cerrado. */
export function parseMobileConfig(text: string | null): string[] {
  try {
    return parseAssistantConfig(text).exclude;
  } catch {
    throw new Error("mobile.json no es JSON válido: corrígelo para usar Kioku en el móvil (así no se salta ninguna carpeta privada)");
  }
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);

/** Claves que nombran una nota en las respuestas (la tarea de un foco, el proyecto de una tarea…). */
const NOTE_KEYS = ["path", "projectPath", "taskPath"];
const names = (o: Obj, exclude: string[]) => NOTE_KEYS.some((k) => typeof o[k] === "string" && isPrivate(o[k] as string, exclude));
/** El objeto es de una nota privada, o lleva una (`{ task: {…privada…} }`, `{ project: {…} }`). */
const touches = (o: Obj, exclude: string[]) => names(o, exclude) || Object.values(o).some((x) => isObj(x) && names(x, exclude));

/** Quita lo privado: los elementos de las listas desaparecen; un objeto suelto que lo toca queda en `null`. */
function clean(v: unknown, exclude: string[]): unknown {
  if (Array.isArray(v)) return v.filter((x) => !(isObj(x) && touches(x, exclude))).map((x) => clean(x, exclude));
  if (!isObj(v)) return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, isObj(x) && touches(x, exclude) ? null : clean(x, exclude)]));
}

/** «Hoy»: si la mejor tarea es privada se sugiere la mejor visible, y el foco o los proyectos privados no aparecen. */
function todayView(t: Obj, exclude: string[]): unknown {
  const visible = [t.suggestion, ...(Array.isArray(t.alternatives) ? t.alternatives : [])].filter((s) => isObj(s) && !touches(s, exclude));
  const inbox = isObj(t.inbox) && Array.isArray(t.inbox.items) ? t.inbox : null;
  const hidden = inbox ? (inbox.items as unknown[]).length - (clean(inbox.items, exclude) as unknown[]).length : 0;
  const base = clean({ ...t, suggestion: null, alternatives: [], focus: isObj(t.focus) && touches(t.focus, exclude) ? { active: false } : t.focus }, exclude) as Obj;
  return {
    ...base, suggestion: clean(visible[0] ?? null, exclude), alternatives: clean(visible.slice(1), exclude),
    ...(inbox && hidden ? { inbox: { ...(base.inbox as Obj), count: Math.max(0, Number(inbox.count) - hidden) } } : {}),
  };
}

/** Respuesta de lectura sin nada de las carpetas privadas. */
export function mobileView(route: string, v: unknown, exclude: string[]): unknown {
  if (!exclude.length) return v;
  if (route === "/api/resolve") { const r = v as { path: string | null }; return { ...r, path: r.path && isPrivate(r.path, exclude) ? null : r.path }; }
  if (route === "/api/today" && isObj(v)) return todayView(v, exclude);
  if (route === "/api/focus" && isObj(v) && touches(v, exclude)) return { active: false };
  return clean(v, exclude);
}

/** Una actividad de calendario sale al móvil solo si ella, su tarea y su proyecto son visibles; una relación sin resolver podría apuntar a algo privado. */
export function calendarVisible(
  it: { path: string; task?: string; project?: string; taskPath: string | null; projectPath: string | null },
  exclude: string[], resolve: (raw: string) => string | null,
): boolean {
  const refs = [it.task && resolve(it.task), it.project && resolve(it.project)];
  if (refs.some((r) => r === null)) return false;
  return ![it.path, it.taskPath, it.projectPath, ...refs].some((x) => x && isPrivate(x, exclude));
}

/** Eventos en vivo que le llegan al móvil: cambios de notas visibles; nada de escritorio, asistente ni rutas privadas. */
export function mobileEvent(ev: { kind?: string; path?: unknown }, exclude: string[]): boolean {
  if (ev.kind === "navigate" || ev.kind?.startsWith("assistant")) return false;
  return !(typeof ev.path === "string" && isPrivate(ev.path, exclude));
}
