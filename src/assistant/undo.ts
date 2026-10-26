// Deshacer de las acciones automáticas del asistente: instantánea previa en texto plano + hash posterior.
// Solo se deshace si NADA del grupo cambió desde la acción (si no, avisa y no pisa nada).
import type { Jarvis } from "../core/jarvis.ts";
import { ulid } from "../core/ids.ts";
import { hashText, VaultError } from "../core/vault.ts";

export interface UndoRecord {
  id: string;
  ts: string;
  sessionId: string;
  tool: string;
  summary: string;
  files: { path: string; beforeText: string | null; afterHash: string | null }[];
  /** Fecha en que se deshizo (si ya se hizo). */
  undone?: string;
}

export interface Snapshot {
  before: Map<string, string | null>;
}

export class UndoStore {
  private j: Jarvis;
  private lastMs = 0;

  constructor(j: Jarvis) {
    this.j = j;
  }

  /** Foto de los ficheros ANTES de actuar (los que no existen quedan como null). */
  async capture(paths: string[]): Promise<Snapshot> {
    const before = new Map<string, string | null>();
    for (const p of paths) before.set(p, this.j.vault.exists(p) ? (await this.j.vault.read(p)).text : null);
    return { before };
  }

  /** Registra lo ocurrido tras actuar. `extra`: rutas nuevas que la acción pudo crear (p. ej. el destino de un movimiento). */
  async commit(snap: Snapshot, meta: { sessionId: string; tool: string; summary: string }, extra: string[] = []): Promise<UndoRecord> {
    const before = new Map(snap.before);
    for (const p of extra) if (!before.has(p)) before.set(p, null);
    const files: UndoRecord["files"] = [];
    for (const [path, beforeText] of before) {
      const afterHash = this.j.vault.exists(path) ? (await this.j.vault.read(path)).hash : null;
      const unchanged = beforeText === null ? afterHash === null : afterHash === hashText(beforeText);
      if (!unchanged) files.push({ path, beforeText, afterHash });
    }
    const ms = Math.max(Date.now(), this.lastMs + 1);
    this.lastMs = ms;
    const rec: UndoRecord = { id: ulid(ms), ts: new Date(ms).toISOString(), ...meta, files };
    await this.j.vault.writeInternal(`undo/${rec.id}.json`, JSON.stringify(rec, null, 2) + "\n");
    return rec;
  }

  async list(limit = 50): Promise<UndoRecord[]> {
    const out: UndoRecord[] = [];
    for (const f of await this.j.vault.listInternal("undo")) {
      if (!f.endsWith(".json")) continue;
      try { out.push(JSON.parse((await this.j.vault.readInternal(`undo/${f}`)) ?? "") as UndoRecord); } catch { /* ilegible: se ignora */ }
    }
    return out.sort((a, b) => b.id.localeCompare(a.id)).slice(0, limit);
  }

  async undo(id: string): Promise<UndoRecord> {
    const text = /^[0-9A-Z]{26}$/.test(id) ? await this.j.vault.readInternal(`undo/${id}.json`) : null;
    if (!text) throw new VaultError("not-found", "Acción no encontrada");
    const rec = JSON.parse(text) as UndoRecord;
    if (rec.undone) throw new VaultError("invalid", "Esa acción ya está deshecha");
    for (const f of rec.files) {
      const now = this.j.vault.exists(f.path) ? (await this.j.vault.read(f.path)).hash : null;
      if (now !== f.afterHash) throw new VaultError("conflict", `«${f.path}» cambió después de la acción: no se deshace para no pisar tus cambios`);
    }
    await this.j.restoreSnapshot(rec.files.map((f) => ({ path: f.path, text: f.beforeText })));
    rec.undone = new Date().toISOString();
    await this.j.vault.writeInternal(`undo/${rec.id}.json`, JSON.stringify(rec, null, 2) + "\n");
    await this.j.log.record("ai.undo", null, { id: rec.id, tool: rec.tool, summary: rec.summary, files: rec.files.map((f) => f.path) });
    return rec;
  }
}
