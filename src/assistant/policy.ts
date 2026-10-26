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
  if (exclude.some((p) => p && rel.startsWith(p))) throw new AssistantError("excluded", "Esa carpeta está excluida del asistente");
  return rel;
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

/** `.jarvis/assistant.json`: `{ "exclude": ["Privado/"] }`. Tolerante: un fichero ilegible equivale a «sin exclusiones». */
export function parseAssistantConfig(text: string | null): { exclude: string[] } {
  try {
    const v = text ? JSON.parse(text) : null;
    const ex = v && typeof v === "object" && Array.isArray(v.exclude) ? v.exclude : [];
    return { exclude: ex.filter((x: unknown): x is string => typeof x === "string" && x.trim() !== "").map((x: string) => x.trim()) };
  } catch {
    return { exclude: [] };
  }
}
