import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseNote, setFrontmatter } from "../core/markdown.ts";
import { hashText, VaultError } from "../core/vault.ts";
import type { TaskStatus } from "../core/index.ts";
import type { Kioku } from "../core/kioku.ts";

class OperationError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
type Result = { outcome: "applied" | "conflict"; path: string; hash: string; text?: string };
type Receipt = { fingerprint: string; target: string; text: string; baseHash: string; result: Result; complete: boolean };

/** Limita el nombre por bytes sin dividir caracteres Unicode. */
function conflictPath(rel: string, opId: string, counter = 1): string {
  const suffix = ` (conflicto móvil ${opId}${counter === 1 ? "" : `-${counter}`}).md`;
  const budget = 240 - Buffer.byteLength(suffix);
  let stem = "";
  for (const ch of path.posix.basename(rel).slice(0, -3)) {
    if (Buffer.byteLength(stem + ch) > budget) break;
    stem += ch;
  }
  const dir = path.posix.dirname(rel);
  return `${dir === "." ? "" : `${dir}/`}${stem}${suffix}`;
}

/** Separate from capture receipts: a prepared write survives a lost response or restart. */
export class MobileOperations {
  private writes: Promise<void> = Promise.resolve();
  private readonly j: Kioku;
  constructor(j: Kioku) { this.j = j; }

  run(body: Record<string, unknown>, visible: (path: string) => boolean = () => true): Promise<Result> {
    const step = this.writes.then(() => this.execute(body, visible));
    this.writes = step.then(() => {}, () => {});
    return step;
  }

  private async safePath(rel: string): Promise<void> {
    let current = this.j.vault.root;
    for (const part of rel.split("/")) {
      current = path.join(current, part);
      try {
        if ((await fs.lstat(current)).isSymbolicLink()) throw new OperationError(400, "Ruta no permitida");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
        throw e;
      }
    }
  }

  private async occupied(rel: string): Promise<boolean> {
    try { await fs.lstat(this.j.vault.abs(rel)); return true; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
  }

  private async execute(body: Record<string, unknown>, visible: (path: string) => boolean): Promise<Result> {
    const { opId, kind, path: rel, baseHash, text, status } = body;
    if (typeof opId !== "string" || !/^[0-9a-f-]{8,64}$/i.test(opId) ||
        (kind !== "edit" && kind !== "task") || typeof rel !== "string" || !rel.toLowerCase().endsWith(".md") ||
        rel.includes("\\") || rel.includes("\0") || rel.startsWith("/") || rel.split("/").some(s => !s || s.startsWith(".")) ||
        typeof baseHash !== "string" || !/^[0-9a-f]{40}$/.test(baseHash) || typeof text !== "string" ||
        (kind === "task" && !["todo", "doing", "done", "dropped"].includes(status as string)) ||
        (kind === "edit" && status !== undefined)) throw new OperationError(400, "Operación móvil inválida");
    const fingerprint = createHash("sha256").update(JSON.stringify([kind, rel, baseHash, text, status ?? null])).digest("hex");
    const file = `mobile-operations/${opId}.json`;
    await this.safePath(rel);
    let receipt: Receipt | null = null;
    const raw = await this.j.vault.readInternal(file);
    if (raw !== null) {
      receipt = JSON.parse(raw) as Receipt;
      if (receipt.fingerprint !== fingerprint) throw new OperationError(400, "Identificador de operación reutilizado con otros datos");
      if (receipt.complete || receipt.result.outcome === "applied") await this.safePath(receipt.target);
      if (!visible(receipt.target)) throw new OperationError(403, "Esa carpeta es privada y no se toca desde el móvil");
      if (receipt.complete) return receipt.result.outcome === "applied" ? { ...receipt.result, text: receipt.text } : receipt.result;
    }
    if (!receipt) {
      const current = await this.j.vault.read(rel);
      let desired = text;
      if (kind === "task") {
        const parsed = parseNote(text, rel);
        if (parsed.frontmatterError || parsed.frontmatter.type !== "task") throw new OperationError(400, "La nota no es una tarea válida");
        desired = setFrontmatter(text, this.j.taskStatusProps(status as TaskStatus));
      }
      const conflict = current.hash !== baseHash;
      let target = conflict ? conflictPath(rel, opId) : rel;
      if (conflict) {
        let n = 2;
        while (await this.occupied(target)) target = conflictPath(rel, opId, n++);
      }
      if (!visible(target)) throw new OperationError(403, "Esa carpeta es privada y no se toca desde el móvil");
      receipt = { fingerprint, target, text: desired, baseHash, result: { outcome: conflict ? "conflict" : "applied", path: target, hash: hashText(desired) }, complete: false };
      await this.j.vault.writeInternal(file, JSON.stringify(receipt));
    }
    if (receipt.result.outcome === "applied") {
      const current = await this.j.vault.read(rel);
      try {
        if (current.hash !== receipt.result.hash) await this.j.saveNote(rel, receipt.text, receipt.baseHash);
        else await this.j.notifyNoteChanged(rel);
      } catch (e) {
        if (!(e instanceof VaultError && e.code === "conflict")) throw e;
        await this.j.vault.read(rel); // Si se eliminó, no se recrea ni se convierte en conflicto.
        const target = conflictPath(rel, opId);
        if (!visible(target)) throw new OperationError(403, "Esa carpeta es privada y no se toca desde el móvil");
        receipt.target = target;
        receipt.result = { outcome: "conflict", path: target, hash: receipt.result.hash };
        await this.j.vault.writeInternal(file, JSON.stringify(receipt));
      }
    }
    if (receipt.result.outcome === "conflict") {
      for (let n = 2; ; n++) {
        try { await this.j.vault.writeExclusive(receipt.target, receipt.text, opId); break; }
        catch (e) { if (!(e instanceof VaultError && e.code === "exists")) throw e; }
        const target = conflictPath(rel, opId, n);
        if (!visible(target)) throw new OperationError(403, "Esa carpeta es privada y no se toca desde el móvil");
        receipt.target = target;
        receipt.result.path = target;
        await this.j.vault.writeInternal(file, JSON.stringify(receipt));
      }
      await this.j.notifyNoteChanged(receipt.target);
    }
    receipt.complete = true;
    await this.j.vault.writeInternal(file, JSON.stringify(receipt));
    return receipt.result.outcome === "applied" ? { ...receipt.result, text: receipt.text } : receipt.result;
  }
}

export function operationErrorStatus(e: unknown): number | null {
  return e instanceof OperationError ? e.status : null;
}
