import type { Kioku } from "./kioku.ts";
import { relationTarget } from "./index.ts";
import { setFrontmatter } from "./markdown.ts";
import { VaultError } from "./vault.ts";
import { addDays, diffDays } from "./dates.ts";
import { calendarState, parseBlock, parseLocal, taskEstimate, type BlockData, type CalendarItem } from "./calendar.ts";

export interface CalendarInput {
  id: string;
  title: string;
  kind: "block" | "event";
  start: string;
  end: string;
  taskPath?: string | null;
  projectPath?: string | null;
}

export class Calendar {
  constructor(privateHost: Kioku, now: () => Date) {
    this.host = privateHost; this.now = now;
  }
  private host: Kioku;
  private now: () => Date;

  private relation(value: unknown): string | null {
    const target = relationTarget(value);
    return target ? this.host.index.resolve(target) : null;
  }

  private item(path: string): CalendarItem {
    const note = this.host.index.getNote(path);
    if (!note || note.type !== "block" || note.fmError) throw new VaultError("invalid", "No es una actividad de calendario válida");
    let data: BlockData;
    try { data = parseBlock(note.fm); } catch (e) { throw new VaultError("invalid", (e as Error).message); }
    const taskPath = this.relation(data.task), task = taskPath ? this.host.index.getNote(taskPath) : null;
    const projectPath = this.relation(data.project) ?? (task ? this.relation(task.fm.project) : null);
    return {
      ...data, path, title: note.title, hash: note.hash, taskPath, projectPath,
      projectTitle: projectPath ? this.host.index.getNote(projectPath)?.title ?? null : null,
      state: calendarState(data, this.now()),
    };
  }

  range(from: string, to: string) {
    parseLocal(from + "T00:00"); parseLocal(to + "T00:00");
    if (to < from || diffDays(from, to) > 366) throw new VaultError("invalid", "Rango inválido (máximo 367 días)");
    const items: CalendarItem[] = [], invalid: { path: string }[] = [];
    for (const note of this.host.index.noteRows()) {
      if (note.type !== "block") continue;
      try {
        const b = this.item(note.path);
        if (b.start < addDays(to, 1) + "T00:00" && b.end > from + "T00:00") items.push(b);
      } catch { invalid.push({ path: note.path }); }
    }
    const tasks = this.host.index.tasks({ status: ["todo", "doing"] }).map((t) => ({
      ...t, estimate: taskEstimate(this.host.index.getNote(t.path)?.fm.estimate),
    }));
    return { items: items.sort((a, b) => a.start.localeCompare(b.start) || a.path.localeCompare(b.path)), tasks, invalid, now: this.now().toISOString() };
  }

  async create(input: CalendarInput): Promise<CalendarItem> {
    if (typeof input.id !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(input.id)) throw new VaultError("invalid", "Identificador de calendario inválido");
    if (typeof input.title !== "string" || !input.title.trim()) throw new VaultError("invalid", "Escribí un título");
    const fm: Record<string, unknown> = { kind: input.kind, start: input.start, end: input.end };
    for (const [key, type] of [["taskPath", "task"], ["projectPath", "project"]] as const) {
      const ref = input[key];
      if (!ref) continue;
      const n = this.host.index.getNote(ref);
      if (!n || n.type !== type || /[\[\]#|\n\r]/.test(ref)) throw new VaultError("invalid", type === "task" ? "La tarea no existe o no es válida" : "El proyecto no existe o no es válido");
      fm[type] = "[[" + ref.replace(/\.md$/i, "") + "]]";
    }
    try { parseBlock(fm); } catch (e) { throw new VaultError("invalid", (e as Error).message); }
    const path = "Calendario/" + input.id + ".md";
    if (this.host.index.getNote(path)) {
      const old = this.item(path);
      if (old.title !== input.title.trim() || old.kind !== input.kind || old.start !== input.start || old.end !== input.end || old.task !== fm.task || old.project !== fm.project) {
        throw new VaultError("conflict", "El identificador ya corresponde a otra actividad");
      }
      return old;
    }
    await this.host.createNote({ title: input.id, type: "block", folder: "Calendario", fm: { ...fm, title: input.title.trim() } });
    return this.item(path);
  }

  async move(path: string, start: string, end: string, hash: string): Promise<CalendarItem> {
    const b = this.item(path);
    try { parseBlock({ ...b, start, end }); } catch (e) { throw new VaultError("invalid", (e as Error).message); }
    if (b.start === start && b.end === end) return b;
    await this.patch(path, { start, end }, hash);
    return this.item(path);
  }

  async finish(path: string, hash: string): Promise<CalendarItem> {
    const b = this.item(path);
    if (b.kind !== "block") throw new VaultError("invalid", "Un evento no se termina como bloque");
    if (b.done_at) return b;
    await this.patch(path, { done_at: this.now().toISOString() }, hash);
    return this.item(path);
  }

  private async patch(path: string, props: Record<string, unknown>, hash: string): Promise<void> {
    if (typeof hash !== "string" || !hash) throw new VaultError("invalid", "Falta el hash de la actividad");
    const current = await this.host.readNote(path);
    if (current.hash !== hash) throw new VaultError("conflict", "La actividad cambió: recargá antes de modificarla");
    await this.host.saveNote(path, setFrontmatter(current.text, props), hash);
  }
}
