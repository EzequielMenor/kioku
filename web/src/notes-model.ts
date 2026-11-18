// Lógica pura compartida para listar y agrupar notas de conocimiento (/notas y /grafo).

export const KNOWLEDGE_NOTE_TYPES = new Set(["note", "resource"]);

export function isKnowledgeNote(n: { type: string }): boolean {
  return KNOWLEDGE_NOTE_TYPES.has(n.type);
}

/** Carpeta contenedora de una nota relativa al vault (`Notas`, `Notas/Diseño`, `(Raíz)`). */
export function noteFolder(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(0, idx) : "(Raíz)";
}

/** Devuelve las carpetas distintas presentes en las notas de conocimiento, con su recuento. */
export function extractFolders(items: readonly { path: string; type: string }[]): { folder: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!isKnowledgeNote(item)) continue;
    const f = noteFolder(item.path);
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => {
      if (a[0] === "Notas" && b[0] !== "Notas") return -1;
      if (b[0] === "Notas" && a[0] !== "Notas") return 1;
      return a[0].localeCompare(b[0], "es");
    })
    .map(([folder, count]) => ({ folder, count }));
}

export interface NotesFilterOpts {
  subType: "all" | "note" | "resource";
  folder: string;
  query: string;
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Filtra a solo notas de conocimiento (excluyendo tareas, proyectos, capturas, calendario, etc.). */
export function listKnowledgeNotes<T extends { path: string; title: string; type: string; mtime: number; tags?: string[] }>(
  items: readonly T[],
  opts: NotesFilterOpts,
): T[] {
  const rawQ = opts.query.trim();
  const tagOnly = rawQ.startsWith("#");
  const q = fold(tagOnly ? rawQ.slice(1) : rawQ);

  return items
    .filter((n) => isKnowledgeNote(n))
    .filter((n) => opts.subType === "all" || n.type === opts.subType)
    .filter((n) => opts.folder === "all" || noteFolder(n.path) === opts.folder)
    .filter((n) => {
      if (!q) return true;
      const tags = n.tags ?? [];
      if (tagOnly) return tags.some((t) => fold(t).includes(q));
      return fold(n.title).includes(q) || fold(n.path).includes(q) || tags.some((t) => fold(t).includes(q));
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * Aparta las filas de las bases que viven en una carpeta propia (p. ej. los 66 libros de «Biblia/»): son elementos de
 * una colección y se ven en Bases; en Notas solo inundarían la lista. Devuelve las notas restantes y el recuento por base.
 */
export function splitBaseRows<T extends { path: string }>(
  items: readonly T[], bases: readonly { path: string; title: string; source?: { folder: string | null } | null }[],
): { notes: T[]; bases: { path: string; title: string; count: number }[] } {
  const withFolder = bases
    .filter((b) => b.source?.folder)
    .map((b) => ({ path: b.path, title: b.title, prefix: `${b.source!.folder!.replace(/\/+$/, "")}/`, count: 0 }));
  if (!withFolder.length) return { notes: [...items], bases: [] };
  const notes: T[] = [];
  for (const n of items) {
    const base = withFolder.find((b) => n.path.startsWith(b.prefix));
    if (base) base.count++; else notes.push(n);
  }
  return { notes, bases: withFolder.filter((b) => b.count > 0).map(({ path, title, count }) => ({ path, title, count })) };
}

/** ¿Hay que enseñar el título encima del texto? Sí, salvo que la nota ya empiece por `# <ese título>` (como en Apple Notes, el título siempre se ve). */
export function needsTitleHeading(text: string, title: string): boolean {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
  const first = body.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const m = /^#\s+(.+?)\s*#*\s*$/.exec(first.trim());
  const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  return !m || norm(m[1]) !== norm(title);
}
