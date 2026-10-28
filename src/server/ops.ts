import type { Vault } from "../core/vault.ts";

const FILE = "ops.json";
const DAY = 86_400_000;

type Entry = { at: number; result: unknown };

export function validOp(v: string): string {
  if (!/^[0-9a-f-]{8,64}$/i.test(v)) throw Object.assign(new Error("x-kioku-op no válido"), { status: 400 });
  return v;
}

/**
 * Registro de operaciones ya aplicadas, para que reenviar una captura con el mismo opId
 * (respuesta perdida, reintento) no cree otra nota. Vive en .kioku/ops.json.
 */
export class OpsLedger {
  private inflight = new Map<string, Promise<unknown>>();
  private writes: Promise<void> = Promise.resolve();
  private vault: Vault;
  private now: () => number;
  private max: number;
  private ttlMs: number;

  constructor(vault: Vault, opts: { now?: () => number; max?: number; ttlMs?: number } = {}) {
    this.vault = vault;
    this.now = opts.now ?? Date.now;
    this.max = opts.max ?? 5000;
    this.ttlMs = opts.ttlMs ?? 30 * DAY;
  }

  run<T>(opId: string, fn: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(opId);
    if (running) return running as Promise<T>;
    const p = (async () => {
      const hit = (await this.load())[opId];
      if (hit && this.now() - hit.at <= this.ttlMs) return hit.result as T;
      const result = await fn();
      await this.record(opId, result);
      return result;
    })().finally(() => this.inflight.delete(opId));
    this.inflight.set(opId, p);
    return p;
  }

  private async load(): Promise<Record<string, Entry>> {
    const raw = await this.vault.readInternal(FILE);
    if (!raw) return {};
    try {
      const o = JSON.parse(raw);
      return o && typeof o === "object" && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }

  /** Lee-modifica-escribe en serie, para que operaciones distintas no se pisen. */
  private record(opId: string, result: unknown): Promise<void> {
    const step = this.writes.then(async () => {
      const state = await this.load();
      const t = this.now();
      state[opId] = { at: t, result };
      const live = Object.entries(state)
        .filter(([, e]) => t - e.at <= this.ttlMs)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, this.max);
      await this.vault.writeInternal(FILE, JSON.stringify(Object.fromEntries(live)));
    });
    this.writes = step.catch(() => {});
    return step;
  }
}
