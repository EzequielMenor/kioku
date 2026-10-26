import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Crea un vault temporal AISLADO. Los tests jamás usan rutas del usuario. */
export function tmpVault(files: Record<string, string> = {}): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "jarvis-test-"));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
