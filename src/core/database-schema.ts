// Planificador de cambios de esquema de una base: dado el frontmatter de la base (`properties`, `views`) y sus filas,
// calcula el esquema/las vistas resultantes y las ediciones que hay que hacer en las notas. Es puro: no toca disco ni
// el índice. Quien lo llama (Kioku) valida y aplica el plan; aquí solo se decide qué cambia.
import { OPTION_COLORS, PROP_TYPES, cellValue, isEmptyValue, parseDatabase, propType, serializeOptions, type DbRow, type OptionColor, type PropOption, type PropType } from "./database.ts";

export type SchemaOp =
  | { op: "add-property"; name: string; type: PropType }
  | { op: "rename-property"; name: string; to: string }
  | { op: "set-type"; name: string; type: PropType }
  | { op: "delete-property"; name: string }
  | { op: "add-option"; prop: string; option: string; color?: OptionColor }
  | { op: "rename-option"; prop: string; option: string; to: string }
  | { op: "set-option-color"; prop: string; option: string; color: OptionColor | null }
  | { op: "reorder-options"; prop: string; options: string[] }
  | { op: "delete-option"; prop: string; option: string; clear?: boolean };

export type RowEdit =
  | { path: string; kind: "rename-key"; from: string; to: string }
  | { path: string; kind: "delete-key"; key: string }
  | { path: string; kind: "set-value"; key: string; value: unknown }; // null = quitar la clave

export interface SchemaPlan {
  /** Nuevo valor de `properties` (forma tal como se guarda en el frontmatter). */
  properties: Record<string, unknown>;
  /** Nuevo valor de `views`; `undefined` = sin cambios. */
  views: unknown[] | undefined;
  rowEdits: RowEdit[];
  /** Frase corta en español para el aviso con «Deshacer». */
  summary: string;
}

export class SchemaError extends Error {}

/** Claves que una propiedad no puede usar como nombre (sistema de Kioku, columnas fijas y claves de la propia base). */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "id", "type", "created", "title", "tags", "parked", "path", "mtime", "source", "properties", "views",
]);

const MAX_SEEDED_OPTIONS = 50;
const TYPE_LABEL: Record<PropType, string> = {
  text: "texto", number: "número", date: "fecha", checkbox: "casilla", select: "selección",
  multi: "multiselección", url: "enlace", relation: "relación",
};

const COLOR_LABEL: Record<OptionColor, string> = {
  gray: "gris", brown: "marrón", orange: "naranja", yellow: "amarillo", green: "verde", blue: "azul", purple: "morado", red: "rojo",
};

const fold = (s: string): string => s.normalize("NFC").toLowerCase();
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hasKey = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const notas = (n: number): string => `${n} ${n === 1 ? "nota" : "notas"}`;
const afectadas = (n: number): string => (n > 0 ? ` (${notas(n)})` : "");

/** Nombre válido para una propiedad nueva: recortado, no vacío, sin saltos de línea ni marcadores YAML, no reservado. */
function validName(input: string): string {
  const name = typeof input === "string" ? input.trim() : "";
  if (!name) throw new SchemaError("El nombre de la propiedad no puede estar vacío");
  if (/[\r\n\u0085\u2028\u2029]/.test(name)) throw new SchemaError("El nombre de la propiedad no puede contener saltos de línea");
  if (name === "---" || name === "...") throw new SchemaError(`«${name}» no es un nombre válido para una propiedad`);
  if (RESERVED_NAMES.has(fold(name))) throw new SchemaError(`«${name}» es un nombre reservado`);
  return name;
}

function schemaProperties(raw: { properties?: unknown }): Record<string, unknown> {
  if (raw.properties === undefined || raw.properties === null) return {};
  if (!isObj(raw.properties)) throw new SchemaError("«properties» de la base no es un objeto");
  return structuredClone(raw.properties);
}

function schemaViews(raw: { views?: unknown }): unknown[] | undefined {
  return Array.isArray(raw.views) ? structuredClone(raw.views) : undefined;
}

/** Todas las claves en uso: las del esquema y las de los frontmatter de las filas. */
function usedKeys(properties: Record<string, unknown>, rows: DbRow[]): Set<string> {
  const keys = new Set(Object.keys(properties));
  for (const r of rows) for (const k of Object.keys(r.fm ?? {})) keys.add(k);
  return keys;
}

/** La propiedad existe (con entrada en el esquema o solo inferida de las filas) y no es una columna de sistema. */
function existing(name: string, properties: Record<string, unknown>, rows: DbRow[]): void {
  if (RESERVED_NAMES.has(fold(name))) throw new SchemaError(`«${name}» es una columna de sistema y no se puede modificar`);
  if (!usedKeys(properties, rows).has(name)) throw new SchemaError(`La propiedad «${name}» no existe`);
}

