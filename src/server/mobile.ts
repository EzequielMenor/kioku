// Acceso desde el móvil: lista blanca del rol `mobile` (la impone el servidor, la UI solo la refleja),
// privacidad (`.kioku/mobile.json`: carpetas que nunca salen del portátil) y filtrado de respuestas.
import path from "node:path";
import { createHash } from "node:crypto";
import { isExcludedPath, parseAssistantConfig } from "../assistant/policy.ts";
import { MOBILE_PROPOSAL_PREFIX, isMobileSessionId } from "../assistant/session.ts";
import type { UndoRecord } from "../assistant/undo.ts";
import type { Proposal } from "../core/proposals.ts";
import { relationTarget } from "../core/index.ts";

export type Role = "full" | "mobile";

/** Lo único que el móvil puede escribir: capturar, tareas (estado y formulario en línea), notas y el asistente (preguntar y deshacer). Borrar, escritorio y mantenimiento quedan fuera. */
const WRITES = new Set([
  "POST /api/capture", "POST /api/capture/convert", "POST /api/note/create", "PUT /api/note", "POST /api/note/props",
  "POST /api/task/status", "POST /api/task/create", "POST /api/task/update", "POST /api/journal", "POST /api/note/open", "POST /api/mobile/operation",
  "POST /api/database/query", // lectura que viaja por POST
  "POST /api/push/subscribe", "POST /api/push/unsubscribe", // avisos al móvil: cada móvil gestiona su propia suscripción
  "POST /api/calendar/create", "POST /api/calendar/move", "POST /api/calendar/finish", // calendario en línea; sin cola sin conexión
  "POST /api/calendar/areas/create", "POST /api/calendar/areas/update", "POST /api/calendar/area", // áreas del calendario y su asignación
  "POST /api/assistant/ask", "POST /api/assistant/undo", // asistente: solo en línea (nunca en la cola sin conexión) y con la privacidad del móvil
]);

/** Del asistente el móvil solo lee su estado y su actividad: ni memoria ni herramientas (esas son del escritorio y del puente). */
const ASSISTANT_READS = new Set(["/api/assistant/status", "/api/assistant/actions"]);
const PROPOSAL_ACTION = /^\/api\/proposals\/[0-9A-Z]{26}\/(?:apply|reject)$/;

const under = (p: string, base: string) => p === base || p.startsWith(`${base}/`);

export function mobileAllowed(method: string, p: string): boolean {
  if (method === "GET") return !(under(p, "/api/devices") || under(p, "/api/ai") || (under(p, "/api/assistant") && !ASSISTANT_READS.has(p)) || (under(p, "/api/proposals") && p !== "/api/proposals"));
  return WRITES.has(`${method} ${p}`) || (method === "POST" && PROPOSAL_ACTION.test(p));
}

/** Parámetros que nombran una nota: si alguno cae en una carpeta privada, la petición no se atiende. */
const PATH_PARAMS = ["path", "focus", "project", "taskPath", "projectPath", "areaPath"];

/** Ruta sin trucos (`//`, `./`, `a/../b`, `\`) antes de compararla con las carpetas privadas. */
const canonical = (p: string) => path.posix.normalize(p.replace(/\\/g, "/")).replace(/^(\.?\/)+/, "");

export const isPrivate = (p: string, exclude: string[]) => isExcludedPath(p, exclude) || isExcludedPath(canonical(p), exclude);

export function touchesPrivate(sources: (URLSearchParams | Record<string, unknown>)[], exclude: string[]): boolean {
  return sources.some((s) => PATH_PARAMS.some((k) => {
    const v = s instanceof URLSearchParams ? s.get(k) : s[k];
    return typeof v === "string" && isPrivate(v, exclude);
  }));
}

