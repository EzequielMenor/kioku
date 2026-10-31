export interface StoredNote { path: string; mtime: number; hash: string; text: string }
export interface QueuedCapture { opId: string; text: string; createdAt: number; state: "pending" | "failed"; error?: string }
export type TaskStatus = "todo" | "doing" | "done" | "dropped";
export type MutationBody = { opId: string; path: string; baseHash: string; text: string } &
  ({ kind: "edit"; status?: never } | { kind: "task"; status: TaskStatus });
export type MutationResult = { outcome: "applied" | "conflict"; path: string; hash: string; text?: string };
export interface Draft { path: string; text: string; baseHash: string; updatedAt: number }
export interface StoredMutation {
  body: MutationBody; createdAt: number; predecessor?: string; attempted: boolean;
  state: "pending" | "applied" | "conflict" | "failed"; result?: MutationResult; error?: string;
}

/** Almacén local del móvil: réplica de notas, metadatos y cola de capturas. */
export interface Store {
  allNotes(): Promise<StoredNote[]>;
  getNote(path: string): Promise<StoredNote | undefined>;
  putNotes(notes: StoredNote[]): Promise<void>;
  deleteNotes(paths: string[]): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  /** Por `createdAt` ascendente. */
  queue(): Promise<QueuedCapture[]>;
  putCapture(c: QueuedCapture): Promise<void>;
  deleteCapture(opId: string): Promise<void>;
  drafts(): Promise<Draft[]>;
  getDraft(path: string): Promise<Draft | undefined>;
  putDraft(draft: Draft): Promise<void>;
  deleteDraft(path: string): Promise<void>;
  mutations(): Promise<StoredMutation[]>;
  putMutation(operation: StoredMutation): Promise<void>;
  putMutationWithDraft(operation: StoredMutation, draft: Draft): Promise<void>;
  acknowledgeMutation(operation: StoredMutation): Promise<void>;
  prepareMutation(operation: StoredMutation, previousText: string): Promise<void>;
  deleteMutation(opId: string): Promise<void>;
  clearLocalPath(path: string): Promise<void>;
  clear(): Promise<void>;
  /** Vacía notas y metadatos en una sola operación, sin tocar la cola de capturas. */
  clearReplica(): Promise<void>;
}

/** Implementación en memoria: la usan los tests y sirve de referencia del contrato. */
export class MemoryStore implements Store {
  private notes = new Map<string, StoredNote>();
  private meta = new Map<string, unknown>();
  private captures = new Map<string, QueuedCapture>();
  private localDrafts = new Map<string, Draft>();
  private operations = new Map<string, StoredMutation>();

  async allNotes(): Promise<StoredNote[]> { return [...this.notes.values()]; }
  async getNote(path: string): Promise<StoredNote | undefined> { return this.notes.get(path); }
  async putNotes(notes: StoredNote[]): Promise<void> { for (const n of notes) this.notes.set(n.path, n); }
  async deleteNotes(paths: string[]): Promise<void> { for (const p of paths) this.notes.delete(p); }
  async getMeta<T>(key: string): Promise<T | undefined> { return this.meta.get(key) as T | undefined; }
  async setMeta(key: string, value: unknown): Promise<void> { this.meta.set(key, value); }
  async queue(): Promise<QueuedCapture[]> { return [...this.captures.values()].sort((a, b) => a.createdAt - b.createdAt); }
  async putCapture(c: QueuedCapture): Promise<void> { this.captures.set(c.opId, c); }
  async deleteCapture(opId: string): Promise<void> { this.captures.delete(opId); }
  async drafts(): Promise<Draft[]> { return structuredClone([...this.localDrafts.values()]); }
  async getDraft(path: string): Promise<Draft | undefined> { return structuredClone(this.localDrafts.get(path)); }
  async putDraft(draft: Draft): Promise<void> { this.localDrafts.set(draft.path, structuredClone(draft)); }
  async deleteDraft(path: string): Promise<void> { this.localDrafts.delete(path); }
  async mutations(): Promise<StoredMutation[]> { return structuredClone([...this.operations.values()].sort((a, b) => a.createdAt - b.createdAt)); }
  async putMutation(operation: StoredMutation): Promise<void> { this.operations.set(operation.body.opId, structuredClone(operation)); }
  async putMutationWithDraft(operation: StoredMutation, draft: Draft): Promise<void> { this.operations.set(operation.body.opId, structuredClone(operation)); this.localDrafts.set(draft.path, structuredClone(draft)); }
  async prepareMutation(operation: StoredMutation, previousText: string): Promise<void> {
    this.operations.set(operation.body.opId, structuredClone(operation));
    const draft = this.localDrafts.get(operation.body.path);
    if (draft?.updatedAt === operation.createdAt && draft.text === previousText) this.localDrafts.set(draft.path, { ...draft, text: operation.body.text, baseHash: operation.body.baseHash });
  }
  async acknowledgeMutation(operation: StoredMutation): Promise<void> {
    this.operations.set(operation.body.opId, structuredClone(operation));
    const draft = this.localDrafts.get(operation.body.path);
    const newer = [...this.operations.values()].some(o => o.body.path === operation.body.path && o.body.opId !== operation.body.opId && o.state !== "applied");
    if (operation.state === "applied" && !newer && draft?.updatedAt === operation.createdAt && draft.text === operation.body.text) this.localDrafts.delete(operation.body.path);
  }
  async deleteMutation(opId: string): Promise<void> { this.operations.delete(opId); }
  async clearLocalPath(path: string): Promise<void> { this.localDrafts.delete(path); for (const [id, op] of this.operations) if (op.body.path === path) this.operations.delete(id); }
  async clearReplica(): Promise<void> { this.notes.clear(); this.meta.clear(); }
  async clear(): Promise<void> { this.notes.clear(); this.meta.clear(); this.captures.clear(); this.localDrafts.clear(); this.operations.clear(); }
}
