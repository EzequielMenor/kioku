export interface StoredNote { path: string; mtime: number; hash: string; text: string }
export interface QueuedCapture { opId: string; text: string; createdAt: number; state: "pending" | "failed"; error?: string }

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
  clear(): Promise<void>;
  /** Vacía notas y metadatos en una sola operación, sin tocar la cola de capturas. */
  clearReplica(): Promise<void>;
}

/** Implementación en memoria: la usan los tests y sirve de referencia del contrato. */
export class MemoryStore implements Store {
  private notes = new Map<string, StoredNote>();
  private meta = new Map<string, unknown>();
  private captures = new Map<string, QueuedCapture>();

  async allNotes(): Promise<StoredNote[]> { return [...this.notes.values()]; }
  async getNote(path: string): Promise<StoredNote | undefined> { return this.notes.get(path); }
  async putNotes(notes: StoredNote[]): Promise<void> { for (const n of notes) this.notes.set(n.path, n); }
  async deleteNotes(paths: string[]): Promise<void> { for (const p of paths) this.notes.delete(p); }
  async getMeta<T>(key: string): Promise<T | undefined> { return this.meta.get(key) as T | undefined; }
  async setMeta(key: string, value: unknown): Promise<void> { this.meta.set(key, value); }
  async queue(): Promise<QueuedCapture[]> { return [...this.captures.values()].sort((a, b) => a.createdAt - b.createdAt); }
  async putCapture(c: QueuedCapture): Promise<void> { this.captures.set(c.opId, c); }
  async deleteCapture(opId: string): Promise<void> { this.captures.delete(opId); }
  async clearReplica(): Promise<void> { this.notes.clear(); this.meta.clear(); }
  async clear(): Promise<void> { this.notes.clear(); this.meta.clear(); this.captures.clear(); }
}
