// Fachada del producto. Toda la lógica de Kioku vive aquí; servidor, CLI y UI son clientes finos.
import { EventEmitter } from "node:events";
import { watch as fsWatch, type FSWatcher } from "node:fs";
import path from "node:path";
import { ActivityLog, type EventKind } from "./activity.ts";
import { RulesProvider, triageInput, type AIProvider } from "./ai.ts";
import { buildPayload, LlmProvider, MAX_CAPTURES, parseLlmConfig, type LlmConfig, type LlmPayload } from "./llm.ts";
import { parseCapture, type ParsedCapture } from "./capture.ts";
import { addDays, diffDays, localDate, localTime } from "./dates.ts";
import { availableColumns, matchesSource, parseDatabase, queryRows, type Column, type DatabaseDef, type QueryResult, type View } from "./database.ts";
import { fuzzyScore, Index, relationTarget, type NoteRow, type NoteType, type TaskRow, type TaskStatus } from "./index.ts";
import { ulid } from "./ids.ts";
import { appendToSection, normKey, parseNote, renderNote, sectionItems, setFrontmatter, splitFrontmatter } from "./markdown.ts";
import { ProposalStore, type Op, type Proposal, type ProposalDraft } from "./proposals.ts";
import { sanitizeFileName, Vault, VaultError } from "./vault.ts";

export const FOLDERS: Record<NoteType, string> = {
  capture: "Bandeja", task: "Tareas", project: "Proyectos", note: "Notas", journal: "Diario", resource: "Recursos", database: "Bases",
};

/** Claves del sistema: ni las filas nuevas ni el asistente pueden fijarlas. */
export const RESERVED_PROPS: ReadonlySet<string> = new Set(["id", "type", "created"]);

/** Valor escalar o lista de escalares: lo único que una celda puede contener (nunca objetos, que son esquema o vistas). */
export function isPlainValue(v: unknown): boolean {
  const scalar = (x: unknown) => typeof x === "string" || typeof x === "number" || typeof x === "boolean";
  return scalar(v) || (Array.isArray(v) && v.every(scalar));
}

/** Carpeta donde se crean las filas: sin `..`, segmentos vacíos ni ocultos (`.kioku`, `.obsidian`…). */
function rowFolder(folder: string): string {
  const clean = folder.replace(/^\.?\/+|\/+$/g, "");
  const segs = clean.split(/[\\/]/);
  if (!clean || segs.some((x) => x === "" || x.startsWith("."))) throw new VaultError("invalid", `La carpeta de origen «${folder}» no es válida para crear filas`);
  return clean;
}

const rawName = (v: unknown): string | null =>
  typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string" ? (v as { name: string }).name.trim() : null;

export interface CaptureResult {
  kind: ParsedCapture["kind"];
  path: string;
  message: string;
  parked: boolean;
  warnings: string[];
}

export interface FocusState {
  active: boolean;
  id?: string;
  startedAt?: string;
  taskPath?: string | null;
  taskTitle?: string | null;
  projectPath?: string | null;
  projectTitle?: string | null;
}

export interface Suggestion {
  task: TaskRow;
  score: number;
  reasons: string[];
}

export interface ResumeCard {
  project: { path: string; title: string; status: string };
  idleDays: number | null;
  lastActivity: string | null;
  lastCheckpoint: { ts: string | null; text: string } | null;
  decisions: string[];
  open: TaskRow[];
  touched: { path: string; title: string }[];
}

export interface TodayView {
  date: string;
  focus: FocusState;
  suggestion: Suggestion | null;
  alternatives: Suggestion[];
  resume: ResumeCard[];
  inbox: { count: number; items: { path: string; title: string }[] };
  overdue: number;
  proposals: number;
}

export interface KiokuOptions {
  root: string;
  now?: () => Date;
  /** Proveedores de IA; por defecto solo reglas locales. */
  providers?: AIProvider[];
}

export function scoreTask(
  t: TaskRow,
  ctx: { today: string; hotProjects: Set<string>; dayFocus: Set<string> },
): Suggestion {
  let score = 0;
  const reasons: string[] = [];
  if (t.due) {
    const d = diffDays(ctx.today, t.due);
    if (d < 0) { score += 100; reasons.push(d === -1 ? "venció ayer" : `venció hace ${-d} días`); }
    else if (d === 0) { score += 80; reasons.push("vence hoy"); }
    else if (d <= 3) { score += 40; reasons.push(d === 1 ? "vence mañana" : `vence en ${d} días`); }
    else if (d <= 7) { score += 15; reasons.push("vence esta semana"); }
  }
  if (t.status === "doing") { score += 60; reasons.push("ya la empezaste"); }
  if (ctx.dayFocus.has(t.path)) { score += 50; reasons.push("la elegiste como foco de hoy"); }
  if (t.projectPath && ctx.hotProjects.has(t.projectPath)) { score += 20; reasons.push("proyecto con actividad reciente"); }
  if (t.priority === 1) { score += 30; reasons.push("prioridad alta"); }
  else if (t.priority === 2) { score += 15; reasons.push("prioridad media"); }
  return { task: t, score, reasons };
}

