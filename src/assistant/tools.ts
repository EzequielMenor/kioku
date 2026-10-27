// Herramientas que el asistente puede usar. El servidor (no el modelo) impone los niveles:
//   read = libres · auto = reversibles con Deshacer · approval = solo como propuesta.
import type { View } from "../core/database.ts";
import { FOLDERS, type Jarvis } from "../core/jarvis.ts";
import type { NoteType, TaskStatus } from "../core/index.ts";
import { normKey, setFrontmatter } from "../core/markdown.ts";
import type { Op } from "../core/proposals.ts";
import { VaultError } from "../core/vault.ts";
import { AssistantError, MAX_NOTES_PER_QUERY, checkAssistantPath, filterProps, isExcludedPath, isProtectedPath } from "./policy.ts";
import type { AssistantSession } from "./session.ts";
import type { UndoStore } from "./undo.ts";

export type ToolLevel = "read" | "auto" | "approval";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: object;
  level: ToolLevel;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
  undoId?: string;
}

export interface ToolCtx {
  j: Jarvis;
  undo: UndoStore;
  s: AssistantSession;
  exclude: string[];
  /** Ruta sobre la que actúa la herramienta (para el evento y el log). */
  path?: string;
  undoId?: string;
}

interface Def {
  spec: ToolSpec;
  run(ctx: ToolCtx, args: Record<string, unknown>): Promise<unknown>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const S = { type: "string" };

export function argStr(args: Record<string, unknown>, k: string): string {
  const v = args[k];
  if (typeof v !== "string" || !v.trim()) throw new AssistantError("invalid", `Falta «${k}»`);
  return v;
}
export const argOpt = (args: Record<string, unknown>, k: string): string | undefined => (typeof args[k] === "string" && args[k] ? (args[k] as string) : undefined);
const argInt = (args: Record<string, unknown>, k: string, d: number, max: number): number => {
  const v = Number(args[k]);
  return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), max) : d;
};

const isExcluded = isExcludedPath;

/** Quita de un resultado todo objeto cuya `path`/`projectPath` esté excluida (y lo anula si era una propiedad suelta). */
function hideExcluded(v: unknown, exclude: string[]): unknown {
  if (!exclude.length || v === null || typeof v !== "object") return v;
  const bad = (o: object): boolean => ["path", "projectPath"].some((k) => { const x = (o as Record<string, unknown>)[k]; return typeof x === "string" && isExcluded(x, exclude); });
  if (Array.isArray(v)) return v.filter((x) => !(x && typeof x === "object" && bad(x))).map((x) => hideExcluded(x, exclude));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x && typeof x === "object" && !Array.isArray(x) && bad(x) ? null : hideExcluded(x, exclude)]));
}

