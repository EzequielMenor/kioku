// Propuestas: la ÚNICA vía por la que IA o automatizaciones modifican el vault.
// Cada operación lleva el hash "before": si el archivo cambió, la propuesta se aborta entera.
import type { Vault } from "./vault.ts";
import { ulid } from "./ids.ts";

export type Op =
  | { op: "create"; path: string; text: string }
  | { op: "update"; path: string; before: string; text: string }
  | { op: "setProp"; path: string; before: string; props: Record<string, unknown> }
  | { op: "move"; from: string; to: string; before: string }
  | { op: "trash"; path: string; before: string };

export type ProposalStatus = "pending" | "applied" | "rejected" | "failed";

export interface Proposal {
  id: string;
  createdAt: string;
  source: string; // "rules" | "llm:<modelo>" | …
  status: ProposalStatus;
  title: string;
  rationale: string;
  /** Clave de deduplicación (p. ej. "triage:Bandeja/x.md"). */
  key?: string;
  ops: Op[];
  resolvedAt?: string;
  error?: string;
}

export type ProposalDraft = Omit<Proposal, "id" | "createdAt" | "status">;

export class ProposalStore {
  private vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  async create(draft: ProposalDraft, now: Date): Promise<Proposal> {
    const p: Proposal = { ...draft, id: ulid(now.getTime()), createdAt: now.toISOString(), status: "pending" };
    await this.save(p);
    return p;
  }

  async save(p: Proposal): Promise<void> {
    await this.vault.writeInternal(`proposals/${p.id}.json`, JSON.stringify(p, null, 2) + "\n");
  }

  async get(id: string): Promise<Proposal | null> {
    if (!/^[0-9A-Z]{26}$/.test(id)) return null;
    const t = await this.vault.readInternal(`proposals/${id}.json`);
    return t ? (JSON.parse(t) as Proposal) : null;
  }

  async list(status?: ProposalStatus): Promise<Proposal[]> {
    const out: Proposal[] = [];
    for (const f of await this.vault.listInternal("proposals")) {
      if (!f.endsWith(".json")) continue;
      try {
        const p = JSON.parse((await this.vault.readInternal(`proposals/${f}`)) ?? "") as Proposal;
        if (!status || p.status === status) out.push(p);
      } catch { /* archivo ilegible: se ignora */ }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
}
