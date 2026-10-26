// Fechas locales (YYYY-MM-DD) y lenguaje natural mínimo en español.

export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function localTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return localDate(dt);
}

/** Días entre dos fechas YYYY-MM-DD (b - a). */
export function diffDays(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

function strip(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Interpreta "hoy", "mañana", "pasado mañana", "lunes".. (próxima ocurrencia, nunca hoy),
 * "+3d", "+2s" y "YYYY-MM-DD". Devuelve null si no entiende.
 */
export function parseWhen(token: string, today: string): string | null {
  const t = strip(token.trim());
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, m, d] = t.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? t : null;
  }
  if (t === "hoy") return today;
  if (t === "manana") return addDays(today, 1);
  if (t === "pasadomanana") return addDays(today, 2);
  const rel = /^\+(\d{1,3})([ds])$/.exec(t);
  if (rel) return addDays(today, Number(rel[1]) * (rel[2] === "s" ? 7 : 1));
  if (t in WEEKDAYS) {
    const [y, m, d] = today.split("-").map(Number);
    const cur = new Date(y, m - 1, d).getDay();
    let delta = (WEEKDAYS[t] - cur + 7) % 7;
    if (delta === 0) delta = 7;
    return addDays(today, delta);
  }
  return null;
}
