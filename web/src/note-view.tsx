import { askConfirm } from "./dialogs.tsx";
import { isMobile } from "./role.ts";
import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api, ApiError } from "./api.ts";
import { createEditor, splitNote, type EditorHandle } from "./editor.ts";
import { useApi } from "./hooks.ts";
import type { NoteInfo } from "./types.ts";
import { parseValue } from "./cell-values.ts";
import { PrioritySelector } from "./priority.tsx";

import { loadMutations, persistDraft, readDraft, setTaskStatus, submitMutation } from "./offline/runtime.ts";
import { parseNote } from "../../src/core/markdown.ts";
import { materializeTask, reconcileTaskAcknowledgement } from "./offline/mobile-editing.ts";
import type { TaskStatus } from "./offline/store.ts";
import { needsTitleHeading } from "./notes-model.ts";

type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Guardado", dirty: "Sin guardar…", saving: "Guardando…", conflict: "Conflicto", error: "Error al guardar",
};

// Claves que el panel nunca ofrece como propiedades libres: son del sistema o ya tienen su control propio.
const SYSTEM_PROPS = new Set(["id", "type", "created", "title", "tags", "aliases", "icon", "parked", "done_at"]);
const TYPED_PROPS: Record<string, string[]> = { task: ["status", "due", "priority", "project"], project: ["status"] };
const NOTE_ICONS = ["", "📝", "💡", "📚", "⚙️", "🧠", "🎯", "🌱", "🔍", "⭐"] as const;

function splitPathParts(rel: string): { folder: string; base: string } {
  const norm = rel.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return {
    folder: idx >= 0 ? norm.slice(0, idx) : "",
    base: (idx >= 0 ? norm.slice(idx + 1) : norm).replace(/\.md$/i, ""),
  };
}

function cleanSlugName(title: string): string {
  const s = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").slice(0, 80).trim();
  return s || "Sin título";
}

function RenameModal({
  path, title: initialTitle, type, onClose, onSubmit,
}: {
  path: string;
  title: string;
  type: string;
  onClose(): void;
  onSubmit(payload: { title?: string; fileName?: string; folder?: string }): Promise<void>;
}) {
  const { folder: curFolder, base: curBase } = splitPathParts(path);
  const [title, setTitle] = useState(initialTitle);
  const [syncFile, setSyncFile] = useState(() => curBase.toLowerCase() === cleanSlugName(initialTitle).toLowerCase());
  const [fileName, setFileName] = useState(curBase);
  const [folder, setFolder] = useState(curFolder);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const effectiveFile = syncFile ? cleanSlugName(title) : fileName.replace(/\.md$/i, "").trim();
  const cleanFolder = folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const previewPath = cleanFolder ? `${cleanFolder}/${effectiveFile || "…"}.md` : `${effectiveFile || "…"}.md`;

  const saveRename = async (e: Event) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) { setErr("El título no puede estar vacío"); return; }
    if (!effectiveFile) { setErr("El nombre de archivo no puede estar vacío"); return; }
    setBusy(true);
    setErr(null);
    try {
      const payload: { title?: string; fileName?: string; folder?: string } = {};
      if (cleanTitle !== initialTitle) payload.title = cleanTitle;
      if (effectiveFile !== curBase) payload.fileName = effectiveFile;
      if (cleanFolder !== curFolder) payload.folder = cleanFolder;
      await onSubmit(payload);
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form class="modal dialog" role="dialog" aria-modal="true" aria-label="Renombrar o mover nota" onSubmit={(e) => void saveRename(e)}>
        <h2>Renombrar o mover</h2>
        {err && <div class="banner warn" role="alert">{err}</div>}
        <label class="field-lbl">Título
          <input autofocus value={title} onInput={(e) => {
            const next = e.currentTarget.value;
            setTitle(next);
            if (syncFile) setFileName(cleanSlugName(next));
          }} />
        </label>
        <label class="field-lbl">Nombre de archivo (.md)
          <input value={syncFile ? cleanSlugName(title) : fileName} onInput={(e) => { setSyncFile(false); setFileName(e.currentTarget.value); }} />
        </label>
        <label class="check muted small">
          <input type="checkbox" checked={syncFile} onChange={(e) => {
            const on = e.currentTarget.checked;
            setSyncFile(on);
            if (on) setFileName(cleanSlugName(title));
          }} />
          Mantener el archivo sincronizado con el título
        </label>
        {type !== "journal" && (
          <label class="field-lbl">Carpeta
            <input list="kioku-note-folders" value={folder} placeholder="Notas" onInput={(e) => setFolder(e.currentTarget.value)} />
            <datalist id="kioku-note-folders">
              <option value="Notas" />
              <option value="Recursos" />
              <option value="Libros" />
              {curFolder && <option value={curFolder} />}
            </datalist>
          </label>
        )}
        <div class="rename-preview muted small">Archivo final: <code>{previewPath}</code></div>
        <div class="row end">
          <button type="button" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" class="primary" disabled={busy}>{busy ? "Renombrando…" : "Guardar cambio"}</button>
        </div>
      </form>
    </div>
  );
}

