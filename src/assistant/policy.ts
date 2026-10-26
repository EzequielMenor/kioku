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

export const ALLOWED_PROPS: readonly string[] = ["status", "project", "due", "priority", "related", "tags"];

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

export function isProtectedPath(rel: string): boolean {
  return PROTECTED_PREFIXES.some((p) => rel.startsWith(p));
}

export function filterProps(props: unknown): Record<string, unknown> {
  if (!props || typeof props !== "object" || Array.isArray(props)) throw new AssistantError("props", "«props» debe ser un objeto");
  for (const k of Object.keys(props)) {
    if (!ALLOWED_PROPS.includes(k)) throw new AssistantError("props", `La propiedad «${k}» no se puede cambiar (permitidas: ${ALLOWED_PROPS.join(", ")})`);
  }
  return { ...(props as Record<string, unknown>) };
}

/** `.jarvis/assistant.json`: `{ "exclude": ["Privado/"] }`. Sin fichero = sin exclusiones; si existe y está roto, falla cerrado. */
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
