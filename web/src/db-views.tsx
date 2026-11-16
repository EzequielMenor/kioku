// Vistas de una base sobre el resultado ya consultado: tabla (con orden y grupos), lista y tablero (arrastrar tarjetas entre columnas).
import { useEffect, useRef, useState } from "preact/hooks";
import { laneValue } from "./cell-values.ts";
import { AddPropertyButton } from "./db-add-property.tsx";
import { Cell } from "./db-cells.tsx";
import { enc, label, READONLY } from "./db-common.ts";
import { HeaderMenu } from "./db-header-menu.tsx";
import type { HeaderMenuCtx } from "./db-header-menu.tsx";
import type { Result } from "./db-common.ts";
import { editSchema } from "./db-schema.ts";
import { optionClass } from "./option-colors.ts";
import type { Column, ResultRow, View } from "./types.ts";

/* ───────────────────────── vistas ───────────────────────── */

type SetCell = (r: ResultRow, k: string, v: unknown) => void;
export type AddRowFn = (title: string, extraProps?: Record<string, unknown>) => Promise<boolean>;

function isEmptyCell(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Alta rápida inline tipo Notion (reutilizada en pie de tabla, lista y columnas del tablero). */
function InlineAddRow({ label: btnLabel, placeholder, ariaLabel, onAdd }: {
  label: string;
  placeholder: string;
  ariaLabel: string;
  onAdd(title: string): Promise<boolean | void>;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);

  if (!editing) {
    return (
      <button type="button" class="inline-row-btn" onClick={() => setEditing(true)}>
        {btnLabel}
      </button>
    );
  }

  const cancel = () => { setEditing(false); setVal(""); };
  const submit = async (e: Event) => {
    e.preventDefault();
    const t = val.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const ok = await onAdd(t);
      if (ok !== false) cancel();
    } finally { setBusy(false); }
  };

  return (
    <form class="inline-row-form" onSubmit={(e) => void submit(e)}>
      <input
        ref={input}
        value={val}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onInput={(e) => setVal(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}
      />
      <button type="submit" class="primary small" disabled={!val.trim() || busy}>Añadir</button>
      <button type="button" class="subtle small" aria-label="Cancelar" onClick={cancel}>×</button>
    </form>
  );
}

/** Celda compacta compartida por tarjetas del Tablero y filas de Lista para editar propiedades sin abrir la nota. */
function CompactPropCell({ col, row, setCell, menu }: { col: Column; row: ResultRow; setCell: SetCell; menu: HeaderMenuCtx | null }) {
  const hasValue = !isEmptyCell(row.cells[col.key]);
  const interactive = col.type === "select" || col.type === "multi" || col.type === "checkbox";
  if (!hasValue && (!interactive || !menu)) return null;
  if (col.type === "checkbox") {
    return (
      <label class="kcheck" title={label(col.key)}>
        <Cell col={col} row={row} setCell={setCell} menu={menu} />
        <span>{label(col.key)}</span>
      </label>
    );
  }
  return <Cell col={col} row={row} setCell={setCell} menu={menu} emptyLabel={interactive ? `+ ${label(col.key)}` : undefined} />;
}

/** `menu` es null en el rol móvil: allí la cabecera solo ordena y la estructura no se edita. */
export function Table({ res, view, sortBy, setCell, menu, addRow }: { res: Result; view: View; sortBy(k: string): void; setCell: SetCell; menu: HeaderMenuCtx | null; addRow?: AddRowFn }) {
  const cur = view.sort[0];
  const keys = res.columns.map((c) => c.key);
  const rowsOf = res.groups ?? [{ key: "", rows: res.rows }];
  return (
    <div class="dbtable">
      <table>
        <thead>
          <tr>{res.columns.map((c) => (
            <th key={c.key} aria-sort={cur?.prop === c.key ? (cur.dir === "asc" ? "ascending" : "descending") : "none"}>
              {menu
                ? <HeaderMenu col={c} view={view} keys={keys} ctx={menu} />
                : <button class="th" onClick={() => sortBy(c.key)}>{label(c.key)}{cur?.prop === c.key && <span class="muted">{cur.dir === "asc" ? " ↑" : " ↓"}</span>}</button>}
            </th>
          ))}{menu && <th class="addcol"><AddPropertyButton ctx={menu} /></th>}</tr>
        </thead>
        <tbody>
          {rowsOf.map((g) => (
            <>
              {res.groups && <tr class="grouprow" key={`g:${g.key}`}><td colSpan={res.columns.length + (menu ? 1 : 0)}>{g.key || "Sin valor"} <span class="muted">{g.rows.length}</span></td></tr>}
              {g.rows.map((r) => <tr key={`${g.key}:${r.path}`}>{res.columns.map((c) => <td key={c.key}><Cell col={c} row={r} setCell={setCell} menu={menu} /></td>)}{menu && <td />}</tr>)}
            </>
          ))}
        </tbody>
        {menu && addRow && (
          <tfoot>
            <tr class="db-addrow">
              <td colSpan={res.columns.length + 1}>
                <InlineAddRow label="+ Nueva fila" placeholder="Título de la nueva fila…" ariaLabel="Añadir fila en la tabla" onAdd={(t) => addRow(t)} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
      {res.rows.length === 0 && <div class="empty">Nada que mostrar con esta vista.</div>}
    </div>
  );
}

export function List({ res, setCell, menu, addRow }: { res: Result; setCell: SetCell; menu: HeaderMenuCtx | null; addRow?: AddRowFn }) {
  const rest = res.columns.filter((c) => c.key !== "title");
  return (
    <ul class="dblist">
      {res.rows.map((r) => (
        <li key={r.path}>
          <a href={`#/nota/${enc(r.path)}`}>{r.title}</a>
          <div class="dblist-props">
            {rest.map((c) => <CompactPropCell key={c.key} col={c} row={r} setCell={setCell} menu={menu} />)}
          </div>
        </li>
      ))}
      {res.rows.length === 0 && <div class="empty">Nada que mostrar con esta vista.</div>}
      {menu && addRow && (
        <li class="dblist-add">
          <InlineAddRow label="+ Nueva fila" placeholder="Título de la nueva fila…" ariaLabel="Añadir fila en la lista" onAdd={(t) => addRow(t)} />
        </li>
      )}
    </ul>
  );
}

function AddLaneColumn({ group, menu }: { group: string; menu: HeaderMenuCtx }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);

  const cancel = () => { setEditing(false); setName(""); };
  const submit = async (e: Event) => {
    e.preventDefault();
    const opt = name.trim();
    if (!opt || busy) return;
    setBusy(true);
    try {
      if (await editSchema({ op: "add-option", prop: group, option: opt }, menu)) cancel();
    } finally { setBusy(false); }
  };

  return (
    <div class="col col-new">
      {!editing ? (
        <button type="button" class="inline-row-btn" onClick={() => setEditing(true)}>+ Nuevo grupo</button>
      ) : (
        <form class="inline-row-form col-new-form" onSubmit={(e) => void submit(e)}>
          <input
            ref={input}
            value={name}
            placeholder="Nombre del grupo…"
            aria-label="Nombre del nuevo grupo"
            onInput={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}
          />
          <div class="row">
            <button type="submit" class="primary small" disabled={!name.trim() || busy}>Crear</button>
            <button type="button" class="subtle small" onClick={cancel}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function Board({ res, view, available, edit, setCell, menu, addRow }: {
  res: Result; view: View; available: Column[]; edit(p: Partial<View>): void; setCell: SetCell; menu: HeaderMenuCtx | null; addRow?: AddRowFn;
}) {
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
  const optMap = new Map((col?.options ?? []).map((o) => [o.name, o]));
  const byKey = new Map((res.groups ?? []).map((g) => [g.key, g.rows]));
  // Columnas del tablero: todas las opciones del esquema (aunque estén vacías), luego otros valores presentes y «Sin valor».
  const optionNames = (col?.options ?? []).map((o) => o.name);
  const lanes = [...optionNames, ...[...byKey.keys()].filter((k) => k !== "" && !optionNames.includes(k)), ""];
  const filteredLanes = lanes.filter((l) => l !== "" || (byKey.get(l)?.length ?? 0) > 0);
  const visibleLanes = filteredLanes.length ? filteredLanes : [""];
  const canAddLane = !!menu && !READONLY.has(group) && (col?.type === "select" || col?.type === "multi");
  const canAddInLane = !!menu && !!addRow && !READONLY.has(group);
  const movable = !READONLY.has(group) && col?.type !== "multi";
  const drop = (lane: string, e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const path = e.dataTransfer?.getData("text/plain");
    const row = res.rows.find((r) => r.path === path);
    if (row && movable && String(row.cells[group] ?? "") !== lane) setCell(row, group, laneValue(col?.type, lane));
  };
  const rest = res.columns.filter((c) => c.key !== "title" && c.key !== group);
  const gridCols = Math.max(1, visibleLanes.length + (canAddLane ? 1 : 0));
  return (
    <div class="board" style={`grid-template-columns: repeat(${gridCols}, minmax(210px, 1fr))`}>
      {visibleLanes.map((lane) => {
        const items = byKey.get(lane) ?? [];
        const opt = lane ? optMap.get(lane) : undefined;
        const laneProps = lane === "" ? undefined : { [group]: col?.type === "multi" ? [lane] : laneValue(col?.type, lane) };
        return (
          <section key={lane} class={`col ${over === lane ? "over" : ""}`} aria-label={lane || "Sin valor"}
            onDragOver={(e) => { e.preventDefault(); setOver(lane); }} onDragLeave={() => setOver((o) => (o === lane ? null : o))} onDrop={(e) => drop(lane, e)}>
            <h2 class="sec">
              {opt?.color ? <span class={`chip ${optionClass(opt.color)}`}>{lane}</span> : <span>{lane || "Sin valor"}</span>}
              {" "}<span class="muted">{items.length}</span>
            </h2>
            {items.map((r) => (
              <article key={r.path} class="kcard" draggable={movable} onDragStart={(e) => e.dataTransfer?.setData("text/plain", r.path)}>
                <a href={`#/nota/${enc(r.path)}`}>{r.title}</a>
                <div class="meta">
                  {rest.map((c) => <CompactPropCell key={c.key} col={c} row={r} setCell={setCell} menu={menu} />)}
                  {movable && (
                    <select class="cell-select kmove" value={lane} aria-label={`Mover «${r.title}»`} onChange={(e) => setCell(r, group, laneValue(col?.type, e.currentTarget.value))}>
                      {lanes.filter((l) => l !== "" || lane === "").map((l) => <option key={l} value={l}>{l || "Sin valor"}</option>)}
                    </select>
                  )}
                </div>
              </article>
            ))}
            {items.length === 0 && !canAddInLane && <div class="kempty muted small">{movable ? "Arrastra filas aquí" : "Vacío"}</div>}
            {canAddInLane && (
              <InlineAddRow
                label="+ Añadir"
                placeholder={`Nueva en «${lane || "Sin valor"}»…`}
                ariaLabel={`Añadir fila en ${lane || "Sin valor"}`}
                onAdd={(t) => addRow!(t, laneProps)}
              />
            )}
          </section>
        );
      })}
      {canAddLane && <AddLaneColumn group={group} menu={menu!} />}
    </div>
  );
}
