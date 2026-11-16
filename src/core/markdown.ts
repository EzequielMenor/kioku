// Parsing de notas: frontmatter, enlaces, etiquetas, secciones.
// Todo es puro (sin disco) para poder probarlo aislado.
import YAML, { type Scalar } from "yaml";

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

/**
 * Renombra una clave del frontmatter tocando solo el texto de la clave: valor, comentarios,
 * orden y el resto del fichero quedan byte a byte (no se re-serializa el documento).
 * Si `from` no existe, o no hay frontmatter, devuelve el texto idéntico.
 * Lanza si el YAML es inválido o si `to` ya existe.
 */
export function renameFrontmatterKey(text: string, from: string, to: string): string {
  const { fmText } = splitFrontmatter(text);
  if (fmText === null) return text;
  const doc = YAML.parseDocument(fmText);
  if (doc.errors.length) throw new Error("Frontmatter YAML inválido: no se renombra la clave");
  const map = doc.contents;
  if (!YAML.isMap(map)) return text;
  const keyNamed = (name: string) =>
    map.items.map((p) => p.key).find((k): k is Scalar.Parsed => YAML.isScalar(k) && String(k.value) === name);
  const key = keyNamed(from);
  if (!key || from === to) return text;
  if (keyNamed(to)) throw new Error(`La clave "${to}" ya existe en el frontmatter`);
  const range = key.range;
  if (!range) throw new Error("Frontmatter YAML inválido: no se renombra la clave");
  // Solo cambia el texto de la clave; el BOM, la línea "---" y el resto se copian tal cual.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const bom = text.slice(0, text.length - src.length);
  const open = src.indexOf("\n") + 1;
  const renamed = fmText.slice(0, range[0]) + renderKey(to, key.type) + fmText.slice(range[1]);
  return bom + src.slice(0, open) + renamed + src.slice(open + fmText.length);
}

/** Clave YAML con el mismo estilo de comillas que la original; plana si era plana y es válida. */
function renderKey(name: string, original: string | undefined): string {
  const sc = new YAML.Scalar(name);
  if (/[\r\n]/.test(name) || original === "QUOTE_DOUBLE") sc.type = "QUOTE_DOUBLE";
  else if (original === "QUOTE_SINGLE") sc.type = "QUOTE_SINGLE";
  else sc.type = "PLAIN";
  return new YAML.Document(sc).toString({ lineWidth: 0 }).trimEnd();
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

export interface RenameOpts {
  title?: string;
  fileName?: string;
  folder?: string;
}

export interface RenamePlan {
  nextTitle: string;
  targetDir: string;
  nextBase: string;
  destRel: string;
}

export class RenamePlanError extends Error {
  code = "invalid" as const;
}

function defaultSanitizeFileName(name: string): string {
  const s = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80)
    .trim();
  return s || "Sin título";
}

const RESERVED_TOP_FOLDERS = new Set([".kioku", ".obsidian", "calendario", "areas"]);

