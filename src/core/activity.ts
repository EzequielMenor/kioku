// Log de actividad append-only en texto plano (.jarvis/log/YYYY-MM.jsonl).
// Es la ÚNICA memoria de "qué hice": legible, auditable y reconstruible en el índice.
import type { Vault } from "./vault.ts";
import type { EventRow, Index } from "./index.ts";

export type EventKind =
  | "note.open" | "note.edit" | "capture" | "task.status" | "focus.start" | "focus.end"
  | "checkpoint" | "decision" | "proposal.created" | "proposal.applied" | "proposal.rejected" | "import" | "capture.convert" | "ai.request";

export class ActivityLog {
  private vault: Vault;
  private index: Index;
  private now: () => Date;

  constructor(vault: Vault, index: Index, now: () => Date) {
    this.vault = vault;
    this.index = index;
    this.now = now;
  }

  async record(kind: EventKind, path: string | null = null, data: Record<string, unknown> = {}): Promise<EventRow> {
    const ts = this.now().toISOString();
    const row: EventRow = { ts, kind, path, data };
    await this.vault.appendInternal(`log/${ts.slice(0, 7)}.jsonl`, JSON.stringify(row) + "\n");
    this.index.addEvent(row);
    return row;
  }

  /** Reconstruye la tabla de eventos desde los JSONL (líneas corruptas se ignoran, no rompen). */
  async reload(): Promise<number> {
    this.index.clearEvents();
    let n = 0;
    const files = (await this.vault.listInternal("log")).filter((f) => f.endsWith(".jsonl")).sort();
    const rows: EventRow[] = [];
    for (const f of files) {
      const text = (await this.vault.readInternal(`log/${f}`)) ?? "";
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as EventRow;
          if (typeof r.ts === "string" && typeof r.kind === "string") rows.push({ ts: r.ts, kind: r.kind, path: r.path ?? null, data: r.data ?? {} });
        } catch { /* línea corrupta */ }
      }
    }
    this.index.tx(() => { for (const r of rows) { this.index.addEvent(r); n++; } });
    return n;
  }
}