function assertFree(name: string, keys: Set<string>, except?: string): void {
  for (const k of keys) {
    if (k !== except && fold(k) === fold(name)) throw new SchemaError(`Ya existe una propiedad llamada «${k}»`);
  }
}

function validType(type: unknown): PropType {
  if (!PROP_TYPES.includes(type as PropType)) throw new SchemaError(`Tipo de propiedad desconocido: ${String(type)}`);
  return type as PropType;
}

/** Cambia el nombre `from` por `to` conservando la posición de la clave. */
function renameKey(o: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]));
}

/** Pone la entrada `name` conservando su posición si ya existe; si no, la añade al final. */
function setEntry(properties: Record<string, unknown>, name: string, entry: unknown): Record<string, unknown> {
  return hasKey(properties, name)
    ? Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, k === name ? entry : v]))
    : Object.fromEntries([...Object.entries(properties), [name, entry]]);
}

/** Aplica `fn` a cada vista objeto (las que no lo son se dejan tal cual); devuelve si alguna cambió. */
function mapViews(views: unknown[] | undefined, fn: (view: Record<string, unknown>) => boolean): boolean {
  let changed = false;
  for (const v of views ?? []) if (isObj(v) && fn(v)) changed = true;
  return changed;
}

function renameInViews(views: unknown[] | undefined, from: string, to: string): boolean {
  return mapViews(views, (view) => {
    let changed = false;
    if (Array.isArray(view.columns) && view.columns.includes(from)) { view.columns = view.columns.map((c) => (c === from ? to : c)); changed = true; }
    for (const list of [view.filter, view.sort]) {
      if (!Array.isArray(list)) continue;
      for (const item of list) if (isObj(item) && item.prop === from) { item.prop = to; changed = true; }
    }
    if (view.group === from) { view.group = to; changed = true; }
    return changed;
  });
}

function removeFromViews(views: unknown[] | undefined, name: string): boolean {
  return mapViews(views, (view) => {
    let changed = false;
    if (Array.isArray(view.columns) && view.columns.includes(name)) { view.columns = view.columns.filter((c) => c !== name); changed = true; }
    for (const field of ["filter", "sort"] as const) {
      const list = view[field];
      if (Array.isArray(list) && list.some((i) => isObj(i) && i.prop === name)) { view[field] = list.filter((i) => !(isObj(i) && i.prop === name)); changed = true; }
    }
    if (view.group === name) { view.group = null; changed = true; }
    return changed;
  });
}

/** Valores distintos presentes en las filas (arrays aplanados, sin repetir ignorando mayúsculas), como opciones sin color. */
function seedOptions(name: string, rows: DbRow[]): PropOption[] {
  const seen = new Set<string>();
  const out: PropOption[] = [];
  for (const r of rows) {
    const v = cellValue(r, name);
    for (const el of Array.isArray(v) ? v : [v]) {
      if (isEmptyValue(el) || typeof el === "object") continue;
      const text = String(el).trim();
      if (!text || seen.has(fold(text))) continue;
      seen.add(fold(text));
      out.push({ name: text });
      if (out.length >= MAX_SEEDED_OPTIONS) return out;
    }
  }
  return out;
}

/** Opción nueva o a renombrar: recortada y no vacía. */
function validOption(input: unknown): string {
  const name = typeof input === "string" ? input.trim() : "";
  if (!name) throw new SchemaError("El nombre de la opción no puede estar vacío");
  return name;
}

function validColor(color: unknown): OptionColor {
  if (!OPTION_COLORS.includes(color as OptionColor)) throw new SchemaError(`Color desconocido: ${String(color)}`);
  return color as OptionColor;
}

interface OptionTarget { properties: Record<string, unknown>; type: PropType; options: PropOption[] }

/** La propiedad `prop` y sus opciones actuales; solo las de tipo select o multi (el efectivo, declarado o inferido) tienen opciones. */
function optionTarget(raw: { properties?: unknown }, rows: DbRow[], prop: string): OptionTarget {
  const properties = schemaProperties(raw);
  existing(prop, properties, rows);
  const def = parseDatabase({ path: "", title: "", fm: { properties } });
  const type = propType(def, prop, rows);
  if (type !== "select" && type !== "multi") throw new SchemaError(`«${prop}» es de tipo ${TYPE_LABEL[type]} y no admite opciones`);
  return { properties, type, options: def.properties[prop]?.options ?? [] };
}

function optionIndex(options: PropOption[], prop: string, name: string): number {
  const i = options.findIndex((o) => fold(o.name) === fold(name));
  if (i < 0) throw new SchemaError(`La opción «${name}» no existe en «${prop}»`);
  return i;
}

