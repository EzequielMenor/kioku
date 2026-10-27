// Bases de datos: Tabla / Tablero / Lista sobre notas Markdown. La definición vive en el frontmatter de la base;
// aquí solo se consulta y se edita (cada celda es una propiedad de su nota).
import { useEffect, useState } from "preact/hooks";
import { isMobile } from "./role.ts";
import { api, lsGet, lsSet } from "./api.ts";
import { askConfirm, askText } from "./dialogs.tsx";
import { useApi } from "./hooks.ts";
import type { Column, Filter, FilterOp, QueryResult, ResultRow, View } from "./types.ts";
import { laneValue, relationValue, safeHref } from "./cell-values.ts";

type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;
type Go = (route: string) => void;
interface Meta { path: string; title: string; views: View[]; warnings: string[]; available: Column[] }
type Result = QueryResult & { database: Meta };
interface DbListItem { path: string; title: string; rows: number; views: View[]; warnings: string[] }

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const OPS: { op: FilterOp; label: string; needsValue: boolean }[] = [
  { op: "is", label: "es", needsValue: true }, { op: "is_not", label: "no es", needsValue: true },
  { op: "contains", label: "contiene", needsValue: true }, { op: "empty", label: "está vacío", needsValue: false },
  { op: "not_empty", label: "no está vacío", needsValue: false }, { op: "gt", label: "mayor que", needsValue: true },
  { op: "lt", label: "menor que", needsValue: true }, { op: "before", label: "antes de", needsValue: true },
  { op: "after", label: "después de", needsValue: true }, { op: "checked", label: "marcado", needsValue: false },
];
const TEMPLATES: { id: string; label: string }[] = [
  { id: "vacía", label: "Vacía" }, { id: "tareas", label: "Tareas" }, { id: "proyectos", label: "Proyectos" }, { id: "libros", label: "Libros" },
];
const LABEL: Record<string, string> = { title: "Nombre", tags: "Etiquetas", path: "Ruta", type: "Tipo", mtime: "Modificada" };
const label = (k: string) => LABEL[k] ?? k;
const READONLY = new Set(["title", "path", "type", "mtime", "tags"]);

/* ───────────────────────── lista de bases ───────────────────────── */

