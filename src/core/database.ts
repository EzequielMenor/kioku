// Bases de datos al estilo Notion sobre notas Markdown: una base es una nota `type: database` cuyo frontmatter
// define de dónde salen las filas (carpeta/tipo/etiquetas), un esquema opcional de propiedades y vistas guardadas.
// Todo aquí es puro (sin disco ni índice): se alimenta con filas y devuelve resultados, así que es fácil de probar.
import type { NoteType } from "./index.ts";
import type { Frontmatter } from "./markdown.ts";

export type PropType = "text" | "number" | "date" | "checkbox" | "select" | "multi" | "url" | "relation";
export type FilterOp = "is" | "is_not" | "contains" | "empty" | "not_empty" | "gt" | "lt" | "before" | "after" | "checked";
export type ViewKind = "table" | "board" | "list";

export const PROP_TYPES: readonly PropType[] = ["text", "number", "date", "checkbox", "select", "multi", "url", "relation"];
export const FILTER_OPS: readonly FilterOp[] = ["is", "is_not", "contains", "empty", "not_empty", "gt", "lt", "before", "after", "checked"];
export const VIEW_KINDS: readonly ViewKind[] = ["table", "board", "list"];
const NOTE_TYPES: readonly string[] = ["note", "task", "project", "journal", "resource", "capture", "database"];

export interface PropSchema { type?: PropType; options?: string[] }
export interface Filter { prop: string; op: FilterOp; value?: unknown }
export interface Sort { prop: string; dir: "asc" | "desc" }
export interface View { name: string; kind: ViewKind; columns: string[]; filter: Filter[]; sort: Sort[]; group: string | null }
export interface DbSource { folder: string | null; type: NoteType | null; tags: string[] }
export interface DatabaseDef {
  path: string;
  title: string;
  source: DbSource;
  properties: Record<string, PropSchema>;
  views: View[];
  /** Cosas del frontmatter que se descartaron por inválidas (nunca se lanza: una base rota sigue abriéndose). */
  warnings: string[];
}

/** Lo mínimo que el motor necesita de una nota. */
export interface DbRow { path: string; title: string; type: NoteType; tags: string[]; mtime: number; fm: Frontmatter }
export interface Column { key: string; type: PropType; options?: string[] }
export interface ResultRow { path: string; title: string; cells: Record<string, unknown> }
export interface QueryResult {
  columns: Column[];
  rows: ResultRow[];
  /** Solo en vistas con `group`: grupos en orden (las opciones del esquema primero, «sin valor» = clave "" al final). */
  groups: { key: string; rows: ResultRow[] }[] | null;
  /** Filas que cumplen los filtros (antes de cualquier límite del cliente). */
  total: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;
const WIKI_RE = /^\[\[[^\]]+\]\]$/;

/** Los `Date` de YAML pasan a texto AAAA-MM-DD para comparar y mostrar igual que si vinieran entrecomillados. */
function norm(v: unknown): unknown {
  return v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : v;
}

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

