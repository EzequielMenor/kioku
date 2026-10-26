// Herramientas que el asistente puede usar. El servidor (no el modelo) impone los niveles:
//   read = libres · auto = reversibles con Deshacer · approval = solo como propuesta.
import type { Jarvis } from "../core/jarvis.ts";
import type { NoteType, TaskStatus } from "../core/index.ts";
import { VaultError } from "../core/vault.ts";
import { AssistantError, checkAssistantPath } from "./policy.ts";
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

const isExcluded = (p: string, exclude: string[]): boolean => exclude.some((x) => x && p.startsWith(x));

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
      return card;
    },
  },
  { spec: { name: "today", level: "read", description: "Vista «Hoy»: siguiente paso sugerido, proyectos a reanudar, Bandeja, vencidas.", inputSchema: obj({}) }, async run(c) { return c.j.today(); } },
  {
    spec: { name: "inbox", level: "read", description: "Capturas pendientes de la Bandeja (ruta, título, texto).", inputSchema: obj({}) },
    async run(c) { return c.j.inbox().map((n) => ({ path: n.path, title: n.title, text: n.body.trim().slice(0, 600) })); },
  },
  {
    spec: { name: "list_tasks", level: "read", description: "Tareas con estado, proyecto, fecha y prioridad. Filtros: status (todo,doing,done,dropped separados por coma), project (ruta).", inputSchema: obj({ status: S, project: S }) },
    async run(c, a) {
      const st = argOpt(a, "status");
      return c.j.index.tasks({ status: st ? (st.split(",") as TaskStatus[]) : undefined, projectPath: argOpt(a, "project") }).slice(0, 200);
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
];

export class AssistantTools {
  private j: Jarvis;
  private undo: UndoStore;
  private exclude: string[];
  protected defs = new Map<string, Def>();

  constructor(j: Jarvis, undo: UndoStore, cfg: { exclude?: string[] } = {}) {
    this.j = j;
    this.undo = undo;
    this.exclude = cfg.exclude ?? [];
    for (const d of READ_DEFS) this.defs.set(d.spec.name, d);
  }

  specs(): ToolSpec[] {
    return [...this.defs.values()].map((d) => d.spec);
  }

  async call(s: AssistantSession, name: string, args: unknown): Promise<ToolResult> {
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