function ChipListEditor({
  items, prefix = "", placeholder, ariaLabel, onSave,
}: {
  items: string[];
  prefix?: string;
  placeholder: string;
  ariaLabel: string;
  onSave(next: string[] | null): Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    let val = draft.trim();
    if (!val) return;
    if (prefix === "#") val = val.replace(/^#+/, "").replace(/\s+/g, "-");
    if (!val || items.includes(val)) { setDraft(""); return; }
    void onSave([...items, val]).then(() => setDraft(""));
  };
  const remove = (item: string) => {
    const next = items.filter((x) => x !== item);
    void onSave(next.length ? next : null);
  };
  return (
    <div class="chip-editor">
      {items.length > 0 && (
        <div class="tagrow">
          {items.map((it) => (
            <span class="chip chip-rm" key={it}>
              {prefix}{it}
              <button type="button" class="chip-x" aria-label={`Quitar ${prefix}${it}`} onClick={() => remove(it)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div class="inline-add">
        <input
          value={draft}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button type="button" onClick={add} disabled={!draft.trim()}>+</button>
      </div>
    </div>
  );
}

const isScalar = (v: unknown) => ["string", "number", "boolean"].includes(typeof v) || v instanceof Date;
const asText = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : String(v));
function ExtraProps({ fm, type, setProp }: { fm: Record<string, unknown>; type: string; setProp(p: Record<string, unknown>): Promise<void> }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const skip = new Set(TYPED_PROPS[type] ?? []);
  const keys = Object.keys(fm).filter((k) => !SYSTEM_PROPS.has(k) && !skip.has(k));
  const structured = keys.filter((k) => typeof fm[k] === "object" && fm[k] !== null && !Array.isArray(fm[k]) && !(fm[k] instanceof Date));
  const editable = keys.filter((k) => !structured.includes(k));
  const add = () => {
    const k = name.trim();
    if (!k || SYSTEM_PROPS.has(k) || value.trim() === "") return;
    void setProp({ [k]: parseValue(value) }).then(() => { setName(""); setValue(""); });
  };
  return (
    <>
      {editable.map((k) => {
        const v = fm[k];
        const aria = `Propiedad ${k}`;
        return (
          <Fragment key={k}>
            <dt title={k}>{k}</dt>
            <dd>
              {typeof v === "boolean"
                ? <input type="checkbox" checked={v} aria-label={aria} onChange={(e) => void setProp({ [k]: e.currentTarget.checked })} />
                : typeof v === "number"
                  ? <input type="number" defaultValue={String(v)} key={String(v)} aria-label={aria} onChange={(e) => void setProp({ [k]: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })} />
                  : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
                    ? <input type="date" value={v} aria-label={aria} onChange={(e) => void setProp({ [k]: e.currentTarget.value || null })} />
                    : Array.isArray(v) && !v.every(isScalar)
                      ? <span class="muted">{asText(v)}</span>
                      : <input defaultValue={asText(v)} key={asText(v)} aria-label={aria} placeholder={Array.isArray(v) ? "a, b, c" : ""}
                          onBlur={(e) => {
                            const raw = e.currentTarget.value;
                            if (raw === asText(v)) return;
                            void setProp({ [k]: Array.isArray(v) ? raw.split(",").map((x) => x.trim()).filter(Boolean) : parseValue(raw) });
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />}
            </dd>
          </Fragment>
        );
      })}
      {structured.length > 0 && <><dt>Definición</dt><dd class="muted small">{structured.join(", ")} (edita el texto de la nota)</dd></>}
      <dt class="addprop-t">Nueva</dt>
      <dd class="addprop">
        <input placeholder="nombre" value={name} onInput={(e) => setName(e.currentTarget.value)} aria-label="Nombre de la nueva propiedad" />
        <input placeholder="valor" value={value} onInput={(e) => setValue(e.currentTarget.value)} aria-label="Valor de la nueva propiedad"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button disabled={!name.trim() || !value.trim()} onClick={add} aria-label="Añadir propiedad">+</button>
      </dd>
    </>
  );
}

const TASK_STATUS = ["todo", "doing", "done", "dropped"];
const STATUS_LABEL: Record<string, string> = { todo: "Pendiente", doing: "En curso", done: "Hecha", dropped: "Descartada" };
const PROJECT_STATUS = ["active", "paused", "done", "someday"];

export function NoteView(props: { path: string; rev: number; go(route: string): void; embedded?: boolean }) {
  return isMobile() ? <MobileNoteView key={props.path} {...props} /> : <DesktopNoteView {...props} />;
}

function MobileNoteView({ path, go, embedded }: { path: string; rev: number; go(route: string): void; embedded?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<NoteInfo | null>(null);
  const [label, setLabel] = useState("Cargando…");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("todo");
  useEffect(() => {
    let dead = false, timer = 0, generation = 0, queued = 0;
    let editor: EditorHandle | null = null, fm = "", hash = "", latest = "";
    const showError = (e: unknown) => { if (!dead) { setLabel("Error local"); setMessage(e instanceof Error ? e.message : String(e)); } };
    const enqueue = () => {
      clearTimeout(timer);
      if (!generation || generation === queued) return;
      const version = generation, text = latest;
      queued = version;
      void submitMutation({ kind: "edit", path, text, baseHash: hash }).then(() => { if (!dead && version === generation) setLabel("Pendiente de sincronizar"); }, e => { if (queued === version) queued = 0; showError(e); });
    };
    const change = () => {
      if (!editor) return;
      latest = fm + editor.getBody(); generation++;
      const version = generation;
      if (!dead) setLabel("Guardando en el dispositivo…");
      void persistDraft(path, latest, hash).then(() => { if (!dead && generation === version) setLabel("Guardado en el dispositivo"); }, showError);
      clearTimeout(timer); timer = window.setTimeout(enqueue, 800);
    };
    (async () => {
      const d = await api<NoteInfo>("GET", `/api/note?path=${encodeURIComponent(path)}`);
      const draft = await readDraft(path);
      if (dead || !host.current) return;
      const text = draft?.text ?? d.text;
      const parts = splitNote(text); fm = parts.fm; hash = draft?.baseHash ?? d.hash; latest = text;
      const parsed = parseNote(text, path);
      setStatus(String(parsed.frontmatter.status ?? "todo")); setInfo(d);
      const operations = await loadMutations();
      if (dead || !host.current) return;
      setLabel(operations.some(o => o.body.path === path && o.state === "conflict") ? "Conflicto" : draft ? "Pendiente de sincronizar" : "Guardado");
      editor = createEditor(host.current, parts.body, { onChange: change, onSave: enqueue, onFollow: async target => {
        const r = await api<{ path: string | null }>("GET", `/api/resolve?q=${encodeURIComponent(target)}`);
        if (r.path) go(`/nota/${r.path}`);
      } });
      if (draft && !operations.some(o => o.body.path === path && o.state !== "applied" && o.body.text === draft.text)) { generation = 1; enqueue(); }
      void api("POST", "/api/note/open", { path }).catch(() => {});
    })().catch(showError);
    const onTask = async (e: Event) => {
      const value = (e as CustomEvent<TaskStatus>).detail;
      try {
        clearTimeout(timer);
        if (generation && generation !== queued) enqueue();
        if (!editor) return;
        latest = materializeTask(fm + editor.getBody(), path, value);
        fm = splitNote(latest).fm;
        if (!dead) { setStatus(value); setLabel("Guardando en el dispositivo…"); }
        await setTaskStatus(path, value, { text: latest, baseHash: hash });
        if (!dead) setLabel("Pendiente de sincronizar");
      } catch (err) { showError(err); }
    };
    const onMutations = (e: Event) => {
      const operations = (e as CustomEvent<import("./offline/store.ts").StoredMutation[]>).detail.filter(o => o.body.path === path);
      for (const op of operations) if (op.state === "applied" && op.result && op.body.baseHash === hash) {
        if (op.body.kind === "task" && op.result.text) {
          latest = reconcileTaskAcknowledgement(fm + (editor?.getBody() ?? splitNote(latest).body), op.result.text, op.body.status);
          fm = splitNote(latest).fm;
        }
        hash = op.result.hash;
        if (generation > queued) void persistDraft(path, latest, hash).catch(showError);
      }
      if (operations.some(o => o.state === "conflict")) setLabel("Conflicto");
      else if (operations.some(o => o.state === "failed")) setLabel("Error al sincronizar");
      else if (operations.some(o => o.state === "pending")) setLabel("Pendiente de sincronizar");
      else if (queued === generation) setLabel("Guardado");
    };
    window.addEventListener("kioku:mutations", onMutations);
    host.current?.addEventListener("kioku-task-status", onTask);
    const node = host.current;
    return () => { enqueue(); dead = true; clearTimeout(timer); window.removeEventListener("kioku:mutations", onMutations); node?.removeEventListener("kioku-task-status", onTask); editor?.destroy(); };
  }, [path]);
  const n = info?.note;
  const [renaming, setRenaming] = useState(false);
  const canRename = !!n && n.type !== "block" && n.type !== "area";
  const mobileIcon = typeof n?.fm.icon === "string" && n.fm.icon ? n.fm.icon : "";
  const back = () => { if (history.length > 1) history.back(); else go("/hoy"); };
  const handleMobileRename = async (payload: { title?: string; fileName?: string; folder?: string }) => {
    if (!navigator.onLine) throw new Error("Renombrar requiere conexión con el portátil");
    const pending = await loadMutations();
    if (pending.some((o) => o.body.path === path && o.state !== "applied") || label.includes("Guardando") || label.includes("Pendiente")) {
      throw new Error("Espera a que se sincronice la nota antes de renombrar");
    }
    const cur = await api<NoteInfo>("GET", `/api/note?path=${encodeURIComponent(path)}`);
    const res = await api<{ path: string; title: string; hash: string }>("POST", "/api/note/rename", { path, ...payload, hash: cur.hash });
    if (res.path !== path) { go(`/nota/${encodeURI(res.path)}`); return; }
    const fresh = await api<NoteInfo>("GET", `/api/note?path=${encodeURIComponent(path)}`);
    setInfo(fresh);
  };
  return <div class="note-layout"><div class="note-main"><header class="note-head">{!embedded && <button class="back subtle" onClick={back}>‹ Atrás</button>}<div class="note-head-left">{mobileIcon && <span class="note-head-icon" aria-hidden="true">{mobileIcon}</span>}<div class="crumbs">{path}</div>{canRename && <button type="button" class="link small rename-btn" onClick={() => setRenaming(true)}>Renombrar</button>}</div><div class="save" title={message}>{label}</div></header>
    {renaming && n && <RenameModal path={path} title={n.title} type={n.type} onClose={() => setRenaming(false)} onSubmit={handleMobileRename} />}
    {message && <div class="banner warn" role="alert">{message}</div>}
    {label === "Conflicto" && <div class="banner warn">El original se conservó. Revisa la copia y resuelve el conflicto en Más.</div>}
    {n && (n.type === "task" || n.type === "capture" || needsTitleHeading(info?.text ?? "", n.title)) && <h1 class="note-title">{n.title}</h1>}
    {n?.type === "task" && <label class="note-status">Estado <select value={status} onChange={e => host.current?.dispatchEvent(new CustomEvent("kioku-task-status", { detail: e.currentTarget.value }))}>{TASK_STATUS.map(x => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}</select></label>}
    <div class="editor" ref={host} /></div></div>;
}

function DesktopNoteView({ path, rev, go, embedded }: { path: string; rev: number; go(route: string): void; embedded?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const s = useRef({ fm: "", hash: "", dirty: false, timer: 0, saving: false, editor: null as EditorHandle | null });
  const [state, setState] = useState<SaveState>("saved");
  const [msg, setMsg] = useState("");
  const [info, setInfo] = useState<NoteInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

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
      if (e instanceof ApiError && e.code === "conflict") mark("conflict", "El archivo cambió fuera de Kioku.");
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
      mark("conflict", "El archivo cambió fuera de Kioku mientras editabas.");
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

  const handleRename = async (payload: { title?: string; fileName?: string; folder?: string }) => {
    if (s.current.dirty) await save();
    const res = await api<{ path: string; title: string; hash: string }>("POST", "/api/note/rename", {
      path,
      ...payload,
      hash: s.current.hash,
    });
    s.current.dirty = false;
    if (res.path !== path) {
      go(info?.note?.type === "project" && !embedded ? `/proyecto/${encodeURI(res.path)}` : `/nota/${encodeURI(res.path)}`);
      return;
    }
    const d = await api<NoteInfo>("GET", `/api/note?path=${encodeURIComponent(path)}`);
    const parts = splitNote(d.text);
    s.current.fm = parts.fm;
    s.current.hash = d.hash;
    if (s.current.editor && s.current.editor.getBody() !== parts.body) {
      s.current.editor.setBody(parts.body);
    }
    setInfo(d);
  };

  const trash = async () => {
    if (!(await askConfirm({ title: "¿Mover esta nota a la papelera?", body: "Va a la papelera de Kioku (.kioku/trash); se puede recuperar desde ahí.", confirm: "Mover a la papelera", danger: true }))) return;
    s.current.dirty = false;
    await api("POST", "/api/note/delete", { path });
    go("/hoy");
  };

  if (loadErr) return <div class="empty">No se pudo abrir la nota: {loadErr}</div>;
  const n = info?.note;
  const fm = n?.fm ?? {};
  const canRename = !!n && n.type !== "block" && n.type !== "area";
  const curIcon = typeof fm.icon === "string" ? fm.icon : "";
  const aliases = Array.isArray(fm.aliases) ? fm.aliases.map(String) : [];
  return (
    <div class="note-layout">
      <div class="note-main">
        <header class="note-head">
          <div class="note-head-left">
            {curIcon && <span class="note-head-icon" aria-hidden="true">{curIcon}</span>}
            <div class="crumbs">{path}</div>
            {canRename && <button type="button" class="link small rename-btn" onClick={() => setRenaming(true)}>Renombrar</button>}
          </div>
          <div class={`save save-${state}`} title={msg}>{SAVE_LABEL[state]}</div>
        </header>
        {n && needsTitleHeading(info?.text ?? "", n.title) && <h1 class="note-title">{n.title}</h1>}
        {renaming && n && <RenameModal path={path} title={n.title} type={n.type} onClose={() => setRenaming(false)} onSubmit={handleRename} />}
        {state === "conflict" && (
          <div class="banner warn" role="alert">
            <span>{msg || "El archivo cambió fuera de Kioku."}</span>
            <button onClick={() => void reloadFromDisk()}>Cargar versión del disco</button>
            <button onClick={() => void save(true)}>Conservar la mía (sobrescribe)</button>
          </div>
        )}
        {n?.fmError && <div class="banner warn">El frontmatter YAML de esta nota es inválido; Kioku no lo modificará.</div>}
        {n && (n.type === "capture" || n.type === "task") && <h1 class="note-title">{n.title}</h1>}
        <div class="editor" ref={host} />
        <div class="hint">Ctrl+Enter sigue un [[enlace]] o marca una casilla · escribe / para formato · [[ para enlazar</div>
      </div>
      <aside class="note-side">
        {n && (
          <section>
            <h3>Propiedades</h3>
            <dl class="props">
              <dt>Tipo</dt>
              <dd>
                {(n.type === "note" || n.type === "resource") && !n.fmError ? (
                  <select aria-label="Tipo de nota" value={n.type} onChange={(e) => void setProp({ type: e.currentTarget.value })}>
                    <option value="note">Nota</option>
                    <option value="resource">Recurso</option>
                  </select>
                ) : n.type}
              </dd>
              {n.type === "task" && (
                <>
                  <dt>Estado</dt>
                  <dd><select value={String(fm.status ?? "todo")} onChange={(e) => void setProp({ status: e.currentTarget.value, ...(e.currentTarget.value === "done" ? {} : { done_at: null }) })}>
                    {TASK_STATUS.map((x) => <option key={x}>{x}</option>)}
                  </select></dd>
                  <dt>Fecha</dt>
                  <dd><input type="date" value={String(fm.due ?? "")} onChange={(e) => void setProp({ due: e.currentTarget.value || null })} /></dd>
                  <dt>Prioridad</dt>
                  <dd><PrioritySelector value={fm.priority} onChange={(priority) => void setProp({ priority: priority })} /></dd>
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
              <ExtraProps fm={fm} type={n.type} setProp={setProp} />
              {!n.fmError && (
                <>
                  <dt>Icono</dt>
                  <dd>
                    <div class="icon-row" role="group" aria-label="Icono de la nota">
                      {NOTE_ICONS.map((ic) => (
                        <button
                          key={ic || "none"}
                          type="button"
                          class={`icon-opt ${curIcon === ic ? "on" : ""}`}
                          title={ic ? `Usar ${ic}` : "Sin icono"}
                          onClick={() => void setProp({ icon: ic || null })}
                        >{ic || "×"}</button>
                      ))}
                    </div>
                  </dd>
                  <dt>Etiquetas</dt>
                  <dd>
                    <ChipListEditor
                      items={n.tags}
                      prefix="#"
                      placeholder="+ etiqueta"
                      ariaLabel="Añadir etiqueta"
                      onSave={(tags) => setProp({ tags })}
                    />
                  </dd>
                  <dt>Alias</dt>
                  <dd>
                    <ChipListEditor
                      items={aliases}
                      placeholder="+ alias para [[enlazar]]"
                      ariaLabel="Añadir alias"
                      onSave={(next) => setProp({ aliases: next })}
                    />
                  </dd>
                </>
              )}
              {n.fmError && n.tags.length > 0 && (<><dt>Etiquetas</dt><dd class="tagrow">{n.tags.map((t) => <span class="chip" key={t}>#{t}</span>)}</dd></>)}
            </dl>
            {canRename && <button type="button" class="link small" onClick={() => setRenaming(true)}>Renombrar o mover archivo →</button>}
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
        {!isMobile() && <section><button class="danger" onClick={() => void trash()}>Mover a la papelera</button></section>}
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