/** Una relación existente (`[[Nota]]`) que el móvil no puede ver: cae en una carpeta privada o no se resuelve (podría apuntar a algo privado). */
export function hiddenRelation(raw: unknown, resolve: (target: string) => string | null, exclude: string[]): boolean {
  if (!raw) return false;
  const target = relationTarget(raw);
  const found = target ? resolve(target) : null;
  return !found || isPrivate(found, exclude);
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
const NOTE_KEYS = ["path", "projectPath", "taskPath", "areaPath"];
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

/** Eventos en vivo que le llegan al móvil: cambios de notas visibles; nada de escritorio, asistente ni rutas privadas. */
export function mobileEvent(ev: { kind?: string; path?: unknown }, exclude: string[]): boolean {
  if (ev.kind === "navigate" || ev.kind?.startsWith("assistant")) return false;
  return !(typeof ev.path === "string" && isPrivate(ev.path, exclude));
}

/* ───────── Asistente en el móvil ───────── */

const fold = (s: string) => s.normalize("NFC").toLowerCase();

/** Entrada de exclusión lista para buscarla dentro de un texto (misma normalización que `isExcludedPath`). */
function needle(x: string): string {
  const k = fold(x.trim()).replace(/^(\.?\/)+/, "");
  return k && !k.endsWith("/") && !k.endsWith(".md") ? `${k}/` : k;
}

/** ¿El texto nombra una carpeta o nota oculta? Guarda extra para lo que no es una ruta (títulos, resúmenes, textos de propuestas). */
export function mentionsHidden(text: string, exclude: string[]): boolean {
  const t = fold(text).replace(/\\/g, "/");
  return exclude.some((x) => { const n = needle(x); return n !== "" && t.includes(n); });
}

/** Huella corta de las exclusiones: si cambian, la conversación y la memoria del motor cambian de espacio (nada se borra). */
export function exclusionScope(exclude: string[]): string {
  const keys = [...new Set(exclude.map(needle).filter(Boolean))].sort();
  return createHash("sha256").update(JSON.stringify(keys)).digest("hex").slice(0, 12);
}

/** Identificador de conversación del móvil: atado al rol y a la huella de privacidad vigente, nunca igual al del escritorio. */
export const mobileConversation = (scope: string, id: string) => `mobile:${scope}:${id}`;

/** Resultado de una herramienta para una sesión del móvil: el mismo filtro que las lecturas del móvil, y fuera los elementos de lista que nombran algo oculto. */
export function mobileToolText(text: string, exclude: string[], patch?: (v: Obj) => void): string {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return text; }
  const scrub = (x: unknown): unknown => Array.isArray(x)
    ? x.filter((i) => !(isObj(i) && mentionsHidden(JSON.stringify(i), exclude))).map(scrub)
    : isObj(x) ? Object.fromEntries(Object.entries(x).map(([k, i]) => [k, scrub(i)])) : x;
  const out = scrub(mobileView("/api/assistant/tools", v, exclude));
  if (patch && isObj(out)) patch(out);
  return JSON.stringify(out);
}

/** Acción automática tal como la ve el móvil: solo las de sesiones del móvil con todo visible hoy, y sin las instantáneas previas. */
export function mobileAction(rec: UndoRecord, exclude: string[]): UndoRecord | null {
  if (!isMobileSessionId(rec.sessionId)) return null;
  if (rec.files.some((f) => isPrivate(f.path, exclude)) || mentionsHidden(rec.summary, exclude)) return null;
  return { ...rec, files: rec.files.map((f) => ({ path: f.path, beforeText: null, afterHash: null })) };
}

const stringsOf = (v: unknown): string[] => typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(stringsOf) : isObj(v) ? Object.values(v).flatMap(stringsOf) : [];

/**
 * Propuesta visible para el móvil: nacida de una sesión del móvil, con TODAS sus rutas (origen y destino), textos y enlaces
 * [[…]] visibles hoy. `resolve` es la del índice: un enlace a una nota oculta esconde la propuesta entera.
 */
export function mobileProposalVisible(p: Proposal, exclude: string[], resolve: (target: string) => string | null): boolean {
  if (!p.key?.startsWith(MOBILE_PROPOSAL_PREFIX)) return false;
  const paths = p.ops.flatMap((op) => (op.op === "move" ? [op.from, op.to] : [op.path]));
  if (paths.some((x) => isPrivate(x, exclude))) return false;
  const texts = [p.title, p.rationale, p.error ?? "", ...stringsOf(p.ops)];
  if (texts.some((t) => mentionsHidden(t, exclude))) return false;
  return !texts.some((t) => [...t.matchAll(/\[\[([^\]|#]+)/g)].some((m) => { const found = resolve(m[1].trim()); return !!found && isPrivate(found, exclude); }));
}
