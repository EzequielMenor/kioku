// Áreas vitales («líneas» del calendario): una nota Markdown por área en `Areas/`, independiente de los proyectos.
// La ruta es el identificador estable; las actividades la enlazan (`area: "[[Areas/<id>]]"`) y nombre y color se leen del área.
import type { Kioku } from "./kioku.ts";
import { setFrontmatter } from "./markdown.ts";
import { VaultError } from "./vault.ts";

export const AREA_FOLDER = "Areas";
const AREA_ID = /^[a-zA-Z0-9-]{8,64}$/;

export interface AreaRow { path: string; title: string; color: string; hash: string }
export interface AreaInput { id: string; title: string; color: string }

/** Solo `#RRGGBB`; se guarda en minúsculas para que `#1A2B3C` y `#1a2b3c` sean el mismo color. */
export function parseColor(value: unknown): string {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new VaultError("invalid", "El color debe ser #RRGGBB");
  return value.toLowerCase();
}

export function parseAreaTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title) throw new VaultError("invalid", "Escribí un título para el área");
  if (title.length > 60 || /[\u0000-\u001f\u007f]/.test(title)) throw new VaultError("invalid", "El título del área admite hasta 60 caracteres en una línea");
  return title;
}

export class Areas {
  constructor(privateHost: Kioku) { this.host = privateHost; }
  private host: Kioku;

  /** El área de esa ruta, o `null` si no es una nota `area` con color válido (una edición a mano rota no se ofrece ni se aplica). */
  get(path: string): AreaRow | null {
    const note = this.host.index.getNote(path);
    if (!note || note.type !== "area" || note.fmError) return null;
    let color: string;
    try { color = parseColor(note.fm.color); } catch { return null; }
    return { path, title: note.title, color, hash: note.hash };
  }

  list(): AreaRow[] {
    const rows: AreaRow[] = [];
    for (const { path } of this.host.index.listNotes({ type: "area", limit: 1_000_000 })) {
      const row = this.get(path);
      if (row) rows.push(row);
    }
    return rows.sort((a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path));
  }

  async create(input: AreaInput): Promise<AreaRow> {
    if (typeof input.id !== "string" || !AREA_ID.test(input.id)) throw new VaultError("invalid", "Identificador de área inválido");
    const title = parseAreaTitle(input.title), color = parseColor(input.color);
    const path = `${AREA_FOLDER}/${input.id}.md`;
    if (this.host.index.getNote(path)) {
      const old = this.get(path);
      if (!old || old.title !== title || old.color !== color) throw new VaultError("conflict", "El identificador ya corresponde a otra área");
      return old;
    }
    await this.host.createNote({ title: input.id, type: "area", folder: AREA_FOLDER, fm: { title, color } });
    return this.get(path)!;
  }

  async update(path: string, title: string, color: string, hash: string): Promise<AreaRow> {
    const cur = this.get(path);
    if (!cur) throw new VaultError("invalid", "No es un área válida");
    const nextTitle = parseAreaTitle(title), nextColor = parseColor(color);
    if (typeof hash !== "string" || !hash) throw new VaultError("invalid", "Falta el hash del área");
    if (cur.title === nextTitle && cur.color === nextColor) return cur;
    const current = await this.host.readNote(path);
    if (current.hash !== hash) throw new VaultError("conflict", "El área cambió: recargá antes de modificarla");
    let text: string;
    try { text = setFrontmatter(current.text, { title: nextTitle, color: nextColor }); } catch (e) { throw new VaultError("invalid", (e as Error).message); }
    await this.host.saveNote(path, text, hash);
    return this.get(path)!;
  }
}
