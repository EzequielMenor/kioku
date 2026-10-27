// Acceso desde el móvil: lista blanca del rol `mobile` (la impone el servidor, la UI solo la refleja),
// privacidad (`.kioku/mobile.json`: carpetas que nunca salen del portátil) y filtrado de respuestas.
import path from "node:path";
import { hideExcluded, isExcludedPath, parseAssistantConfig } from "../assistant/policy.ts";

export type Role = "full" | "mobile";

/** Lo único que el móvil puede escribir: capturar, tareas y notas. Borrar, asistente, escritorio y mantenimiento quedan fuera. */
const WRITES = new Set([
  "POST /api/capture", "POST /api/capture/convert", "POST /api/note/create", "PUT /api/note", "POST /api/note/props",
  "POST /api/task/status", "POST /api/journal", "POST /api/note/open",
  "POST /api/database/query", // lectura que viaja por POST
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

interface Graph { nodes: { path: string }[]; edges: [number, number][] }

/** El grafo va por índices: al quitar nodos hay que reindexar las aristas que sobreviven. */
function filterGraph(g: Graph, exclude: string[]): Graph {
  const remap = new Map<number, number>();
  const nodes: Graph["nodes"] = [];
  g.nodes.forEach((n, i) => { if (!isPrivate(n.path, exclude)) { remap.set(i, nodes.length); nodes.push(n); } });
  const edges = g.edges.flatMap(([a, b]) => (remap.has(a) && remap.has(b) ? [[remap.get(a)!, remap.get(b)!] as [number, number]] : []));
  return { ...g, nodes, edges };
}

/** Respuesta de lectura sin nada de las carpetas privadas. */
export function mobileView(route: string, v: unknown, exclude: string[]): unknown {
  if (!exclude.length) return v;
  if (route === "/api/graph") return filterGraph(v as Graph, exclude);
  if (route === "/api/resolve") { const r = v as { path: string | null }; return { ...r, path: r.path && isPrivate(r.path, exclude) ? null : r.path }; }
  return hideExcluded(v, exclude);
}

/** Eventos en vivo que le llegan al móvil: cambios de notas visibles; nada de escritorio, asistente ni rutas privadas. */
export function mobileEvent(ev: { kind?: string; path?: unknown }, exclude: string[]): boolean {
  if (ev.kind === "navigate" || ev.kind?.startsWith("assistant")) return false;
  return !(typeof ev.path === "string" && isPrivate(ev.path, exclude));
}