function compareSuggestions(a: Suggestion, b: Suggestion): number {
  return (
    b.score - a.score ||
    (a.task.due ?? "9999").localeCompare(b.task.due ?? "9999") ||
    a.task.title.localeCompare(b.task.title)
  );
}

export class Kioku {
  readonly vault: Vault;
  readonly index: Index;
  readonly log: ActivityLog;
  readonly proposals: ProposalStore;
  readonly bus = new EventEmitter();
  readonly providers: AIProvider[];
  private now: () => Date;
  private watcher: FSWatcher | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private lastEditLogged = new Map<string, number>();

  private constructor(opts: KiokuOptions) {
    this.now = opts.now ?? (() => new Date());
    this.vault = new Vault(opts.root);
    this.index = new Index(path.join(this.vault.root, ".kioku", "index.db"));
    this.log = new ActivityLog(this.vault, this.index, this.now);
    this.proposals = new ProposalStore(this.vault);
    this.providers = opts.providers ?? [new RulesProvider()];
  }

  static async open(opts: KiokuOptions): Promise<Kioku> {
    const j = new Kioku(opts);
    await j.vault.writeInternal("README.txt",
      "Carpeta interna de Kioku. index.db es un índice DERIVADO: se puede borrar y se reconstruye.\n" +
      "log/ = actividad (texto plano), proposals/ = propuestas de IA, trash/ = borrados recuperables.\n");
    await j.log.reload();
    await j.index.sync(j.vault);
    return j;
  }

  close(): void {
    this.unwatch();
    this.index.close();
  }

  today_(): string {
    return localDate(this.now());
  }

  /* ---------------- sincronización con disco ---------------- */

