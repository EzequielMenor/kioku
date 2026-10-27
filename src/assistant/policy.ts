// Reglas puras del asistente: qué rutas puede tocar, qué propiedades puede cambiar y cuándo debe pedir aprobación.
export type AssistantErrorCode = "path" | "props" | "unknown-tool" | "excluded" | "limit" | "auth" | "invalid";

export class AssistantError extends Error {
  code: AssistantErrorCode;
  constructor(code: AssistantErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Notas distintas que una consulta puede modificar sola; a partir de ahí, propuesta. */
export const MAX_NOTES_PER_QUERY = 5;

/** Claves que solo el sistema fija: identidad, fecha de creación, tipo y el aparcado del foco. */
const RESERVED_PROPS: readonly string[] = ["id", "created", "type", "parked"];
/** Definición de una base de datos: el asistente no la reescribe (cualquier cambio ahí es una propuesta que apruebas). */
const DB_DEFINITION_PROPS: readonly string[] = ["source", "properties", "views"];
const PROP_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{0,59}$/u;
const MAX_PROP_TEXT = 2000;
const MAX_PROP_LIST = 50;

const PROTECTED_PREFIXES = ["Notas/Importado/"];

export function checkAssistantPath(rel: unknown, exclude: string[]): string {
  if (typeof rel !== "string" || !rel.toLowerCase().endsWith(".md")) throw new AssistantError("path", "Ruta de nota inválida (debe terminar en .md)");
  if (rel.startsWith("/") || rel.includes("\\") || rel.split("/").some((seg) => seg === "" || seg === ".." || seg.startsWith("."))) {
    throw new AssistantError("path", "Ruta no permitida");
  }
  if (isExcludedPath(rel, exclude)) throw new AssistantError("excluded", "Esa carpeta está excluida del asistente");
  return rel;
}

const foldKey = (s: string): string => s.normalize("NFC").toLowerCase();

/** Entrada de exclusión lista para comparar: NFC, sin mayúsculas, sin `./` ni `/` inicial y con `/` final (salvo ficheros .md). */
function exclusionKey(x: string): string {
  const k = foldKey(x.trim()).replace(/^(\.?\/)+/, "");
  return k && !k.endsWith("/") && !k.endsWith(".md") ? `${k}/` : k;
}

/** ¿Está la ruta dentro de una carpeta (o es un fichero) excluida? Insensible a mayúsculas y a NFC/NFD. */
export function isExcludedPath(rel: string, exclude: string[]): boolean {
  const k = foldKey(rel);
  return exclude.some((x) => { const e = exclusionKey(x); return e !== "" && k.startsWith(e); });
}

/** Quita de un resultado todo objeto cuya `path`/`projectPath` esté excluida (y lo anula si era una propiedad suelta). */
export function hideExcluded(v: unknown, exclude: string[]): unknown {
  if (!exclude.length || v === null || typeof v !== "object") return v;
  const bad = (o: object): boolean => ["path", "projectPath"].some((k) => { const x = (o as Record<string, unknown>)[k]; return typeof x === "string" && isExcludedPath(x, exclude); });
  if (Array.isArray(v)) return v.filter((x) => !(x && typeof x === "object" && bad(x))).map((x) => hideExcluded(x, exclude));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x && typeof x === "object" && !Array.isArray(x) && bad(x) ? null : hideExcluded(x, exclude)]));
}

export function isProtectedPath(rel: string): boolean {
  return PROTECTED_PREFIXES.some((p) => rel.startsWith(p));
}

const isScalar = (v: unknown): boolean =>
  (typeof v === "string" && v.length <= MAX_PROP_TEXT) || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

/**
 * Propiedades que el asistente puede escribir: cualquier clave de usuario con un valor simple (texto, número, casilla,
 * lista de simples; `null` la quita). Nunca las del sistema, ni objetos (así no puede reescribir `views`/`source`/`properties`).
 */
export function filterProps(props: unknown, opts: { database?: boolean } = {}): Record<string, unknown> {
  if (!props || typeof props !== "object" || Array.isArray(props)) throw new AssistantError("props", "«props» debe ser un objeto");
  for (const [k, v] of Object.entries(props)) {
    if (!PROP_NAME_RE.test(k) || k.startsWith("__")) throw new AssistantError("props", `Nombre de propiedad no válido: «${k}»`);
    if (RESERVED_PROPS.includes(k)) throw new AssistantError("props", `La propiedad «${k}» es del sistema y no se puede cambiar`);
    if (opts.database && DB_DEFINITION_PROPS.includes(k)) throw new AssistantError("props", `«${k}» es parte de la definición de la base: propón el cambio para que lo apruebe el usuario`);
    const ok = v === null || isScalar(v) || (Array.isArray(v) && v.length <= MAX_PROP_LIST && v.every(isScalar));
    if (!ok) throw new AssistantError("props", `El valor de «${k}» debe ser texto, número, casilla, lista de valores simples o null (quitar)`);
  }
  return { ...(props as Record<string, unknown>) };
}

/** `.kioku/assistant.json`: `{ "exclude": ["Privado/"] }`. Sin fichero = sin exclusiones; si existe y está roto, falla cerrado. */
export function parseAssistantConfig(text: string | null): { exclude: string[] } {
  if (!text) return { exclude: [] };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new AssistantError("invalid", "assistant.json no es JSON válido: corrígelo para usar el asistente (así no se salta ninguna exclusión)");
  }
  const ex = v && typeof v === "object" && Array.isArray((v as { exclude?: unknown }).exclude) ? (v as { exclude: unknown[] }).exclude : [];
  return { exclude: ex.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) };
}