const READ_DEFS: Def[] = [
  {
    spec: { name: "search", level: "read", description: "Busca notas por texto (título, cuerpo, etiquetas). Devuelve ruta, título y fragmento.", inputSchema: obj({ query: S, limit: { type: "number" } }, ["query"]) },
    async run(c, a) {
      return c.j.index.search(argStr(a, "query"), argInt(a, "limit", 15, 30)).filter((h) => !isExcluded(h.path, c.exclude));
    },
  },
  {
    spec: { name: "read_note", level: "read", description: "Lee una nota completa por su ruta (p. ej. Notas/Cocina.md).", inputSchema: obj({ path: S }, ["path"]) },
    async run(c, a) {
      const path = checkAssistantPath(a.path, c.exclude);
      const r = await c.j.readNote(path);
      c.path = path;
      c.s.reads.add(path);
      return { path, title: r.note?.title ?? null, type: r.note?.type ?? null, text: r.text };
    },
  },
  {
    spec: { name: "list_notes", level: "read", description: "Lista notas, opcionalmente por tipo (note, project, task, capture, journal, resource) o carpeta.", inputSchema: obj({ type: S, prefix: S, limit: { type: "number" } }) },
    async run(c, a) {
      return c.j.index.listNotes({ type: argOpt(a, "type") as NoteType | undefined, prefix: argOpt(a, "prefix"), limit: argInt(a, "limit", 100, 300) })
        .filter((n) => !isExcluded(n.path, c.exclude)).map((n) => ({ path: n.path, title: n.title, type: n.type, mtime: n.mtime }));
    },
  },
  {
    spec: { name: "get_project", level: "read", description: "Tarjeta de reanudación de un proyecto: dónde se dejó, decisiones, tareas abiertas.", inputSchema: obj({ path: S }, ["path"]) },
    async run(c, a) {
      const path = checkAssistantPath(a.path, c.exclude);
      const card = c.j.resume(path);
      if (!card) throw new AssistantError("invalid", "Proyecto no encontrado");
      c.path = path;
      return hideExcluded(card, c.exclude);
    },
  },
  {
    spec: { name: "list_databases", level: "read", description: "Bases de datos (tablas) de la bóveda: ruta, título, nº de filas y vistas guardadas.", inputSchema: obj({}) },
    async run(c) {
      const skip = (p: string) => isExcluded(p, c.exclude);
      return c.j.listDatabases({ skip }).filter((d) => !skip(d.path)).map((d) => ({ path: d.path, title: d.title, rows: d.rows, views: d.views.map((v) => ({ name: v.name, kind: v.kind })) }));
    },
  },
  {
    spec: {
      name: "query_database", level: "read",
      description: "Consulta las filas de una base de datos. `view`: nombre de una vista guardada (opcional). `filter`: lista de {prop, op, value} que se suma a la vista; ops: is, is_not, contains, empty, not_empty, gt, lt, before, after, checked. Devuelve columnas, filas (con sus celdas), total y, si la vista agrupa, los grupos. Máximo 100 filas.",
      inputSchema: obj({ path: S, view: S, filter: { type: "array", items: { type: "object" } } }, ["path"]),
    },
    async run(c, a) {
      const path = checkAssistantPath(a.path, c.exclude);
      const skip = (p: string) => isExcluded(p, c.exclude);
      let view: string | View | undefined = argOpt(a, "view");
      if (a.filter !== undefined) {
        if (!Array.isArray(a.filter)) throw new AssistantError("invalid", "«filter» debe ser una lista de {prop, op, value}");
        const base = c.j.queryDatabase(path, view, { skip }).database.views.find((v) => v.name === view) ?? c.j.queryDatabase(path, undefined, { skip }).database.views[0];
        view = { ...base, name: "consulta", filter: [...base.filter, ...(a.filter as View["filter"])] };
      }
      const r = c.j.queryDatabase(path, view, { skip });
      const LIMIT = 100;
      let left = LIMIT;
      const groups = r.groups?.map((g) => { const rows = g.rows.slice(0, left); left -= rows.length; return { key: g.key, rows }; }) ?? null;
      return {
        database: { path: r.database.path, title: r.database.title, views: r.database.views.map((v) => v.name) },
        columns: r.columns, total: r.total, truncated: r.total > LIMIT,
        rows: r.rows.slice(0, LIMIT), groups,
      };
    },
  },
  { spec: { name: "today", level: "read", description: "Vista «Hoy»: siguiente paso sugerido, proyectos a reanudar, Bandeja, vencidas.", inputSchema: obj({}) }, async run(c) { return hideExcluded(await c.j.today(), c.exclude); } },
  {
    spec: { name: "inbox", level: "read", description: "Capturas pendientes de la Bandeja (ruta, título, texto).", inputSchema: obj({}) },
    async run(c) {
      const caps = c.j.inbox().filter((n) => !isExcluded(n.path, c.exclude));
      for (const n of caps) c.s.reads.add(n.path); // su texto viaja al modelo: queda anotado
      return caps.map((n) => ({ path: n.path, title: n.title, text: n.body.trim().slice(0, 600) }));
    },
  },
  {
    spec: { name: "list_tasks", level: "read", description: "Tareas con estado, proyecto, fecha y prioridad. Filtros: status (todo,doing,done,dropped separados por coma), project (ruta).", inputSchema: obj({ status: S, project: S }) },
    async run(c, a) {
      const st = argOpt(a, "status");
      return (hideExcluded(c.j.index.tasks({ status: st ? (st.split(",") as TaskStatus[]) : undefined, projectPath: argOpt(a, "project") }), c.exclude) as unknown[]).slice(0, 200);
    },
  },
  {
    spec: { name: "neighbors", level: "read", description: "Enlaces de una nota: salientes y entrantes (backlinks).", inputSchema: obj({ path: S }, ["path"]) },
    async run(c, a) {
      const path = checkAssistantPath(a.path, c.exclude);
      c.path = path;
      return {
        outgoing: c.j.index.outgoing(path).filter((o) => !o.path || !isExcluded(o.path, c.exclude)),
        backlinks: c.j.index.backlinks(path).filter((b) => !isExcluded(b.path, c.exclude)).map((b) => ({ path: b.path, title: b.title, context: b.context })),
      };
    },
  },
  {
    spec: { name: "recent_activity", level: "read", description: "Actividad reciente (capturas, ediciones, foco, decisiones) de los últimos N días.", inputSchema: obj({ days: { type: "number" } }) },
    async run(c, a) {
      const since = new Date(Date.now() - argInt(a, "days", 7, 90) * 86_400_000).toISOString();
      return c.j.index.events({ since, limit: 200 }).filter((e) => !e.path || !isExcluded(e.path, c.exclude));
    },
  },
  {
    spec: { name: "find_broken_links", level: "read", description: "Enlaces [[...]] que no apuntan a ninguna nota: {from, target}.", inputSchema: obj({}) },
    async run(c) {
      return c.j.index.brokenLinks().filter((b) => !isExcluded(b.from, c.exclude)).slice(0, 200);
    },
  },
  {
    spec: { name: "find_duplicates", level: "read", description: "Grupos de notas con el mismo título (sin distinguir mayúsculas ni tildes): {title, paths}.", inputSchema: obj({}) },
    async run(c) {
      const groups = new Map<string, { title: string; paths: string[] }>();
      for (const n of c.j.index.listNotes({ limit: 5000 })) {
        if (isExcluded(n.path, c.exclude)) continue;
        const key = normKey(n.title);
        if (!key) continue;
        const g = groups.get(key) ?? { title: n.title, paths: [] };
        g.paths.push(n.path);
        groups.set(key, g);
      }
      return [...groups.values()].filter((g) => g.paths.length > 1).slice(0, 100);
    },
  },
  {
    spec: { name: "stale_projects", level: "read", description: "Proyectos activos sin tocar desde hace `days` días o más (por defecto 14): {path, title, idleDays}.", inputSchema: obj({ days: { type: "number" } }) },
    async run(c, a) {
      const n = Number(a.days);
      const days = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 14;
      const out: { path: string; title: string; idleDays: number | null }[] = [];
      for (const p of c.j.index.listNotes({ type: "project", limit: 500 })) {
        if (isExcluded(p.path, c.exclude)) continue;
        const status = c.j.index.getNote(p.path)?.fm.status;
        if (status && status !== "active") continue;
        const idle = c.j.resume(p.path)?.idleDays ?? null;
        if (idle === null || idle >= days) out.push({ path: p.path, title: p.title, idleDays: idle });
      }
      return out.sort((x, y) => (y.idleDays ?? 1e9) - (x.idleDays ?? 1e9));
    },
  },
];