  watch(): void {
    if (this.watcher) return;
    this.watcher = fsWatch(this.vault.root, { recursive: true }, (_ev, filename) => {
      if (!filename) return;
      const f = filename.toString();
      if (f.split(path.sep).some((seg) => seg.startsWith(".")) || !f.toLowerCase().endsWith(".md")) return;
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => {
        this.index.sync(this.vault).then((r) => {
          if (r.added || r.updated || r.removed) this.bus.emit("change", { kind: "external", ...r });
        }).catch(() => {});
      }, 150);
    });
  }

  unwatch(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.syncTimer) clearTimeout(this.syncTimer);
  }

  async reindex(): Promise<{ notes: number; events: number }> {
    this.index.reset();
    const events = await this.log.reload();
    await this.index.sync(this.vault);
    this.bus.emit("change", { kind: "reindex" });
    return { notes: this.index.count(), events };
  }

  private async reindexPath(rel: string): Promise<NoteRow> {
    const r = await this.vault.read(rel);
    const row = this.index.tx(() => {
      const n = this.index.upsertNote(rel, r.text, { mtimeMs: r.mtimeMs, size: Buffer.byteLength(r.text) });
      this.index.resolveAll();
      return n;
    });
    return row;
  }

  private changed(kind: string, p: string | null): void {
    this.bus.emit("change", { kind, path: p });
  }

  /* ---------------- notas ---------------- */

  async readNote(rel: string): Promise<{ text: string; hash: string; note: NoteRow | null }> {
    const r = await this.vault.read(rel);
    return { text: r.text, hash: r.hash, note: this.index.getNote(rel) };
  }

  async openedNote(rel: string): Promise<void> {
    await this.log.record("note.open", rel);
  }

  /** Guarda desde el editor. Falla con VaultError("conflict") si el archivo cambió fuera. */
  async saveNote(rel: string, text: string, baseHash: string): Promise<{ hash: string; note: NoteRow }> {
    const { hash } = await this.vault.write(rel, text, baseHash);
    const note = await this.reindexPath(rel);
    const last = this.lastEditLogged.get(rel) ?? 0;
    if (Date.now() - last > 5 * 60_000) {
      this.lastEditLogged.set(rel, Date.now());
      await this.log.record("note.edit", rel, { project: this.projectOf(note) });
    }
    this.changed("note", rel);
    return { hash, note };
  }

  /** Ruta y texto que tendría una nota nueva, sin escribirla (lo usan createNote y las propuestas del asistente). */
  buildNote(opts: {
    title: string; type?: NoteType; folder?: string; body?: string; fm?: Record<string, unknown>; parked?: string | null;
  }): { rel: string; text: string } {
    const type = opts.type ?? "note";
    const title = opts.title.trim() || "Sin título";
    const base = sanitizeFileName(title);
    const rel = this.vault.uniquePath(`${opts.folder ?? FOLDERS[type]}/${base}.md`);
    const fm: Record<string, unknown> = { id: ulid(this.now().getTime()), type };
    if (base !== title) fm.title = title;
    Object.assign(fm, opts.fm ?? {});
    fm.created = this.now().toISOString();
    if (opts.parked) fm.parked = opts.parked;
    return { rel, text: renderNote(fm, opts.body ?? "") };
  }

  async createNote(opts: {
    title: string; type?: NoteType; folder?: string; body?: string; fm?: Record<string, unknown>; parked?: string | null;
  }): Promise<NoteRow> {
    const { rel, text } = this.buildNote(opts);
    await this.vault.write(rel, text, null);
    const note = await this.reindexPath(rel);
    this.changed("note", rel);
    return note;
  }

  /** Cambia propiedades del frontmatter conservando todo lo demás. */
  async setProps(rel: string, props: Record<string, unknown>): Promise<NoteRow> {
    const cur = await this.vault.read(rel);
    const next = setFrontmatter(cur.text, props);
    await this.vault.write(rel, next, cur.hash);
    const note = await this.reindexPath(rel);
    this.changed("note", rel);
    return note;
  }

  /** Acción directa del usuario sobre una captura de la Bandeja: la convierte en tarea o nota y la mueve a su carpeta. */
  async convertCapture(rel: string, kind: "task" | "note"): Promise<NoteRow> {
    const n = this.index.getNote(rel);
    if (!n || n.type !== "capture") throw new VaultError("invalid", "Solo se pueden convertir capturas de la Bandeja");
    await this.setProps(rel, kind === "task" ? { type: "task", status: "todo" } : { type: "note" });
    const to = this.vault.uniquePath(`${FOLDERS[kind]}/${path.posix.basename(rel)}`);
    await this.vault.move(rel, to);
    this.index.tx(() => { this.index.removeNote(rel); });
    const moved = await this.reindexPath(to);
    await this.log.record("capture.convert", to, { from: rel, kind });
    this.changed("note", to);
    return moved;
  }

  /** Restaura ficheros a un estado anterior (Deshacer del asistente). `text: null` = el fichero no debe existir. */
  async restoreSnapshot(files: { path: string; text: string | null }[]): Promise<void> {
    for (const f of files) {
      if (f.text === null) {
        if (this.vault.exists(f.path)) await this.vault.trash(f.path);
        this.index.tx(() => { this.index.removeNote(f.path); });
      } else {
        await this.vault.write(f.path, f.text);
        await this.reindexPath(f.path);
      }
    }
    this.index.tx(() => { this.index.resolveAll(); });
    for (const f of files) this.changed(f.text === null ? "delete" : "note", f.path);
  }

  async deleteNote(rel: string): Promise<string> {
    const dest = await this.vault.trash(rel);
    this.index.tx(() => { this.index.removeNote(rel); this.index.resolveAll(); });
    this.changed("delete", rel);
    return dest;
  }

  /* ---------------- bases de datos ---------------- */

  /** Fila de la base: sus notas se leen siempre del índice, que es derivado (borrarlo y reindexar da lo mismo). */
  private databaseDef(rel: string): DatabaseDef {
    const n = this.index.getNote(rel);
    if (!n) throw new VaultError("not-found", "Base de datos no encontrada");
    if (n.type !== "database") throw new VaultError("invalid", "Esa nota no es una base de datos");
    return parseDatabase({ path: n.path, title: n.title, fm: n.fm });
  }

  /** `skip`: filas que quien consulta no debe ver (p. ej. carpetas excluidas del asistente); tampoco se cuentan. */
  listDatabases(opts: { skip?: (path: string) => boolean } = {}): { path: string; title: string; rows: number; views: View[]; warnings: string[] }[] {
    const all = this.index.noteRows().filter((r) => !opts.skip?.(r.path) || r.type === "database");
    return all.filter((r) => r.type === "database").map((r) => {
      const def = parseDatabase(r);
      return { path: def.path, title: def.title, rows: all.filter((x) => matchesSource(def, x)).length, views: def.views, warnings: def.warnings };
    });
  }

  /** `view`: nombre de una vista guardada, o una vista ad hoc (filtros del momento sin guardar). Sin `view`, la primera. */
  queryDatabase(rel: string, view?: string | View, opts: { skip?: (path: string) => boolean } = {}): QueryResult & { database: { path: string; title: string; views: View[]; warnings: string[]; available: Column[] } } {
    const def = this.databaseDef(rel);
    let v: View;
    if (view === undefined) v = def.views[0];
    else if (typeof view === "string") {
      const found = def.views.find((x) => x.name === view);
      if (!found) throw new VaultError("not-found", `Vista «${view}» no encontrada`);
      v = found;
    } else v = this.validView(view);
    const rows = this.index.noteRows().filter((r) => !opts.skip?.(r.path) && matchesSource(def, r));
    return { ...queryRows(def, v, rows), database: { path: def.path, title: def.title, views: def.views, warnings: def.warnings, available: availableColumns(def, rows) } };
  }

  /** Una vista llegada de fuera (API, asistente) se valida con el mismo parser tolerante: si algo se descartaría, se rechaza. */
  private validView(raw: unknown): View {
    const probe = parseDatabase({ path: "", title: "", fm: { views: [raw] } });
    if (probe.warnings.length || probe.views.length !== 1) throw new VaultError("invalid", probe.warnings[0] ?? "Vista inválida");
    return probe.views[0];
  }

  async createDatabase(opts: { name: string; template?: "vacía" | "tareas" | "proyectos" | "libros" }): Promise<NoteRow> {
    const name = opts.name.trim();
    if (!name) throw new VaultError("invalid", "Ponle un nombre a la base");
    const t = opts.template ?? "vacía";
    if (!["vacía", "tareas", "proyectos", "libros"].includes(t)) throw new VaultError("invalid", `Plantilla desconocida: ${String(t)}`);
    const table = (columns: string[]) => ({ name: "Tabla", kind: "table", columns, filter: [], sort: [], group: null });
    const board = (name: string, group: string, columns: string[]) => ({ name, kind: "board", columns, filter: [], sort: [], group });
    const spec: Record<string, unknown> =
      t === "tareas" ? {
        source: { type: "task" },
        properties: { status: { type: "select", options: ["todo", "doing", "done", "dropped"] }, due: { type: "date" }, priority: { type: "number" } },
        views: [table(["title", "status", "due", "priority"]), board("Tablero", "status", ["title", "due"])],
      } : t === "proyectos" ? {
        source: { type: "project" },
        properties: { status: { type: "select", options: ["active", "paused", "done"] } },
        views: [table(["title", "status"]), board("Por estado", "status", ["title"])],
      } : t === "libros" ? {
        source: { folder: "Libros/" },
        properties: { Estado: { type: "select", options: ["Quiero leer", "Leyendo", "Leído"] }, Autor: { type: "text" }, Nota: { type: "number" } },
        views: [table(["title", "Estado", "Autor", "Nota"]), board("Por estado", "Estado", ["title", "Autor"])],
      } : {
        source: { folder: `${sanitizeFileName(name)}/` },
        properties: {},
        views: [table(["title"])],
      };
    return this.createNote({ title: name, type: "database", fm: spec, body: `# ${name}\n\nBase de datos: las filas son notas Markdown; las vistas se guardan en las propiedades de este fichero.\n` });
  }

  /** Añade o reemplaza (por nombre) una vista. Lo demás del frontmatter —incluidas vistas escritas a mano— se conserva tal cual. */
  async saveView(rel: string, view: View): Promise<NoteRow> {
    this.databaseDef(rel);
    const v = this.validView(view);
    return this.mutateViews(rel, (raw) => {
      const i = raw.findIndex((x) => rawName(x) === v.name);
      if (i >= 0) raw[i] = v; else raw.push(v);
      return raw;
    });
  }

  async deleteView(rel: string, name: string): Promise<NoteRow> {
    this.databaseDef(rel);
    return this.mutateViews(rel, (raw) => {
      const next = raw.filter((x) => rawName(x) !== name);
      if (next.length === raw.length) throw new VaultError("not-found", `Vista «${name}» no encontrada`);
      return next;
    });
  }

  /**
   * Cambia `views` partiendo del texto del fichero (no del índice, que puede ir por detrás de una edición externa)
   * y en serie, para que dos guardados simultáneos no se pisen.
   */
  private mutateViews(rel: string, fn: (raw: unknown[]) => unknown[]): Promise<NoteRow> {
    const run = async () => {
      const cur = await this.vault.read(rel);
      const views = parseNote(cur.text, rel).frontmatter.views;
      const next = fn(Array.isArray(views) ? [...views] : []);
      const text = setFrontmatter(cur.text, { views: next.length ? next : null });
      await this.vault.write(rel, text, cur.hash);
      const note = await this.reindexPath(rel);
      this.changed("note", rel);
      return note;
    };
    const result = this.viewsQueue.then(run, run);
    this.viewsQueue = result.catch(() => undefined);
    return result;
  }

  private viewsQueue: Promise<unknown> = Promise.resolve();

  /** Nueva fila: una nota normal en la carpeta/tipo de origen. `id`, `type` y `created` son del sistema y nunca se aceptan. */
  async createRow(rel: string, opts: { title: string; props?: Record<string, unknown> }): Promise<NoteRow> {
    const { rel: p, text } = this.buildRow(rel, opts);
    await this.vault.write(p, text, null);
    const note = await this.reindexPath(p);
    this.changed("note", p);
    return note;
  }

  /** Ruta y texto de la fila sin escribirla (lo usa el asistente para decidir entre aplicar y proponer). */
  buildRow(rel: string, opts: { title: string; props?: Record<string, unknown> }): { rel: string; text: string } {
    const def = this.databaseDef(rel);
    const s = def.source;
    if (s.folder === null && s.type === null && s.tags.length === 0) throw new VaultError("invalid", "La base no tiene origen: no se pueden crear filas");
    const fm: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(opts.props ?? {})) {
      if (RESERVED_PROPS.has(k) || k === "title") continue;
      if (!isPlainValue(val)) throw new VaultError("invalid", `El valor de «${k}» debe ser texto, número, fecha, casilla o lista`);
      fm[k] = val;
    }
    if (s.tags.length && fm.tags === undefined) fm.tags = s.tags;
    if (s.type === "task" && fm.status === undefined) fm.status = "todo";
    return this.buildNote({
      title: opts.title, type: s.type ?? "note", fm,
      folder: s.folder !== null ? rowFolder(s.folder) : FOLDERS[s.type ?? "note"],
    });
  }

  /* ---------------- captura (Quick) ---------------- */

  async capture(input: string): Promise<CaptureResult> {
    const text = input.trim();
    if (!text) throw new VaultError("invalid", "Nada que capturar");
    const today = this.today_();
    const p = parseCapture(text, today);
    if (!p.title) throw new VaultError("invalid", "Nada que capturar");
    const focus = this.focusState();
    const parkedId = focus.active ? focus.id! : null;
    const warnings = p.unparsed.map((u) => `No entendí la fecha «${u}»`);

    if (p.kind === "decision") {
      const proj = this.pickProject(p.projectQuery, focus);
      if (!proj) throw new VaultError("invalid", "¿De qué proyecto? Usa @proyecto o inicia un foco");
      await this.addDecision(proj.path, p.text);
      return { kind: "decision", path: proj.path, message: `Decisión añadida a «${proj.title}»`, parked: false, warnings };
    }

    if (p.kind === "task") {
      const proj = p.projectQuery ? this.findProject(p.projectQuery) : focus.active && focus.projectPath ? this.index.getNote(focus.projectPath) : null;
      if (p.projectQuery && !proj) warnings.push(`No encontré el proyecto «${p.projectQuery}»`);
      const fm: Record<string, unknown> = { status: "todo" };
      if (proj) fm.project = `[[${proj.title}]]`;
      if (p.due) fm.due = p.due;
      if (p.priority) fm.priority = p.priority;
      const note = await this.createNote({ title: p.title, type: "task", fm, parked: parkedId });
      await this.log.record("capture", note.path, { kind: "task", project: proj?.path ?? null });
      return { kind: "task", path: note.path, message: `Tarea creada${p.due ? ` para ${p.due}` : ""}`, parked: !!parkedId, warnings };
    }

    const type: NoteType = p.kind === "note" ? "note" : "capture";
    const body = p.text !== p.title ? p.text + "\n" : "";
    const note = await this.createNote({ title: p.title, type, body, parked: type === "capture" ? parkedId : null });
    await this.log.record("capture", note.path, { kind: p.kind });
    return {
      kind: p.kind, path: note.path, parked: type === "capture" && !!parkedId, warnings,
      message: type === "capture" ? (parkedId ? "Guardado para después del foco" : "Guardado en Bandeja") : "Nota creada",
    };
  }

  /* ---------------- tareas ---------------- */

  /** Propiedades que implica un cambio de estado de tarea (done_at solo al completarla). */
  taskStatusProps(status: TaskStatus): Record<string, unknown> {
    return { status, done_at: status === "done" ? this.now().toISOString() : null };
  }

  async setTaskStatus(rel: string, status: TaskStatus): Promise<NoteRow> {
    const note = await this.setProps(rel, this.taskStatusProps(status));
    await this.log.record("task.status", rel, { status, project: this.projectOf(note) });
    return note;
  }

  private projectOf(note: NoteRow): string | null {
    if (note.type === "project") return note.path;
    const t = relationTarget(note.fm.project);
    return t ? this.index.resolve(t) : null;
  }

  /* ---------------- proyectos ---------------- */

  findProject(query: string): NoteRow | null {
    const q = normKey(query);
    if (!q) return null;
    let best: { n: NoteRow; s: number } | null = null;
    for (const p of this.index.listNotes({ type: "project", limit: 500 })) {
      const full = this.index.getNote(p.path)!;
      if (full.fm.status === "done") continue;
      const al = Array.isArray(full.fm.aliases) ? full.fm.aliases.map(String) : [];
      const s = Math.max(...[p.title, ...al].map((n) => fuzzyScore(q, normKey(n))));
      if (s > 0 && (!best || s > best.s)) best = { n: full, s };
    }
    return best?.n ?? null;
  }

  private pickProject(query: string | null, focus: FocusState): NoteRow | null {
    if (query) return this.findProject(query);
    if (focus.active && focus.projectPath) return this.index.getNote(focus.projectPath);
    return null;
  }

  async createProject(title: string): Promise<NoteRow> {
    return this.createNote({
      title, type: "project", fm: { status: "active" },
      body: `# ${title}\n\n## Objetivo\n\n## Decisiones\n\n## Bitácora\n`,
    });
  }

  /** Texto resultante de añadir una entrada a «Decisiones» o «Bitácora» (sin escribir). */
  async withEntry(projectPath: string, kind: "decision" | "checkpoint", text: string): Promise<{ before: string; next: string }> {
    const d = this.now();
    const cur = await this.vault.read(projectPath);
    const { fmText, body } = splitFrontmatter(cur.text);
    const [section, item] = kind === "decision" ? ["Decisiones", `${localDate(d)} — ${text}`] : ["Bitácora", `${localDate(d)} ${localTime(d)} — ${text}`];
    return { before: cur.hash, next: (fmText === null ? "" : `---\n${fmText}\n---\n`) + appendToSection(body, section, item) };
  }

  private async writeEntry(projectPath: string, kind: "decision" | "checkpoint", text: string): Promise<void> {
    const { before, next } = await this.withEntry(projectPath, kind, text);
    await this.vault.write(projectPath, next, before);
    await this.reindexPath(projectPath);
    await this.log.record(kind, projectPath, { text, project: projectPath });
    this.changed("note", projectPath);
  }

  async addDecision(projectPath: string, text: string): Promise<void> {
    await this.writeEntry(projectPath, "decision", text);
  }

  async addCheckpoint(projectPath: string, text: string): Promise<void> {
    await this.writeEntry(projectPath, "checkpoint", text);
  }

  projectLastTouch(projectPath: string): string | null {
    const p = this.index.getNote(projectPath);
    if (!p) return null;
    let last = new Date(p.mtime).toISOString();
    for (const t of this.index.tasks({ projectPath })) {
      const iso = new Date(t.mtime).toISOString();
      if (iso > last) last = iso;
    }
    for (const e of this.index.events({ limit: 500 })) {
      if (e.data.project === projectPath && e.ts > last) last = e.ts;
    }
    return last;
  }

  resume(projectPath: string): ResumeCard | null {
    const p = this.index.getNote(projectPath);
    if (!p) return null;
    const bitacora = sectionItems(p.body, "Bitácora");
    let lastCheckpoint: ResumeCard["lastCheckpoint"] = null;
    const lastLine = bitacora[bitacora.length - 1];
    if (lastLine) {
      const m = /^(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)\s+[—-]\s+(.*)$/.exec(lastLine);
      lastCheckpoint = m ? { ts: m[1], text: m[2] } : { ts: null, text: lastLine };
    }
    const decisions = sectionItems(p.body, "Decisiones").slice(-3).reverse();
    const open = this.index
      .tasks({ projectPath, status: ["todo", "doing"] })
      .filter((t) => !this.isParked(t))
      .sort((a, b) => (a.status === "doing" ? -1 : 0) - (b.status === "doing" ? -1 : 0) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || (a.priority ?? 9) - (b.priority ?? 9));
    const related = new Map<string, { path: string; title: string; mtime: number }>();
    const add = (path: string) => {
      const n = this.index.getNote(path);
      if (n && n.type !== "task" && n.path !== projectPath) related.set(path, { path, title: n.title, mtime: n.mtime });
    };
    this.index.backlinks(projectPath).forEach((b) => add(b.path));
    this.index.outgoing(projectPath).forEach((o) => o.path && add(o.path));
    const touched = [...related.values()].sort((a, b) => b.mtime - a.mtime).slice(0, 5).map(({ path, title }) => ({ path, title }));
    const lastActivity = this.projectLastTouch(projectPath);
    const idleDays = lastActivity ? Math.max(0, diffDays(localDate(new Date(lastActivity)), this.today_())) : null;
    return {
      project: { path: p.path, title: p.title, status: String(p.fm.status ?? "active") },
      idleDays, lastActivity, lastCheckpoint, decisions, open, touched,
    };
  }

  /* ---------------- foco ---------------- */

  focusState(): FocusState {
    const ev = this.index.events({ kinds: ["focus.start", "focus.end"], limit: 1 })[0];
    if (!ev || ev.kind === "focus.end") return { active: false };
    const d = ev.data as { task?: string | null; project?: string | null };
    const task = d.task ? this.index.getNote(d.task) : null;
    const project = d.project ? this.index.getNote(d.project) : null;
    return {
      active: true, id: ev.ts, startedAt: ev.ts,
      taskPath: d.task ?? null, taskTitle: task?.title ?? null,
      projectPath: d.project ?? null, projectTitle: project?.title ?? null,
    };
  }

  private isParked(t: TaskRow): boolean {
    const f = this.focusState();
    return !!t.focus && f.active && t.focus === f.id;
  }

  async startFocus(opts: { taskPath?: string; projectPath?: string }): Promise<FocusState> {
    if (this.focusState().active) throw new VaultError("invalid", "Ya hay una sesión de foco activa");
    let task: NoteRow | null = null;
    let project: string | null = opts.projectPath ?? null;
    if (opts.taskPath) {
      task = this.index.getNote(opts.taskPath);
      if (!task || task.type !== "task") throw new VaultError("not-found", "Tarea no encontrada");
      project = this.projectOf(task);
      if ((task.fm.status ?? "todo") === "todo") task = await this.setTaskStatus(task.path, "doing");
    }
    if (!task && !project) throw new VaultError("invalid", "Elige una tarea o un proyecto");
    await this.log.record("focus.start", task?.path ?? project, { task: task?.path ?? null, project });
    this.changed("focus", null);
    return this.focusState();
  }

  async endFocus(opts: { checkpoint?: string; done?: boolean } = {}): Promise<{ minutes: number }> {
    const f = this.focusState();
    if (!f.active) throw new VaultError("invalid", "No hay foco activo");
    const minutes = Math.max(0, Math.round((this.now().getTime() - new Date(f.startedAt!).getTime()) / 60_000));
    const cp = opts.checkpoint?.trim();
    if (cp && f.projectPath) await this.addCheckpoint(f.projectPath, cp);
    if (opts.done && f.taskPath) await this.setTaskStatus(f.taskPath, "done");
    await this.log.record("focus.end", f.taskPath ?? f.projectPath ?? null, {
      task: f.taskPath ?? null, project: f.projectPath ?? null, minutes, checkpoint: cp ?? null,
    });
    this.changed("focus", null);
    return { minutes };
  }

  /* ---------------- Hoy ---------------- */

  inbox(): NoteRow[] {
    const f = this.focusState();
    return this.index
      .listNotes({ type: "capture", limit: 500 })
      .map((n) => this.index.getNote(n.path)!)
      .filter((n) => !(f.active && n.fm.parked === f.id))
      .sort((a, b) => b.mtime - a.mtime);
  }

  async dayFocusPaths(date: string): Promise<Set<string>> {
    const j = this.index.getNote(`${FOLDERS.journal}/${date}.md`);
    const out = new Set<string>();
    const fm = j?.fm.focus;
    for (const x of Array.isArray(fm) ? fm : fm ? [fm] : []) {
      const t = relationTarget(x);
      const p = t ? this.index.resolve(t) : null;
      if (p) out.add(p);
    }
    return out;
  }

  async today(): Promise<TodayView> {
    const date = this.today_();
    const focus = this.focusState();
    const projects = this.index.listNotes({ type: "project", limit: 500 }).filter((p) => {
      const s = this.index.getNote(p.path)!.fm.status;
      return !s || s === "active";
    });
    const cutoff = addDays(date, -2);
    const hot = new Set<string>();
    const touch = new Map<string, string>();
    for (const p of projects) {
      const t = this.projectLastTouch(p.path);
      if (t) touch.set(p.path, t);
      if (t && localDate(new Date(t)) >= cutoff) hot.add(p.path);
    }
    const dayFocus = await this.dayFocusPaths(date);
    const open = this.index.tasks({ status: ["todo", "doing"] }).filter((t) => !this.isParked(t));
    const ranked = open.map((t) => scoreTask(t, { today: date, hotProjects: hot, dayFocus })).sort(compareSuggestions);
    const resume = projects
      .sort((a, b) => (touch.get(b.path) ?? "").localeCompare(touch.get(a.path) ?? ""))
      .slice(0, 3)
      .map((p) => this.resume(p.path)!)
      .filter(Boolean);
    const inbox = this.inbox();
    return {
      date, focus,
      suggestion: ranked[0] ?? null,
      alternatives: ranked.slice(1, 3),
      resume,
      inbox: { count: inbox.length, items: inbox.slice(0, 3).map((n) => ({ path: n.path, title: n.title })) },
      overdue: open.filter((t) => t.due && t.due < date).length,
      proposals: (await this.proposals.list("pending")).length,
    };
  }

  /* ---------------- diario ---------------- */

  async journal(date = this.today_()): Promise<NoteRow> {
    const rel = `${FOLDERS.journal}/${date}.md`;
    const ex = this.index.getNote(rel);
    if (ex) return ex;
    await this.vault.write(rel, renderNote({ id: ulid(this.now().getTime()), type: "journal", created: this.now().toISOString() }, `# ${date}\n\n`), null);
    const n = await this.reindexPath(rel);
    this.changed("note", rel);
    return n;
  }

  /* ---------------- propuestas ---------------- */

  /** Genera propuestas de triage para capturas de la Bandeja que aún no tienen una pendiente. */
  async refreshTriage(): Promise<Proposal[]> {
    const pending = await this.proposals.list("pending");
    const have = new Set(pending.map((p) => p.key));
    const captures = this.inbox().filter((c) => !have.has(`triage:${c.path}`));
    if (!captures.length) return [];
    const created: Proposal[] = [];
    for (const prov of this.providers) {
      if (!(await prov.available())) continue;
      const drafts = await prov.proposeTriage(triageInput(this.index, captures));
      for (const d of drafts) {
        if (d.key && have.has(d.key)) continue;
        const p = await this.proposals.create(d, this.now());
        await this.log.record("proposal.created", null, { id: p.id, title: p.title, source: p.source });
        created.push(p);
        if (d.key) have.add(d.key);
      }
      if (created.length) break; // el primer proveedor disponible que aporte, gana
    }
    if (created.length) this.changed("proposals", null);
    return created;
  }

  /* ---------------- IA opcional (modelo real) ---------------- */

  async aiConfig(): Promise<LlmConfig | null> {
    return parseLlmConfig(await this.vault.readInternal("ai.json"));
  }

  async setAiConfig(cfg: LlmConfig | null): Promise<void> {
    if (cfg) await this.vault.writeInternal("ai.json", JSON.stringify(cfg, null, 2) + "\n");
    else await this.vault.writeInternal("ai.json", "");
  }

  /** Capturas que se enviarían ahora (sin propuesta del modelo pendiente), con el payload exacto. */
  private async aiBatch() {
    const cfg = await this.aiConfig();
    if (!cfg) return null;
    const pending = new Set((await this.proposals.list("pending")).filter((p) => p.source.startsWith("llm:")).map((p) => p.key));
    const captures = this.inbox().filter((c) => !pending.has(`triage:${c.path}`)).slice(0, MAX_CAPTURES);
    const payload = buildPayload(cfg, triageInput(this.index, captures));
    return payload ? { cfg, captures, payload } : null;
  }

  /** Lo que se enviaría al modelo ahora mismo, byte a byte. No hace ninguna petición. */
  async aiPreview(): Promise<LlmPayload | null> {
    return (await this.aiBatch())?.payload ?? null;
  }

  /** Envía al modelo SOLO si el payload coincide con el que el usuario vio (`hash`). Devuelve propuestas pendientes. */
  async llmTriage(hash: string, fetchImpl?: typeof fetch): Promise<Proposal[]> {
    const batch = await this.aiBatch();
    if (!batch) throw new VaultError("invalid", "IA no configurada o Bandeja vacía");
    const { cfg, captures, payload } = batch;
    if (payload.hash !== hash) throw new VaultError("conflict", "La Bandeja o la configuración cambió: revisa de nuevo qué se enviaría");
    await this.log.record("ai.request", null, { endpoint: payload.endpoint, model: payload.model, local: payload.local, captures: captures.length, hash });
    const drafts = await new LlmProvider(cfg, fetchImpl).proposeTriage(triageInput(this.index, captures));
    const pending = await this.proposals.list("pending");
    const created: Proposal[] = [];
    for (const d of drafts) {
      for (const old of pending.filter((p) => p.key === d.key && !p.source.startsWith("llm:"))) {
        old.status = "rejected"; old.resolvedAt = this.now().toISOString(); old.error = "Sustituida por la propuesta del modelo";
        await this.proposals.save(old);
        await this.log.record("proposal.rejected", null, { id: old.id, title: old.title, reason: "sustituida por IA" });
      }
      const p = await this.proposals.create(d, this.now());
      await this.log.record("proposal.created", null, { id: p.id, title: p.title, source: p.source });
      created.push(p);
    }
    if (created.length) this.changed("proposals", null);
    return created;
  }

  /** Crea una propuesta pendiente (la usa el asistente cuando una escritura excede su nivel). */
  async createProposal(draft: ProposalDraft): Promise<Proposal> {
    const p = await this.proposals.create(draft, this.now());
    await this.log.record("proposal.created", null, { id: p.id, title: p.title, source: p.source });
    this.changed("proposals", null);
    return p;
  }

  /** Aplica una propuesta: valida TODOS los hashes antes de tocar nada. */
  async applyProposal(id: string): Promise<Proposal> {
    const p = await this.proposals.get(id);
    if (!p) throw new VaultError("not-found", "Propuesta no encontrada");
    if (p.status !== "pending") throw new VaultError("invalid", `La propuesta ya está ${p.status}`);

    const touched = new Set<string>();
    const check = async (rel: string, before: string | null) => {
      if (touched.has(rel)) return;
      touched.add(rel);
      let cur: string | null = null;
      try { cur = (await this.vault.read(rel)).hash; } catch (e) { if (!(e instanceof VaultError) || e.code !== "not-found") throw e; }
      if (before === null ? cur !== null : cur !== before) {
        throw new VaultError("conflict", `«${rel}» cambió desde que se hizo la propuesta; no se aplica nada`);
      }
    };
    try {
      for (const op of p.ops) {
        if (op.op === "create") await check(op.path, null);
        else if (op.op === "move") { await check(op.from, op.before); await check(op.to, null); touched.add(op.to); }
        else await check(op.path, op.before);
      }
      for (const op of p.ops) await this.runOp(op);
    } catch (e) {
      const conflict = e instanceof VaultError && e.code === "conflict";
      if (!conflict) { p.status = "failed"; p.error = (e as Error).message; p.resolvedAt = this.now().toISOString(); await this.proposals.save(p); }
      throw e;
    }
    p.status = "applied";
    p.resolvedAt = this.now().toISOString();
    await this.proposals.save(p);
    await this.log.record("proposal.applied", null, { id: p.id, title: p.title });
    this.changed("proposals", null);
    return p;
  }

  private async runOp(op: Op): Promise<void> {
    switch (op.op) {
      case "create":
        await this.vault.write(op.path, op.text, null);
        await this.reindexPath(op.path);
        break;
      case "update":
        await this.vault.write(op.path, op.text);
        await this.reindexPath(op.path);
        break;
      case "setProp": {
        const cur = await this.vault.read(op.path);
        await this.vault.write(op.path, setFrontmatter(cur.text, op.props));
        await this.reindexPath(op.path);
        break;
      }
      case "move": {
        await this.vault.move(op.from, op.to);
        this.index.tx(() => { this.index.removeNote(op.from); });
        await this.reindexPath(op.to);
        break;
      }
      case "trash":
        await this.deleteNote(op.path);
        break;
    }
  }

  async rejectProposal(id: string): Promise<Proposal> {
    const p = await this.proposals.get(id);
    if (!p) throw new VaultError("not-found", "Propuesta no encontrada");
    if (p.status !== "pending") throw new VaultError("invalid", `La propuesta ya está ${p.status}`);
    p.status = "rejected";
    p.resolvedAt = this.now().toISOString();
    await this.proposals.save(p);
    await this.log.record("proposal.rejected", null, { id: p.id, title: p.title });
    this.changed("proposals", null);
    return p;
  }

  /** Contexto exacto que se entregaría a un modelo/agente para un proyecto (inspeccionable, sin memoria oculta). */
  contextFor(projectPath: string): { card: ResumeCard; notes: { path: string; title: string; excerpt: string }[] } | null {
    const card = this.resume(projectPath);
    if (!card) return null;
    const notes = card.touched.map((t) => ({
      ...t, excerpt: (this.index.getNote(t.path)?.body ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
    }));
    return { card, notes };
  }

  async record(kind: EventKind, p: string | null, data: Record<string, unknown> = {}) {
    return this.log.record(kind, p, data);
  }
}
