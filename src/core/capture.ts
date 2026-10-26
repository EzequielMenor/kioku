// Gramática de Quick: un solo campo de texto, el primer token decide el tipo.
//   texto libre              → captura en Bandeja
//   t Llamar !mañana @Proy   → tarea (fecha, proyecto, prioridad p1..p3)
//   d Usar SQLite            → decisión (proyecto en foco o @proyecto)
//   n Título                 → nota
import { parseWhen } from "./dates.ts";

export type CaptureKind = "capture" | "task" | "decision" | "note";

export interface ParsedCapture {
  kind: CaptureKind;
  title: string;
  /** Texto completo sin prefijo (para el cuerpo cuando el título se trunca). */
  text: string;
  due: string | null;
  priority: 1 | 2 | 3 | null;
  projectQuery: string | null;
  /** Fragmentos con sintaxis de fecha que no se entendieron (se avisan, no se pierden). */
  unparsed: string[];
}

const PREFIXES: [RegExp, CaptureKind][] = [
  [/^(?:t|tarea|todo)\s+/i, "task"],
  [/^(?:d|decisi[oó]n|decision)\s+/i, "decision"],
  [/^(?:n|nota)\s+/i, "note"],
];

export function parseCapture(input: string, today: string): ParsedCapture {
  let text = input.trim();
  let kind: CaptureKind = "capture";
  for (const [re, k] of PREFIXES) {
    const m = re.exec(text);
    if (m) {
      kind = k;
      text = text.slice(m[0].length).trim();
      break;
    }
  }

  let due: string | null = null;
  let priority: 1 | 2 | 3 | null = null;
  let projectQuery: string | null = null;
  const unparsed: string[] = [];

  // Metadatos estructurados solo tienen sentido en tarea/decisión; en captura/nota se conserva el texto tal cual.
  if (kind === "task" || kind === "decision") {
    text = text.replace(/@\[([^\]]+)\]|@([\p{L}\p{N}_-]+)/gu, (_m, a: string, b: string) => {
      projectQuery = (a ?? b).replace(/-/g, " ").trim();
      return "";
    });
    if (kind === "task") {
      text = text.replace(/(?:^|\s)!(\S+)/g, (m, tok: string) => {
        const d = parseWhen(tok, today);
        if (d) due = d;
        else unparsed.push(`!${tok}`);
        return d ? " " : m;
      });
      text = text.replace(/(?:^|\s)p([123])(?=\s|$)/gi, (_m, n: string) => {
        priority = Number(n) as 1 | 2 | 3;
        return " ";
      });
    }
    text = text.replace(/\s+/g, " ").trim();
  }

  const firstLine = text.split("\n")[0].trim();
  const title = firstLine.length > 80 ? firstLine.slice(0, 77).trimEnd() + "…" : firstLine;
  return { kind, title, text, due, priority, projectQuery, unparsed };
}
