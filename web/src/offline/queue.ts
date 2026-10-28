import type { QueuedCapture, Store } from "./store.ts";

/** Error de envío: `retryable` distingue «sin red / servidor ocupado» (se reintenta) de un rechazo definitivo. */
export class SendError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export const backoffMs = (attempt: number): number => Math.min(30_000, 1000 * 2 ** attempt);

/** Capturas pendientes de envío, guardadas en el `Store` y reenviadas en orden con su `opId`. */
export class CaptureQueue {
  private store: Store;
  private newId: () => string;
  private last = 0;
  private flushing: Promise<{ sent: number; failed: number; stopped: boolean }> | null = null;

  constructor(store: Store, newId: () => string = () => crypto.randomUUID()) {
    this.store = store;
    this.newId = newId;
  }

  async add(text: string, opId?: string): Promise<QueuedCapture> {
    this.last = Math.max(Date.now(), this.last + 1);
    const c: QueuedCapture = { opId: opId ?? this.newId(), text, createdAt: this.last, state: "pending" };
    await this.store.putCapture(c);
    return c;
  }

  list(): Promise<QueuedCapture[]> { return this.store.queue(); }

  /**
   * Envía las pendientes por orden. Un error reintentable (o desconocido) detiene la cola sin perder nada;
   * uno definitivo marca esa captura `failed` y continúa. Dos llamadas simultáneas comparten el mismo envío.
   */
  flush(send: (c: QueuedCapture) => Promise<void>): Promise<{ sent: number; failed: number; stopped: boolean }> {
    if (!this.flushing) this.flushing = this.run(send).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async run(send: (c: QueuedCapture) => Promise<void>) {
    let sent = 0, failed = 0;
    for (const c of await this.store.queue()) {
      if (c.state !== "pending") continue;
      try {
        await send(c);
        await this.store.deleteCapture(c.opId);
        sent++;
      } catch (e) {
        if (e instanceof SendError && !e.retryable) {
          await this.store.putCapture({ ...c, state: "failed", error: e.message });
          failed++;
          continue;
        }
        return { sent, failed, stopped: true };
      }
    }
    return { sent, failed, stopped: false };
  }

  async retry(opId: string): Promise<void> {
    const c = (await this.store.queue()).find((x) => x.opId === opId);
    if (!c) return;
    const { error: _error, ...rest } = c;
    await this.store.putCapture({ ...rest, state: "pending" });
  }

  discard(opId: string): Promise<void> { return this.store.deleteCapture(opId); }
}