/* ───────── escritura ─────────
   Cada herramienta «auto» describe un plan: qué notas toca, cómo se vería como propuesta y cómo se aplica.
   El servidor decide si se aplica (con Deshacer) o si se convierte en propuesta (límite por consulta, rutas protegidas). */

interface WritePlan {
  summary: string;
  /** Notas existentes que se modifican. */
  touches: string[];
  /** Rutas nuevas que se crearán. */
  creates?: string[];
  /** El mismo cambio expresado como operaciones de propuesta. */
  ops(): Promise<Op[]>;
  apply(): Promise<{ out: unknown; created?: string[] }>;
}

const hashOf = async (c: ToolCtx, rel: string): Promise<string> => (await c.j.vault.read(rel)).hash;

function existingNote(c: ToolCtx, raw: unknown): string {
  const p = checkAssistantPath(raw, c.exclude);
  if (!c.j.vault.exists(p)) throw new AssistantError("invalid", `La nota «${p}» no existe`);
  return p;
}

function projectPath(c: ToolCtx, v: string): string {
  if (v.toLowerCase().endsWith(".md")) {
    const p = existingNote(c, v);
    if (c.j.index.getNote(p)?.type !== "project") throw new AssistantError("invalid", `«${p}» no es un proyecto`);
    return p;
  }
  const f = c.j.findProject(v);
  if (!f || isExcluded(f.path, c.exclude)) throw new AssistantError("invalid", `No encontré el proyecto «${v}»`);
  return f.path;
}

