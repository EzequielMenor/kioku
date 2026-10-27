// Acceso al disco. Única puerta de escritura: todo pasa por aquí.
// Garantías: nunca se sale de la raíz, escritura atómica, detección de conflictos, borrado = papelera.
import { createHash, randomUUID } from "node:crypto";
import { promises as fs, statSync } from "node:fs";
import path from "node:path";

export class VaultError extends Error {
  code: "outside-root" | "conflict" | "exists" | "not-found" | "invalid";
  constructor(code: VaultError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export interface FileInfo {
  path: string; // relativa, con "/"
  mtimeMs: number;
  size: number;
}

export interface ReadResult {
  text: string;
  hash: string;
  mtimeMs: number;
}

export const INTERNAL_DIR = ".kioku";

export function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

export class Vault {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Resuelve una ruta relativa garantizando que queda dentro de la raíz. */
  abs(rel: string): string {
    if (typeof rel !== "string" || rel.includes("\0")) throw new VaultError("invalid", "Ruta inválida");
    const normalized = rel.replaceAll("\\", "/");
    if (path.isAbsolute(normalized)) throw new VaultError("outside-root", `Ruta absoluta no permitida: ${rel}`);
    const full = path.resolve(this.root, normalized);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new VaultError("outside-root", `Ruta fuera del vault: ${rel}`);
    }
    return full;
  }

  rel(full: string): string {
    return path.relative(this.root, full).split(path.sep).join("/");
  }

  /** Las notas del usuario nunca viven dentro de .kioku/. */
  assertUserPath(rel: string): void {
    const top = rel.replaceAll("\\", "/").split("/")[0];
    if (top === INTERNAL_DIR) throw new VaultError("invalid", "Ruta reservada para uso interno");
  }

  exists(rel: string): boolean {
    try {
      statSync(this.abs(rel));
      return true;
    } catch {
      return false;
    }
  }

  async read(rel: string): Promise<ReadResult> {
    try {
      const full = this.abs(rel);
      const [text, st] = await Promise.all([fs.readFile(full, "utf8"), fs.stat(full)]);
      return { text, hash: hashText(text), mtimeMs: st.mtimeMs };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new VaultError("not-found", `No existe: ${rel}`);
      throw e;
    }
  }

  /**
   * Escritura atómica (tmp + rename).
   * expectHash: hash que el llamante leyó. `null` = el archivo NO debe existir. `undefined` = sin comprobación.
   */
  async write(rel: string, text: string, expectHash?: string | null): Promise<{ hash: string }> {
    this.assertUserPath(rel);
    const full = this.abs(rel);
    if (expectHash !== undefined) {
      let current: string | null = null;
      try {
        current = hashText(await fs.readFile(full, "utf8"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (expectHash === null && current !== null) throw new VaultError("exists", `Ya existe: ${rel}`);
      if (expectHash !== null && current !== expectHash) {
        throw new VaultError("conflict", `El archivo cambió fuera de Kioku: ${rel}`);
      }
    }
    await this.writeRaw(full, text);
    return { hash: hashText(text) };
  }

  private async writeRaw(full: string, text: string): Promise<void> {
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`;
    await fs.writeFile(tmp, text, "utf8");
    await fs.rename(tmp, full);
  }

  /** Escritura en el área interna (.kioku/…): índice, log, propuestas. */
  async writeInternal(rel: string, text: string): Promise<void> {
    await this.writeRaw(this.abs(`${INTERNAL_DIR}/${rel}`), text);
  }

  async appendInternal(rel: string, line: string): Promise<void> {
    const full = this.abs(`${INTERNAL_DIR}/${rel}`);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.appendFile(full, line, "utf8");
  }

  async readInternal(rel: string): Promise<string | null> {
    try {
      return await fs.readFile(this.abs(`${INTERNAL_DIR}/${rel}`), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async listInternal(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(this.abs(`${INTERNAL_DIR}/${dir}`));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }

  /** Borra un fichero del área interna (no toca las notas del usuario). */
  async removeInternal(rel: string): Promise<void> {
    await fs.rm(this.abs(`${INTERNAL_DIR}/${rel}`), { force: true });
  }

  /** Mueve a .kioku/trash/ (nunca borra de verdad). Devuelve la ruta en la papelera. */
  async trash(rel: string): Promise<string> {
    this.assertUserPath(rel);
    const src = this.abs(rel);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = `${INTERNAL_DIR}/trash/${stamp}__${rel.replaceAll("/", "__")}`;
    await fs.mkdir(path.dirname(this.abs(dest)), { recursive: true });
    await fs.rename(src, this.abs(dest));
    return dest;
  }

  async move(from: string, to: string): Promise<void> {
    this.assertUserPath(from);
    this.assertUserPath(to);
    if (this.exists(to)) throw new VaultError("exists", `Ya existe: ${to}`);
    await fs.mkdir(path.dirname(this.abs(to)), { recursive: true });
    await fs.rename(this.abs(from), this.abs(to));
  }

  /** Devuelve `rel` si está libre; si no, añade -2, -3… antes de la extensión. */
  uniquePath(rel: string): string {
    if (!this.exists(rel)) return rel;
    const ext = path.posix.extname(rel);
    const base = rel.slice(0, rel.length - ext.length);
    for (let i = 2; i < 10_000; i++) {
      const cand = `${base}-${i}${ext}`;
      if (!this.exists(cand)) return cand;
    }
    throw new VaultError("exists", `Sin nombre libre para ${rel}`);
  }

  /** Lista todos los .md del usuario (ignora directorios ocultos como .obsidian y .kioku). */
  async listMarkdown(): Promise<FileInfo[]> {
    const out: FileInfo[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
          const st = await fs.stat(full);
          out.push({ path: this.rel(full), mtimeMs: st.mtimeMs, size: st.size });
        }
      }
    };
    await walk(this.root);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
}

/** Nombre de archivo seguro y legible (estilo Obsidian: conserva acentos y espacios). */
export function sanitizeFileName(title: string, max = 80): string {
  const s = title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, max)
    .trim();
  return s || "Sin título";
}
