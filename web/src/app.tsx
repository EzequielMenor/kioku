import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "./app.css";
import { UNAUTHORIZED_EVENT, api, lsGet, lsSet } from "./api.ts";
import { AssistantActivity, AssistantMemory, AssistantView } from "./assistant.tsx";
import { DatabasesList, DatabaseView } from "./databases.tsx";
import { CalendarView } from "./calendar.tsx";
import { askConfirm, askText } from "./dialogs.tsx";
import { useApi, useRevision, useRoute } from "./hooks.ts";
import { GraphView } from "./graph.tsx";
import { extractKey } from "./pairing.ts";
import { SEAL_PATH } from "./seal.ts";
import { MOBILE_HIDDEN, getRole, isMobile, setRole } from "./role.ts";
import { discardCapture, formatAgo, loadQueue, retryCapture, startOffline, submit, syncNow, useOffline, wipeOffline, type OfflineState } from "./offline/runtime.ts";
import type { QueuedCapture } from "./offline/store.ts";
import { NoteView } from "./note-view.tsx";
import { TaskBoard, TaskTable } from "./task-views.tsx";
import type {
  CaptureResult, FocusState, NoteListItem, Proposal, ResumeCard, SearchHit, TaskRow, TodayView,
} from "./types.ts";

type Go = (route: string) => void;
type Toast = { text: string; error?: boolean };

const ICONS: Record<string, string> = {
  hoy: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  bandeja: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>',
  proyectos: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/>',
  tareas: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  notas: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M8 13h8M8 17h8M8 9h2"/>',
  propuestas: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  bases: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  grafo: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.2 7.2l7.6.4M7.4 8.2l3.6 7.9M16.6 10.1l-3.4 5.9"/>',
  asistente: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9 11h6M9 14h3"/>',
  calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  diario: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
};
const Seal = () => <svg class="seal" viewBox="12 12 76 76" aria-hidden="true"><rect x="12" y="12" width="76" height="76" rx="9" /><path d={SEAL_PATH} /></svg>;
const Icon = ({ name }: { name: string }) => <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;

const NAV: { route: string; label: string; key: string; icon: string }[] = [
  { route: "/hoy", label: "Hoy", key: "h", icon: "hoy" },
  { route: "/bandeja", label: "Bandeja", key: "b", icon: "bandeja" },
  { route: "/proyectos", label: "Proyectos", key: "p", icon: "proyectos" },
  { route: "/tareas", label: "Tareas", key: "t", icon: "tareas" },
  { route: "/calendario", label: "Calendario", key: "c", icon: "calendario" },
  { route: "/notas", label: "Notas", key: "n", icon: "notas" },
  { route: "/bases", label: "Bases", key: "d", icon: "bases" },
  { route: "/grafo", label: "Grafo", key: "g", icon: "grafo" },
  { route: "/asistente", label: "Asistente", key: "a", icon: "asistente" },
  { route: "/propuestas", label: "Propuestas", key: "r", icon: "propuestas" },
];

/** Entradas de navegación que ve quien usa la interfaz (el móvil no tiene Asistente ni Propuestas). */
const visibleNav = () => NAV.filter((n) => !(isMobile() && MOBILE_HIDDEN.has(n.route)));

const enc = (p: string) => encodeURI(p);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function relDate(d: string | null, today?: string): string {
  if (!d) return "";
  if (!today) return d;
  const diff = Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
  if (diff === 0) return "hoy";
  if (diff === 1) return "mañana";
  if (diff === -1) return "ayer";
  if (diff < 0) return `hace ${-diff} d`;
  return diff < 7 ? `en ${diff} d` : d;
}

/** j/k mueven la selección por filas (.task, .cards .card, .rows li); Enter abre; x marca/desmarca. */
function listNav(e: KeyboardEvent): boolean {
  const rows = [...document.querySelectorAll<HTMLElement>("main .task, main .cards > .card, main .rows > li")];
  if (!rows.length || !["j", "k", "Enter", "x"].includes(e.key)) return false;
  const cur = rows.findIndex((r) => r.classList.contains("kb-sel"));
  if (e.key === "j" || e.key === "k") {
    const next = Math.max(0, Math.min(rows.length - 1, cur < 0 ? 0 : cur + (e.key === "j" ? 1 : -1)));
    rows.forEach((r, i) => r.classList.toggle("kb-sel", i === next));
    rows[next].scrollIntoView({ block: "nearest" });
    e.preventDefault();
    return true;
  }
  if (cur < 0) return false;
  if (e.key === "Enter") { rows[cur].querySelector<HTMLElement>("a")?.click(); e.preventDefault(); return true; }
  const box = rows[cur].querySelector<HTMLInputElement>("input[type=checkbox]");
  if (e.key === "x" && box) { box.click(); e.preventDefault(); return true; }
  return false;
}

// ───────────────────────────── App ─────────────────────────────