function escalationReason(s: AssistantSession, paths: string[]): string | null {
  const prot = paths.find(isProtectedPath);
  if (prot) return `«${prot}» pertenece a la copia importada de Obsidian: ahí los cambios siempre necesitan la aprobación del usuario.`;
  const fresh = paths.filter((p) => !s.touched.has(p)).length;
  if (s.touched.size + fresh > MAX_NOTES_PER_QUERY) {
    return `Esta consulta ya ha modificado ${s.touched.size} notas (límite ${MAX_NOTES_PER_QUERY}): el resto de cambios requieren la aprobación del usuario.`;
  }
  return null;
}

function writeDef(spec: Omit<ToolSpec, "level">, plan: (c: ToolCtx, a: Record<string, unknown>) => Promise<WritePlan>): Def {
  return {
    spec: { ...spec, level: "auto" },
    async run(c, a) {
      const p = await plan(c, a);
      const all = [...p.touches, ...(p.creates ?? [])];
      c.path = all[0];
      const reason = escalationReason(c.s, all) ?? externalContentReason(a);
      if (reason) {
        const prop = await c.j.createProposal({ source: "assistant", title: p.summary, rationale: reason, ops: await p.ops() });
        return { escalated: true, proposalId: prop.id, reason, message: "No se ha cambiado nada: queda una propuesta pendiente para que el usuario la apruebe." };
      }
      for (const x of all) c.s.touched.add(x); // se reserva antes de actuar: el límite cuenta también lo que falle a medias
      const snap = await c.undo.capture(p.touches);
      let res: Awaited<ReturnType<WritePlan["apply"]>> | undefined;
      let failure: unknown;
      try {
        res = await p.apply();
      } catch (e) {
        failure = e;
      }
      const created = res?.created ?? [];
      const rec = await c.undo.commit(snap, { sessionId: c.s.id, tool: spec.name, summary: failure ? `${p.summary} (incompleta)` : p.summary }, [...(p.creates ?? []), ...created]);
      c.undoId = rec.id;
      for (const x of created) c.s.touched.add(x);
      if (failure) throw failure;
      return { ...(res!.out as object), undoId: rec.id };
    },
  };
}

