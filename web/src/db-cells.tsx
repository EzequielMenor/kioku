// Celda de una base: muestra y edita una propiedad de la fila según el tipo de su columna.
import { useRef, useState } from "preact/hooks";
import { misfit, relationValue, safeHref } from "./cell-values.ts";
import { enc, label, READONLY, text } from "./db-common.ts";
import type { HeaderMenuCtx } from "./db-header-menu.tsx";
import { editSchema } from "./db-schema.ts";
import { optionClass, valueClass } from "./option-colors.ts";
import { Popover } from "./popover.tsx";
import type { Column, ResultRow } from "./types.ts";

/* ───────────────────────── celdas ───────────────────────── */

type SetCell = (r: ResultRow, k: string, v: unknown) => void;

/** `menu` es null en el rol móvil: allí la celda de selección conserva el `<select>` nativo y no se pueden crear opciones. */
export function Cell({ col, row, setCell, menu }: { col: Column; row: ResultRow; setCell: SetCell; menu: HeaderMenuCtx | null }) {
  const v = row.cells[col.key];
  const aria = `${label(col.key)} de «${row.title}»`;
  if (col.key === "title") return <a href={`#/nota/${enc(row.path)}`}>{row.title}</a>;
  if (col.key === "tags") return <>{(Array.isArray(v) ? v : []).map((t) => <span class="chip" key={String(t)}>#{String(t)}</span>)}</>;
  if (col.key === "mtime") return <span class="muted">{typeof v === "number" ? new Date(v).toLocaleDateString("es") : ""}</span>;
  if (READONLY.has(col.key)) return <span class="muted">{text(v)}</span>;
  const why = misfit(col.type, v);
  if (why) return <MisfitCell col={col} row={row} setCell={setCell} v={v} why={why} aria={aria} />;
  switch (col.type) {
    case "checkbox":
      return <input type="checkbox" checked={v === true} aria-label={aria} onChange={(e) => setCell(row, col.key, e.currentTarget.checked)} />;
    case "select": {
      const options = col.options ?? [];
      const cur = text(v);
      if (menu) return <SelectCell col={col} row={row} setCell={setCell} menu={menu} aria={aria} />;
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

/** Valor que no encaja con el tipo de la columna (p. ej. «300 aprox.» en un número): se muestra tal cual con un aviso, no como celda vacía.
 *  Pulsarlo (o Enter) abre el campo del tipo; solo lo que el usuario escribe después lo sustituye. */
function MisfitCell({ col, row, setCell, v, why, aria }: { col: Column; row: ResultRow; setCell: SetCell; v: unknown; why: string; aria: string }) {
  const [editing, setEditing] = useState(false);
  const raw = typeof v === "object" && v !== null && !Array.isArray(v) ? JSON.stringify(v) : text(v);
  if (!editing) {
    return <button type="button" class="cell-misfit" title={why} aria-label={`${aria}: «${raw}». ${why}; pulsa para editar`} onClick={() => setEditing(true)}>
      <span aria-hidden="true">⚠</span> {raw}
    </button>;
  }
  const done = () => setEditing(false);
  if (col.type === "checkbox") return <input type="checkbox" checked={false} autoFocus aria-label={aria} onBlur={done} onChange={(e) => setCell(row, col.key, e.currentTarget.checked)} />;
  const isNum = col.type === "number";
  return <input class={`cell-input${isNum ? " num" : ""}`} type={isNum ? "number" : "date"} autoFocus aria-label={aria}
    onBlur={done} onKeyDown={(e) => { if (e.key === "Escape") done(); }}
    onChange={(e) => setCell(row, col.key, isNum ? (e.currentTarget.value === "" ? "" : Number(e.currentTarget.value)) : e.currentTarget.value)} />;
}

/** Selección en escritorio: el valor es un chip de color que abre un popover con filtro, las opciones, «Vaciar» y «Crear «X»». */
function SelectCell({ col, row, setCell, menu, aria }: { col: Column; row: ResultRow; setCell: SetCell; menu: HeaderMenuCtx; aria: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const options = col.options ?? [];
  const cur = text(row.cells[col.key]);
  const typed = q.trim();
  const fold = (s: string) => s.toLowerCase();
  const matches = options.filter((o) => fold(o.name).includes(fold(typed)));
  const exact = options.find((o) => fold(o.name) === fold(typed));
  const close = () => { setOpen(false); setQ(""); };

  const pick = (name: string) => { close(); if (name !== cur) setCell(row, col.key, name); };
  const create = async () => {
    if (!typed || busy.current) return;
    busy.current = true;
    try {
      // Si añadir la opción falla, la celda no se toca: el error ya se mostró.
      if (await editSchema({ op: "add-option", prop: col.key, option: typed }, menu)) { close(); setCell(row, col.key, typed); }
    } finally { busy.current = false; }
  };
  const enter = () => {
    if (!typed) return;
    if (exact) pick(exact.name);
    else if (matches.length) pick(matches[0].name);
    else void create();
  };

  return (
    <>
      <button ref={btn} class={`opt-chip cell-chip ${cur ? valueClass(options, cur) : "empty"}`} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${aria}: ${cur || "vacío"}`} onClick={() => setOpen(!open)}>{cur || "—"}</button>
      {open && (
        <Popover anchor={btn.current} label={`Valor de ${label(col.key)}`} onClose={close}>
          <div class="pop-section">
            <input class="opt-filter" aria-label="Filtrar opciones" placeholder="Buscar o crear…" value={q} onInput={(e) => setQ(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enter(); } }} />
          </div>
          <div class="pop-section">
            <div class="opt-list">
              {matches.map((o) => <button key={o.name} class={`opt-chip ${optionClass(o.color)}`} aria-pressed={o.name === cur} onClick={() => pick(o.name)}>{o.name}</button>)}
              {matches.length === 0 && !typed && <span class="muted small">Aún no hay opciones. Escribe para crear una.</span>}
            </div>
          </div>
          <div class="pop-section pop-list">
            {typed && !exact && <button class="pop-item" onClick={() => void create()}>Crear «{typed}»</button>}
            <button class="pop-item" disabled={!cur} onClick={() => pick("")}>Vaciar</button>
          </div>
        </Popover>
      )}
    </>
  );
}