function App() {
  const [route, setRoute] = useRoute();
  const [toast, setToast] = useState<Toast | null>(null);
  const [overlay, setOverlay] = useState<null | "palette" | "capture" | "help" | "context" | "endfocus" | "more">(null);
  const [ctxPath, setCtxPath] = useState<string | null>(null);
  const [theme, setTheme] = useState(lsGet("theme") ?? "dark");
  const rev = useRevision((e) => { if (e.kind === "navigate" && e.route) setRoute(e.route); });
  const focus = useApi<FocusState>("/api/focus", rev).data;
  const counts = useApi<TodayView>("/api/today", rev).data;
  const toastTimer = useRef(0);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const on = () => { setLocked(true); void wipeOffline(); };
    addEventListener(UNAUTHORIZED_EVENT, on);
    return () => removeEventListener(UNAUTHORIZED_EVENT, on);
  }, []);
  const [, setRoleTick] = useState(0);
  useEffect(() => {
    startOffline(); // sin red el rol sale de lo último visto; startOffline solo actúa en el móvil
    api<{ role: "full" | "mobile" }>("GET", "/api/session").then((r) => { const changed = r.role !== getRole(); setRole(r.role); startOffline(); if (changed) setRoleTick((n) => n + 1); }, () => {});
  }, []);
  const off = useOffline();
  const mobile = isMobile();

  const say = (text: string, error = false) => {
    setToast({ text, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), error ? 6000 : 2800);
  };
  const guard = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try { return await fn(); } catch (e) { say(errText(e), true); return undefined; }
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    lsSet("theme", theme);
  }, [theme]);

  // Atajos de teclado globales (no se disparan mientras se escribe).
  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      if (!overlay && !(e.target as HTMLElement).closest("input, textarea, select, .cm-editor") && !e.ctrlKey && !e.metaKey && !e.altKey && listNav(e)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOverlay("palette"); return; }
      const t = e.target as HTMLElement;
      const typing = t.closest("input, textarea, select, .cm-editor");
      if (e.key === "Escape" && overlay) { setOverlay(null); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || overlay) return;
      if (g && Date.now() - g < 1200) {
        const hit = visibleNav().find((n) => n.key === e.key);
        g = 0;
        if (hit) { e.preventDefault(); setRoute(hit.route); }
        return;
      }
      if (e.key === "g") { g = Date.now(); return; }
      if (e.key === "c") { e.preventDefault(); setOverlay("capture"); }
      else if (e.key === "a" && !isMobile()) { e.preventDefault(); setRoute("/asistente"); }
      else if (e.key === "f" && !isMobile()) { e.preventDefault(); void toggleFocus(); }
      else if (e.key === "?") setOverlay("help");
      else if (e.key === "/") { e.preventDefault(); setOverlay("palette"); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const toggleFocus = async () => {
    if (focus?.active) { setOverlay("endfocus"); return; }
    await guard(async () => {
      await api("POST", "/api/focus/start", {});
      say("Foco iniciado. Lo que captures quedará aparcado hasta terminar.");
    });
  };

  const openContext = (path: string) => { setCtxPath(path); setOverlay("context"); };

  const newNote = async (type: "note" | "project") => {
    const title = await askText(type === "project"
      ? { title: "Nuevo proyecto", placeholder: "Nombre del proyecto", confirm: "Crear" }
      : { title: "Nueva nota", placeholder: "Título de la nota", confirm: "Crear" });
    if (!title) return;
    await guard(async () => {
      if (type === "project") {
        const r = await api<{ path: string }>("POST", "/api/project/create", { title });
        setRoute(`/proyecto/${r.path}`);
      } else {
        const r = await api<{ path: string }>("POST", "/api/note/create", { title, type: "note" });
        setRoute(`/nota/${r.path}`);
      }
    });
  };

  const openJournal = () => guard(async () => {
    const r = await api<{ path: string }>("POST", "/api/journal", {});
    setRoute(`/nota/${r.path}`);
  });

  if (locked) {
    return <LockedScreen />;
  }

  let view;
  const [head, ...rest] = route.split("/").filter(Boolean);
  const arg = rest.join("/");
  switch (head) {
    case "bandeja": view = <InboxView rev={rev} go={setRoute} say={say} guard={guard} />; break;
    case "proyectos": view = <ProjectsView rev={rev} go={setRoute} onNew={() => newNote("project")} />; break;
    case "proyecto": view = <ProjectView key={arg} path={arg} rev={rev} go={setRoute} say={say} guard={guard} focus={focus} onContext={openContext} />; break;
    case "tareas": view = <TasksView rev={rev} go={setRoute} guard={guard} today={counts?.date} />; break;
    case "calendario": view = <CalendarView rev={rev} guard={guard} say={say} />; break;
    case "notas": view = <NotesView rev={rev} go={setRoute} onNew={() => newNote("note")} />; break;
    case "bases": view = arg ? <DatabaseView key={arg} path={arg} rev={rev} go={setRoute} guard={guard} say={say} /> : <DatabasesList rev={rev} go={setRoute} guard={guard} />; break;
    case "grafo": view = <GraphView key={arg} rev={rev} go={setRoute} focus={arg || undefined} />; break;
    case "asistente": view = arg === "actividad" ? <AssistantActivity rev={rev} say={say} /> : arg === "memoria" ? <AssistantMemory rev={rev} say={say} /> : <AssistantView rev={rev} say={say} go={setRoute} />; break;
    case "propuestas": view = <ProposalsView rev={rev} say={say} guard={guard} />; break;
    case "nota": view = <NoteView key={arg} path={arg} rev={rev} go={setRoute} />; break;
    default: view = <TodayScreen rev={rev} go={setRoute} guard={guard} say={say} onCapture={() => setOverlay("capture")} />;
  }
  const activeRoute = head ? `/${head === "proyecto" ? "proyectos" : head}` : "/hoy";

  return (
    <div class="shell">
      <nav class="sidebar" aria-label="Navegación">
        <div class="brand"><Seal />Kioku</div>
        {visibleNav().map((n) => (
          <a key={n.route} href={`#${n.route}`} class={activeRoute === n.route ? "active" : ""}>
            <Icon name={n.icon} /><span>{n.label}</span>
            {n.route === "/bandeja" && counts && counts.inbox.count > 0 && <b class="badge">{counts.inbox.count}</b>}
            {n.route === "/propuestas" && counts && counts.proposals > 0 && <b class="badge">{counts.proposals}</b>}
          </a>
        ))}
        <a href="#/diario" onClick={(e) => { e.preventDefault(); void openJournal(); }}><Icon name="diario" /><span>Diario</span></a>
        <div class="spacer" />
        <button class="side-btn" onClick={() => setOverlay("capture")}>Capturar <kbd>c</kbd></button>
        <button class="side-btn" onClick={() => setOverlay("palette")}>Buscar <kbd>Ctrl K</kbd></button>
        <button class="side-btn subtle" onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "auto" : "dark")}>
          Tema: {theme === "auto" ? "sistema" : theme === "dark" ? "oscuro" : "claro"}
        </button>
        <button class="side-btn subtle" onClick={() => setOverlay("help")}>Atajos <kbd>?</kbd></button>
      </nav>
      <div class="content">
        {focus?.active && !mobile && <FocusBar focus={focus} onEnd={() => setOverlay("endfocus")} go={setRoute} />}
        <main>{mobile && !off.online && <div class="offline-bar" role="status">{off.lastSync ? `Sin conexión · datos de ${formatAgo(off.lastSync, Date.now())}` : "Sin conexión · aún sin copia"}</div>}{view}</main>
      </div>

      <BottomNav active={activeRoute} pending={off.pending + off.failed} onSearch={() => setOverlay("palette")} onMore={() => setOverlay("more")} />
      <button class="fab" aria-label="Capturar" onClick={() => setOverlay("capture")}>+</button>
      {overlay === "more" && <MoreSheet off={off} counts={counts} theme={theme} setTheme={setTheme} onClose={() => setOverlay(null)} onCapture={() => setOverlay("capture")} onJournal={() => { setOverlay(null); void openJournal(); }} />}
      {overlay === "palette" && <Palette go={(r) => { setOverlay(null); setRoute(r); }} onClose={() => setOverlay(null)} newNote={() => { setOverlay(null); void newNote("note"); }}
        newProject={() => { setOverlay(null); void newNote("project"); }} journal={() => { setOverlay(null); void openJournal(); }} toggleFocus={() => { setOverlay(null); void toggleFocus(); }}
        focusActive={!!focus?.active} />}
      {overlay === "capture" && <CaptureOverlay onClose={() => setOverlay(null)} say={say} />}
      {overlay === "help" && <Help onClose={() => setOverlay(null)} />}
      {overlay === "endfocus" && focus?.active && <EndFocus focus={focus} onClose={() => setOverlay(null)} say={say} guard={guard} />}
      {overlay === "context" && ctxPath && <ContextDialog path={ctxPath} onClose={() => setOverlay(null)} />}
      {toast && <div class={`toast ${toast.error ? "err" : ""}`} role="status">{toast.text}</div>}
    </div>
  );
}

