// Crear una actividad desde una línea de texto natural en español: «gym mañana 18-19». Lógica pura, sin DOM ni red.
import { addDays, localDate } from "./dates.ts";

export type QuickAdd = { ok: true; title: string; start: string; end: string } | { ok: false; error: string };

const L = "(?<![\\p{L}\\d])", R = "(?![\\p{L}\\d])";
const re = (src: string) => new RegExp(src, "iu");
const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const pad = (n: number) => String(n).padStart(2, "0");

/** Quita la primera coincidencia y devuelve el resto con un espacio en su lugar. */
function take(text: string, pattern: RegExp): { match: RegExpExecArray; rest: string } | null {
  const match = pattern.exec(text);
  return match ? { match, rest: text.slice(0, match.index) + " " + text.slice(match.index + match[0].length) } : null;
}

const validDate = (y: number, m: number, d: number) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; };

export function parseQuickAdd(input: string, now: Date): QuickAdd {
  // Los acentos se quitan solo para reconocer palabras: el título conserva el texto original (misma longitud, así que los índices coinciden).
  let text = input.normalize("NFC");
  const today = localDate(now);
  let day: string | null = null;

  const fixed = (y: number, m: number, d: number) => {
    if (!validDate(y, m, d)) return false;
    day = `${y}-${pad(m)}-${pad(d)}`;
    return true;
  };
  const yearless = (m: number, d: number) => {
    const y = now.getFullYear();
    if (!fixed(y, m, d)) return false;
    if (day! < today) fixed(y + 1, m, d);
    return true;
  };

  // Día: fecha ISO, d/m, «5 de noviembre», «pasado mañana», «mañana», «hoy» o día de la semana (siempre el próximo; hoy solo si se dice «hoy»).
  const pl = () => plain(text);
  let t = take(text, re(`${L}(\\d{4})-(\\d{2})-(\\d{2})${R}`));
  if (t && fixed(Number(t.match[1]), Number(t.match[2]), Number(t.match[3]))) text = t.rest;
  else if ((t = take(text, re(`${L}(\\d{1,2})/(\\d{1,2})${R}`))) && yearless(Number(t.match[2]), Number(t.match[1]))) text = t.rest;
  else {
    const months = take(pl(), re(`${L}(\\d{1,2})\\s+de\\s+(${MONTHS.join("|")})${R}`));
    if (months && yearless(MONTHS.indexOf(months.match[2].toLowerCase()) + 1, Number(months.match[1]))) text = text.slice(0, months.match.index) + " " + text.slice(months.match.index + months.match[0].length);
    else {
      const word = take(pl(), re(`${L}(pasado\\s+manana|manana|hoy|${WEEKDAYS.join("|")})${R}`));
      if (word) {
        const w = word.match[1].toLowerCase().replace(/\s+/g, " ");
        const dow = now.getDay();
        const ahead = w === "hoy" ? 0 : w === "manana" ? 1 : w === "pasado manana" ? 2 : ((WEEKDAYS.indexOf(w) - dow + 6) % 7) + 1;
        day = addDays(today, ahead);
        text = text.slice(0, word.match.index) + " " + text.slice(word.match.index + word.match[0].length);
      }
    }
  }

  // Hora: rango «18-19», «de 9 a 10», «7h-8h30»; o una hora suelta («a las 14», «20:00», «17h») con duración opcional («1h30», «90min»).
  let startMin: number | null = null, endMin: number | null = null, badTime = false;
  const hhmm = (h: string, m?: string) => { const hour = Number(h), min = m === undefined ? 0 : Number(m); if (hour > 23 || min > 59) { badTime = true; return 0; } return hour * 60 + min; };
  const range = take(text, re(`${L}(?:(?:de|desde)\\s+)?(\\d{1,2})(?:[:h](\\d{2}))?h?\\s*(?:-|–|a|hasta)\\s*(\\d{1,2})(?:[:h](\\d{2}))?h?${R}`));
  if (range) {
    startMin = hhmm(range.match[1], range.match[2]); endMin = hhmm(range.match[3], range.match[4]);
    text = range.rest;
  } else {
    const single = take(text, re(`${L}(?:a\\s+las?\\s+(\\d{1,2})(?:[:h](\\d{2}))?|(\\d{1,2})[:h](\\d{2})|(\\d{1,2})h)${R}`));
    if (single) {
      const m = single.match;
      startMin = m[1] !== undefined ? hhmm(m[1], m[2]) : m[3] !== undefined ? hhmm(m[3], m[4]) : hhmm(m[5]);
      text = single.rest;
      const dur = take(text, re(`${L}(?:(\\d+)h(\\d{2})?|(\\d+)\\s*(?:min|m)|(\\d+)\\s*horas?)${R}`));
      let minutes = 60;
      if (dur) {
        const d = dur.match;
        minutes = d[1] !== undefined ? Number(d[1]) * 60 + Number(d[2] ?? 0) : d[3] !== undefined ? Number(d[3]) : Number(d[4]) * 60;
        text = dur.rest;
      }
      endMin = startMin + minutes;
    }
  }

  const title = text.replace(/\s+/g, " ").trim()
    .replace(/^(?:(?:el|la|los|a|las|de|desde|para|hasta|,|-|–)\s+)+/i, "").replace(/(?:\s+(?:el|la|los|a|las|de|desde|para|hasta|,|-|–))+$/i, "").trim();
  if (badTime || startMin === null || endMin === null) return { ok: false, error: title ? "Falta una hora válida, por ejemplo «mañana 18-19»" : "Falta el título y la hora, por ejemplo «gym mañana 18-19»" };
  if (!title) return { ok: false, error: "Falta el título" };
  if (endMin <= startMin) return { ok: false, error: "El fin debe ser posterior al inicio" };
  if (endMin > 24 * 60) return { ok: false, error: "La actividad no puede pasar de medianoche" };
  const date = day ?? today;
  const clock = (min: number) => min === 24 * 60 ? `${addDays(date, 1)}T00:00` : `${date}T${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  return { ok: true, title, start: clock(startMin), end: clock(endMin) };
}
