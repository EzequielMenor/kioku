import { SendError } from "./queue.ts";
import { reconcileTaskAcknowledgement } from "./mobile-editing.ts";
import { parseNote } from "../../../src/core/markdown.ts";
import type { Draft, MutationBody, MutationResult, Store, StoredMutation } from "./store.ts";
export type { Draft, MutationBody, MutationResult, StoredMutation, TaskStatus } from "./store.ts";
export type MutationInput = MutationBody extends infer B ? B extends MutationBody ? Omit<B, "opId"> : never : never;
export type MutationTransport = (body: MutationBody) => Promise<MutationResult>;
export interface FlushResult { sent: number; conflicts: number; failed: number; stopped: boolean }

/** Durable snapshots. The transport maps HTTP 409 mobile-conflict to a conflict result. */
export class MutationQueue {
  private flushing: Promise<FlushResult> | null = null;
  private adding: Promise<void> = Promise.resolve();
  private store: Store;
  private newId: () => string;
  constructor(store: Store, newId: () => string = () => crypto.randomUUID()) { this.store = store; this.newId = newId; }

  add(input: MutationInput, opId = this.newId()): Promise<StoredMutation> {
    const work = this.adding.then(async () => {
      const all = await this.store.mutations();
      if (all.some(o => o.body.opId === opId)) throw new Error("duplicate operation id");
      const previous = all.filter(o => o.body.path === input.path).at(-1);
      const createdAt = Math.max(Date.now(), ...all.map(o => o.createdAt + 1));
      const body = { ...input, opId } as MutationBody;
      // A snapshot can have been captured before an acknowledgement but added afterwards.
      // Only follow the current chain, never unrelated historical operations.
      let linked = !!previous && previous.state !== "applied";
      let ancestor = previous;
      const seen = new Set<string>();
      while (!linked && ancestor && !seen.has(ancestor.body.opId)) {
        seen.add(ancestor.body.opId);
        linked = input.baseHash === ancestor.body.baseHash || input.baseHash === ancestor.result?.hash;
        ancestor = ancestor.predecessor ? all.find(o => o.body.opId === ancestor!.predecessor) : undefined;
      }
      const op: StoredMutation = { body, createdAt, predecessor: linked ? previous?.body.opId : undefined, attempted: false, state: "pending" };
      await this.store.putMutationWithDraft(op, { path: input.path, text: input.text, baseHash: input.baseHash, updatedAt: createdAt });
      return op;
    });
    this.adding = work.then(() => {}, () => {});
    return work;
  }

  list(): Promise<StoredMutation[]> { return this.store.mutations(); }
  draft(path: string): Promise<Draft | undefined> { return this.store.getDraft(path); }
  async overlay(path: string): Promise<Draft | undefined> { return this.draft(path); }
  flush(send: MutationTransport): Promise<FlushResult> {
    if (!this.flushing) this.flushing = this.run(send).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async run(send: MutationTransport): Promise<FlushResult> {
    await this.adding;
    const ids = (await this.store.mutations()).map(o => o.body.opId);
    let sent = 0, conflicts = 0, failed = 0;
    for (const id of ids) {
      const all = await this.store.mutations();
      let op = all.find(o => o.body.opId === id);
      if (!op || op.state !== "pending") continue;
      const previousText = op.body.text;
      if (op.predecessor) {
        const prior = all.find(o => o.body.opId === op!.predecessor);
        if (!prior || prior.state !== "applied" || !prior.result) continue;
        if (!op.attempted) {
          const status = prior.body.kind === "task" ? prior.body.status : prior.result.text && parseNote(prior.result.text, prior.body.path).frontmatter.status;
          const text = status === "done" && prior.result.text ? reconcileTaskAcknowledgement(op.body.text, prior.result.text, "done") : op.body.text;
          op = { ...op, body: { ...op.body, text, baseHash: prior.result.hash } };
        }
      }
      if (!op.attempted) {
        op = { ...op, attempted: true };
        await this.store.prepareMutation(op, previousText);
      }
      let result: MutationResult;
      try { result = await send(structuredClone(op.body)); }
      catch (e) {
        if (e instanceof SendError && !e.retryable) {
          await this.store.putMutation({ ...op, state: "failed", error: e.message });
          failed++; continue;
        }
        return { sent, conflicts, failed, stopped: true };
      }
      await this.store.acknowledgeMutation({ ...op, state: result.outcome, result });
      if (result.outcome === "applied") sent++; else conflicts++;
    }
    return { sent, conflicts, failed, stopped: false };
  }

  async resetPath(path: string): Promise<void> {
    if (this.flushing) throw new Error("No se puede restablecer durante el envío");
    const work = this.adding.then(() => this.store.clearLocalPath(path));
    this.adding = work.then(() => {}, () => {});
    await work;
  }

  async retry(opId: string): Promise<void> {
    const op = (await this.list()).find(o => o.body.opId === opId);
    if (!op || op.state !== "failed") return;
    const { error: _error, ...rest } = op;
    await this.store.putMutation({ ...rest, state: "pending" });
  }
  async discard(opId: string): Promise<void> {
    if (this.flushing) throw new Error("cannot discard during flush");
    await this.adding;
    const all = await this.list();
    if (all.some(o => o.predecessor === opId)) throw new Error("operation has dependents");
    await this.store.deleteMutation(opId);
  }
}