type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;
type Say = (t: string, e?: boolean) => void;

// ───────────────────────────── Foco ─────────────────────────────

function FocusBar({ focus, onEnd, go }: { focus: FocusState; onEnd(): void; go: Go }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const mins = Math.max(0, Math.round((now - new Date(focus.startedAt!).getTime()) / 60_000));
  return (
    <div class="focusbar" role="status">
      <span class="dot" />
      <div class="ftxt">
        <strong>{focus.taskTitle ?? focus.projectTitle ?? "Foco libre"}</strong>
        {focus.taskTitle && focus.projectTitle && <span class="muted"> · {focus.projectTitle}</span>}
        <span class="muted"> · {mins} min</span>
      </div>
      {focus.taskPath && <button onClick={() => go(`/nota/${focus.taskPath}`)}>Abrir</button>}
      <button class="primary" onClick={onEnd}>Terminar foco</button>
    </div>
  );
}

function EndFocus({ focus, onClose, say, guard }: { focus: FocusState; onClose(): void; say: Say; guard: Guard }) {
  const [cp, setCp] = useState("");
  const [done, setDone] = useState(false);
  const submit = async () => {
    const r = await guard(() => api<{ minutes: number }>("POST", "/api/focus/end", { checkpoint: cp.trim() || undefined, done }));
    if (r) { say(`Foco terminado (${r.minutes} min).${cp.trim() ? " Checkpoint guardado." : ""}`); onClose(); }
  };
  return (
    <Modal title="Terminar foco" onClose={onClose}>
      <p class="muted">Deja una nota para tu yo futuro: ¿dónde lo dejas y cuál es el siguiente paso?</p>
      <textarea autofocus rows={3} placeholder="Checkpoint (opcional)…" value={cp} onInput={(e) => setCp(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit(); }} />
      {focus.taskPath && <label class="check"><input type="checkbox" checked={done} onChange={(e) => setDone(e.currentTarget.checked)} /> Marcar «{focus.taskTitle}» como hecha</label>}
      {!focus.projectPath && cp.trim() && <p class="muted">Sin proyecto asociado: el checkpoint no se guardará.</p>}
      <div class="row end"><button onClick={onClose}>Cancelar</button><button class="primary" onClick={() => void submit()}>Terminar</button></div>
    </Modal>
  );
}

// ───────────────────────────── Hoy ─────────────────────────────

function TaskLine({ t, today, go, guard, onFocus }: { t: TaskRow; today?: string; go: Go; guard: Guard; onFocus?: () => void }) {
  const done = t.status === "done" || t.status === "dropped";
  const overdue = !!t.due && !!today && t.due < today && !done;
  return (
    <li class={`task ${done ? "is-done" : ""}`}>
      <input type="checkbox" checked={t.status === "done"} aria-label={`Marcar «${t.title}» como hecha`}
        onChange={(e) => void guard(() => api("POST", "/api/task/status", { path: t.path, status: e.currentTarget.checked ? "done" : "todo" }))} />
      <a class="ttitle" href={`#/nota/${enc(t.path)}`}>{t.title}</a>
      {t.status === "doing" && <span class="chip accent">en curso</span>}
      {t.priority && <span class="chip">p{t.priority}</span>}
      {t.due && <span class={`chip ${overdue ? "bad" : ""}`}>{relDate(t.due, today)}</span>}
      {t.projectPath && <a class="chip link" href={`#/proyecto/${enc(t.projectPath)}`}>{t.projectTitle}</a>}
      {onFocus && !done && <button class="mini" onClick={onFocus} title="Empezar foco">▶</button>}
    </li>
  );
}

