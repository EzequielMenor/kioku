// Comandos `/` y atajos de formato Markdown para el editor CodeMirror.

export interface SlashResult {
  insert: string;
  cursorOffset: number;
  reopenLinks?: boolean;
}

export interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  applyText(ctx: { linePrefix: string }): SlashResult;
}

const norm = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: "h1",
    label: "Título 1",
    hint: "# Encabezado",
    keywords: "h1 titulo encabezado heading #",
    applyText: () => ({ insert: "# ", cursorOffset: 2 }),
  },
  {
    id: "h2",
    label: "Título 2",
    hint: "## Subtítulo",
    keywords: "h2 titulo subtitulo heading ##",
    applyText: () => ({ insert: "## ", cursorOffset: 3 }),
  },
  {
    id: "h3",
    label: "Título 3",
    hint: "### Apartado",
    keywords: "h3 titulo apartado heading ###",
    applyText: () => ({ insert: "### ", cursorOffset: 4 }),
  },
  {
    id: "bold",
    label: "Negrita",
    hint: "**texto** · Ctrl+B",
    keywords: "negrita bold fuerte b **",
    applyText: () => ({ insert: "****", cursorOffset: 2 }),
  },
  {
    id: "italic",
    label: "Cursiva",
    hint: "*texto* · Ctrl+I",
    keywords: "cursiva italic enfasis i *",
    applyText: () => ({ insert: "**", cursorOffset: 1 }),
  },
  {
    id: "strike",
    label: "Tachado",
    hint: "~~texto~~",
    keywords: "tachado strike strikethrough ~~",
    applyText: () => ({ insert: "~~~~", cursorOffset: 2 }),
  },
  {
    id: "code",
    label: "Código en línea",
    hint: "`código`",
    keywords: "codigo inline code backtick `",
    applyText: () => ({ insert: "``", cursorOffset: 1 }),
  },
  {
    id: "todo",
    label: "Lista de tareas",
    hint: "- [ ] tarea",
    keywords: "tarea todo check checkbox lista pendiente []",
    applyText: () => ({ insert: "- [ ] ", cursorOffset: 6 }),
  },
  {
    id: "bullet",
    label: "Lista con viñetas",
    hint: "- elemento",
    keywords: "lista bullet vinetas puntos ul -",
    applyText: () => ({ insert: "- ", cursorOffset: 2 }),
  },
  {
    id: "ordered",
    label: "Lista numerada",
    hint: "1. elemento",
    keywords: "lista numerada ol pasos 1.",
    applyText: () => ({ insert: "1. ", cursorOffset: 3 }),
  },
  {
    id: "quote",
    label: "Cita",
    hint: "> texto",
    keywords: "cita quote blockquote >",
    applyText: () => ({ insert: "> ", cursorOffset: 2 }),
  },
  {
    id: "codeblock",
    label: "Bloque de código",
    hint: "```",
    keywords: "bloque codigo codeblock pre ```",
    applyText: () => ({ insert: "```\n\n```", cursorOffset: 4 }),
  },
  {
    id: "divider",
    label: "Separador",
    hint: "---",
    keywords: "separador linea divisor hr regla ---",
    applyText: ({ linePrefix }) => {
      const insert = linePrefix.trim() ? "\n---\n" : "---\n";
      return { insert, cursorOffset: insert.length };
    },
  },
  {
    id: "link",
    label: "Enlace a nota",
    hint: "[[nota]]",
    keywords: "enlace link wikilink nota referencia [[",
    applyText: () => ({ insert: "[[", cursorOffset: 2, reopenLinks: true }),
  },
];

/** Detecta si el cursor está escribiendo un comando `/` al inicio de línea o tras espacio. */
export function matchSlashTrigger(
  lineTextBeforeCursor: string,
  lineFromPos: number,
): { from: number; query: string; linePrefix: string } | null {
  const m = /(?:^|\s)\/([^\s/[\]`]*)$/.exec(lineTextBeforeCursor);
  if (!m) return null;
  const slashOffset = m.index + (m[0].startsWith("/") ? 0 : 1);
  const beforeSlash = lineTextBeforeCursor.slice(0, slashOffset);
  if (beforeSlash.lastIndexOf("[[") > beforeSlash.lastIndexOf("]]")) return null;
  let ticks = 0;
  for (let i = 0; i < beforeSlash.length; i++) if (beforeSlash[i] === "`") ticks++;
  if (ticks % 2 === 1) return null;
  return {
    from: lineFromPos + slashOffset,
    query: m[1],
    linePrefix: beforeSlash,
  };
}

/** Filtra y ordena los comandos `/` ignorando mayúsculas y tildes. */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = norm(query);
  if (!q) return [...SLASH_COMMANDS];
  const scored: { cmd: SlashCommand; rank: number }[] = [];
  for (const cmd of SLASH_COMMANDS) {
    const label = norm(cmd.label);
    const keywords = norm(cmd.keywords);
    const hint = norm(cmd.hint);
    if (label.startsWith(q)) scored.push({ cmd, rank: 0 });
    else if (label.includes(q)) scored.push({ cmd, rank: 1 });
    else if (keywords.includes(q) || hint.includes(q)) scored.push({ cmd, rank: 2 });
  }
  scored.sort((a, b) => a.rank - b.rank);
  return scored.map((s) => s.cmd);
}

function countEdge(doc: string, pos: number, dir: -1 | 1, ch: string): number {
  let n = 0;
  while (pos >= 0 && pos < doc.length && doc[pos] === ch) {
    n++;
    pos += dir;
  }
  return n;
}

/** Envuelve o desenvuelve una selección (o el cursor) con un marcador Markdown (`**` o `*`). */
export function toggleInlineWrap(
  docText: string,
  selFrom: number,
  selTo: number,
  marker: string,
): { from: number; to: number; insert: string; anchor: number; head: number } {
  const m = marker.length;
  const selected = docText.slice(selFrom, selTo);
  const isStar = marker === "*" || marker === "**";
  let outer = false;
  if (selFrom >= m && selTo + m <= docText.length && docText.slice(selFrom - m, selFrom) === marker && docText.slice(selTo, selTo + m) === marker) {
    if (isStar) {
      const l = countEdge(docText, selFrom - 1, -1, "*");
      const r = countEdge(docText, selTo, 1, "*");
      outer = marker === "**" ? l >= 2 && r >= 2 : l % 2 === 1 && r % 2 === 1;
    } else {
      outer = true;
    }
  }
  if (outer) {
    return {
      from: selFrom - m,
      to: selTo + m,
      insert: selected,
      anchor: selFrom - m,
      head: selTo - m,
    };
  }
  if (
    selected.length >= m * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    !(marker === "*" && selected.startsWith("**") && selected.endsWith("**") && countEdge(selected, 0, 1, "*") % 2 === 0 && countEdge(selected, selected.length - 1, -1, "*") % 2 === 0)
  ) {
    const inner = selected.slice(m, -m);
    return { from: selFrom, to: selTo, insert: inner, anchor: selFrom, head: selFrom + inner.length };
  }
  return {
    from: selFrom,
    to: selTo,
    insert: `${marker}${selected}${marker}`,
    anchor: selFrom + m,
    head: selTo + m,
  };
}
