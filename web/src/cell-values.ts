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

/** Aviso si un valor no vacío no encaja con el tipo de la columna (tras «Cambiar tipo» los valores no se reescriben): `null` si encaja. */
export function misfit(type: PropType | undefined, v: unknown): string | null {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return null;
  if (type === "number") {
    const ok = (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()));
    return ok ? null : "No es un número";
  }
  if (type === "date") {
    const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(v) : null;
    const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`) : null;
    return d && !Number.isNaN(d.getTime()) && d.toISOString().startsWith(`${m![1]}-${m![2]}-${m![3]}`) ? null : "No es una fecha";
  }
  if (type === "checkbox") return typeof v === "boolean" ? null : "No es un valor sí/no";
  return null;
}