function TodayScreen({ rev, go, guard, say, onCapture }: { rev: number; go: Go; guard: Guard; say: Say; onCapture(): void }) {
  const { data: t, error } = useApi<TodayView>("/api/today", rev);
  if (error) return <div class="empty">No se pudo cargar: {error}</div>;
  if (!t) return <div class="empty muted">Cargando…</div>;
  const start = (path: string) => guard(async () => { await api("POST", "/api/focus/start", { taskPath: path }); say("Foco iniciado."); });
  const nothing = !t.suggestion && t.resume.length === 0 && t.inbox.count === 0;
  const mobile = isMobile();
  return (
    <div class="page narrow">
      <h1>Hoy <span class="muted date">{t.date}</span></h1>
      {t.suggestion ? (
        <section class="card next">
          <div class="eyebrow">Siguiente paso</div>
          <h2><a href={`#/nota/${enc(t.suggestion.task.path)}`}>{t.suggestion.task.title}</a></h2>
          <div class="meta">
            {t.suggestion.task.projectTitle && <a class="chip link" href={`#/proyecto/${enc(t.suggestion.task.projectPath!)}`}>{t.suggestion.task.projectTitle}</a>}
            {t.suggestion.reasons.map((r) => <span class="chip" key={r}>{r}</span>)}
          </div>
          <div class="row">
            {!t.focus.active && !mobile && <button class="primary" onClick={() => void start(t.suggestion!.task.path)}>Empezar foco</button>}
            <button onClick={() => void guard(() => api("POST", "/api/task/status", { path: t.suggestion!.task.path, status: "done" }))}>Ya está hecha</button>
          </div>
          {t.alternatives.length > 0 && (
            <details>
              <summary>Otras opciones ({t.alternatives.length})</summary>
              <ul class="tasks">
                {t.alternatives.map((a) => <TaskLine key={a.task.path} t={a.task} today={t.date} go={go} guard={guard} onFocus={t.focus.active || mobile ? undefined : () => void start(a.task.path)} />)}
              </ul>
            </details>
          )}
        </section>
      ) : (
        <section class="card"><div class="eyebrow">Siguiente paso</div><p class="muted">No hay tareas abiertas. Captura algo con <kbd>c</kbd> o escribe <code>t …</code>.</p></section>
      )}

      {(t.overdue > 0 || t.inbox.count > 0 || (t.proposals > 0 && !mobile)) && (
        <div class="pills">
          {t.overdue > 0 && <a class="pill bad" href="#/tareas">{plural(t.overdue, "tarea vencida", "tareas vencidas")}</a>}
          {t.inbox.count > 0 && <a class="pill" href="#/bandeja">{plural(t.inbox.count, "captura sin procesar", "capturas sin procesar")}</a>}
          {t.proposals > 0 && !mobile && <a class="pill accent" href="#/propuestas">{plural(t.proposals, "propuesta por revisar", "propuestas por revisar")}</a>}
        </div>
      )}

      {t.resume.length > 0 && (
        <section>
          <h2 class="sec">Retomar</h2>
          <div class="grid">
            {t.resume.map((r) => <ResumeTile key={r.project.path} r={r} go={go} />)}
          </div>
        </section>
      )}
      {nothing && (
        <section class="card welcome">
          <h2>Empieza por aquí</h2>
          <p class="muted">Pulsa <kbd>c</kbd> (o usa Quick) y escribe sin pensar dónde va:</p>
          <ul class="plain ex">
            <li><code>Idea suelta</code> → Bandeja</li>
            <li><code>t Llamar a Ana !mañana p1</code> → tarea con fecha y prioridad</li>
            <li><code>t Maquetar home @MiWeb</code> → tarea en un proyecto</li>
            <li><code>d Usaremos SQLite @MiWeb</code> → decisión registrada en el proyecto</li>
          </ul>
          <div class="row"><button class="primary" onClick={onCapture}>Capturar ahora</button><a href="#/proyectos">Crear un proyecto</a></div>
        </section>
      )}
    </div>
  );
}

function ResumeTile({ r, go }: { r: ResumeCard; go: Go }) {
  return (
    <button class="tile" onClick={() => go(`/proyecto/${r.project.path}`)}>
      <div class="tile-title">{r.project.title}</div>
      <div class="muted small">{r.idleDays === null ? "sin actividad registrada" : r.idleDays === 0 ? "activo hoy" : `parado hace ${r.idleDays} d`} · {plural(r.open.length, "tarea abierta", "tareas abiertas")}</div>
      {r.lastCheckpoint ? <p class="cp">{r.lastCheckpoint.text}</p> : <p class="cp muted">Sin checkpoint todavía</p>}
    </button>
  );
}

// ───────────────────────────── Bandeja ─────────────────────────────