export function DatabasesList({ rev, go, guard }: { rev: number; go: Go; guard: Guard }) {
  const { data } = useApi<DbListItem[]>("/api/databases", rev);
  const [name, setName] = useState("");
  const [tpl, setTpl] = useState("vacía");
  const create = (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return;
    void guard(async () => {
      const r = await api<{ path: string }>("POST", "/api/database/create", { name: name.trim(), template: tpl });
      setName("");
      go(`/bases/${r.path}`);
    });
  };
  return (
    <div class="page narrow">
      <header class="page-head"><h1>Bases</h1></header>
      <p class="muted">Una base es una nota que reúne otras notas como filas (por carpeta, tipo o etiqueta) con propiedades y vistas. Todo queda en ficheros Markdown.</p>
      {!isMobile() && <form class="inline addbar" onSubmit={create}>
        <input placeholder="Nombre de la nueva base…" value={name} onInput={(e) => setName(e.currentTarget.value)} aria-label="Nombre de la base" />
        <select value={tpl} onChange={(e) => setTpl(e.currentTarget.value)} aria-label="Plantilla">
          {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button class="primary" disabled={!name.trim()}>Crear</button>
      </form>}
      {data && data.length === 0 && <div class="empty">{isMobile() ? "Aún no hay bases. Se crean desde el portátil." : "Aún no tienes bases. Crea una arriba, por ejemplo «Libros»."}</div>}
      <div class="cards">
        {(data ?? []).map((d) => (
          <a key={d.path} class="card dbcard" href={`#/bases/${enc(d.path)}`}>
            <b>{d.title}</b>
            <span class="muted small">{d.rows === 1 ? "1 fila" : `${d.rows} filas`} · {d.views.length === 1 ? "1 vista" : `${d.views.length} vistas`}</span>
            {d.warnings.length > 0 && <span class="chip bad">{d.warnings.length} aviso{d.warnings.length > 1 ? "s" : ""}</span>}
          </a>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── una base ───────────────────────── */

export function DatabaseView({ path, rev, go, guard, say }: { path: string; rev: number; go: Go; guard: Guard; say(t: string, error?: boolean): void }) {
  const [viewName, setViewName] = useState<string | null>(lsGet(`db.view.${path}`));
  const [draft, setDraft] = useState<View | null>(null);
  const [panel, setPanel] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    let dead = false;
    api<Result>("POST", "/api/database/query", { path, view: draft ?? viewName ?? undefined }).then(
      (r) => { if (!dead) { setRes(r); setError(null); } },
      (e: Error) => {
        if (dead) return;
        if (!draft && viewName) { setViewName(null); return; } // la vista guardada ya no existe: vuelve a la primera
        setError(e.message);
      },
    );
    return () => { dead = true; };
  }, [path, viewName, draft, rev]);

  if (error) return <div class="page narrow"><div class="empty">{error}<div class="row" style="justify-content:center"><a href="#/bases">Volver a Bases</a></div></div></div>;
  if (!res) return <div class="page"><div class="empty">Cargando…</div></div>;

  const db = res.database;
  const saved = db.views.find((v) => v.name === (viewName ?? db.views[0].name)) ?? db.views[0];
  const view = draft ?? saved;
  const kind = view.kind;
  const edit = (patch: Partial<View>) => setDraft({ ...view, ...patch });
  const pick = (n: string) => { setViewName(n); setDraft(null); lsSet(`db.view.${path}`, n); };

  const setCell = (row: ResultRow, key: string, value: unknown) =>
    guard(() => api("POST", "/api/note/props", { path: row.path, props: { [key]: value === "" || (Array.isArray(value) && !value.length) ? null : value } }));

  const addRow = async () => {
    const t = title.trim();
    if (!t) return;
    // Lo que el filtro exige se rellena solo: así la fila nueva no desaparece al crearla.
    const props: Record<string, unknown> = {};
    for (const f of view.filter) if (f.op === "is" && f.value !== undefined && !READONLY.has(f.prop)) props[f.prop] = f.value;
    const firstLane = db.available.find((c) => c.key === view.group)?.options?.[0];
    if (kind === "board" && view.group && !READONLY.has(view.group) && props[view.group] === undefined && firstLane) props[view.group] = firstLane;
    const r = await guard(() => api<{ path: string }>("POST", "/api/database/row", { path, title: t, props }));
    if (r) setTitle("");
  };

  const saveView = async () => {
    const name = await askText({ title: "Guardar vista", placeholder: "Nombre de la vista", confirm: "Guardar" });
    if (!name) return;
    const exists = db.views.some((v) => v.name === name);
    if (exists && !(await askConfirm({ title: `Reemplazar «${name}»`, body: "Ya existe una vista con ese nombre.", confirm: "Reemplazar" }))) return;
    const ok = await guard(() => api("POST", "/api/database/view", { path, view: { ...view, name } }));
    if (ok) { setDraft(null); pick(name); say(`Vista «${name}» guardada`); }
  };
  const deleteView = async () => {
    if (db.views.length < 2 || !(await askConfirm({ title: `Borrar la vista «${saved.name}»`, body: "Solo se quita la vista; las filas no se tocan.", confirm: "Borrar", danger: true }))) return;
    const ok = await guard(() => api("POST", "/api/database/view/delete", { path, name: saved.name }));
    if (ok) { setViewName(null); setDraft(null); }
  };
  const sortBy = (key: string) => {
    const cur = view.sort[0];
    edit({ sort: cur?.prop === key ? (cur.dir === "asc" ? [{ prop: key, dir: "desc" }] : []) : [{ prop: key, dir: "asc" }] });
  };

  return (
    <div class="page wide">
      <header class="page-head">
        <h1>{db.title}</h1>
        <div class="row">
          <a class="chip link" href={`#/nota/${enc(path)}`} title="Ver y editar el fichero de la base">Definición</a>
          <button onClick={() => setPanel(!panel)} aria-expanded={panel}>Filtros y orden{view.filter.length + view.sort.length ? ` · ${view.filter.length + view.sort.length}` : ""}</button>
        </div>
      </header>

      <div class="row dbbar">
        <div class="seg" role="tablist" aria-label="Vistas">
          {db.views.map((v) => <button key={v.name} role="tab" aria-selected={!draft && v.name === saved.name} class={!draft && v.name === saved.name ? "on" : ""} onClick={() => pick(v.name)}>{v.name}</button>)}
        </div>
        <span class="muted small">Mostrar como</span>
        <div class="seg" role="tablist" aria-label="Tipo de vista">
          {(["table", "board", "list"] as const).map((k) => <button key={k} role="tab" aria-selected={kind === k} class={kind === k ? "on" : ""} onClick={() => edit({ kind: k })}>{{ table: "Tabla", board: "Tablero", list: "Lista" }[k]}</button>)}
        </div>
        {draft ? (
          <>
            <span class="chip accent">Cambios sin guardar</span>
            {!isMobile() && <button class="primary" onClick={() => void saveView()}>Guardar vista</button>}
            <button onClick={() => setDraft(null)}>Descartar</button>
          </>
        ) : db.views.length > 1 && !isMobile() && <button class="subtle" onClick={() => void deleteView()}>Borrar vista</button>}
      </div>

      {db.warnings.length > 0 && <div class="notice warn" role="status">{db.warnings.map((w) => <div key={w}>{w}</div>)}</div>}
      {panel && <ViewPanel view={view} available={db.available} edit={edit} />}

      {isMobile()
        ? <div class="addbar"><span class="muted small">{res.total === 1 ? "1 fila" : `${res.total} filas`}</span></div>
        : <form class="inline addbar" onSubmit={(e) => { e.preventDefault(); void addRow(); }}>
          <input placeholder="Nueva fila…  (título)" value={title} onInput={(e) => setTitle(e.currentTarget.value)} aria-label="Título de la nueva fila" />
          <button class="primary" disabled={!title.trim()}>Añadir</button>
          <span class="muted small">{res.total === 1 ? "1 fila" : `${res.total} filas`}</span>
        </form>}

      {kind === "table" && <Table res={res} view={view} sortBy={sortBy} setCell={setCell} />}
      {kind === "list" && <List res={res} />}
      {kind === "board" && <Board res={res} view={view} available={db.available} edit={edit} setCell={setCell} />}
    </div>
  );
}

/* ───────────────────────── filtros / orden / agrupación / columnas ───────────────────────── */

function ViewPanel({ view, available, edit }: { view: View; available: Column[]; edit(p: Partial<View>): void }) {
  const first = available[0]?.key ?? "title";
  const setFilter = (i: number, f: Filter) => edit({ filter: view.filter.map((x, j) => (j === i ? f : x)) });
  const cols = view.columns.length ? view.columns : available.filter((c) => c.key !== "tags").map((c) => c.key);
  const propSelect = (value: string, onChange: (v: string) => void, aria: string) => (
    <select value={value} onChange={(e) => onChange(e.currentTarget.value)} aria-label={aria}>
      {available.map((c) => <option key={c.key} value={c.key}>{label(c.key)}</option>)}
      {!available.some((c) => c.key === value) && <option value={value}>{value}</option>}
    </select>
  );
  return (
    <section class="dbpanel" aria-label="Ajustes de la vista">
      <div>
        <h3 class="sec">Filtros</h3>
        {view.filter.map((f, i) => {
          const spec = OPS.find((o) => o.op === f.op)!;
          const col = available.find((c) => c.key === f.prop);
          return (
            <div class="frow" key={i}>
              {propSelect(f.prop, (v) => setFilter(i, { prop: v, op: f.op, value: f.value }), "Propiedad")}
              <select value={f.op} onChange={(e) => setFilter(i, { prop: f.prop, op: e.currentTarget.value as FilterOp, value: f.value })} aria-label="Condición">
                {OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
              </select>
              {spec.needsValue && (col?.options
                ? <select value={String(f.value ?? "")} onChange={(e) => setFilter(i, { ...f, value: e.currentTarget.value })} aria-label="Valor">
                    <option value="">—</option>{col.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                : <input value={String(f.value ?? "")} type={col?.type === "date" || f.op === "before" || f.op === "after" ? "date" : "text"} aria-label="Valor"
                    onInput={(e) => setFilter(i, { ...f, value: col?.type === "number" && e.currentTarget.value !== "" && !Number.isNaN(Number(e.currentTarget.value)) ? Number(e.currentTarget.value) : e.currentTarget.value })} />)}
              <button class="subtle" aria-label="Quitar filtro" onClick={() => edit({ filter: view.filter.filter((_, j) => j !== i) })}>✕</button>
            </div>
          );
        })}
        <button class="subtle" onClick={() => edit({ filter: [...view.filter, { prop: first, op: "is", value: "" }] })}>+ Filtro</button>
      </div>
      <div>
        <h3 class="sec">Orden</h3>
        {view.sort.map((s, i) => (
          <div class="frow" key={i}>
            {propSelect(s.prop, (v) => edit({ sort: view.sort.map((x, j) => (j === i ? { ...x, prop: v } : x)) }), "Ordenar por")}
            <select value={s.dir} onChange={(e) => edit({ sort: view.sort.map((x, j) => (j === i ? { ...x, dir: e.currentTarget.value as "asc" | "desc" } : x)) })} aria-label="Dirección">
              <option value="asc">ascendente</option><option value="desc">descendente</option>
            </select>
            <button class="subtle" aria-label="Quitar orden" onClick={() => edit({ sort: view.sort.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button class="subtle" onClick={() => edit({ sort: [...view.sort, { prop: first, dir: "asc" }] })}>+ Orden</button>
        <h3 class="sec">Agrupar por</h3>
        <select value={view.group ?? ""} onChange={(e) => edit({ group: e.currentTarget.value || null })} aria-label="Agrupar por">
          <option value="">Sin agrupar</option>
          {available.map((c) => <option key={c.key} value={c.key}>{label(c.key)}</option>)}
        </select>
      </div>
      <div>
        <h3 class="sec">Columnas</h3>
        <div class="colpick">
          {available.map((c) => (
            <label key={c.key}>
              <input type="checkbox" checked={cols.includes(c.key)}
                onChange={(e) => edit({ columns: e.currentTarget.checked ? [...cols, c.key] : cols.filter((k) => k !== c.key) })} /> {label(c.key)}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── celdas ───────────────────────── */

const text = (v: unknown): string => (v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v));

function Cell({ col, row, setCell }: { col: Column; row: ResultRow; setCell(r: ResultRow, k: string, v: unknown): void }) {
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
          {cur && !options.includes(cur) && <option value={cur}>{cur}</option>}
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
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

/* ───────────────────────── vistas ───────────────────────── */

type SetCell = (r: ResultRow, k: string, v: unknown) => void;

function Table({ res, view, sortBy, setCell }: { res: Result; view: View; sortBy(k: string): void; setCell: SetCell }) {
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

function List({ res }: { res: Result }) {
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

function Board({ res, view, available, edit, setCell }: { res: Result; view: View; available: Column[]; edit(p: Partial<View>): void; setCell: SetCell }) {
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
  const lanes = [...(col?.options ?? []), ...[...byKey.keys()].filter((k) => k !== "" && !(col?.options ?? []).includes(k)), ""];
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