/** Guarda `options` en la entrada de `prop` (la crea con su tipo si no existía); sin opciones, quita la clave. */
function withOptions(t: OptionTarget, prop: string, options: PropOption[]): Record<string, unknown> {
  const current = hasKey(t.properties, prop) ? t.properties[prop] : undefined;
  const entry: Record<string, unknown> = isObj(current) ? current : { type: t.type };
  if (options.length) entry.options = serializeOptions(options);
  else delete entry.options;
  return setEntry(t.properties, prop, entry);
}

/**
 * Ediciones de fila (`set-value`) para las notas cuyo valor de `prop` es la opción `option`, sea escalar o elemento de lista:
 * `replacement` la sustituye (conservando el orden) y `null` la quita (la clave desaparece si queda sin valor).
 * Los valores se comparan sin distinguir mayúsculas; si el valor resultante es idéntico al actual no se genera edición.
 */
function optionRowEdits(rows: DbRow[], prop: string, option: string, replacement: string | null): RowEdit[] {
  const is = (v: unknown): boolean => typeof v === "string" && fold(v) === fold(option);
  const edits: RowEdit[] = [];
  for (const r of rows) {
    if (!hasKey(r.fm ?? {}, prop)) continue;
    const v = cellValue(r, prop);
    let value: unknown;
    if (Array.isArray(v)) {
      if (!v.some(is)) continue;
      const items = replacement === null ? v.filter((el) => !is(el)) : v.map((el) => (is(el) ? replacement : el));
      value = items.length ? items : null;
    } else if (is(v)) value = replacement;
    else continue;
    if (JSON.stringify(value) !== JSON.stringify(v)) edits.push({ path: r.path, kind: "set-value", key: prop, value });
  }
  return edits;
}

/** Cambia el valor de los filtros is / is_not / contains de `prop` que apuntaban a la opción `from`. */
function renameOptionInFilters(views: unknown[] | undefined, prop: string, from: string, to: string): boolean {
  return mapViews(views, (view) => {
    let changed = false;
    if (!Array.isArray(view.filter)) return false;
    for (const f of view.filter) {
      if (isObj(f) && f.prop === prop && (f.op === "is" || f.op === "is_not" || f.op === "contains") && typeof f.value === "string" && fold(f.value) === fold(from)) {
        f.value = to;
        changed = true;
      }
    }
    return changed;
  });
}