/** Texto que el asistente escribe y que un visor de Markdown cargaría solo (imágenes, enlaces, HTML): puede filtrar notas privadas, así que no se aplica sin aprobación. */
const EXTERNAL_RE = /https?:\/\/|!\[|<\s*(?:img|script|iframe|link|svg|object|embed)\b|\bdata:/i;
function externalContentReason(args: Record<string, unknown>): string | null {
  return EXTERNAL_RE.test(JSON.stringify(args)) ? "El texto incluye enlaces web, imágenes o HTML: podrían usarse para sacar contenido de tus notas, así que necesita tu aprobación." : null;
}

const TASK_STATUSES = ["todo", "doing", "done", "dropped"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const WRITE_DEFS: Def[] = [
  writeDef(
    { name: "create_task", description: "Crea una tarea (opcionalmente en un proyecto, con fecha AAAA-MM-DD y prioridad 1-3).", inputSchema: obj({ title: S, project: S, due: S, priority: { type: "number" } }, ["title"]) },
    async (c, a) => {
      const title = argStr(a, "title");
      const fm: Record<string, unknown> = { status: "todo" };
      const proj = argOpt(a, "project");
      if (proj) fm.project = `[[${c.j.index.getNote(projectPath(c, proj))!.title}]]`;
      const due = argOpt(a, "due");
      if (due) { if (!DATE_RE.test(due)) throw new AssistantError("invalid", "«due» debe ser AAAA-MM-DD"); fm.due = due; }
      if (a.priority !== undefined) {
        if (![1, 2, 3].includes(Number(a.priority))) throw new AssistantError("invalid", "«priority» debe ser 1, 2 o 3");
        fm.priority = Number(a.priority);
      }
      const opts = { title, type: "task" as NoteType, fm };
      const { rel } = c.j.buildNote(opts);
      return {
        summary: `Crear tarea «${title}»`, touches: [], creates: [rel],
        ops: async () => { const b = c.j.buildNote(opts); return [{ op: "create", path: b.rel, text: b.text }]; },
        apply: async () => { const n = await c.j.createNote(opts); return { out: { path: n.path }, created: [n.path] }; },
      };
    },
  ),
  writeDef(
    { name: "create_note", description: "Crea una nota nueva (type: note o resource) en su carpeta por defecto.", inputSchema: obj({ title: S, body: S, type: S }, ["title"]) },
    async (c, a) => {
      const type = (argOpt(a, "type") ?? "note") as NoteType;
      if (type !== "note" && type !== "resource") throw new AssistantError("invalid", "«type» debe ser note o resource");
      const body = argOpt(a, "body");
      const opts = { title: argStr(a, "title"), type, body: body ? body.trimEnd() + "\n" : "" };
      const { rel } = c.j.buildNote(opts);
      return {
        summary: `Crear nota «${opts.title}»`, touches: [], creates: [rel],
        ops: async () => { const b = c.j.buildNote(opts); return [{ op: "create", path: b.rel, text: b.text }]; },
        apply: async () => { const n = await c.j.createNote(opts); return { out: { path: n.path }, created: [n.path] }; },
      };
    },
  ),
  writeDef(
    { name: "create_row", description: "Añade una fila (una nota) a una base de datos, con el título y las propiedades indicadas (valores simples). Se crea en la carpeta/tipo de origen de la base.", inputSchema: obj({ database: S, title: S, props: { type: "object" } }, ["database", "title"]) },
    async (c, a) => {
      const db = checkAssistantPath(a.database, c.exclude);
      const title = argStr(a, "title");
      const props = a.props === undefined ? {} : filterProps(a.props);
      const opts = { title, props };
      const { rel } = c.j.buildRow(db, opts);
      checkAssistantPath(rel, c.exclude); // la base puede apuntar a una carpeta excluida: ahí tampoco se escribe
      return {
        summary: `Añadir la fila «${title}» a «${db}»`, touches: [], creates: [rel],
        ops: async () => { const b = c.j.buildRow(db, opts); return [{ op: "create", path: b.rel, text: b.text }]; },
        apply: async () => { const n = await c.j.createRow(db, opts); return { out: { path: n.path }, created: [n.path] }; },
      };
    },
  ),
  writeDef(
    { name: "set_task_status", description: "Cambia el estado de una tarea: todo, doing, done o dropped.", inputSchema: obj({ path: S, status: S }, ["path", "status"]) },
    async (c, a) => {
      const path = existingNote(c, a.path);
      const status = argStr(a, "status");
      if (!TASK_STATUSES.includes(status)) throw new AssistantError("invalid", `«status» debe ser uno de: ${TASK_STATUSES.join(", ")}`);
      if (c.j.index.getNote(path)?.type !== "task") throw new AssistantError("invalid", `«${path}» no es una tarea`);
      return {
        summary: `Marcar «${path}» como ${status}`, touches: [path],
        ops: async () => [{ op: "setProp", path, before: await hashOf(c, path), props: c.j.taskStatusProps(status as TaskStatus) }],
        apply: async () => { await c.j.setTaskStatus(path, status as TaskStatus); return { out: { path, status } }; },
      };
    },
  ),
  writeDef(
    { name: "set_props", description: "Cambia propiedades de una nota (status, due, priority, tags… o cualquier propiedad propia, p. ej. las columnas de una base). Valores simples (texto, número, true/false, lista de simples); null quita la propiedad. No se pueden tocar id, created, type ni la definición de una base.", inputSchema: obj({ path: S, props: { type: "object" } }, ["path", "props"]) },
    async (c, a) => {
      const path = existingNote(c, a.path);
      const props = filterProps(a.props, { database: c.j.index.getNote(path)?.type === "database" });
      if (!Object.keys(props).length) throw new AssistantError("props", "«props» está vacío");
      return {
        summary: `Cambiar propiedades de «${path}» (${Object.keys(props).join(", ")})`, touches: [path],
        ops: async () => [{ op: "setProp", path, before: await hashOf(c, path), props }],
        apply: async () => { await c.j.setProps(path, props); return { out: { path, props } }; },
      };
    },
  ),
  writeDef(
    { name: "convert_capture", description: "Convierte una captura de la Bandeja en tarea (task) o nota (note) y la mueve a su carpeta.", inputSchema: obj({ path: S, kind: S }, ["path", "kind"]) },
    async (c, a) => {
      const path = existingNote(c, a.path);
      const kind = argStr(a, "kind");
      if (kind !== "task" && kind !== "note") throw new AssistantError("invalid", "«kind» debe ser task o note");
      if (c.j.index.getNote(path)?.type !== "capture") throw new AssistantError("invalid", `«${path}» no es una captura de la Bandeja`);
      const to = c.j.vault.uniquePath(`${FOLDERS[kind]}/${path.slice(path.lastIndexOf("/") + 1)}`);
      return {
        summary: `Convertir la captura «${path}» en ${kind === "task" ? "tarea" : "nota"}`, touches: [path], creates: [to],
        ops: async () => {
          const cur = await c.j.vault.read(path);
          const text = setFrontmatter(cur.text, kind === "task" ? { type: "task", status: "todo" } : { type: "note" });
          return [{ op: "update", path, before: cur.hash, text }, { op: "move", from: path, to, before: cur.hash }];
        },
        apply: async () => { const n = await c.j.convertCapture(path, kind); return { out: { path: n.path }, created: [n.path] }; },
      };
    },
  ),
  ...(["checkpoint", "decision"] as const).map((kind) =>
    writeDef(
      {
        name: kind === "checkpoint" ? "add_checkpoint" : "add_decision",
        description: kind === "checkpoint" ? "Añade una entrada fechada a la Bitácora de un proyecto (ruta o título)." : "Añade una decisión fechada a un proyecto (ruta o título).",
        inputSchema: obj({ project: S, text: S }, ["project", "text"]),
      },
      async (c, a) => {
        const path = projectPath(c, argStr(a, "project"));
        const text = argStr(a, "text").trim();
        return {
          summary: `${kind === "checkpoint" ? "Anotar en la bitácora" : "Anotar decisión"} de «${path}»`, touches: [path],
          ops: async () => { const r = await c.j.withEntry(path, kind, text); return [{ op: "update", path, before: r.before, text: r.next }]; },
          apply: async () => { await (kind === "checkpoint" ? c.j.addCheckpoint(path, text) : c.j.addDecision(path, text)); return { out: { path } }; },
        };
      },
    )),
  writeDef(
    { name: "append_to_note", description: "Añade texto al final de una nota (nunca reescribe lo existente).", inputSchema: obj({ path: S, text: S }, ["path", "text"]) },
    async (c, a) => {
      const path = existingNote(c, a.path);
      const text = argStr(a, "text").trim();
      if (text.length > 20_000) throw new AssistantError("invalid", "Texto demasiado largo (máximo 20 000 caracteres)");
      const appended = (cur: string) => cur.replace(/\s*$/, "\n\n") + text + "\n";
      return {
        summary: `Añadir texto al final de «${path}»`, touches: [path],
        ops: async () => { const cur = await c.j.vault.read(path); return [{ op: "update", path, before: cur.hash, text: appended(cur.text) }]; },
        apply: async () => { const cur = await c.j.vault.read(path); await c.j.saveNote(path, appended(cur.text), cur.hash); return { out: { path } }; },
      };
    },
  ),
];

const OP_KINDS = ["create", "update", "setProp", "move", "trash"];

/** Valida las operaciones que propone el modelo y rellena `before` con el hash real (el modelo no lo controla). */
async function buildProposalOps(c: ToolCtx, raw: unknown): Promise<Op[]> {
  if (!Array.isArray(raw) || !raw.length) throw new AssistantError("invalid", "«ops» debe ser una lista con al menos una operación");
  if (raw.length > 50) throw new AssistantError("invalid", "Demasiadas operaciones en una propuesta (máximo 50)");
  const ops: Op[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const kind = r?.op;
    if (typeof kind !== "string" || !OP_KINDS.includes(kind)) throw new AssistantError("invalid", `Operación desconocida: ${String(kind)} (permitidas: ${OP_KINDS.join(", ")})`);
    if (kind === "create") {
      const path = checkAssistantPath(r.path, c.exclude);
      if (c.j.vault.exists(path)) throw new AssistantError("invalid", `«${path}» ya existe`);
      if (typeof r.text !== "string") throw new AssistantError("invalid", "«create» necesita «text»");
      ops.push({ op: "create", path, text: r.text });
    } else if (kind === "move") {
      const from = existingNote(c, r.from);
      const to = checkAssistantPath(r.to, c.exclude);
      if (c.j.vault.exists(to)) throw new AssistantError("invalid", `«${to}» ya existe`);
      ops.push({ op: "move", from, to, before: await hashOf(c, from) });
    } else {
      const path = existingNote(c, r.path);
      const before = await hashOf(c, path);
      if (kind === "trash") ops.push({ op: "trash", path, before });
      else if (kind === "update") {
        if (typeof r.text !== "string") throw new AssistantError("invalid", "«update» necesita «text»");
        ops.push({ op: "update", path, before, text: r.text });
      } else {
        if (!r.props || typeof r.props !== "object" || Array.isArray(r.props)) throw new AssistantError("invalid", "«setProp» necesita «props» (objeto)");
        ops.push({ op: "setProp", path, before, props: r.props as Record<string, unknown> });
      }
    }
  }
  return ops;
}

const PROPOSE_DEF: Def = {
  spec: {
    name: "propose", level: "approval",
    description: "Propone cambios que el usuario debe aprobar (borrar, mover, reescribir, crear en lote). Ops: create{path,text}, update{path,text}, setProp{path,props}, move{from,to}, trash{path}. No cambia nada hasta que el usuario acepta.",
    inputSchema: obj({ title: S, rationale: S, ops: { type: "array", items: { type: "object" } } }, ["title", "rationale", "ops"]),
  },
  async run(c, a) {
    const title = argStr(a, "title");
    const rationale = argStr(a, "rationale");
    const ops = await buildProposalOps(c, a.ops);
    const first = ops[0];
    c.path = first.op === "move" ? first.from : first.path;
    const p = await c.j.createProposal({ source: "assistant", title, rationale, ops });
    return { proposalId: p.id, status: "pending", message: "Propuesta creada: el usuario debe aprobarla en Propuestas." };
  },
};

export class AssistantTools {
  private j: Jarvis;
  private undo: UndoStore;
  private exclude: string[];
  protected defs = new Map<string, Def>();
  /** Las llamadas de una misma sesión se ejecutan de una en una: el límite y el Deshacer no admiten carreras. */
  private queues = new WeakMap<AssistantSession, Promise<unknown>>();

  constructor(j: Jarvis, undo: UndoStore, cfg: { exclude?: string[] } = {}) {
    this.j = j;
    this.undo = undo;
    this.exclude = cfg.exclude ?? [];
    for (const d of [...READ_DEFS, ...WRITE_DEFS, PROPOSE_DEF]) this.defs.set(d.spec.name, d);
  }

  specs(): ToolSpec[] {
    return [...this.defs.values()].map((d) => d.spec);
  }

  call(s: AssistantSession, name: string, args: unknown): Promise<ToolResult> {
    const run = (this.queues.get(s) ?? Promise.resolve()).then(() => this.callNow(s, name, args));
    this.queues.set(s, run.catch(() => undefined));
    return run;
  }

  private async callNow(s: AssistantSession, name: string, args: unknown): Promise<ToolResult> {
    const def = this.defs.get(name);
    if (!def) return { isError: true, text: `Herramienta desconocida: ${name}` };
    const a = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
    const ctx: ToolCtx = { j: this.j, undo: this.undo, s, exclude: this.exclude };
    try {
      const out = await def.run(ctx, a);
      await this.report(ctx, def.spec, a);
      return { text: typeof out === "string" ? out : JSON.stringify(out), undoId: ctx.undoId };
    } catch (e) {
      if (e instanceof AssistantError || e instanceof VaultError) return { isError: true, text: e.message };
      throw e;
    }
  }

  private async report(ctx: ToolCtx, spec: ToolSpec, args: Record<string, unknown>): Promise<void> {
    const path = ctx.path ?? (typeof args.path === "string" ? args.path : undefined);
    this.j.bus.emit("change", { kind: "assistant.tool", sessionId: ctx.s.id, tool: spec.name, level: spec.level, path });
    await this.j.log.record("ai.action", path ?? null, { sessionId: ctx.s.id, tool: spec.name, level: spec.level, undoId: ctx.undoId });
  }
}