function InboxView({ rev, go, say, guard }: { rev: number; go: Go; say: Say; guard: Guard }) {
  const { data } = useApi<{ path: string; title: string; mtime: number; excerpt: string }[]>("/api/inbox", rev);
  const mobile = isMobile();
  const props = useApi<Proposal[]>(mobile ? null : "/api/proposals", rev).data ?? [];
  const triaged = new Set(props.map((p) => p.key));
  const suggest = () => guard(async () => {
    const r = await api<Proposal[]>("POST", "/api/triage");
    say(r.length ? `${plural(r.length, "propuesta nueva", "propuestas nuevas")} en Propuestas.` : "Nada nuevo que proponer.");
  });
  const convert = (path: string, kind: "task" | "note") => guard(async () => {
    await api("POST", "/api/capture/convert", { path, kind });
    say(kind === "task" ? "Convertida en tarea." : "Guardada como nota.");
  });
  const discard = (path: string, title: string) => guard(async () => {
    if (!(await askConfirm({ title: `¿Descartar «${title}»?`, body: "Va a la papelera de Kioku (.kioku/trash) y se puede recuperar.", confirm: "Descartar", danger: true }))) return;
    await api("POST", "/api/note/delete", { path });
    say("Descartada.");
  });
  return (
    <div class="page narrow">
      <header class="page-head">
        <h1>Bandeja</h1>
        {!mobile && <button onClick={() => void suggest()}>Sugerir organización</button>}
      </header>
      {mobile
        ? <p class="muted">Capturas sin procesar. Conviértelas en tarea o nota; organizarlas con sugerencias se hace en el portátil.</p>
        : <p class="muted">Capturas sin procesar. Nada se mueve solo: las sugerencias llegan como <a href="#/propuestas">propuestas</a> que tú apruebas.</p>}
      {data && data.length === 0 && <div class="empty">Bandeja vacía.</div>}
      <ul class="cards">
        {(data ?? []).map((n) => (
          <li key={n.path} class="card">
            <a class="ctitle" href={`#/nota/${enc(n.path)}`}>{n.title}</a>
            {n.excerpt && n.excerpt !== n.title && <p class="excerpt">{n.excerpt}</p>}
            <div class="row small">
              <span class="muted">{new Date(n.mtime).toLocaleString("es")}</span>
              {triaged.has(`triage:${n.path}`) && <a class="chip accent" href="#/propuestas">tiene propuesta</a>}
              <span class="grow" />
              <button class="mini" onClick={() => void convert(n.path, "task")}>→ Tarea</button>
              <button class="mini" onClick={() => void convert(n.path, "note")}>→ Nota</button>
              <button class="mini" onClick={() => go(`/nota/${n.path}`)}>Abrir</button>
              {!mobile && <button class="mini danger" onClick={() => void discard(n.path, n.title)}>Descartar</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────────────────────── Proyectos ─────────────────────────────

function ProjectsView({ rev, go, onNew }: { rev: number; go: Go; onNew(): void }) {
  const { data } = useApi<ResumeCard[]>("/api/projects", rev);
  const groups: [string, string][] = [["active", "Activos"], ["paused", "En pausa"], ["someday", "Algún día"], ["done", "Terminados"]];
  return (
    <div class="page">
      <header class="page-head"><h1>Proyectos</h1>{!isMobile() && <button class="primary" onClick={onNew}>Nuevo proyecto</button>}</header>
      {data && data.length === 0 && <div class="empty">Aún no hay proyectos. Crea uno o escribe <code>t algo @NuevoProyecto</code>.</div>}
      {groups.map(([st, label]) => {
        const items = (data ?? []).filter((r) => (r.project.status || "active") === st);
        if (!items.length) return null;
        return (
          <section key={st}>
            <h2 class="sec">{label}</h2>
            <div class="grid">{items.map((r) => <ResumeTile key={r.project.path} r={r} go={go} />)}</div>
          </section>
        );
      })}
    </div>
  );
}

function ProjectView({ path, rev, go, say, guard, focus, onContext }: { path: string; rev: number; go: Go; say: Say; guard: Guard; focus: FocusState | null; onContext(p: string): void }) {
  const { data: r, error } = useApi<ResumeCard>(`/api/project?path=${encodeURIComponent(path)}`, rev);
  const [cp, setCp] = useState("");
  const [dec, setDec] = useState("");
  const [task, setTask] = useState("");
  if (error) return <div class="empty">No se pudo abrir el proyecto: {error}</div>;
  if (!r) return <div class="empty muted">Cargando…</div>;
  const add = async (kind: "checkpoint" | "decision", text: string, clear: () => void) => {
    if (!text.trim()) return;
    if (await guard(() => api("POST", `/api/project/${kind}`, { path, text }))) { clear(); say(kind === "checkpoint" ? "Checkpoint guardado." : "Decisión registrada."); }
  };
  const addTask = async () => {
    if (!task.trim()) return;
    const title = r.project.title.includes(" ") ? `@[${r.project.title}]` : `@${r.project.title}`;
    if (await guard(() => api<CaptureResult>("POST", "/api/capture", { text: `t ${task.trim()} ${title}` }))) setTask("");
  };
  return (
    <div class="page">
      <header class="page-head">
        <div>
          <h1>{r.project.title}</h1>
          <div class="muted small">{r.project.status} · {r.idleDays === null ? "sin actividad registrada" : r.idleDays === 0 ? "activo hoy" : `parado hace ${r.idleDays} d`}</div>
        </div>
        {!isMobile() && <div class="row">
          <button onClick={() => onContext(path)} title="Muestra exactamente qué datos recibiría un modelo de IA">Contexto IA</button>
          {!focus?.active && <button class="primary" onClick={() => void guard(async () => { await api("POST", "/api/focus/start", { projectPath: path }); say("Foco iniciado."); })}>Foco en este proyecto</button>}
        </div>}
      </header>
      <div class="two">
        <div>
          <section class="card">
            <div class="eyebrow">Dónde lo dejaste</div>
            {r.lastCheckpoint ? <><p class="cp big">{r.lastCheckpoint.text}</p><div class="muted small">{r.lastCheckpoint.ts}</div></> : <p class="muted">Sin checkpoint. Escribe uno abajo al terminar de trabajar.</p>}
            {!isMobile() && <form class="inline" onSubmit={(e) => { e.preventDefault(); void add("checkpoint", cp, () => setCp("")); }}>
              <input placeholder="Nuevo checkpoint: dónde lo dejas, siguiente paso…" value={cp} onInput={(e) => setCp(e.currentTarget.value)} />
              <button>Guardar</button>
            </form>}
          </section>
          <section class="card">
            <div class="eyebrow">Tareas abiertas ({r.open.length})</div>
            <ul class="tasks">{r.open.map((t) => <TaskLine key={t.path} t={t} go={go} guard={guard} />)}</ul>
            <form class="inline" onSubmit={(e) => { e.preventDefault(); void addTask(); }}>
              <input placeholder="Nueva tarea… (!mañana p1)" value={task} onInput={(e) => setTask(e.currentTarget.value)} />
              <button>Añadir</button>
            </form>
          </section>
        </div>
        <div>
          <section class="card">
            <div class="eyebrow">Decisiones</div>
            {r.decisions.length === 0 && <p class="muted">Aún ninguna.</p>}
            <ul class="plain">{r.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
            {!isMobile() && <form class="inline" onSubmit={(e) => { e.preventDefault(); void add("decision", dec, () => setDec("")); }}>
              <input placeholder="Registrar decisión y su porqué…" value={dec} onInput={(e) => setDec(e.currentTarget.value)} />
              <button>Registrar</button>
            </form>}
          </section>
          {r.touched.length > 0 && (
            <section class="card">
              <div class="eyebrow">Notas tocadas recientemente</div>
              <ul class="plain">{r.touched.map((n) => <li key={n.path}><a href={`#/nota/${enc(n.path)}`}>{n.title}</a></li>)}</ul>
            </section>
          )}
        </div>
      </div>
      <h2 class="sec">Nota del proyecto</h2>
      <div class="embedded"><NoteView key={path} path={path} rev={rev} go={go} embedded /></div>
    </div>
  );
}

// ───────────────────────────── Tareas ─────────────────────────────

function TasksView({ rev, go, guard, today }: { rev: number; go: Go; guard: Guard; today?: string }) {
  const { data } = useApi<TaskRow[]>("/api/tasks", rev);
  const [showDone, setShowDone] = useState(false);
  const [q, setQ] = useState("");
  const [nt, setNt] = useState("");
  const [mode, setModeRaw] = useState<"lista" | "tabla" | "tablero">(() => { const m = lsGet("tasks.mode"); return m === "tabla" || m === "tablero" ? m : "lista"; });
  const setMode = (m: typeof mode) => { setModeRaw(m); lsSet("tasks.mode", m); };
  const list = (data ?? []).filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase()) || (t.projectTitle ?? "").toLowerCase().includes(q.toLowerCase()));
  const doing = list.filter((t) => t.status === "doing");
  const open = list.filter((t) => t.status === "todo").sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || (a.priority ?? 9) - (b.priority ?? 9));
  const closed = list.filter((t) => t.status === "done" || t.status === "dropped").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")).slice(0, 50);
  const Group = ({ title, items }: { title: string; items: TaskRow[] }) => items.length ? (
    <section><h2 class="sec">{title} <span class="muted">{items.length}</span></h2><ul class="tasks">{items.map((t) => <TaskLine key={t.path} t={t} today={today} go={go} guard={guard} />)}</ul></section>
  ) : null;
  return (
    <div class={`page ${mode === "lista" ? "narrow" : "wide"}`}>
      <header class="page-head"><h1>Tareas</h1><div class="row">
        <div class="seg" role="tablist" aria-label="Vista">
          {(["lista", "tabla", "tablero"] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} class={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}
        </div>
        <input class="search" placeholder="Filtrar…" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      </div></header>
      <form class="inline addbar" onSubmit={(e) => { e.preventDefault(); if (!nt.trim()) return; void guard(async () => { await api("POST", "/api/capture", { text: `t ${nt.trim()}` }); setNt(""); }); }}>
        <input placeholder="Nueva tarea…  !mañana  @proyecto  p1" value={nt} onInput={(e) => setNt(e.currentTarget.value)} />
        <button class="primary">Añadir</button>
      </form>
      {data && data.length === 0 && <div class="empty">Sin tareas. Crea una con <code>t …</code> desde Quick (o pulsa <kbd>c</kbd>).</div>}
      {mode === "tabla" && <TaskTable tasks={list} today={today} guard={guard} fmt={relDate} />}
      {mode === "tablero" && <TaskBoard tasks={list} today={today} guard={guard} fmt={relDate} />}
      {mode === "lista" && <>
        <Group title="En curso" items={doing} />
        <Group title="Pendientes" items={open} />
        <div class="row"><button class={`chip btn ${showDone ? "on" : ""}`} onClick={() => setShowDone(!showDone)}>{showDone ? "Ocultar completadas" : "Mostrar completadas"}</button></div>
        {showDone && <Group title="Completadas" items={closed} />}
      </>}
    </div>
  );
}

// ───────────────────────────── Notas ─────────────────────────────

function NotesView({ rev, go, onNew }: { rev: number; go: Go; onNew(): void }) {
  const { data } = useApi<NoteListItem[]>("/api/notes", rev);
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const types = ["all", "note", "capture", "project", "task", "journal", "resource"];
  const label: Record<string, string> = { all: "Todas", note: "Notas", capture: "Capturas", project: "Proyectos", task: "Tareas", journal: "Diario", resource: "Recursos" };
  const list = (data ?? [])
    .filter((n) => (type === "all" || n.type === type) && (!q || n.title.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.mtime - a.mtime);
  return (
    <div class="page narrow">
      <header class="page-head"><h1>Notas</h1><div class="row"><input class="search" placeholder="Filtrar por título…" value={q} onInput={(e) => setQ(e.currentTarget.value)} /><button class="primary" onClick={onNew}>Nueva nota</button></div></header>
      <div class="chips">{types.map((tp) => <button key={tp} class={`chip btn ${type === tp ? "on" : ""}`} onClick={() => setType(tp)}>{label[tp]}</button>)}</div>
      <ul class="rows">
        {list.slice(0, 400).map((n) => (
          <li key={n.path}>
            <a href={`#/nota/${enc(n.path)}`}>{n.title}</a>
            <span class="chip">{label[n.type] ?? n.type}</span>
            <span class="muted small path">{n.path}</span>
          </li>
        ))}
      </ul>
      {data && list.length === 0 && <div class="empty">Nada que mostrar.</div>}
    </div>
  );
}

// ───────────────────────────── Propuestas ─────────────────────────────

function OpView({ op }: { op: Proposal["ops"][number] & { current?: Record<string, unknown> | null } }) {
  switch (op.op) {
    case "create": return <div class="op"><b>Crear</b> <code>{op.path}</code><pre>{op.text}</pre></div>;
    case "update": return <div class="op"><b>Reemplazar contenido de</b> <code>{op.path}</code><pre>{op.text}</pre></div>;
    case "move": return <div class="op"><b>Mover</b> <code>{op.from}</code> → <code>{op.to}</code></div>;
    case "trash": return <div class="op"><b>Mover a la papelera</b> <code>{op.path}</code></div>;
    case "setProp":
      return (
        <div class="op"><b>Cambiar propiedades de</b> <code>{op.path}</code>
          <table class="diff"><tbody>
            {Object.entries(op.props).map(([k, v]) => (
              <tr key={k}><td>{k}</td><td class="old">{op.current && k in op.current ? JSON.stringify(op.current[k]) : "—"}</td><td>→</td><td class="new">{v === null ? "(quitar)" : JSON.stringify(v)}</td></tr>
            ))}
          </tbody></table>
        </div>
      );
  }
}


interface AiStatus { configured: boolean; model?: string; baseUrl?: string; local?: boolean; apiKeyEnv?: string | null }
interface AiPayload { endpoint: string; model: string; local: boolean; captures: number; hash: string; messages: { role: string; content: string }[] }

/** IA opcional: siempre se ve el payload exacto y se confirma antes de enviar nada. */
function AiPanel({ rev, say, guard }: { rev: number; say: Say; guard: Guard }) {
  const { data: st } = useApi<AiStatus>("/api/ai", rev);
  const [prev, setPrev] = useState<AiPayload | null>(null);
  if (!st) return null;
  if (!st.configured) return <p class="muted small">IA de un modelo real: opcional y desactivada. Para usar tu modelo local o una API: <code>kioku ai config &lt;url&gt; &lt;modelo&gt;</code>.</p>;
  const look = () => guard(async () => {
    const r = await api<AiPayload | null>("GET", "/api/ai/preview");
    if (!r) say("Nada que enviar: la Bandeja está vacía o ya tiene propuestas del modelo.");
    else setPrev(r);
  });
  const send = () => guard(async () => {
    const r = await api<Proposal[]>("POST", "/api/ai/triage", { hash: prev!.hash });
    setPrev(null);
    say(r.length ? `${plural(r.length, "propuesta del modelo", "propuestas del modelo")}.` : "El modelo no propuso nada.");
  });
  return (
    <>
      <div class="row"><button onClick={() => void look()}>Clasificar la Bandeja con IA ({st.model})…</button>
        <span class={`chip ${st.local ? "" : "bad"}`}>{st.local ? "modelo local" : "API remota"}</span></div>
      {prev && (
        <Modal title="Esto es lo que se enviaría" onClose={() => setPrev(null)} wide>
          <p class="small">Destino: <code>{prev.endpoint}</code> · modelo <code>{prev.model}</code> · {plural(prev.captures, "captura", "capturas")}.</p>
          <p class={`small ${prev.local ? "muted" : "bad-text"}`}>{prev.local ? "El destino es tu propia máquina: los datos no salen de ella." : "El destino es REMOTO: estos datos saldrán de tu máquina al pulsar «Enviar»."} La respuesta solo se convierte en propuestas que tú apruebas.</p>
          <pre class="ctxjson">{prev.messages.map((m) => `── ${m.role} ──\n${m.content}`).join("\n\n")}</pre>
          <div class="row end"><button onClick={() => setPrev(null)}>Cancelar</button><button class="primary" onClick={() => void send()}>Enviar exactamente esto</button></div>
        </Modal>
      )}
    </>
  );
}

function ProposalsView({ rev, say, guard }: { rev: number; say: Say; guard: Guard }) {
  const { data, reload } = useApi<Proposal[]>("/api/proposals?status=pending", rev);
  const act = async (id: string, what: "apply" | "reject") => {
    const r = await guard(() => api<Proposal>("POST", `/api/proposals/${id}/${what}`));
    if (r) { say(what === "apply" ? "Aplicada." : "Descartada."); reload(); }
  };
  return (
    <div class="page narrow">
      <header class="page-head"><h1>Propuestas</h1>
        <button onClick={() => void guard(async () => { const r = await api<Proposal[]>("POST", "/api/triage"); say(r.length ? `${r.length} nuevas.` : "Nada nuevo."); })}>Revisar bandeja</button>
      </header>
      <AiPanel rev={rev} say={say} guard={guard} />
      <p class="muted">Todo cambio que no hagas tú directamente pasa por aquí. Ves exactamente qué se tocará; si el archivo cambió desde que se propuso, la propuesta se aborta entera.</p>
      {data && data.length === 0 && <div class="empty">No hay propuestas pendientes.</div>}
      {(data ?? []).map((p) => (
        <section key={p.id} class="card">
          <div class="eyebrow">{p.source}</div>
          <h2>{p.title}</h2>
          <p class="muted">{p.rationale}</p>
          {p.ops.map((op, i) => <OpView key={i} op={op} />)}
          <div class="row">
            <button class="primary" onClick={() => void act(p.id, "apply")}>Aplicar</button>
            <button onClick={() => void act(p.id, "reject")}>Descartar</button>
          </div>
        </section>
      ))}
    </div>
  );
}

// ───────────────────────────── Móvil ─────────────────────────────

/** Pantalla sin clave. En el móvil la cookie de Safari no siempre pasa a la app instalada: se puede pegar la clave o la URL de `kioku pair`. */
function LockedScreen() {
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const submit = (e: Event) => {
    e.preventDefault();
    const k = extractKey(text);
    if (!k) { setBad(true); return; }
    location.href = `/?k=${k}`; // el daemon cambia la clave por una cookie y redirige
  };
  return (
    <div class="empty locked">
      <h2>Falta la clave de Kioku</h2>
      <p>Esta página no se abrió con la clave del daemon. En el portátil, ábrela con <code>kioku open</code> (o copia la URL de <code>kioku url</code>). Desde el móvil, pega aquí la clave o la dirección que da <code>kioku pair</code>.</p>
      <form class="inline" onSubmit={submit}>
        <input placeholder="Clave o dirección de emparejamiento" value={text} autocomplete="off" autocapitalize="off" spellcheck={false} aria-label="Clave o dirección de emparejamiento"
          onInput={(e) => { setText(e.currentTarget.value); setBad(false); }} />
        <button class="primary">Entrar</button>
      </form>
      {bad && <p class="bad-text" role="alert">Eso no parece una clave de Kioku (64 caracteres) ni una dirección con <code>?k=</code>.</p>}
    </div>
  );
}

/** Barra inferior (solo se ve en pantallas estrechas): lo más usado a un pulgar. */
function BottomNav({ active, pending, onSearch, onMore }: { active: string; pending: number; onSearch(): void; onMore(): void }) {
  const items: [string, string, string][] = [["/hoy", "Hoy", "hoy"], ["/calendario", "Calendario", "calendario"], ["/tareas", "Tareas", "tareas"], ["/notas", "Notas", "notas"]];
  return (
    <nav class="bottomnav" aria-label="Navegación">
      {items.map(([route, label, icon]) => (
        <a key={route} href={`#${route}`} class={active === route ? "active" : ""}><Icon name={icon} /><span>{label}</span></a>
      ))}
      <button onClick={onSearch}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><span>Buscar</span></button>
      <button onClick={onMore}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg><span>Más</span>{pending > 0 && <b class="nav-badge" aria-label={`${pending} capturas sin enviar`}>{pending}</b>}</button>
    </nav>
  );
}

/** «Más»: el resto de pantallas en el móvil. */
function MoreSheet({ off, counts, theme, setTheme, onClose, onCapture, onJournal }: { off: OfflineState; counts: TodayView | null; theme: string; setTheme(t: string): void; onClose(): void; onCapture(): void; onJournal(): void }) {
  const rest = visibleNav().filter((n) => !["/hoy", "/calendario", "/tareas", "/notas"].includes(n.route));
  return (
    <div class="scrim sheet-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal sheet" role="dialog" aria-label="Más">
        <ul class="sheet-list">
          {rest.map((n) => (
            <li key={n.route}>
              <a href={`#${n.route}`} onClick={onClose}><Icon name={n.icon} /><span>{n.label}</span>
                {n.route === "/bandeja" && counts && counts.inbox.count > 0 && <b class="badge">{counts.inbox.count}</b>}
                {n.route === "/propuestas" && counts && counts.proposals > 0 && <b class="badge">{counts.proposals}</b>}
              </a>
            </li>
          ))}
          <li><a href="#/diario" onClick={(e) => { e.preventDefault(); onJournal(); }}><Icon name="diario" /><span>Diario de hoy</span></a></li>
          <li><button onClick={onCapture}>Captura rápida</button></li>
          <li><button onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "auto" : "dark")}>Tema: {theme === "auto" ? "sistema" : theme === "dark" ? "oscuro" : "claro"}</button></li>
        </ul>
        <OfflineSection off={off} />
      </div>
    </div>
  );
}

/** Estado de la copia sin conexión: capturas sin enviar, última sincronización y espacio usado. */
function OfflineSection({ off }: { off: OfflineState }) {
  const [queue, setQueue] = useState<QueuedCapture[]>([]);
  const [used, setUsed] = useState<string | null>(null);
  useEffect(() => { void loadQueue().then(setQueue); }, [off.pending, off.failed]);
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => { if (e.usage != null) setUsed(e.usage < 1_048_576 ? `${Math.max(1, Math.round(e.usage / 1024))} KB` : `${(e.usage / 1_048_576).toFixed(1)} MB`); }, () => {});
  }, [off.lastSync]);
  const failed = queue.filter((c) => c.state === "failed");
  return (
    <div class="offline-info">
      {off.pending > 0 && <p>{off.pending === 1 ? "1 captura sin enviar" : `${off.pending} capturas sin enviar`}: se enviará{off.pending === 1 ? "" : "n"} al abrir con red.</p>}
      {failed.map((c) => (
        <div class="failed-capture" key={c.opId}>
          <p><b>No se pudo enviar:</b> {c.text}<br /><span class="muted small">{c.error}</span></p>
          <div class="row"><button onClick={() => void retryCapture(c.opId)}>Reenviar</button><button onClick={() => void discardCapture(c.opId)}>Descartar</button></div>
        </div>
      ))}
      <p class="muted small">Última sincronización: {off.lastSync ? formatAgo(off.lastSync, Date.now()) : "todavía ninguna"}{used ? ` · ${used} en este dispositivo` : ""}</p>
      <button disabled={off.syncing} onClick={() => void syncNow()}>{off.syncing ? "Sincronizando…" : "Sincronizar ahora"}</button>
    </div>
  );
}

// ───────────────────────────── Overlays ─────────────────────────────

function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: preact.ComponentChildren; wide?: boolean }) {
  return (
    <div class="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class={`modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function CaptureOverlay({ onClose, say }: { onClose(): void; say: Say }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      // En el móvil la captura pasa por la cola: sin red se guarda y se envía al abrir con red.
      const r = isMobile() ? await submit(text) : { sent: true as const, result: await api<CaptureResult>("POST", "/api/capture", { text }) };
      if (r.sent) say(r.result.message + (r.result.warnings.length ? ` (${r.result.warnings.join("; ")})` : ""));
      else say("Guardada sin conexión; se enviará al abrir con red");
      onClose();
    } catch (e) { say(errText(e), true); setBusy(false); }
  };
  return (
    <Modal title="Captura rápida" onClose={onClose}>
      <input class="big-input" autofocus placeholder="Idea suelta · t tarea !mañana @proyecto p1 · d decisión · n nota" value={text}
        onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
      <p class="muted small">Enter para guardar. Sin prefijo va a la Bandeja; nada se organiza solo.</p>
    </Modal>
  );
}

