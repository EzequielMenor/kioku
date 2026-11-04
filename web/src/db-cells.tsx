// Celda de una base: muestra y edita una propiedad de la fila según el tipo de su columna.
import { relationValue, safeHref } from "./cell-values.ts";
import { enc, label, READONLY, text } from "./db-common.ts";
import type { Column, ResultRow } from "./types.ts";

/* ───────────────────────── celdas ───────────────────────── */

export function Cell({ col, row, setCell }: { col: Column; row: ResultRow; setCell(r: ResultRow, k: string, v: unknown): void }) {
  const v = row.cells[col.key];
  const aria = `${label(col.key)} de «${row.title}»`;
  if (col.key === "title") return <a href={`#/nota/${enc(row.path)}`}>{row.title}</a>;
  if (col.key === "tags") return <>{(Array.isArray(v) ? v : []).map((t) => <span class="chip" key={String(t)}>#{String(t)}</span>)}</>;
  if (col.key === "mtime") return <span class="muted">{typeof v === "number" ? new Date(v).toLocaleDateString("es") : ""}</span>;
  if (READONLY.has(col.key)) return <span class="muted">{text(v)}</span>;
  switch (col.type) {
    case "checkbox":
      return <input type="checkbox" checked={v === true} aria-label={aria} onChange={(e) => setCell(row, col.key, e.currentTarget.checked)} />;
    case "select": {
      const options = col.options ?? [];
      const cur = text(v);
      return (
        <select class="cell-select" value={cur} aria-label={aria} onChange={(e) => setCell(row, col.key, e.currentTarget.value)}>
          <option value="">—</option>
          {cur && !options.some((o) => o.name === cur) && <option value={cur}>{cur}</option>}
          {options.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
        </select>
      );
    }
    case "number":
      return <input class="cell-input num" type="number" defaultValue={text(v)} key={text(v)} aria-label={aria}
        onChange={(e) => setCell(row, col.key, e.currentTarget.value === "" ? "" : Number(e.currentTarget.value))} />;
    case "date":
      return <input class="cell-input" type="date" defaultValue={text(v).slice(0, 10)} key={text(v)} aria-label={aria}
        onChange={(e) => setCell(row, col.key, e.currentTarget.value)} />;
    case "multi":
      return <input class="cell-input" defaultValue={text(v)} key={text(v)} placeholder="a, b, c" aria-label={aria}
        onBlur={(e) => { const next = e.currentTarget.value.split(",").map((s) => s.trim()).filter(Boolean); if (next.join(", ") !== text(v)) setCell(row, col.key, next); }} />;
    case "relation":
      return <input class="cell-input" defaultValue={text(v)} key={text(v)} placeholder="[[Nota]], [[Otra]]" aria-label={aria}
        onBlur={(e) => { if (e.currentTarget.value !== text(v)) setCell(row, col.key, relationValue(e.currentTarget.value, v)); }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
    default:
      return (
        <span class="cell-text">
          <input class="cell-input" defaultValue={text(v)} key={text(v)} aria-label={aria}
            onBlur={(e) => { if (e.currentTarget.value !== text(v)) setCell(row, col.key, e.currentTarget.value); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          {col.type === "url" && safeHref(text(v)) && <a href={safeHref(text(v))!} target="_blank" rel="noreferrer noopener" aria-label="Abrir enlace">↗</a>}
        </span>
      );
  }
}
