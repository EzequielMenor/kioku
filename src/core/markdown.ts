// Parsing de notas: frontmatter, enlaces, etiquetas, secciones.
// Todo es puro (sin disco) para poder probarlo aislado.
import YAML from "yaml";

export type Frontmatter = Record<string, unknown>;

export interface SplitNote {
  /** Texto YAML crudo (sin los ---), o null si no hay frontmatter. */
  fmText: string | null;
  body: string;
}

export interface LinkRef {
  /** Destino tal como se escribió, sin ancla ni alias. */
  target: string;
  anchor: string | null;
  alias: string | null;
  embed: boolean;
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

export interface ParsedNote {
  frontmatter: Frontmatter;
  /** true si había frontmatter pero no se pudo interpretar. */
  frontmatterError: boolean;
  body: string;
  title: string;
  links: LinkRef[];
  tags: string[];
  headings: Heading[];
}

const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(text: string): SplitNote {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const m = FM_RE.exec(src);
  if (!m) return { fmText: null, body: src };
  return { fmText: m[1], body: src.slice(m[0].length) };
}

/** Quita bloques de código y código en línea para que no cuenten como enlaces/etiquetas. */
export function stripCode(body: string): string {
  return body
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

const WIKI_RE = /(!?)\[\[([^\[\]\n]+?)\]\]/g;

export function extractLinks(body: string): LinkRef[] {
  const out: LinkRef[] = [];
  for (const m of stripCode(body).matchAll(WIKI_RE)) {
    let inner = m[2];
    let alias: string | null = null;
    const pipe = inner.indexOf("|");
    if (pipe >= 0) {
      alias = inner.slice(pipe + 1).trim() || null;
      inner = inner.slice(0, pipe);
    }
    let anchor: string | null = null;
    const hash = inner.indexOf("#");
    if (hash >= 0) {
      anchor = inner.slice(hash + 1).trim() || null;
      inner = inner.slice(0, hash);
    }
    const target = inner.trim();
    // [[#Encabezado]] apunta a la propia nota: target vacío es legítimo.
    if (!target && !anchor) continue;
    out.push({ target, anchor, alias, embed: m[1] === "!" });
  }
  return out;
}

const TAG_RE = /(?<![\p{L}\p{N}_/&#])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu;

export function extractTags(body: string): string[] {
  const set = new Set<string>();
  for (const m of stripCode(body).matchAll(TAG_RE)) set.add(m[1]);
  return [...set];
}

export function extractHeadings(body: string): Heading[] {
  const out: Heading[] = [];
  const lines = stripCode(body).split("\n");
  lines.forEach((l, i) => {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i });
  });
  return out;
}

function parseYaml(fmText: string | null): { fm: Frontmatter; error: boolean } {
  if (fmText === null) return { fm: {}, error: false };
  try {
    const v = YAML.parse(fmText);
    if (v === null || v === undefined) return { fm: {}, error: false };
    if (typeof v !== "object" || Array.isArray(v)) return { fm: {}, error: true };
    return { fm: v as Frontmatter, error: false };
  } catch {
    return { fm: {}, error: true };
  }
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).replace(/^#/, "").trim()).filter(Boolean);
  if (typeof v === "string") return v.split(/[,\s]+/).map((x) => x.replace(/^#/, "").trim()).filter(Boolean);
  return [];
}

export function parseNote(text: string, fileName: string): ParsedNote {
  const { fmText, body } = splitFrontmatter(text);
  const { fm, error } = parseYaml(fmText);
  const headings = extractHeadings(body);
  const h1 = headings.find((h) => h.level === 1)?.text;
  const fmTitle = typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : null;
  const base = fileName.replace(/\.md$/i, "").split("/").pop() ?? fileName;
  const tags = [...new Set([...asStringList(fm.tags), ...extractTags(body)])];
  const fmLinks: LinkRef[] = [];
  // Relaciones en propiedades (project: "[[X]]") también son enlaces.
  const walk = (v: unknown) => {
    if (typeof v === "string") fmLinks.push(...extractLinks(v));
    else if (Array.isArray(v)) v.forEach(walk);
  };
  Object.values(fm).forEach(walk);
  return {
    frontmatter: fm,
    frontmatterError: error,
    body,
    title: fmTitle ?? h1 ?? base,
    links: [...extractLinks(body), ...fmLinks],
    tags,
    headings,
  };
}

/**
 * Reescribe el frontmatter conservando comentarios, orden y propiedades desconocidas.
 * Si el YAML existente es inválido lanza: nunca pisamos lo que no entendemos.
 */
export function setFrontmatter(text: string, patch: Record<string, unknown>): string {
  const { fmText, body } = splitFrontmatter(text);
  const doc = fmText === null ? new YAML.Document({}) : YAML.parseDocument(fmText);
  if (doc.errors.length) throw new Error("Frontmatter YAML inválido: no se modifica");
  if (doc.contents === null) doc.contents = doc.createNode({}) as never;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) doc.delete(k);
    else doc.set(k, v);
  }
  const yaml = String(doc).trimEnd();
  return `---\n${yaml}\n---\n${body}`;
}

export function renderNote(frontmatter: Frontmatter, body: string): string {
  const keys = Object.keys(frontmatter).filter((k) => frontmatter[k] !== undefined && frontmatter[k] !== null);
  if (!keys.length) return body;
  const clean = Object.fromEntries(keys.map((k) => [k, frontmatter[k]]));
  return `---\n${YAML.stringify(clean).trimEnd()}\n---\n${body}`;
}

/* ---------- Secciones ---------- */

function sectionRange(lines: string[], name: string): { start: number; end: number; level: number } | null {
  const target = name.trim().toLowerCase();
  let inFence = false;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^(```|~~~)/.test(l)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (!m) continue;
    if (start < 0) {
      if (m[2].trim().toLowerCase() === target) {
        start = i;
        level = m[1].length;
      }
    } else if (m[1].length <= level) {
      return { start, end: i, level };
    }
  }
  return start < 0 ? null : { start, end: lines.length, level };
}

/** Elementos de lista (`- x`) bajo un encabezado, en orden de aparición. */
export function sectionItems(body: string, name: string): string[] {
  const lines = body.split("\n");
  const r = sectionRange(lines, name);
  if (!r) return [];
  const items: string[] = [];
  for (let i = r.start + 1; i < r.end; i++) {
    const m = /^\s*[-*+]\s+(.*\S)\s*$/.exec(lines[i]);
    if (m) items.push(m[1]);
  }
  return items;
}

/** Añade un elemento de lista al final de la sección; la crea (nivel 2) si no existe. */
export function appendToSection(body: string, name: string, item: string): string {
  const lines = body.split("\n");
  const r = sectionRange(lines, name);
  const bullet = `- ${item}`;
  if (!r) {
    const trimmed = body.replace(/\s+$/, "");
    const sep = trimmed ? "\n\n" : "";
    return `${trimmed}${sep}## ${name}\n\n${bullet}\n`;
  }
  let last = r.start;
  for (let i = r.start + 1; i < r.end; i++) if (lines[i].trim()) last = i;
  const out = [...lines.slice(0, last + 1)];
  if (last === r.start) out.push("");
  out.push(bullet, ...lines.slice(last + 1));
  let res = out.join("\n");
  if (!res.endsWith("\n")) res += "\n";
  return res;
}

/** Slug seguro para nombres de archivo: minúsculas, sin acentos, guiones. */
export function slugify(s: string, max = 48): string {
  const slug = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "sin-titulo";
}

/** Clave de comparación de títulos/enlaces: sin acentos, minúsculas, espacios colapsados. */
export function normKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