interface PaletteItem { label: string; hint?: string; run(): void }

function Palette(p: { go(r: string): void; onClose(): void; newNote(): void; newProject(): void; journal(): void; toggleFocus(): void; focusActive: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const cmds: PaletteItem[] = [
    ...visibleNav().map((n) => ({ label: `Ir a ${n.label}`, hint: `g ${n.key}`, run: () => p.go(n.route) })),
    { label: "Nueva nota", run: p.newNote },
    ...(isMobile() ? [] : [{ label: "Nuevo proyecto", run: p.newProject }]),
    { label: "Abrir diario de hoy", run: p.journal },
    ...(isMobile() ? [] : [{ label: p.focusActive ? "Terminar foco" : "Iniciar foco", hint: "f", run: p.toggleFocus }]),
  ];
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    let dead = false;
    const t = setTimeout(() => {
      api<SearchHit[]>("GET", `/api/search?q=${encodeURIComponent(q)}&limit=12`).then((h) => { if (!dead) setHits(h); }, () => {});
    }, 90);
    return () => { dead = true; clearTimeout(t); };
  }, [q]);
  const ql = q.trim().toLowerCase();
  const shownCmds = ql ? cmds.filter((c) => c.label.toLowerCase().includes(ql)) : cmds;
  const items: PaletteItem[] = [
    ...hits.map((h) => ({
      label: h.title, hint: h.type,
      run: () => p.go(h.type === "project" ? `/proyecto/${h.path}` : `/nota/${h.path}`),
      snippet: h.snippet,
    } as PaletteItem & { snippet?: string })),
    ...shownCmds,
  ];
  useEffect(() => setSel(0), [q, hits.length]);
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
  };
  return (
    <div class="scrim top" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="modal palette" role="dialog" aria-label="Buscar o ejecutar">
        <input class="big-input" autofocus placeholder="Buscar notas, tareas, proyectos… o escribir un comando" value={q} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={key} />
        <ul class="plist" role="listbox">
          {items.map((it, i) => (
            <li key={i} role="option" aria-selected={i === sel} class={i === sel ? "sel" : ""} onMouseEnter={() => setSel(i)} onClick={() => it.run()}>
              <span>{it.label}</span>
              {(it as { snippet?: string }).snippet && <span class="snip" dangerouslySetInnerHTML={{ __html: snippetHtml((it as { snippet?: string }).snippet!) }} />}
              {it.hint && <span class="chip">{it.hint}</span>}
            </li>
          ))}
          {items.length === 0 && <li class="muted">Sin resultados</li>}
        </ul>
      </div>
    </div>
  );
}

