// Celda de una base: muestra y edita una propiedad de la fila según el tipo de su columna.
import { useEffect, useRef, useState } from "preact/hooks";
import { misfit, relationValue, safeHref } from "./cell-values.ts";
import { enc, label, READONLY, text } from "./db-common.ts";
import type { HeaderMenuCtx } from "./db-header-menu.tsx";
import { editSchema } from "./db-schema.ts";
import { optionClass, valueClass } from "./option-colors.ts";
import { Popover } from "./popover.tsx";
import type { Column, PropOption, ResultRow } from "./types.ts";

/* ───────────────────────── celdas ───────────────────────── */

type SetCell = (r: ResultRow, k: string, v: unknown) => void;

function multiList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** `menu` es null en el rol móvil: allí selección/multi conservan controles simples y no se crean opciones. */
export function Cell({ col, row, setCell, menu, emptyLabel }: { col: Column; row: ResultRow; setCell: SetCell; menu: HeaderMenuCtx | null; emptyLabel?: string }) {
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
      if (menu) return <SelectCell col={col} row={row} setCell={setCell} menu={menu} aria={aria} emptyLabel={emptyLabel} />;
      return (
        <select class="cell-select" value={cur} aria-label={aria} onChange={(e) => setCell(row, col.key, e.currentTarget.value)}>
          <option value="">{emptyLabel ?? "—"}</option>
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
      if (menu) return <MultiCell col={col} row={row} setCell={setCell} menu={menu} aria={aria} emptyLabel={emptyLabel} />;
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
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]); // `autofocus` solo vale al cargar la página
  const raw = typeof v === "object" && v !== null && !Array.isArray(v) ? JSON.stringify(v) : text(v);
  if (!editing) {
    return <button type="button" class="cell-misfit" title={why} aria-label={`${aria}: «${raw}». ${why}; pulsa para editar`} onClick={() => setEditing(true)}>
      <span aria-hidden="true">⚠</span> {raw}
    </button>;
  }
  const done = () => setEditing(false);
  if (col.type === "checkbox") return <input ref={input} type="checkbox" checked={false} aria-label={aria} onBlur={done} onChange={(e) => setCell(row, col.key, e.currentTarget.checked)} />;
  const isNum = col.type === "number";
  return <input ref={input} class={`cell-input${isNum ? " num" : ""}`} type={isNum ? "number" : "date"} aria-label={aria}
    onBlur={done} onKeyDown={(e) => { if (e.key === "Escape") done(); }}
    onChange={(e) => setCell(row, col.key, isNum ? (e.currentTarget.value === "" ? "" : Number(e.currentTarget.value)) : e.currentTarget.value)} />;
}

/** Popover compartido para celdas `select` y `multi`: filtra opciones existentes, permite crear nuevas y vaciar el valor. */
function OptionPickerPopover({
  anchor, title, options, selected, clearDisabled, colKey, menu, closeOnPick,
  onPick, onClear, onCreated, onClose,
}: {
  anchor: HTMLButtonElement | null;
  title: string;
  options: PropOption[];
  selected: (name: string) => boolean;
  clearDisabled: boolean;
  colKey: string;
  menu: HeaderMenuCtx;
  closeOnPick: boolean;
  onPick(name: string): void;
  onClear(): void;
  onCreated(name: string): void;
  onClose(): void;
}) {
  const busy = useRef(false);
  const [q, setQ] = useState("");
  const typed = q.trim();
  const fold = (s: string) => s.toLowerCase();
  const matches = options.filter((o) => fold(o.name).includes(fold(typed)));
  const exact = options.find((o) => fold(o.name) === fold(typed));

  const pick = (name: string) => { if (closeOnPick) onClose(); onPick(name); };
  const create = async () => {
    if (!typed || busy.current) return;
    busy.current = true;
    try {
      // Si añadir la opción falla, la celda no se toca: el error ya se mostró.
      if (await editSchema({ op: "add-option", prop: colKey, option: typed }, menu)) {
        if (closeOnPick) onClose();
        else setQ("");
        onCreated(typed);
      }
    } finally { busy.current = false; }
  };
  const enter = () => {
    if (!typed) return;
    if (exact) pick(exact.name);
    else if (matches.length) pick(matches[0].name);
    else void create();
  };

  return (
    <Popover anchor={anchor} label={title} onClose={onClose}>
      <div class="pop-section">
        <input class="opt-filter" aria-label="Filtrar opciones" placeholder="Buscar o crear…" value={q} onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enter(); } }} />
      </div>
      <div class="pop-section">
        <div class="opt-list">
          {matches.map((o) => <button key={o.name} type="button" class={`opt-chip ${optionClass(o.color)}`} aria-pressed={selected(o.name)} onClick={() => pick(o.name)}>{o.name}</button>)}
          {matches.length === 0 && !typed && <span class="muted small">Aún no hay opciones. Escribe para crear una.</span>}
        </div>
      </div>
      <div class="pop-section pop-list">
        {typed && !exact && <button type="button" class="pop-item" onClick={() => void create()}>Crear «{typed}»</button>}
        <button type="button" class="pop-item" disabled={clearDisabled} onClick={onClear}>Vaciar</button>
      </div>
    </Popover>
  );
}

