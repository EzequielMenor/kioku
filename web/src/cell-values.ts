// Conversión texto de la UI → valor YAML, sin dependencias de Preact (se prueba desde test/).
import type { PropType } from "./types.ts";

/** Texto escrito en el panel de propiedades → valor: true/false y números canónicos con su tipo, el resto texto ("007" y "1.10" se quedan como están); vacío = quitar la propiedad. */
export function parseValue(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return null;
  if (t === "true" || t === "false") return t === "true";
  if (/^-?\d+(\.\d+)?$/.test(t) && String(Number(t)) === t) return Number(t);
  return t;
}

/** Clave de columna del tablero (siempre texto) → valor con el tipo de la propiedad agrupada. */
export function laneValue(type: PropType | undefined, lane: string): unknown {
  if (lane === "") return "";
  if (type === "checkbox") return lane === "true";
  if (type === "number") { const n = Number(lane); return Number.isFinite(n) ? n : lane; }
  return lane;
}

/** Texto de una celda de relación: si ya era una lista (o el texto trae comas) vuelve a ser lista de enlaces. */
export function relationValue(raw: string, prev: unknown): unknown {
  const t = raw.trim();
  if (t === "") return "";
  if (!Array.isArray(prev) && !t.includes(",")) return t;
  return t.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Solo http(s): un valor de celda nunca se convierte en `javascript:` ni `data:`. */
export function safeHref(v: string): string | null {
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch { return null; }
}