/** Los snippets de FTS marcan coincidencias con «…»; se escapa todo y se resalta. */
function snippetHtml(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/«/g, "<mark>").replace(/»/g, "</mark>");
}

function Help({ onClose }: { onClose(): void }) {
  const rows: [string, string][] = [
    ["Ctrl K  ·  /", "Buscar y comandos"], ["c", "Captura rápida"], ["a", "Hablar con el asistente"], ["f", "Iniciar / terminar foco"],
    ["g h · b · p · t · c · n · d · g · a · r", "Ir a Hoy · Bandeja · Proyectos · Tareas · Calendario · Notas · Bases · Grafo · Asistente · Propuestas"],
    ["Ctrl Enter (editor)", "Seguir [[enlace]] o marcar casilla"], ["Ctrl S (editor)", "Guardar ahora (si no, autoguardado)"], ["j · k · Enter · x", "En listas: bajar · subir · abrir · marcar hecha"], ["Esc", "Cerrar"],
  ];
  return (
    <Modal title="Atajos" onClose={onClose}>
      <table class="keys"><tbody>{rows.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody></table>
      <p class="muted small">Quick (desde cualquier lugar): asigna una tecla de Hyprland a <code>kioku quick</code>.<br />Sintaxis: <code>t tarea !mañana @proyecto p1</code> · <code>d decisión @proyecto</code> · <code>n nota</code></p>
    </Modal>
  );
}

function ContextDialog({ path, onClose }: { path: string; onClose(): void }) {
  const { data, error } = useApi<unknown>(`/api/context?path=${encodeURIComponent(path)}`, 0);
  return (
    <Modal title="Contexto que vería un modelo de IA" onClose={onClose} wide>
      <p class="muted small">Esto es exactamente lo que se enviaría a un proveedor (por defecto solo se usan reglas locales; un modelo real es opcional (kioku ai config)). No hay memoria oculta.</p>
      <pre class="ctxjson">{error ?? JSON.stringify(data, null, 2)}</pre>
      <div class="row end"><button onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

render(<App />, document.getElementById("root")!);