export function planSchemaOp(raw: { properties?: unknown; views?: unknown }, rows: DbRow[], op: SchemaOp): SchemaPlan {
  switch (op.op) {
    case "add-property": {
      const properties = schemaProperties(raw);
      const name = validName(op.name);
      const type = validType(op.type);
      assertFree(name, usedKeys(properties, rows));
      return {
        properties: Object.fromEntries([...Object.entries(properties), [name, { type }]]),
        views: undefined,
        rowEdits: [],
        summary: `Añadida «${name}» (${TYPE_LABEL[type]})`,
      };
    }

    case "rename-property": {
      const properties = schemaProperties(raw);
      existing(op.name, properties, rows);
      const to = validName(op.to);
      if (to === op.name) throw new SchemaError("El nombre nuevo es igual al actual");
      // Cambiar solo la capitalización de sí misma es válido; chocar con cualquier otra clave no.
      assertFree(to, usedKeys(properties, rows), op.name);
      const views = schemaViews(raw);
      const viewsChanged = renameInViews(views, op.name, to);
      const rowEdits: RowEdit[] = rows
        .filter((r) => hasKey(r.fm ?? {}, op.name))
        .map((r) => ({ path: r.path, kind: "rename-key", from: op.name, to }));
      return {
        properties: renameKey(properties, op.name, to),
        views: viewsChanged ? views : undefined,
        rowEdits,
        summary: `Renombrada «${op.name}» → «${to}»${afectadas(rowEdits.length)}`,
      };
    }

    case "set-type": {
      const properties = schemaProperties(raw);
      existing(op.name, properties, rows);
      const type = validType(op.type);
      const current = properties[op.name];
      const entry: Record<string, unknown> = isObj(current) ? current : {};
      entry.type = type;
      if (type === "select" || type === "multi") {
        // Las opciones que ya hay (con sus colores) se conservan; si no hay, se siembran con lo que usan las filas.
        const has = Array.isArray(entry.options) && entry.options.length > 0;
        if (!has) {
          const seeded = seedOptions(op.name, rows);
          if (seeded.length) entry.options = serializeOptions(seeded);
          else delete entry.options;
        }
      } else {
        delete entry.options;
      }
      return {
        properties: setEntry(properties, op.name, entry),
        views: undefined,
        rowEdits: [],
        summary: `«${op.name}» ahora es de tipo ${TYPE_LABEL[type]}`,
      };
    }

    case "delete-property": {
      const properties = schemaProperties(raw);
      existing(op.name, properties, rows);
      const views = schemaViews(raw);
      const viewsChanged = removeFromViews(views, op.name);
      const rowEdits: RowEdit[] = rows
        .filter((r) => hasKey(r.fm ?? {}, op.name))
        .map((r) => ({ path: r.path, kind: "delete-key", key: op.name }));
      return {
        properties: Object.fromEntries(Object.entries(properties).filter(([k]) => k !== op.name)),
        views: viewsChanged ? views : undefined,
        rowEdits,
        summary: `Eliminada «${op.name}»${afectadas(rowEdits.length)}`,
      };
    }

    case "add-option": {
      const t = optionTarget(raw, rows, op.prop);
      const name = validOption(op.option);
      if (t.options.some((o) => fold(o.name) === fold(name))) throw new SchemaError(`Ya existe la opción «${name}» en «${op.prop}»`);
      const color = op.color === undefined || op.color === null ? undefined : validColor(op.color);
      return {
        properties: withOptions(t, op.prop, [...t.options, color ? { name, color } : { name }]),
        views: undefined,
        rowEdits: [],
        summary: `Añadida la opción «${name}» a «${op.prop}»`,
      };
    }

    case "rename-option": {
      const t = optionTarget(raw, rows, op.prop);
      const i = optionIndex(t.options, op.prop, op.option);
      const old = t.options[i].name;
      const to = validOption(op.to);
      if (to === old) throw new SchemaError("El nombre nuevo es igual al actual");
      // Cambiar solo la capitalización de sí misma es válido; chocar con otra opción no.
      if (t.options.some((o, j) => j !== i && fold(o.name) === fold(to))) throw new SchemaError(`Ya existe la opción «${to}» en «${op.prop}»`);
      const options = t.options.map((o, j) => (j === i ? { ...o, name: to } : o));
      const views = schemaViews(raw);
      const viewsChanged = renameOptionInFilters(views, op.prop, old, to);
      const rowEdits = optionRowEdits(rows, op.prop, old, to);
      return {
        properties: withOptions(t, op.prop, options),
        views: viewsChanged ? views : undefined,
        rowEdits,
        summary: `Renombrada la opción «${old}» → «${to}»${afectadas(rowEdits.length)}`,
      };
    }

    case "set-option-color": {
      const t = optionTarget(raw, rows, op.prop);
      const i = optionIndex(t.options, op.prop, op.option);
      const color = op.color === null ? null : validColor(op.color);
      const { name } = t.options[i];
      return {
        properties: withOptions(t, op.prop, t.options.map((o, j) => (j === i ? (color ? { name, color } : { name }) : o))),
        views: undefined,
        rowEdits: [],
        summary: color ? `Color de la opción «${name}»: ${COLOR_LABEL[color]}` : `Quitado el color de la opción «${name}»`,
      };
    }

    case "reorder-options": {
      const t = optionTarget(raw, rows, op.prop);
      const wanted = Array.isArray(op.options) ? op.options : [];
      const used = new Set<number>();
      const ordered = wanted.map((n) => {
        const i = t.options.findIndex((o) => typeof n === "string" && fold(o.name) === fold(n));
        if (i < 0) throw new SchemaError(`La opción «${String(n)}» no existe en «${op.prop}»`);
        if (used.has(i)) throw new SchemaError(`La opción «${t.options[i].name}» está repetida`);
        used.add(i);
        return t.options[i];
      });
      if (ordered.length !== t.options.length) throw new SchemaError("El nuevo orden debe incluir todas las opciones, sin añadir ni quitar ninguna");
      return {
        properties: withOptions(t, op.prop, ordered),
        views: undefined,
        rowEdits: [],
        summary: `Reordenadas las opciones de «${op.prop}»`,
      };
    }

    case "delete-option": {
      const t = optionTarget(raw, rows, op.prop);
      const i = optionIndex(t.options, op.prop, op.option);
      const { name } = t.options[i];
      const rowEdits = op.clear ? optionRowEdits(rows, op.prop, name, null) : [];
      return {
        properties: withOptions(t, op.prop, t.options.filter((_, j) => j !== i)),
        views: undefined,
        rowEdits,
        summary: `Eliminada la opción «${name}» de «${op.prop}»${afectadas(rowEdits.length)}`,
      };
    }

    default: {
      const unknownOp: never = op;
      throw new SchemaError(`Operación desconocida: ${String((unknownOp as { op?: unknown }).op)}`);
    }
  }
}
