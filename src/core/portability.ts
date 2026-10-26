// Exportar / restaurar / importar. Principio: el origen de una importación es de SOLO LECTURA.
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { normKey, parseNote } from "./markdown.ts";

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Copia de seguridad completa (.tar.gz) sin el índice derivado: se reconstruye al restaurar. */
export function exportVault(home: string, dest: string): { bytes: number } {
  const h = path.resolve(home);
  const d = path.resolve(dest);
  if (inside(d, h)) throw new Error("El destino no puede estar dentro del vault");
  const r = spawnSync(
    "tar",
    [
      "-czf", d,
      "--exclude=.jarvis/index.db", "--exclude=.jarvis/index.db-wal", "--exclude=.jarvis/index.db-shm",
      "--exclude=.jarvis/runtime.json", "--exclude=.jarvis/daemon.log",
      "-C", path.dirname(h), path.basename(h),
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`tar falló: ${r.stderr}`);
  return { bytes: 0 };
}

/** Restaura en una carpeta vacía o inexistente. Nunca sobrescribe. */
export async function restoreVault(archive: string, dest: string): Promise<{ files: number }> {
  const d = path.resolve(dest);
  try {
    const entries = await fs.readdir(d);
    if (entries.length) throw new Error(`El destino no está vacío: ${d}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const list = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
  if (list.status !== 0) throw new Error(`Archivo ilegible: ${list.stderr}`);
  const names = list.stdout.split("\n").filter(Boolean);
  if (names.some((n) => path.isAbsolute(n) || n.split("/").includes(".."))) throw new Error("El archivo contiene rutas inseguras");
  await fs.mkdir(d, { recursive: true });
  const x = spawnSync("tar", ["-xzf", archive, "-C", d, "--strip-components=1", "--no-same-owner"], { encoding: "utf8" });
  if (x.status !== 0) throw new Error(`tar falló: ${x.stderr}`);
  return { files: names.filter((n) => !n.endsWith("/")).length };
}

export interface ImportReport {
  source: string;
  notes: number;
  attachments: number;
  alreadyThere: number;
  brokenLinks: { from: string; target: string }[];
  applied: boolean;
}

/**
 * Copia un vault de Obsidian a `Notas/Importado/` dentro de JARVIS.
 * Garantías: el origen solo se LEE (readdir/readFile/copyFile-origen); no se toca .obsidian;
 * los archivos se copian byte a byte (sin reescribir enlaces); nunca se pisa un archivo existente.
 */
export async function importObsidian(src: string, home: string, apply: boolean): Promise<ImportReport> {
  const s = path.resolve(src);
  const h = path.resolve(home);
  if (inside(h, s) || inside(s, h)) throw new Error("El origen y el vault de JARVIS no pueden estar anidados");
  const st = await fs.stat(s).catch(() => null);
  if (!st?.isDirectory()) throw new Error(`No existe la carpeta: ${s}`);

  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue; // .obsidian, .trash, .git…
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) files.push(path.relative(s, full));
    }
  };
  await walk(s);

  const known = new Set<string>();
  const mdTexts = new Map<string, string>();
  for (const f of files.filter((x) => x.toLowerCase().endsWith(".md"))) {
    const text = await fs.readFile(path.join(s, f), "utf8");
    mdTexts.set(f, text);
    const noExt = f.replace(/\.md$/i, "").split(path.sep).join("/");
    known.add(normKey(noExt));
    known.add(normKey(noExt.split("/").pop()!));
    const al = parseNote(text, f).frontmatter.aliases;
    for (const a of Array.isArray(al) ? al : typeof al === "string" ? [al] : []) known.add(normKey(String(a)));
  }
  for (const f of files) known.add(normKey(path.basename(f)));

  const broken: ImportReport["brokenLinks"] = [];
  for (const [f, text] of mdTexts) {
    for (const l of parseNote(text, f).links) {
      if (l.target && !known.has(normKey(l.target.replace(/\.md$/i, "")))) broken.push({ from: f, target: l.target });
    }
  }

  let notes = 0, attachments = 0, there = 0;
  for (const f of files) {
    const destRel = path.join("Notas", "Importado", f);
    const dest = path.join(h, destRel);
    const exists = await fs.stat(dest).then(() => true, () => false);
    if (exists) { there++; continue; }
    if (f.toLowerCase().endsWith(".md")) notes++; else attachments++;
    if (apply) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(path.join(s, f), dest, 1 /* COPYFILE_EXCL */);
      const stt = await fs.stat(path.join(s, f));
      await fs.utimes(dest, stt.atime, stt.mtime);
    }
  }
  return { source: s, notes, attachments, alreadyThere: there, brokenLinks: broken, applied: apply };
}
