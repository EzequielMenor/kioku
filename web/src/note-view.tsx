import { askConfirm } from "./dialogs.tsx";
import { useEffect, useRef, useState } from "preact/hooks";
import { api, ApiError } from "./api.ts";
import { createEditor, splitNote, type EditorHandle } from "./editor.ts";
import { useApi } from "./hooks.ts";
import type { NoteInfo } from "./types.ts";

type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Guardado", dirty: "Sin guardar…", saving: "Guardando…", conflict: "Conflicto", error: "Error al guardar",
};

const TASK_STATUS = ["todo", "doing", "done", "dropped"];
const PROJECT_STATUS = ["active", "paused", "done", "someday"];

export function NoteView({ path, rev, go, embedded }: { path: string; rev: number; go(route: string): void; embedded?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const s = useRef({ fm: "", hash: "", dirty: false, timer: 0, saving: false, editor: null as EditorHandle | null });
  const [state, setState] = useState<SaveState>("saved");
  const [msg, setMsg] = useState("");
  const [info, setInfo] = useState<NoteInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const mark = (st: SaveState, m = "") => { setState(st); setMsg(m); };

  const save = async (force = false): Promise<void> => {
    const c = s.current;
    const ed = c.editor;
    if (!ed || c.saving) return;
    clearTimeout(c.timer);
    c.saving = true;
    mark("saving");
    const body = ed.getBody();
    try {
      let hash = c.hash;
      if (force) hash = (await api<NoteInfo>("GET", `/api/note?path=${encodeURIComponent(path)}`)).hash;
      const r = await api<{ hash: string }>("PUT", "/api/note", { path, text: c.fm + body, hash });
      c.hash = r.hash;
      c.dirty = c.editor === ed && ed.getBody() !== body;
      mark(c.dirty ? "dirty" : "saved");
      if (c.dirty) c.timer = window.setTimeout(() => void save(), 800);
    } catch (e) {
      if (e instanceof ApiError && e.code === "conflict") mark("conflict", "El archivo cambió fuera de JARVIS.");
      else mark("error", (e as Error).message);
    } finally {
      c.saving = false;
    }
  };

  const reloadFromDisk = async () => {
    const d = await api<NoteInfo>("GET", `/api/note?path=${encodeURIComponent(path)}`);
    const { fm, body } = splitNote(d.text);
    s.current.fm = fm;
    s.current.hash = d.hash;
    s.current.dirty = false;
    s.current.editor?.setBody(body);
    s.current.dirty = false;
    setInfo(d);
    mark("saved");
  };

  // Crear el editor al abrir la nota; guardar pendiente y destruirlo al salir.
  useEffect(() => {
    let dead = false;
    const c = s.current;
    c.editor = null; c.dirty = false; c.hash = ""; c.fm = "";
    setLoadErr(null); setInfo(null); mark("saved");
    api<NoteInfo>("GET", `/api/note?path=${encodeURIComponent(path)}`).then(
      (d) => {
        if (dead || !host.current) return;
        const { fm, body } = splitNote(d.text);
        c.fm = fm; c.hash = d.hash;
        setInfo(d);
        c.editor = createEditor(host.current, body, {
          onChange: () => { c.dirty = true; mark("dirty"); clearTimeout(c.timer); c.timer = window.setTimeout(() => void save(), 800); },
          onSave: () => void save(),
          onFollow: async (target) => {
            const r = await api<{ path: string | null }>("GET", `/api/resolve?q=${encodeURIComponent(target)}`);
            if (r.path) go(`/nota/${r.path}`);
            else if (await askConfirm({ title: `«${target}» no existe`, body: "¿Quieres crear esa nota?", confirm: "Crear" })) {
              const n = await api<{ path: string }>("POST", "/api/note/create", { title: target, type: "note" });
              go(`/nota/${n.path}`);
            }
          },
        });
        void api("POST", "/api/note/open", { path });
        if (!body.trim()) c.editor.focus();
      },
      (e: Error) => { if (!dead) setLoadErr(e.message); },
    );
    return () => {
      dead = true;
      if (c.dirty && c.editor) void save();
      clearTimeout(c.timer);
      const ed = c.editor;
      // destruir tras iniciar el guardado (que ya capturó el cuerpo)
      setTimeout(() => ed?.destroy(), 0);
      c.editor = null;
    };
  }, [path]);

  // Cambios externos (otro programa, Obsidian, CLI): refrescar panel y, si no hay edición local, el cuerpo.
  const { data: fresh } = useApi<NoteInfo>(`/api/note?path=${encodeURIComponent(path)}`, rev);
  useEffect(() => {
    const c = s.current;
    if (!fresh || !c.editor || fresh.path !== path) return;
    setInfo(fresh);
    if (fresh.hash === c.hash) return;
    if (!c.dirty && !c.saving) {
      const { fm, body } = splitNote(fresh.text);
      c.fm = fm; c.hash = fresh.hash;
      if (c.editor.getBody() !== body) { c.editor.setBody(body); c.dirty = false; }
    } else if (state !== "saving") {
      mark("conflict", "El archivo cambió fuera de JARVIS mientras editabas.");
    }
  }, [fresh]);

  const setProp = async (props: Record<string, unknown>) => {
    if (s.current.dirty) await save();
    await api("POST", "/api/note/props", { path, props });
    await reloadFromDiskKeepEditor();
  };
  const reloadFromDiskKeepEditor = async () => {
    const d = await api<NoteInfo>("GET", `/api/note?path=${encodeURIComponent(path)}`);
    s.current.fm = splitNote(d.text).fm;
    s.current.hash = d.hash;
    setInfo(d);
  };

  const trash = async () => {
    if (!(await askConfirm({ title: "¿Mover esta nota a la papelera?", body: "Va a la papelera de JARVIS (.jarvis/trash); se puede recuperar desde ahí.", confirm: "Mover a la papelera", danger: true }))) return;
    s.current.dirty = false;
    await api("POST", "/api/note/delete", { path });
    go("/hoy");
  };

  if (loadErr) return <div class="empty">No se pudo abrir la nota: {loadErr}</div>;
  const n = info?.note;
  const fm = n?.fm ?? {};
  return (
    <div class="note-layout">
      <div class="note-main">
        <header class="note-head">
          <div class="crumbs">{path}</div>
          <div class={`save save-${state}`} title={msg}>{SAVE_LABEL[state]}</div>
        </header>
        {state === "conflict" && (
          <div class="banner warn" role="alert">
            <span>{msg || "El archivo cambió fuera de JARVIS."}</span>
            <button onClick={() => void reloadFromDisk()}>Cargar versión del disco</button>
            <button onClick={() => void save(true)}>Conservar la mía (sobrescribe)</button>
          </div>
        )}
        {n?.fmError && <div class="banner warn">El frontmatter YAML de esta nota es inválido; JARVIS no lo modificará.</div>}
        {n && (n.type === "capture" || n.type === "task") && <h1 class="note-title">{n.title}</h1>}
        <div class="editor" ref={host} />
        <div class="hint">Ctrl+Enter sigue un [[enlace]] o marca una casilla · Ctrl+clic también · escribe [[ para enlazar</div>
      </div>
      <aside class="note-side">
        {n && (
          <section>
            <h3>Propiedades</h3>
            <dl class="props">
              <dt>Tipo</dt><dd>{n.type}</dd>
              {n.type === "task" && (
                <>
                  <dt>Estado</dt>
                  <dd><select value={String(fm.status ?? "todo")} onChange={(e) => void setProp({ status: e.currentTarget.value, ...(e.currentTarget.value === "done" ? {} : { done_at: null }) })}>
                    {TASK_STATUS.map((x) => <option key={x}>{x}</option>)}
                  </select></dd>
                  <dt>Fecha</dt>
                  <dd><input type="date" value={String(fm.due ?? "")} onChange={(e) => void setProp({ due: e.currentTarget.value || null })} /></dd>
                  <dt>Prioridad</dt>
                  <dd><select value={String(fm.priority ?? "")} onChange={(e) => void setProp({ priority: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
                    <option value="">—</option><option value="1">p1</option><option value="2">p2</option><option value="3">p3</option>
                  </select></dd>
                  <dt>Proyecto</dt><dd>{String(fm.project ?? "—")}</dd>
                </>
              )}
              {n.type === "project" && (
                <>
                  <dt>Estado</dt>
                  <dd><select value={String(fm.status ?? "active")} onChange={(e) => void setProp({ status: e.currentTarget.value })}>
                    {PROJECT_STATUS.map((x) => <option key={x}>{x}</option>)}
                  </select></dd>
                </>
              )}
              {n.tags.length > 0 && (<><dt>Etiquetas</dt><dd class="tagrow">{n.tags.map((t) => <span class="chip" key={t}>#{t}</span>)}</dd></>)}
            </dl>
            {n.type === "project" && !embedded && <button class="link" onClick={() => go(`/proyecto/${path}`)}>Abrir panel del proyecto →</button>}
          </section>
        )}
        <section><button class="link" onClick={() => go(`/grafo/${path}`)}>Ver grafo local →</button></section>
        <LinkList title="Enlaces entrantes" empty="Nadie enlaza aquí todavía." items={info?.backlinks ?? []} go={go} />
        <section>
          <h3>Enlaces salientes</h3>
          {(info?.outgoing ?? []).length === 0 && <p class="muted">Sin enlaces.</p>}
          <ul class="plain">
            {(info?.outgoing ?? []).map((o) => (
              <li key={o.target}>
                {o.path ? <a href={`#/nota/${encodeURI(o.path)}`}>{o.title ?? o.target}</a> : <span class="broken" title="No existe todavía">{o.target}</span>}
              </li>
            ))}
          </ul>
        </section>
        {(info?.unlinked ?? []).length > 0 && (
          <LinkList title="Menciones sin enlazar" empty="" items={info!.unlinked} go={go} />
        )}
        <section><button class="danger" onClick={() => void trash()}>Mover a la papelera</button></section>
      </aside>
    </div>
  );
}

function LinkList({ title, empty, items, go }: { title: string; empty: string; items: { path: string; title: string; context: string }[]; go(r: string): void }) {
  return (
    <section>
      <h3>{title}</h3>
      {items.length === 0 && empty && <p class="muted">{empty}</p>}
      <ul class="plain">
        {items.map((b) => (
          <li key={b.path}>
            <a href={`#/nota/${encodeURI(b.path)}`} onClick={(e) => { e.preventDefault(); go(`/nota/${b.path}`); }}>{b.title}</a>
            {b.context && <div class="ctx">{b.context}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