/** Selección en escritorio: el valor es un chip de color que abre un popover con filtro, las opciones, «Vaciar» y «Crear «X»». */
function SelectCell({ col, row, setCell, menu, aria, emptyLabel }: { col: Column; row: ResultRow; setCell: SetCell; menu: HeaderMenuCtx; aria: string; emptyLabel?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const options = col.options ?? [];
  const cur = text(row.cells[col.key]);

  return (
    <>
      <button ref={btn} type="button" class={`opt-chip cell-chip ${cur ? valueClass(options, cur) : "empty"}`} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${aria}: ${cur || "vacío"}`} title={label(col.key)} onClick={() => setOpen(!open)}>{cur || emptyLabel || "—"}</button>
      {open && (
        <OptionPickerPopover
          anchor={btn.current}
          title={`Valor de ${label(col.key)}`}
          options={options}
          selected={(name) => name === cur}
          clearDisabled={!cur}
          colKey={col.key}
          menu={menu}
          closeOnPick={true}
          onPick={(name) => { if (name !== cur) setCell(row, col.key, name); }}
          onClear={() => { setOpen(false); if (cur) setCell(row, col.key, ""); }}
          onCreated={(name) => setCell(row, col.key, name)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Selección múltiple en escritorio: muestra chips de color y permite activar/desactivar varias opciones o crear nuevas. */
function MultiCell({ col, row, setCell, menu, aria, emptyLabel }: { col: Column; row: ResultRow; setCell: SetCell; menu: HeaderMenuCtx; aria: string; emptyLabel?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const options = col.options ?? [];
  const selected = multiList(row.cells[col.key]);
  const extra = selected.filter((s) => !options.some((o) => o.name === s)).map((name): PropOption => ({ name }));

  const toggle = (name: string) => {
    const next = selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name];
    setCell(row, col.key, next);
  };

  return (
    <>
      <button ref={btn} type="button" class={selected.length ? "multi-cell cell-chip" : "opt-chip cell-chip empty"} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${aria}: ${selected.join(", ") || "vacío"}`} title={label(col.key)} onClick={() => setOpen(!open)}>
        {selected.length
          ? selected.map((s) => <span key={s} class={`chip ${valueClass(options, s)}`}>{s}</span>)
          : (emptyLabel || "—")}
      </button>
      {open && (
        <OptionPickerPopover
          anchor={btn.current}
          title={`Opciones de ${label(col.key)}`}
          options={[...options, ...extra]}
          selected={(name) => selected.includes(name)}
          clearDisabled={selected.length === 0}
          colKey={col.key}
          menu={menu}
          closeOnPick={false}
          onPick={toggle}
          onClear={() => { setOpen(false); if (selected.length) setCell(row, col.key, []); }}
          onCreated={(name) => { if (!selected.includes(name)) setCell(row, col.key, [...selected, name]); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