export function inferType(value: unknown): PropType {
  const v = norm(value);
  if (typeof v === "boolean") return "checkbox";
  if (typeof v === "number") return "number";
  if (Array.isArray(v)) return v.length > 0 && v.every((x) => typeof x === "string" && WIKI_RE.test(x)) ? "relation" : "multi";
  if (typeof v === "string") {
    if (DATE_RE.test(v)) return "date";
    if (/^https?:\/\//i.test(v)) return "url";
    if (WIKI_RE.test(v)) return "relation";
  }
  return "text";
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);

/** Lee la definición de una base desde su frontmatter. Tolerante: lo inválido se descarta y queda como aviso. */
export function parseDatabase(note: { path: string; title: string; fm: Frontmatter }): DatabaseDef {
  const warnings: string[] = [];
  const fm = note.fm ?? {};

  const source: DbSource = { folder: null, type: null, tags: [] };
  if (fm.source !== undefined) {
    if (!isObj(fm.source)) warnings.push("«source» debe ser un objeto con folder/type/tags");
    else {
      if (typeof fm.source.folder === "string" && fm.source.folder.trim()) source.folder = fm.source.folder.trim();
      if (typeof fm.source.type === "string") {
        if (NOTE_TYPES.includes(fm.source.type)) source.type = fm.source.type as NoteType;
        else warnings.push(`«source.type» desconocido: ${fm.source.type}`);
      }
      source.tags = strArr(fm.source.tags);
    }
  }

  const properties: Record<string, PropSchema> = {};
  if (fm.properties !== undefined) {
    if (!isObj(fm.properties)) warnings.push("«properties» debe ser un objeto");
    else {
      for (const [key, raw] of Object.entries(fm.properties)) {
        if (!isObj(raw)) { warnings.push(`Propiedad «${key}»: debe ser un objeto con type/options`); continue; }
        const p: PropSchema = {};
        if (raw.type !== undefined) {
          if (PROP_TYPES.includes(raw.type as PropType)) p.type = raw.type as PropType;
          else warnings.push(`Propiedad «${key}»: tipo desconocido «${String(raw.type)}»`);
        }
        const options = strArr(raw.options);
        if (options.length) p.options = options;
        properties[key] = p;
      }
    }
  }

  const views: View[] = [];
  if (fm.views !== undefined) {
    if (!Array.isArray(fm.views)) warnings.push("«views» debe ser una lista");
    else {
      for (const [i, raw] of fm.views.entries()) {
        if (!isObj(raw)) { warnings.push(`Vista ${i + 1}: debe ser un objeto`); continue; }
        if (typeof raw.name !== "string" || !raw.name.trim()) { warnings.push(`Vista ${i + 1}: falta «name»`); continue; }
        if (!VIEW_KINDS.includes(raw.kind as ViewKind)) { warnings.push(`Vista «${raw.name}»: «kind» debe ser table, board o list`); continue; }
        const v: View = { name: raw.name.trim(), kind: raw.kind as ViewKind, columns: strArr(raw.columns), filter: [], sort: [], group: typeof raw.group === "string" && raw.group ? raw.group : null };
        for (const f of Array.isArray(raw.filter) ? raw.filter : []) {
          if (isObj(f) && typeof f.prop === "string" && f.prop && FILTER_OPS.includes(f.op as FilterOp)) v.filter.push(f.value === undefined ? { prop: f.prop, op: f.op as FilterOp } : { prop: f.prop, op: f.op as FilterOp, value: f.value });
          else warnings.push(`Vista «${v.name}»: filtro inválido`);
        }
        for (const s of Array.isArray(raw.sort) ? raw.sort : []) {
          if (isObj(s) && typeof s.prop === "string" && s.prop && (s.dir === "asc" || s.dir === "desc")) v.sort.push({ prop: s.prop, dir: s.dir });
          else warnings.push(`Vista «${v.name}»: orden inválido`);
        }
        views.push(v);
      }
    }
  }
  if (views.length === 0) views.push({ name: "Tabla", kind: "table", columns: [], filter: [], sort: [], group: null });

  return { path: note.path, title: note.title, source, properties, views, warnings };
}

const fold = (s: string): string => s.normalize("NFC").toLowerCase();
function folderKey(x: string): string {
  const k = fold(x.trim()).replace(/^(\.?\/)+/, "");
  return k && !k.endsWith("/") ? `${k}/` : k;
}

function rowTags(row: DbRow): string[] {
  const fmTags = Array.isArray(row.fm.tags) ? row.fm.tags.filter((t): t is string => typeof t === "string") : [];
  return [...new Set([...row.tags, ...fmTags].map((t) => fold(t.replace(/^#/, ""))))];
}

/** ¿Es esta nota una fila de la base? Una base sin origen definido no tiene filas, y nunca es fila de sí misma. */
export function matchesSource(def: DatabaseDef, row: DbRow): boolean {
  const s = def.source;
  if (s.folder === null && s.type === null && s.tags.length === 0) return false;
  if (row.path === def.path) return false;
  if (s.folder !== null && !fold(row.path).startsWith(folderKey(s.folder))) return false;
  if (s.type !== null && row.type !== s.type) return false;
  if (s.type === null && row.type === "database") return false;
  if (s.tags.length) {
    const have = rowTags(row);
    if (!s.tags.every((t) => have.includes(fold(t.replace(/^#/, ""))))) return false;
  }
  return true;
}

export function cellValue(row: DbRow, prop: string): unknown {
  switch (prop) {
    case "title": return row.title;
    case "path": return row.path;
    case "type": return row.type;
    case "mtime": return row.mtime;
    case "tags": return rowTags(row);
    default: return norm(row.fm[prop]);
  }
}

/** Tipo de una propiedad: el del esquema si lo declara; si no, el del primer valor no vacío que aparezca. */
export function propType(def: DatabaseDef, key: string, rows: DbRow[]): PropType {
  if (key === "title" || key === "path" || key === "type") return "text";
  if (key === "tags") return "multi";
  if (key === "mtime") return "number";
  const declared = def.properties[key]?.type;
  if (declared) return declared;
  for (const r of rows) {
    const v = cellValue(r, key);
    if (!isEmptyValue(v)) return inferType(v);
  }
  return "text";
}

const sameText = (a: unknown, b: unknown): boolean => fold(String(a)) === fold(String(b));

function matchIs(v: unknown, x: unknown): boolean {
  if (Array.isArray(v)) return v.some((el) => matchIs(el, x));
  if (isEmptyValue(v)) return false;
  if (typeof v === "number") return Number(x) === v;
  if (typeof v === "boolean") return sameText(v, x);
  return sameText(v, x);
}

function ordered(v: unknown, x: unknown): number | null {
  if (isEmptyValue(v) || isEmptyValue(x)) return null;
  const num = (y: unknown): number => (typeof y === "number" ? y : typeof y === "string" && y.trim() !== "" ? Number(y) : NaN);
  const a = num(v), b = num(x);
  if (!Number.isNaN(a) && !Number.isNaN(b)) return a - b;
  return String(v) < String(x) ? -1 : String(v) > String(x) ? 1 : 0;
}

function passes(row: DbRow, f: Filter): boolean {
  const v = cellValue(row, f.prop);
  switch (f.op) {
    case "is": return matchIs(v, f.value);
    case "is_not": return !matchIs(v, f.value);
    case "contains": return Array.isArray(v) ? v.some((el) => fold(String(el)).includes(fold(String(f.value ?? "")))) : !isEmptyValue(v) && fold(String(v)).includes(fold(String(f.value ?? "")));
    case "empty": return isEmptyValue(v);
    case "not_empty": return !isEmptyValue(v);
    case "gt": case "after": { const c = ordered(v, f.value); return c !== null && c > 0; }
    case "lt": case "before": { const c = ordered(v, f.value); return c !== null && c < 0; }
    case "checked": return v === true || (typeof v === "string" && fold(v) === "true");
  }
}

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  const text = (x: unknown) => (Array.isArray(x) ? x.join(", ") : String(x));
  return collator.compare(text(a), text(b));
}

const SYSTEM_KEYS = new Set(["id", "type", "created", "title", "tags", "parked"]);

/** Todas las propiedades que una vista puede usar: título, las del esquema, las que aparecen en las filas y las etiquetas. */
export function availableColumns(def: DatabaseDef, rows: DbRow[]): Column[] {
  const keys = ["title", ...Object.keys(def.properties).filter((k) => !SYSTEM_KEYS.has(k))];
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.fm)) {
      if (SYSTEM_KEYS.has(k) || keys.includes(k) || (typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date))) continue;
      keys.push(k);
    }
  }
  keys.push("tags");
  return keys.map((key) => {
    const col: Column = { key, type: propType(def, key, rows) };
    const options = def.properties[key]?.options;
    if (options) col.options = options;
    return col;
  });
}

/** Aplica filtros, orden y agrupación de una vista a las filas (que ya cumplen el origen de la base). */
export function queryRows(def: DatabaseDef, view: View, rows: DbRow[]): QueryResult {
  const kept = rows.filter((r) => view.filter.every((f) => passes(r, f)));

  // Orden estable multi-clave; los valores vacíos van siempre al final, sea cual sea la dirección.
  const sorted = view.sort.length
    ? kept.map((r, i) => ({ r, i })).sort((x, y) => {
        for (const s of view.sort) {
          const a = cellValue(x.r, s.prop), b = cellValue(y.r, s.prop);
          const ea = isEmptyValue(a), eb = isEmptyValue(b);
          if (ea || eb) { if (ea && eb) continue; return ea ? 1 : -1; }
          const c = compareValues(a, b);
          if (c !== 0) return s.dir === "asc" ? c : -c;
        }
        return x.i - y.i;
      }).map((x) => x.r)
    : kept;

  const keys = view.columns.length ? view.columns : ["title", ...Object.keys(def.properties)];
  const columns: Column[] = keys.map((key) => {
    const col: Column = { key, type: propType(def, key, rows) };
    const options = def.properties[key]?.options;
    if (options) col.options = options;
    return col;
  });

  const toResult = (r: DbRow): ResultRow => ({ path: r.path, title: r.title, cells: Object.fromEntries(keys.map((k) => [k, cellValue(r, k) ?? null])) });
  const result = sorted.map(toResult);

  let groups: QueryResult["groups"] = null;
  if (view.group) {
    const byKey = new Map<string, ResultRow[]>();
    sorted.forEach((r, i) => {
      const v = cellValue(r, view.group!);
      const gk = isEmptyValue(v) ? [""] : Array.isArray(v) ? v.map(String) : [String(v)];
      for (const k of gk) byKey.set(k, [...(byKey.get(k) ?? []), result[i]]);
    });
    const options = def.properties[view.group]?.options ?? [];
    const ordKeys = [
      ...options.filter((o) => byKey.has(o)),
      ...[...byKey.keys()].filter((k) => k !== "" && !options.includes(k)),
      ...(byKey.has("") ? [""] : []),
    ];
    groups = ordKeys.map((key) => ({ key, rows: byKey.get(key)! }));
  }

  return { columns, rows: result, groups, total: kept.length };
}
