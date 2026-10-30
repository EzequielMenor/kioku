import type { NoteType, SearchHit } from "../types.ts";
import type { StoredNote } from "./store.ts";

const W_TITLE = 10, W_HEADING = 4, W_BODY = 1;
const TYPES: readonly string[] = ["note", "task", "project", "journal", "resource", "capture", "database", "block"];

/** Minúsculas sin diacríticos, con el índice de cada carácter en el original (para recortar el snippet). */
function fold(s: string): { text: string; at: number[] } {
  let text = "";
  const at: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let k = 0; k < f.length; k++) at.push(i);
    text += f;
    i += ch.length;
  }
  return { text, at };
}

function splitNote(text: string): { fm: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  return m ? { fm: m[1], body: text.slice(m[0].length) } : { fm: "", body: text };
}

function noteType(fm: string): NoteType {
  const t = /^type:\s*(\S+)/m.exec(fm)?.[1] ?? "note";
  return (TYPES.includes(t) ? t : "note") as NoteType;
}

function titleOf(path: string, body: string): string {
  const h = /^#\s+(.+)$/m.exec(body);
  if (h) return h[1].trim();
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

function snippetAround(body: string, needles: string[]): string {
  const { text, at } = fold(body);
  let pos = -1;
  for (const w of needles) { const p = text.indexOf(w); if (p >= 0 && (pos < 0 || p < pos)) pos = p; }
  const from = pos < 0 ? 0 : Math.max(0, at[pos] - 60);
  const chunk = body.slice(from, from + 160).replace(/\s+/g, " ").trim();
  return (from > 0 ? "…" : "") + chunk;
}

/** Título (primera cabecera o nombre del fichero) y tipo de una nota a partir de su texto. */
export function describeNote(path: string, text: string): { title: string; type: NoteType } {
  const { fm, body } = splitNote(text);
  return { title: titleOf(path, body), type: noteType(fm) };
}

/** Búsqueda sencilla sobre la réplica: todas las palabras (AND), título > cabecera > cuerpo. */
export function searchNotes(notes: StoredNote[], query: string, limit = 12): SearchHit[] {
  const words = fold(query.trim()).text.split(/\s+/).filter(Boolean);
  if (query.trim().length < 2 || !words.length) return [];
  const hits: SearchHit[] = [];
  for (const n of notes) {
    const { fm, body } = splitNote(n.text);
    const title = titleOf(n.path, body);
    const t = fold(title).text;
    const headings = fold(body.split("\n").filter((l) => /^#{1,6}\s/.test(l)).join("\n")).text;
    const b = fold(body).text;
    let score = 0, inTitle = false, ok = true;
    for (const w of words) {
      if (t.includes(w)) { score += W_TITLE; inTitle = true; }
      else if (headings.includes(w)) score += W_HEADING;
      else if (b.includes(w)) score += W_BODY;
      else { ok = false; break; }
    }
    if (!ok) continue;
    hits.push({
      path: n.path, title,
      type: noteType(fm),
      snippet: snippetAround(body, words),
      kind: inTitle ? "title" : "content",
      score,
    });
  }
  return hits.sort((a, c) => c.score - a.score || a.path.localeCompare(c.path)).slice(0, limit);
}
