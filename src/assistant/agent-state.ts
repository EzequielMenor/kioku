// Estado del agente, único para todas las interfaces (panel de Kioku y compañero de escritorio).
// Refleja actividad REAL: lo mueve el servidor al recibir una consulta, al ejecutar una herramienta, al llegar texto
// del modelo, al terminar y al quedar propuestas por confirmar. Las interfaces solo lo pintan.
export type AgentPhase = "idle" | "listening" | "thinking" | "responding" | "awaiting_confirmation" | "success" | "error";

export interface AgentSnapshot {
  state: AgentPhase;
  /** Qué está haciendo, en una frase («Leyendo Notas/X.md…»). */
  label: string | null;
  /** Conversación a la que pertenece la actividad. */
  conversation: string | null;
  since: string;
  /** Hay una consulta en curso. */
  busy: boolean;
  /** Propuestas del asistente que esperan la decisión del usuario. */
  awaiting: string[];
}

/** Texto del indicador en vivo a partir de la herramienta en curso. */
export function toolLabel(tool: string, path?: string | null): string {
  const p = path ? ` ${path}` : "";
  if (tool === "read_note" || tool === "get_project") return `Leyendo${p}…`;
  if (tool === "search") return "Buscando en tus notas…";
  if (tool === "inbox") return "Revisando tu Bandeja…";
  if (tool === "today") return "Mirando tu día…";
  if (tool === "list_tasks") return "Revisando tus tareas…";
  if (tool === "list_notes") return "Listando tus notas…";
  if (tool === "list_events") return "Mirando tu calendario…";
  if (tool === "list_databases" || tool === "query_database") return "Consultando tus bases de datos…";
  if (tool === "neighbors") return `Mirando los enlaces de${p || " una nota"}…`;
  if (tool === "recent_activity") return "Repasando tu actividad reciente…";
  if (tool === "propose") return "Preparando una propuesta…";
  if (tool === "create_row") return `Añadiendo una fila${path ? ` a ${path}` : ""}…`;
  if (tool.startsWith("create_") || tool.startsWith("add_") || tool === "append_to_note") return `Escribiendo${p}…`;
  if (tool === "set_props" || tool === "set_task_status" || tool === "convert_capture") return `Actualizando${p}…`;
  return `Consultando (${tool})…`;
}

export interface AgentStateOptions {
  successMs?: number;
  errorMs?: number;
  listeningMs?: number;
}

export class AgentState {
  private snap: AgentSnapshot = { state: "idle", label: null, conversation: null, since: new Date().toISOString(), busy: false, awaiting: [] };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private emit: (s: AgentSnapshot) => void;
  private o: Required<AgentStateOptions>;
  /** Consultas en curso (el motor las atiende de una en una, pero pueden encolarse). */
  private running = 0;

  constructor(emit: (s: AgentSnapshot) => void, o: AgentStateOptions = {}) {
    this.emit = emit;
    this.o = { successMs: o.successMs ?? 3500, errorMs: o.errorMs ?? 9000, listeningMs: o.listeningMs ?? 6000 };
  }

  snapshot(): AgentSnapshot {
    return { ...this.snap, awaiting: [...this.snap.awaiting] };
  }

  private set(patch: Partial<AgentSnapshot>, settleIn?: number): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const next = { ...this.snap, ...patch };
    const same = next.state === this.snap.state && next.label === this.snap.label && next.conversation === this.snap.conversation && next.busy === this.snap.busy && next.awaiting.join() === this.snap.awaiting.join();
    if (!same) {
      this.snap = { ...next, since: next.state === this.snap.state ? this.snap.since : new Date().toISOString() };
      this.emit(this.snapshot());
    }
    if (settleIn !== undefined) {
      this.timer = setTimeout(() => { this.timer = null; this.settle(); }, settleIn);
      this.timer.unref?.();
    }
  }

  /** Reposo: si quedan propuestas por decidir, el agente espera confirmación; si no, descansa. */
  private settle(): void {
    if (this.running > 0) return;
    this.set(this.snap.awaiting.length
      ? { state: "awaiting_confirmation", label: this.snap.awaiting.length === 1 ? "Una propuesta espera tu decisión" : `${this.snap.awaiting.length} propuestas esperan tu decisión`, busy: false }
      : { state: "idle", label: null, busy: false });
  }

  /** El usuario está escribiendo en alguna interfaz. Solo cuenta si el agente no está trabajando. */
  listening(active: boolean): void {
    if (this.running > 0) return;
    if (active) this.set({ state: "listening", label: null }, this.o.listeningMs);
    else if (this.snap.state === "listening") this.settle();
  }

  start(conversation: string): void {
    this.running++;
    this.set({ state: "thinking", label: "Pensando…", conversation, busy: true });
  }

  thinking(label = "Pensando…"): void {
    if (this.running > 0) this.set({ state: "thinking", label });
  }

  responding(): void {
    if (this.running > 0 && this.snap.state !== "responding") this.set({ state: "responding", label: "Respondiendo…" });
  }

  /** Fin de una consulta. `proposals`: las que nacieron en ella y siguen pendientes. */
  finish(r: { ok: boolean; proposals?: string[]; error?: string }): void {
    this.running = Math.max(0, this.running - 1);
    const awaiting = [...new Set([...this.snap.awaiting, ...(r.proposals ?? [])])];
    if (this.running > 0) { this.set({ awaiting, state: "thinking", label: "Pensando…" }); return; }
    if (!r.ok) this.set({ awaiting, state: "error", label: r.error ?? "Algo falló", busy: false }, this.o.errorMs);
    else if (r.proposals?.length) this.set({ awaiting, busy: false, state: "awaiting_confirmation", label: awaiting.length === 1 ? "Una propuesta espera tu decisión" : `${awaiting.length} propuestas esperan tu decisión` });
    else this.set({ awaiting, state: "success", label: "Hecho", busy: false }, this.o.successMs);
  }

  /** Tras aplicar o descartar propuestas: se quitan de la espera las que ya no están pendientes. */
  pending(ids: Set<string>): void {
    const awaiting = this.snap.awaiting.filter((id) => ids.has(id));
    if (awaiting.length === this.snap.awaiting.length) return;
    this.snap = { ...this.snap, awaiting };
    if (this.running > 0) { this.emit(this.snapshot()); return; }
    if (this.snap.state === "awaiting_confirmation") this.settle();
    else this.emit(this.snapshot());
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
