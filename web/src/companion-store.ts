// Estado del compañero en el cliente. No guarda nada propio: es un espejo de lo que tiene el daemon
// (conversación, estado del agente, ajustes), que es lo mismo que ve el compañero de escritorio.
// Carga inicial por HTTP y actualizaciones por el flujo de eventos (`assistant.*`).
import type { AgentSnapshot, CompanionMode, CompanionView, EngineInfo, MessageView } from "./types.ts";

export interface CompanionState {
  ready: boolean;
  agent: AgentSnapshot;
  companion: CompanionView;
  engine: EngineInfo | null;
  conversation: string;
  msgs: MessageView[];
  /** Texto de la respuesta que está llegando ahora mismo. */
  streaming: string;
  /** Mensaje enviado desde esta interfaz que el daemon aún no ha confirmado. */
  sending: boolean;
  /** Aviso de un fallo que no pertenece a la conversación (p. ej. el asistente no está disponible). */
  problem: string | null;
}

export interface CompanionEvent { kind: string; conversation?: string; text?: string; reset?: boolean; message?: MessageView; agent?: AgentSnapshot; companion?: CompanionView }

export interface CompanionDeps {
  api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T>;
  /** Suscripción al flujo de eventos del daemon. */
  onEvent(cb: (e: CompanionEvent) => void): () => void;
  now?(): number;
}

const IDLE: AgentSnapshot = { state: "idle", label: null, conversation: null, since: "", busy: false, awaiting: [] };
const DEFAULT_VIEW: CompanionView = { mode: "active", conversation: "", overlay: null, quiet: false, focusSession: false, webForeground: false };

export function createCompanionStore(deps: CompanionDeps) {
  let state: CompanionState = { ready: false, agent: IDLE, companion: DEFAULT_VIEW, engine: null, conversation: "", msgs: [], streaming: "", sending: false, problem: null };
  const listeners = new Set<(s: CompanionState) => void>();
  const set = (patch: Partial<CompanionState>) => { state = { ...state, ...patch }; for (const l of listeners) l(state); };
  let started = false;
  let stop: (() => void) | null = null;
  let lastListening = 0;

  const loadConversation = async () => {
    const c = await deps.api<{ id: string; messages: MessageView[] }>("GET", "/api/assistant/conversation");
    set({ conversation: c.id, msgs: c.messages, streaming: "" });
  };
  const load = async () => {
    try {
      const [s] = await Promise.all([
        deps.api<{ agent: AgentSnapshot; companion: CompanionView; engine: EngineInfo | null }>("GET", "/api/assistant/state"),
        loadConversation(),
      ]);
      set({ ready: true, agent: s.agent, companion: s.companion, engine: s.engine });
    } catch { /* sin daemon o sin permiso: el compañero no aparece */ }
  };

  const onEvent = (e: CompanionEvent) => {
    if (e.kind === "assistant.state" && e.agent) {
      set({ agent: e.agent, ...(e.agent.busy ? {} : { streaming: "" }) });
    } else if (e.kind === "assistant.companion" && e.companion) {
      const changed = e.companion.conversation !== state.conversation;
      set({ companion: e.companion });
      if (changed) void loadConversation().catch(() => undefined);
    } else if (e.kind === "assistant.delta" && e.conversation === state.conversation) {
      set({ streaming: e.reset ? "" : state.streaming + (e.text ?? "") });
    } else if (e.kind === "assistant.message" && e.message && e.conversation === state.conversation) {
      if (state.msgs.some((m) => m.id === e.message!.id)) return;
      set({ msgs: [...state.msgs, e.message], ...(e.message.role === "assistant" ? { streaming: "" } : { sending: false }) });
    } else if (e.kind === "proposals" || e.kind === "note" || e.kind === "delete") {
      // Una propuesta se resolvió o una acción se deshizo: los botones de los mensajes deben reflejarlo.
      if (state.msgs.some((m) => m.proposals.length || m.actions.length)) void loadConversation().catch(() => undefined);
    }
  };

  return {
    getState: () => state,
    subscribe(l: (s: CompanionState) => void): () => void {
      listeners.add(l);
      return () => { listeners.delete(l); };
    },
    /** Conecta con el daemon (una sola vez). */
    start(): void {
      if (started) return;
      started = true;
      stop = deps.onEvent(onEvent);
      void load();
    },
    stop(): void { stop?.(); stop = null; started = false; },
    reload: load,
    async send(message: string, context?: { route?: string; path?: string }): Promise<void> {
      const m = message.trim();
      if (!m || state.sending) return;
      set({ sending: true, problem: null });
      try {
        await deps.api("POST", "/api/assistant/ask", { message: m, context, surface: "web" });
      } catch (e) {
        // Los fallos de una consulta ya abierta llegan como mensaje de la conversación; aquí solo los previos (asistente no disponible).
        const text = (e as Error).message;
        if (!state.msgs.some((x) => x.error && x.text === text)) set({ problem: text });
      } finally {
        set({ sending: false });
      }
    },
    cancel: () => deps.api("POST", "/api/assistant/cancel", {}).catch(() => undefined),
    async newConversation(): Promise<void> {
      await deps.api("POST", "/api/assistant/conversation/new", {});
      await loadConversation();
    },
    async setMode(mode: CompanionMode): Promise<void> {
      set({ companion: await deps.api<CompanionView>("POST", "/api/assistant/companion", { mode }) });
    },
    /** El usuario está escribiendo: el agente «escucha». Se limita para no enviar una petición por tecla. */
    listening(active: boolean): void {
      const now = (deps.now ?? Date.now)();
      if (active && now - lastListening < 2500) return;
      if (!active && !lastListening) return;
      lastListening = active ? now : 0;
      void deps.api("POST", "/api/assistant/listening", { active }).catch(() => undefined);
    },
    presence(id: string, focused: boolean): void {
      void deps.api("POST", "/api/assistant/companion/presence", { id, focused }).catch(() => undefined);
    },
    dismissProblem(): void { set({ problem: null }); },
  };
}

export type CompanionStore = ReturnType<typeof createCompanionStore>;

/** Qué tiene delante el usuario según la ruta del cliente: una nota concreta o una vista. */
export function viewContext(route: string): { route: string; path?: string; label: string } {
  const [head, ...rest] = route.split("/").filter(Boolean);
  const arg = rest.join("/");
  if ((head === "nota" || head === "proyecto" || head === "bases") && arg.toLowerCase().endsWith(".md")) {
    return { route, path: arg, label: arg.slice(arg.lastIndexOf("/") + 1).replace(/\.md$/i, "") };
  }
  const names: Record<string, string> = { hoy: "Hoy", bandeja: "Bandeja", proyectos: "Proyectos", tareas: "Tareas", calendario: "Calendario", notas: "Notas", bases: "Bases", grafo: "Grafo", propuestas: "Propuestas", asistente: "Asistente" };
  return { route, label: names[head ?? "hoy"] ?? "Kioku" };
}

/** Estado que pinta el personaje: el del agente, salvo en concentración, donde descansa mientras no haya nada que atender. */
export function faceState(agent: AgentSnapshot, quiet: boolean): "idle" | "listening" | "thinking" | "responding" | "awaiting_confirmation" | "success" | "error" | "quiet" {
  if (quiet && (agent.state === "idle" || agent.state === "success" || agent.state === "listening")) return "quiet";
  return agent.state;
}
