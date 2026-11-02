import { useEffect, useRef, useState } from "preact/hooks";
import "./task-form.css";
import { api } from "./api.ts";
import { STATUS } from "./task-views.tsx";
import type { AreaRow, CalendarProject, NoteInfo, TaskStatus } from "./types.ts";

interface Values {
  title: string; due: string; status: TaskStatus; priority: string;
  areaPath: string; projectPath: string; estimate: string;
}
const EMPTY: Values = { title: "", due: "", status: "todo", priority: "", areaPath: "", projectPath: "", estimate: "" };
const relation = (value: unknown, info: NoteInfo) => {
  if (typeof value !== "string") return "";
  const target = value.replace(/^\[\[/, "").replace(/\]\]$/, "");
  return info.outgoing.find((o) => o.target === target)?.path ?? target.replace(/(?:\.md)?$/, ".md");
};

/** A single editor for task properties; the Markdown body stays untouched. */
export function TaskForm({ path, onClose, onSaved }: { path: string | null; onClose(): void; onSaved(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Values>(EMPTY);
  const [original, setOriginal] = useState<Values>(EMPTY);
  const [hash, setHash] = useState("");
  const [projects, setProjects] = useState<CalendarProject[]>([]);
  const [areas, setAreas] = useState<AreaRow[]>([]);
  const label = path ? "Editar tarea" : "Añadir tarea";
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); if (before?.isConnected) before.focus(); };
  }, []);
  useEffect(() => {
    let dead = false;
    Promise.all([
      api<CalendarProject[]>("GET", "/api/calendar/projects"),
      api<AreaRow[]>("GET", "/api/calendar/areas"),
      path ? api<NoteInfo>("GET", "/api/note?path=" + encodeURIComponent(path)) : Promise.resolve(null),
    ]).then(([ps, as, info]) => {
      if (dead) return;
      if (info && (!info.note || info.note.type !== "task" || info.note.fmError)) throw new Error("No es una tarea válida");
      setProjects(ps); setAreas(as);
      if (info?.note) {
        const fm = info.note.fm;
        const values: Values = {
          title: info.note.title, due: String(fm.due ?? ""), status: (fm.status ?? "todo") as TaskStatus,
          priority: String(fm.priority ?? ""), estimate: String(fm.estimate ?? ""),
          projectPath: relation(fm.project, info), areaPath: relation(fm.area, info),
        };
        setForm(values); setOriginal(values); setHash(info.hash);
      }
      setLoaded(true);
    }).catch((e: Error) => { if (!dead) setError(e.message); });
    return () => { dead = true; };
  }, [path]);
  useEffect(() => { if (loaded) title.current?.focus(); }, [loaded]);
  const close = () => { if (!saving.current) onClose(); };
  const set = (patch: Partial<Values>) => setForm((f) => ({ ...f, ...patch }));
  const save = async (e: Event) => {
    e.preventDefault();
    if (saving.current || !loaded || !form.title.trim()) return;
    saving.current = true; setBusy(true); setError("");
    const values = {
      title: form.title.trim(), status: form.status, due: form.due || null,
      priority: form.priority ? Number(form.priority) : null, estimate: form.estimate ? Number(form.estimate) : null,
      projectPath: form.projectPath || null, areaPath: form.areaPath || null,
    };
    // Al editar solo viaja lo que cambió (el resto de propiedades y el cuerpo quedan como están); al crear, solo lo rellenado.
    const fields = Object.fromEntries(Object.entries(values).filter(([key, value]) => path ? form[key as keyof Values] !== original[key as keyof Values] : value !== null));
    try {
      await api("POST", path ? "/api/task/update" : "/api/task/create", path ? { path, hash, ...fields } : fields);
      onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { saving.current = false; setBusy(false); }
  };
  const options = (items: { path: string; title: string }[], value: string) => <>
    {value && !items.some((item) => item.path === value) && <option value={value}>{value}</option>}
    {items.map((item) => <option key={item.path} value={item.path}>{item.title}</option>)}
  </>;
  return (
    <dialog ref={dialog} class="modal task-dialog" aria-label={label} onCancel={(e) => { e.preventDefault(); close(); }}
      // Sin activación reciente del usuario el navegador no deja cancelar «cancel»: si cierra el diálogo con un guardado en curso, se reabre.
      onClose={() => { if (saving.current && dialog.current && !dialog.current.open) dialog.current.showModal(); }}
      onKeyDown={(e) => e.stopPropagation()}>
      <h2>{label}</h2>
      {error && <p class="bad-text" role="alert">{error}</p>}
      {!loaded ? <>{!error && <p class="muted">Cargando formulario…</p>}<button type="button" onClick={close}>Cerrar</button></> : (
        <form onSubmit={(e) => void save(e)}>
          <fieldset disabled={busy} class="task-form-fields">
            <label>Título<input ref={title} required maxLength={200} value={form.title} onInput={(e) => set({ title: e.currentTarget.value })} /></label>
            <div class="task-form-grid">
              <label>Fecha límite<input type="date" value={form.due} onInput={(e) => set({ due: e.currentTarget.value })} /></label>
              <label>Estado<select value={form.status} onChange={(e) => set({ status: e.currentTarget.value as TaskStatus })}>{STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
              <label>Prioridad<select value={form.priority} onChange={(e) => set({ priority: e.currentTarget.value })}>
                <option value="">Sin prioridad</option><option value="1">Alta</option><option value="2">Media</option><option value="3">Baja</option>
              </select></label>
              <label>Estimación (minutos)<input type="number" min={1} max={1440} step={1} value={form.estimate} onInput={(e) => set({ estimate: e.currentTarget.value })} /></label>
              <label>Área<select value={form.areaPath} onChange={(e) => set({ areaPath: e.currentTarget.value })}><option value="">Sin área</option>{options(areas, form.areaPath)}</select></label>
              <label>Proyecto<select value={form.projectPath} onChange={(e) => set({ projectPath: e.currentTarget.value })}><option value="">Sin proyecto</option>{options(projects, form.projectPath)}</select></label>
            </div>
            <p class="muted small">Solo el título es obligatorio. El área es independiente del proyecto. El título se guarda tal cual.</p>
            <div class="row end">
              {path && <a href={"#/nota/" + path.split("/").map(encodeURIComponent).join("/")} onClick={(e) => { if (saving.current) e.preventDefault(); else onClose(); }}>Abrir nota</a>}
              <button type="button" onClick={close}>Cancelar</button>
              <button class="primary" disabled={!form.title.trim()}>{busy ? "Guardando…" : path ? "Guardar cambios" : "Crear tarea"}</button>
            </div>
          </fieldset>
        </form>
      )}
    </dialog>
  );
}
