// Estado de la conversación con el asistente, fuera de la vista: la respuesta puede llegar cuando el usuario
// ya cambió de pantalla, y la vista que vuelva debe encontrar el estado real (respondiendo o ya respondido).
import type { Proposal, UndoRecord } from "./types.ts";

export type Msg = { role: "user" | "assistant"; text: string; error?: boolean; reads?: string[]; actions?: UndoRecord[]; proposals?: Proposal[] };
export interface ChatState { msgs: Msg[]; busy: boolean; live: string | null }

export interface ChatDeps {
  ask(message: string, conversation: string): Promise<{ answer: string; reads: string[]; actions: UndoRecord[] }>;
  pendingProposals(): Promise<Proposal[]>;
  actionsSince(ts: string): Promise<UndoRecord[]>;
}

const newId = () => `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function createChat(deps: ChatDeps) {
  let state: ChatState = { msgs: [], busy: false, live: null };
  let conversation = newId();
  const listeners = new Set<(s: ChatState) => void>();
  const set = (patch: Partial<ChatState>) => { state = { ...state, ...patch }; for (const l of listeners) l(state); };
  const push = (m: Msg) => set({ msgs: [...state.msgs, m] });

  return {
    getState: () => state,
    conversation: () => conversation,
    subscribe(l: (s: ChatState) => void): () => void {
      listeners.add(l);
      return () => { listeners.delete(l); };
    },
    /** Solo cuenta mientras hay una consulta en curso. */
    setLive(label: string): void { if (state.busy) set({ live: label }); },
    reset(): void { conversation = newId(); set({ msgs: [] }); },
    async send(message: string): Promise<void> {
      const m = message.trim();
      if (!m || state.busy) return;
      set({ msgs: [...state.msgs, { role: "user", text: m }], busy: true, live: "Pensando…" });
      const startedAt = new Date().toISOString();
      try {
        const before = new Set((await deps.pendingProposals().catch(() => [] as Proposal[])).map((p) => p.id));
        const r = await deps.ask(m, conversation);
        const after = await deps.pendingProposals().catch(() => [] as Proposal[]);
        push({ role: "assistant", text: r.answer, reads: r.reads, actions: r.actions, proposals: after.filter((p) => !before.has(p.id) && p.source === "assistant") });
      } catch (e) {
        // Si falló a medias, lo que ya cambió sigue siendo deshacible: se muestra igualmente.
        const actions = await deps.actionsSince(startedAt).catch(() => [] as UndoRecord[]);
        push({ role: "assistant", text: (e as Error).message, error: true, actions });
      } finally {
        set({ busy: false, live: null });
      }
    },
  };
}
