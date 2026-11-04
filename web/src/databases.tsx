// Bases de datos: lista de bases y vista de una base (cabecera, vistas guardadas, alta de filas). La definición vive en el frontmatter de la base;
// aquí solo se consulta y se edita (cada celda es una propiedad de su nota). Las vistas (tabla, lista, tablero) están en db-views.tsx,
// el panel de filtros en db-panel.tsx, las celdas en db-cells.tsx y las utilidades y tipos compartidos en db-common.ts.
import { useEffect, useState } from "preact/hooks";
import { isMobile } from "./role.ts";
import { api, lsGet, lsSet } from "./api.ts";
import { askConfirm, askText } from "./dialogs.tsx";
import { useApi } from "./hooks.ts";
import { enc, READONLY } from "./db-common.ts";
import type { Result } from "./db-common.ts";
import { ViewPanel } from "./db-panel.tsx";
import { Board, List, Table } from "./db-views.tsx";
import type { Guard, Say } from "./db-schema.ts";
import type { ResultRow, SchemaOp, View } from "./types.ts";

type Go = (route: string) => void;
interface DbListItem { path: string; title: string; rows: number; views: View[]; warnings: string[] }

const TEMPLATES: { id: string; label: string }[] = [
  { id: "vacía", label: "Vacía" }, { id: "tareas", label: "Tareas" }, { id: "proyectos", label: "Proyectos" }, { id: "libros", label: "Libros" },
];

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

export function DatabaseView({ path, rev, go, guard, say }: { path: string; rev: number; go: Go; guard: Guard; say: Say }) {
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
    const firstLane = db.available.find((c) => c.key === view.group)?.options?.[0]?.name;
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

  // Tras renombrar o borrar una propiedad, el borrador (si lo hay) no debe seguir apuntando a la clave antigua; las vistas guardadas ya las reescribe el servidor.
  const afterSchema = (op: SchemaOp) => {
    // Una vista con columnas explícitas no mostraría la propiedad nueva: se añade al borrador (la vista guardada no se toca).
    if (op.op === "add-property") { if (view.columns.length) edit({ columns: [...view.columns, op.name] }); return; }
    if (op.op !== "rename-property" && op.op !== "delete-property") return;
    const from = op.name;
    const to = op.op === "rename-property" ? op.to : null;
    const swap = (k: string) => (k === from ? to : k);
    setDraft((d) => d && {
      ...d,
      columns: d.columns.flatMap((k) => swap(k) ?? []),
      filter: d.filter.flatMap((f) => (f.prop === from ? (to ? [{ ...f, prop: to }] : []) : [f])),
      sort: d.sort.flatMap((s) => (s.prop === from ? (to ? [{ ...s, prop: to }] : []) : [s])),
      group: d.group === from ? to : d.group,
    });
  };
  const menu = isMobile() ? null : { path, guard, say, edit, onSchema: afterSchema };

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

      {kind === "table" && <Table res={res} view={view} sortBy={sortBy} setCell={setCell} menu={menu} />}
      {kind === "list" && <List res={res} />}
      {kind === "board" && <Board res={res} view={view} available={db.available} edit={edit} setCell={setCell} />}
    </div>
  );
}