/** Calcula título, carpeta y ruta destino válidas para renombrar o mover una nota. */
export function planNoteRename(
  rel: string,
  curTitle: string,
  opts: RenameOpts,
  sanitize: (name: string) => string = defaultSanitizeFileName,
): RenamePlan {
  const normRel = rel.replace(/\\/g, "/");
  const slash = normRel.lastIndexOf("/");
  const curDir = slash >= 0 ? normRel.slice(0, slash) : "";
  const curBase = (slash >= 0 ? normRel.slice(slash + 1) : normRel).replace(/\.md$/i, "");

  const nextTitle = opts.title !== undefined ? opts.title.trim() : curTitle;
  if (opts.title !== undefined && !nextTitle) throw new RenamePlanError("El título no puede estar vacío");

  let targetDir = curDir;
  if (opts.folder !== undefined) {
    targetDir = opts.folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (targetDir) {
      const segs = targetDir.split("/");
      if (segs.some((s) => !s || s === "." || s === ".." || s.startsWith("."))) {
        throw new RenamePlanError("Carpeta no permitida");
      }
      if (RESERVED_TOP_FOLDERS.has(segs[0].toLowerCase())) {
        throw new RenamePlanError("Esa carpeta está reservada");
      }
    }
  }

  let nextBase = curBase;
  if (opts.fileName !== undefined) {
    const rawName = opts.fileName.trim().replace(/\.md$/i, "");
    if (!rawName.replace(/[<>:"/\\|?*\x00-\x1f.\s]+/g, "")) {
      throw new RenamePlanError("Nombre de archivo inválido");
    }
    nextBase = sanitize(rawName);
  } else if (opts.title !== undefined && nextTitle !== curTitle) {
    nextBase = sanitize(nextTitle);
  }

  const destRel = targetDir ? `${targetDir}/${nextBase}.md` : `${nextBase}.md`;
  return { nextTitle, targetDir, nextBase, destRel };
}

const FM_FENCE_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const WIKILINK_MATCH_RE = /(!?)\[\[([^\]\n]+)\]\]/g;
const CODE_FENCE_LINE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;

function rewriteWikilinksInSegment(text: string, mapTarget: (target: string) => string | null): string {
  return text.replace(WIKILINK_MATCH_RE, (m, embed: string, inner: string) => {
    const pipe = inner.indexOf("|");
    const beforeAlias = pipe >= 0 ? inner.slice(0, pipe) : inner;
    const alias = pipe >= 0 ? inner.slice(pipe) : "";
    const hash = beforeAlias.indexOf("#");
    const rawTarget = (hash >= 0 ? beforeAlias.slice(0, hash) : beforeAlias).trim();
    const anchor = hash >= 0 ? beforeAlias.slice(hash) : "";
    const next = mapTarget(rawTarget);
    if (next === null || next === rawTarget) return m;
    return `${embed}[[${next}${anchor}${alias}]]`;
  });
}

function rewriteLineOutsideCode(line: string, mapTarget: (target: string) => string | null): string {
  let out = "";
  let i = 0;
  let plainStart = 0;
  while (i < line.length) {
    if (line[i] === "`") {
      let tickLen = 0;
      while (i + tickLen < line.length && line[i + tickLen] === "`") tickLen++;
      const close = line.indexOf("`".repeat(tickLen), i + tickLen);
      if (close >= 0) {
        out += rewriteWikilinksInSegment(line.slice(plainStart, i), mapTarget);
        out += line.slice(i, close + tickLen);
        i = close + tickLen;
        plainStart = i;
        continue;
      }
      i += tickLen;
      continue;
    }
    i++;
  }
  out += rewriteWikilinksInSegment(line.slice(plainStart), mapTarget);
  return out;
}

/** Reescribe enlaces `[[...]]` en frontmatter y cuerpo (respetando bloques y spans de código). */
export function rewriteWikilinks(text: string, mapTarget: (target: string) => string | null): string {
  const fm = FM_FENCE_RE.exec(text);
  const fmPart = fm ? rewriteWikilinksInSegment(fm[0], mapTarget) : "";
  const body = fm ? text.slice(fm[0].length) : text;
  const lines = body.split("\n");
  let fenceChar: string | null = null;
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].replace(/\r$/, "");
    const m = CODE_FENCE_LINE_RE.exec(trimmed);
    if (!fenceChar && m) {
      fenceChar = m[1][0];
      fenceLen = m[1].length;
      continue;
    }
    if (fenceChar) {
      if (new RegExp(`^[ \\t]{0,3}${fenceChar}{${fenceLen},}[ \\t]*$`).test(trimmed)) {
        fenceChar = null;
        fenceLen = 0;
      }
      continue;
    }
    lines[i] = rewriteLineOutsideCode(lines[i], mapTarget);
  }
  return fmPart + lines.join("\n");
}

/** Si el cuerpo empieza con `# oldTitle`, lo sincroniza con `newTitle` preservando el frontmatter. */
export function replaceLeadingHeading(text: string, oldTitle: string, newTitle: string): string {
  if (normKey(oldTitle) === normKey(newTitle) && oldTitle === newTitle) return text;
  const fm = FM_FENCE_RE.exec(text);
  const fmPart = fm ? fm[0] : "";
  const body = fm ? text.slice(fmPart.length) : text;
  const head = /^([ \t]*(?:\r?\n)*)(#[ \t]+)([^\r\n]+)/.exec(body);
  if (!head || normKey(head[3]) !== normKey(oldTitle)) return text;
  return fmPart + head[1] + head[2] + newTitle + body.slice(head[0].length);
}

/** Construye un mapeador para actualizar enlaces `[[...]]` tras renombrar o mover una nota. */
export function createRenameLinkMapper(
  oldRel: string,
  oldTitle: string,
  newRel: string,
  newBase: string,
  newTitle: string,
): (rawTarget: string) => string | null {
  const oldPathNoExt = normKey(oldRel.replace(/\.md$/i, ""));
  const newPathNoExt = newRel.replace(/\.md$/i, "");
  const oldSlash = oldRel.lastIndexOf("/");
  const oldBase = (oldSlash >= 0 ? oldRel.slice(oldSlash + 1) : oldRel).replace(/\.md$/i, "");
  const oldBaseKey = normKey(oldBase);
  const oldTitleKey = normKey(oldTitle);
  const fileChanged = oldBaseKey !== normKey(newBase) || newBase !== oldBase;
  const titleChanged = oldTitleKey !== normKey(newTitle) || newTitle !== oldTitle;

  return (rawTarget: string) => {
    const stripped = rawTarget.replace(/\.md$/i, "").trim();
    if (!stripped) return null;
    const key = normKey(stripped);
    if (key === oldPathNoExt) return newPathNoExt;
    if (!stripped.includes("/")) {
      if (key === oldBaseKey && fileChanged) return newBase;
      if (key === oldTitleKey && titleChanged) return newBase;
    }
    return null;
  };
}
