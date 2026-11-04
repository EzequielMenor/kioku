// Utilidades y tipos compartidos por las piezas de las bases: databases.tsx, db-cells.tsx, db-views.tsx y db-panel.tsx. Sin JSX.
import type { Column, PropType, QueryResult, View } from "./types.ts";

interface Meta { path: string; title: string; views: View[]; warnings: string[]; available: Column[] }
export type Result = QueryResult & { database: Meta };

export const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

const LABEL: Record<string, string> = { title: "Nombre", tags: "Etiquetas", path: "Ruta", type: "Tipo", mtime: "Modificada" };
export const label = (k: string) => LABEL[k] ?? k;
export const READONLY = new Set(["title", "path", "type", "mtime", "tags"]);
/** Espejo de `RESERVED_NAMES` del servidor (test/db-common.test.ts comprueba que coinciden): claves que ninguna propiedad puede renombrar, cambiar de tipo ni borrar. */
const RESERVED = new Set(["id", "type", "created", "title", "tags", "parked", "path", "mtime", "source", "properties", "views"]);
/** Columna de sistema para el menú de cabecera: el servidor compara sin distinguir mayúsculas, así que «Type» o «Tags» (de Obsidian) también lo son. */
export const isSystemKey = (k: string): boolean => READONLY.has(k) || RESERVED.has(k.normalize("NFC").toLowerCase());

export const text = (v: unknown): string => (v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v));

export const PROP_TYPE_LABEL: Record<PropType, string> = {
  text: "Texto", number: "Número", date: "Fecha", checkbox: "Casilla", select: "Selección", multi: "Multiselección", url: "Enlace", relation: "Relación",
};
export const PROP_TYPE_ORDER: PropType[] = ["text", "number", "date", "checkbox", "select", "multi", "url", "relation"];
