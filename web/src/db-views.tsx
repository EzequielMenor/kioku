// Vistas de una base sobre el resultado ya consultado: tabla (con orden y grupos), lista y tablero (arrastrar tarjetas entre columnas).
import { useState } from "preact/hooks";
import { laneValue } from "./cell-values.ts";
import { Cell } from "./db-cells.tsx";
import { enc, label, READONLY, text } from "./db-common.ts";
import type { Result } from "./db-common.ts";
import type { Column, ResultRow, View } from "./types.ts";

/* ───────────────────────── vistas ───────────────────────── */

type SetCell = (r: ResultRow, k: string, v: unknown) => void;

export function Table({ res, view, sortBy, setCell }: { res: Result; view: View; sortBy(k: string): void; setCell: SetCell }) {
  const cur = view.sort[0];
  const rowsOf = res.groups ?? [{ key: "", rows: res.rows }];
  return (
    <div class="dbtable">
      <table>
        <thead>
          <tr>{res.columns.map((c) => (
            <th key={c.key} aria-sort={cur?.prop === c.key ? (cur.dir === "asc" ? "ascending" : "descending") : "none"}>
              <button class="th" onClick={() => sortBy(c.key)}>{label(c.key)}{cur?.prop === c.key && <span class="muted">{cur.dir === "asc" ? " ↑" : " ↓"}</span>}</button>
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {rowsOf.map((g) => (
            <>
              {res.groups && <tr class="grouprow" key={`g:${g.key}`}><td colSpan={res.columns.length}>{g.key || "Sin valor"} <span class="muted">{g.rows.length}</span></td></tr>}
              {g.rows.map((r) => <tr key={`${g.key}:${r.path}`}>{res.columns.map((c) => <td key={c.key}><Cell col={c} row={r} setCell={setCell} /></td>)}</tr>)}
            </>
          ))}
        </tbody>
      </table>
      {res.rows.length === 0 && <div class="empty">Nada que mostrar con esta vista.</div>}
    </div>
  );
}

export function List({ res }: { res: Result }) {
  const rest = res.columns.filter((c) => c.key !== "title");
  return (
    <ul class="dblist">
      {res.rows.map((r) => (
        <li key={r.path}>
          <a href={`#/nota/${enc(r.path)}`}>{r.title}</a>
          {rest.map((c) => {
            const v = r.cells[c.key];
            if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return null;
            return <span key={c.key} class="chip" title={label(c.key)}>{c.type === "checkbox" ? (v ? `✓ ${label(c.key)}` : "") : text(v)}</span>;
          })}
        </li>
      ))}
      {res.rows.length === 0 && <div class="empty">Nada que mostrar con esta vista.</div>}
    </ul>
  );
}

export function Board({ res, view, available, edit, setCell }: { res: Result; view: View; available: Column[]; edit(p: Partial<View>): void; setCell: SetCell }) {
  const [over, setOver] = useState<string | null>(null);
  const group = view.group;
  if (!group) {
    const candidates = available.filter((c) => c.type === "select");
    return (
      <div class="empty">
        Elige la propiedad por la que agrupar el tablero.
        <div class="row" style="justify-content:center">
          <select value="" onChange={(e) => e.currentTarget.value && edit({ group: e.currentTarget.value })} aria-label="Agrupar por">
            <option value="">Agrupar por…</option>
            {(candidates.length ? candidates : available).map((c) => <option key={c.key} value={c.key}>{label(c.key)}</option>)}
          </select>
        </div>
      </div>
    );
  }
  const col = available.find((c) => c.key === group);
  const byKey = new Map((res.groups ?? []).map((g) => [g.key, g.rows]));
  // Columnas del tablero: todas las opciones del esquema (aunque estén vacías), luego otros valores presentes y «Sin valor».
  const optionNames = (col?.options ?? []).map((o) => o.name);
  const lanes = [...optionNames, ...[...byKey.keys()].filter((k) => k !== "" && !optionNames.includes(k)), ""];
  const movable = !READONLY.has(group) && col?.type !== "multi";
  const drop = (lane: string, e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const path = e.dataTransfer?.getData("text/plain");
    const row = res.rows.find((r) => r.path === path);
    if (row && movable && String(row.cells[group] ?? "") !== lane) setCell(row, group, laneValue(col?.type, lane));
  };
  const rest = res.columns.filter((c) => c.key !== "title" && c.key !== group);
  return (
    <div class="board" style={`grid-template-columns: repeat(${Math.max(1, lanes.length)}, minmax(210px, 1fr))`}>
      {lanes.map((lane) => {
        const items = byKey.get(lane) ?? [];
        if (lane === "" && items.length === 0) return null;
        return (
          <section key={lane} class={`col ${over === lane ? "over" : ""}`} aria-label={lane || "Sin valor"}
            onDragOver={(e) => { e.preventDefault(); setOver(lane); }} onDragLeave={() => setOver((o) => (o === lane ? null : o))} onDrop={(e) => drop(lane, e)}>
            <h2 class="sec">{lane || "Sin valor"} <span class="muted">{items.length}</span></h2>
            {items.map((r) => (
              <article key={r.path} class="kcard" draggable={movable} onDragStart={(e) => e.dataTransfer?.setData("text/plain", r.path)}>
                <a href={`#/nota/${enc(r.path)}`}>{r.title}</a>
                <div class="meta">
                  {rest.map((c) => {
                    const v = r.cells[c.key];
                    return v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) ? null : <span class="chip" key={c.key} title={label(c.key)}>{text(v)}</span>;
                  })}
                  {movable && (
                    <select class="cell-select kmove" value={lane} aria-label={`Mover «${r.title}»`} onChange={(e) => setCell(r, group, laneValue(col?.type, e.currentTarget.value))}>
                      {lanes.filter((l) => l !== "" || lane === "").map((l) => <option key={l} value={l}>{l || "Sin valor"}</option>)}
                    </select>
                  )}
                </div>
              </article>
            ))}
            {items.length === 0 && <div class="kempty muted small">{movable ? "Arrastra filas aquí" : "Vacío"}</div>}
          </section>
        );
      })}
    </div>
  );
}
