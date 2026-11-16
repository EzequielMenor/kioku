import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "./app.css";
import { UNAUTHORIZED_EVENT, api, lsGet, lsSet, setDemoTransport } from "./api.ts";
import { AssistantActivity, AssistantMemory, AssistantView } from "./assistant.tsx";
import { AssistantManagement } from "./assistant-management.tsx";
import { Companion, CompanionModeButton, KioFace } from "./companion.tsx";
import { ConnectionsView } from "./connections.tsx";
import { UpdateBanner } from "./update-panel.tsx";
import { DeviceEnrollment } from "./device-access.tsx";
import { enrollmentToken } from "./device-access-model.ts";
import { DatabasesList, DatabaseView } from "./databases.tsx";
import { CalendarView } from "./calendar.tsx";
import { enableDemoMode, handleDemoApi, isDemoMode, onDemoChange, resetDemoState } from "./demo/engine.ts";
import { askConfirm, askText } from "./dialogs.tsx";
import { useApi, useRevision, useRoute } from "./hooks.ts";
import { GraphView } from "./graph.tsx";
import { DemoBar, LandingView } from "./landing.tsx";
import { extractKey } from "./pairing.ts";
import { SEAL_PATH } from "./seal.ts";
import { MOBILE_HIDDEN, getRole, isMobile, setRole } from "./role.ts";
import { discardCapture, formatAgo, loadQueue, retryCapture, startOffline, submit, syncNow, useOffline, wipeOffline, loadMutations, retryMutation, resetMutationPath, setTaskStatus, type OfflineState } from "./offline/runtime.ts";
import type { TaskStatus } from "./offline/store.ts";
import type { QueuedCapture, StoredMutation } from "./offline/store.ts";
import { NoteView } from "./note-view.tsx";
import { KioBox, KioRecent } from "./kio-box.tsx";
import { HabitsToday } from "./db-trackers.tsx";
import { extractFolders, isKnowledgeNote, listKnowledgeNotes, noteFolder } from "./notes-model.ts";
import { priorityLabel } from "./priority.ts";
import { OpView } from "./proposal-ops.tsx";
import { currentState, disablePush, enablePush, type PushState } from "./push.ts";
import { TaskForm } from "./task-form.tsx";
import { TaskBoard, TaskTable } from "./task-views.tsx";
import type {
  CalendarEntry, CalendarResponse, CaptureResult, FocusState, NoteListItem, Proposal, ResumeCard, SearchHit, TaskRow, TodayView,
} from "./types.ts";

type Go = (route: string) => void;
type Toast = { text: string; error?: boolean; action?: { label: string; run(): void } };
/** Aviso desde fuera del árbol de App (filas de tareas): lo fija App en cada render. */
let toastApi: ((t: Toast) => void) | null = null;

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
  { route: "/asistente", label: "Kio", key: "a", icon: "asistente" },
  { route: "/notas", label: "Notas", key: "n", icon: "notas" },
  { route: "/tareas", label: "Tareas", key: "t", icon: "tareas" },
  { route: "/calendario", label: "Calendario", key: "c", icon: "calendario" },
  { route: "/bases", label: "Bases", key: "d", icon: "bases" },
];
/** Pantallas que viven dentro de una sección: siguen teniendo ruta y atajo «g …», pero no ocupan sitio en el menú. */
const SECONDARY: { route: string; key: string }[] = [
  { route: "/bandeja", key: "b" }, { route: "/proyectos", key: "p" }, { route: "/grafo", key: "g" }, { route: "/propuestas", key: "r" }, { route: "/ajustes", key: "s" },
];
/** Sección del menú que se ilumina para cada ruta. */
const SECTION_OF: Record<string, string> = { bandeja: "/notas", nota: "/notas", grafo: "/notas", proyectos: "/tareas", proyecto: "/tareas", propuestas: "/asistente", conexiones: "/ajustes" };

/** Entradas de navegación que ve quien usa la interfaz (`MOBILE_HIDDEN` lista las que el móvil no tiene). */
const visibleNav = () => NAV.filter((n) => !(isMobile() && MOBILE_HIDDEN.has(n.route)));

const enc = (p: string) => encodeURI(p);
const localToday = () => new Date().toLocaleDateString("sv"); // YYYY-MM-DD en hora local
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

const bootDemo = isDemoMode();
if (bootDemo) {
  enableDemoMode();
  setDemoTransport(handleDemoApi, onDemoChange);
}

function App() {
  const [route, setRoute] = useRoute();
  const [demo, setDemo] = useState(bootDemo);
  const [toast, setToast] = useState<Toast | null>(null);
  const [overlay, setOverlay] = useState<null | "palette" | "capture" | "help" | "context" | "endfocus" | "more" | "assistant-management">(null);
  const [ctxPath, setCtxPath] = useState<string | null>(null);
  const [theme, setTheme] = useState(lsGet("theme") ?? "dark");
  const isLanding = route === "/inicio";
  const rev = useRevision((e) => { if (e.kind === "navigate" && e.route) setRoute(e.route); });
  const focus = useApi<FocusState>(isLanding ? null : "/api/focus", rev).data;
  const counts = useApi<TodayView>(isLanding ? null : "/api/today", rev).data;
  const toastTimer = useRef(0);
  const [locked, setLocked] = useState(false);

  const activateDemo = (targetRoute = "/hoy") => {
    enableDemoMode();
    setDemoTransport(handleDemoApi, onDemoChange);
    setDemo(true);
    setLocked(false);
    setRoute(targetRoute);
  };

  useEffect(() => {
    if (route === "/demo") activateDemo("/hoy");
  }, [route]);

  useEffect(() => {
    const on = () => { if (!demo) { setLocked(true); void wipeOffline(); } };
    addEventListener(UNAUTHORIZED_EVENT, on);
    return () => removeEventListener(UNAUTHORIZED_EVENT, on);
  }, [demo]);
  const [, setRoleTick] = useState(0);
  useEffect(() => {
    if (demo) { setRole("full"); return; }
    startOffline(); // sin red el rol sale de lo último visto; startOffline solo actúa en el móvil
    api<{ role: "full" | "mobile" }>("GET", "/api/session").then(
      (r) => { const changed = r.role !== getRole(); setRole(r.role); startOffline(); if (changed) setRoleTick((n) => n + 1); },
      () => {},
    );
  }, [demo]);
  const off = useOffline();
  const mobile = isMobile();

  const show = (t: Toast) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), t.error || t.action ? 6000 : 2800);
  };
  toastApi = show;
  const say = (text: string, error = false, action?: Toast["action"]) => show({ text, error, action });
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
        const hit = [...visibleNav(), ...SECONDARY].find((n) => n.key === e.key);
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

  const newNote = async (type: "note" | "project" | "resource", folder?: string) => {
    const title = await askText(type === "project"
      ? { title: "Nuevo proyecto", placeholder: "Nombre del proyecto", confirm: "Crear" }
      : type === "resource"
        ? { title: "Nuevo recurso", placeholder: "Título del recurso", confirm: "Crear" }
        : { title: "Nueva nota", placeholder: "Título de la nota", confirm: "Crear" });
    if (!title) return;
    await guard(async () => {
      if (type === "project") {
        const r = await api<{ path: string }>("POST", "/api/project/create", { title });
        setRoute(`/proyecto/${r.path}`);
      } else {
        const r = await api<{ path: string }>("POST", "/api/note/create", { title, type, ...(folder ? { folder } : {}) });
        setRoute(`/nota/${r.path}`);
      }
    });
  };

  const openJournal = () => guard(async () => {
    const r = await api<{ path: string }>("POST", "/api/journal", {});
    setRoute(`/nota/${r.path}`);
  });

  if (isLanding) {
    return <LandingView theme={theme} setTheme={setTheme} onStartDemo={(r) => activateDemo(r ?? "/hoy")} />;
  }

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
    case "notas": view = <NotesView rev={rev} go={setRoute} onNew={(tp, folder) => newNote(tp, folder)} onJournal={() => void openJournal()} />; break;
    case "bases": view = arg ? <DatabaseView key={arg} path={arg} rev={rev} go={setRoute} guard={guard} say={say} /> : <DatabasesList rev={rev} go={setRoute} guard={guard} />; break;
    case "grafo": view = <GraphView key={arg} rev={rev} go={setRoute} focus={arg || undefined} />; break;
    case "asistente": view = arg === "actividad" ? <AssistantActivity rev={rev} say={say} /> : arg === "memoria" ? <AssistantMemory rev={rev} say={say} /> : <AssistantView rev={rev} say={say} go={setRoute} />; break;
    case "propuestas": view = <ProposalsView rev={rev} say={say} guard={guard} />; break;
    case "conexiones": case "ajustes": view = <SettingsView mobile={mobile} demo={demo} theme={theme} setTheme={setTheme} onManageKio={() => setOverlay("assistant-management")}><ConnectionsView mobile={mobile} demo={demo}>{mobile && <OfflineSection off={off} />}</ConnectionsView></SettingsView>; break;
    case "nota": view = <NoteView key={arg} path={arg} rev={rev} go={setRoute} />; break;
    default: view = <TodayScreen rev={rev} go={setRoute} guard={guard} say={say} />;
  }
  const activeRoute = head ? SECTION_OF[head] ?? `/${head}` : "/hoy";
  const inbox = counts?.inbox.count ?? 0;
  const subRoute = head === "nota" ? null : head === "proyecto" ? "/proyectos" : head === "asistente" && arg ? "/asistente/actividad" : `/${head ?? "hoy"}`;
  const tabs = subRoute && ({
    "/notas": [["/notas", "Notas"], ["/bandeja", inbox ? `Sin organizar · ${inbox}` : "Sin organizar"], ["/grafo", "Grafo"]],
    "/tareas": [["/tareas", "Tareas"], ["/proyectos", "Proyectos"]],
    "/asistente": [["/asistente", "Conversación"], ["/propuestas", counts?.proposals ? `Propuestas · ${counts.proposals}` : "Propuestas"], ["/asistente/actividad", "Actividad"]],
  } as Record<string, [string, string][]>)[activeRoute];

  return (
    <div class="shell">
      <nav class="sidebar" aria-label="Navegación">
        <div class="brand"><Seal />Kioku</div>
        {visibleNav().map((n) => (
          <a key={n.route} href={`#${n.route}`} class={activeRoute === n.route ? "active" : ""}>
            <Icon name={n.icon} /><span>{n.label}</span>
            {n.route === "/notas" && counts && counts.inbox.count > 0 && <b class="badge" title="Sin organizar">{counts.inbox.count}</b>}
            {n.route === "/asistente" && counts && counts.proposals > 0 && <b class="badge" title="Propuestas por revisar">{counts.proposals}</b>}
          </a>
        ))}
        <div class="spacer" />
        <button class="side-btn" onClick={() => setOverlay("capture")}>Capturar <kbd>c</kbd></button>
        <button class="side-btn" onClick={() => setOverlay("palette")}>Buscar <kbd>Ctrl K</kbd></button>
        <a href="#/ajustes" class={`side-link ${activeRoute === "/ajustes" ? "active" : ""}`}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg><span>Ajustes</span></a>
      </nav>
      <div class="content">
        {demo && <DemoBar onReset={() => { resetDemoState(); say("Datos de prueba restaurados."); }} onLanding={() => setRoute("/inicio")} />}
        {!mobile && !demo && !isLanding && <UpdateBanner go={setRoute} />}
        {focus?.active && !mobile && <FocusBar focus={focus} onEnd={() => setOverlay("endfocus")} go={setRoute} />}
        <main>{mobile && !off.online && <div class="offline-bar" role="status">{off.lastSync ? `Sin conexión · datos de ${formatAgo(off.lastSync, Date.now())}` : "Sin conexión · aún sin copia"}</div>}{tabs && <SectionTabs tabs={tabs} active={subRoute!} />}{view}</main>
      </div>

      <BottomNav active={activeRoute} pending={off.pending + off.failed + off.mutations} proposals={counts?.proposals ?? 0} onMore={() => setOverlay("more")} />
      {overlay === "more" && <MoreSheet onClose={() => setOverlay(null)} onSearch={() => setOverlay("palette")} onJournal={() => { setOverlay(null); void openJournal(); }} />}
      {overlay === "palette" && <Palette go={(r) => { setOverlay(null); setRoute(r); }} onClose={() => setOverlay(null)} newNote={() => { setOverlay(null); void newNote("note"); }}
        newProject={() => { setOverlay(null); void newNote("project"); }} journal={() => { setOverlay(null); void openJournal(); }} toggleFocus={() => { setOverlay(null); void toggleFocus(); }}
        focusActive={!!focus?.active} manageAssistant={() => setOverlay("assistant-management")} />}
      {overlay === "assistant-management" && !mobile && <AssistantManagement onClose={() => setOverlay(null)} go={setRoute} />}
      {overlay === "capture" && <CaptureOverlay onClose={() => setOverlay(null)} say={say} />}
      {overlay === "help" && <Help onClose={() => setOverlay(null)} />}
      {overlay === "endfocus" && focus?.active && <EndFocus focus={focus} onClose={() => setOverlay(null)} say={say} guard={guard} />}
      {overlay === "context" && ctxPath && <ContextDialog path={ctxPath} onClose={() => setOverlay(null)} />}
      {!mobile && !demo && <Companion route={route} go={setRoute} say={say} />}
      {toast && <div class={`toast ${toast.error ? "err" : ""}`} role="status"><span>{toast.text}</span>{toast.action && <button onClick={() => { const a = toast.action!; setToast(null); a.run(); }}>{toast.action.label}</button>}</div>}
    </div>
  );
}

/** Subpantallas de una sección (Notas · Sin organizar · Grafo…): una fila discreta encima de la página. */
function SectionTabs({ tabs, active }: { tabs: [string, string][]; active: string }) {
  return (
    <nav class="section-tabs" aria-label="Secciones">
      {tabs.map(([route, label]) => <a key={route} href={`#${route}`} class={route === active ? "on" : ""} aria-current={route === active ? "page" : undefined}>{label}</a>)}
    </nav>
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

/** Marca la tarea como hecha y ofrece deshacerlo: al completarla sale de la lista y, sin aviso, no queda claro si se guardó. */
async function completeTask(t: { path: string; title: string; status: TaskStatus }, guard: Guard) {
  const before = t.status;
  const ok = await guard(async () => { await setTaskStatus(t.path, "done"); return true; });
  if (ok) toastApi?.({ text: `Hecha: ${t.title.length > 40 ? t.title.slice(0, 40) + "…" : t.title}`, action: { label: "Deshacer", run: () => void guard(() => setTaskStatus(t.path, before)) } });
}

/** `compact`: la fecha ya la dice el grupo (Hoy, Próximas…), así que solo se repite si está vencida. */
function TaskLine({ t, today, go, guard, onFocus, onEdit, compact }: { t: TaskRow; today?: string; go: Go; guard: Guard; onFocus?: () => void; onEdit?: (path: string) => void; compact?: boolean }) {
  const done = t.status === "done" || t.status === "dropped";
  const overdue = !!t.due && !!today && t.due < today && !done;
  return (
    <li class={`task ${done ? "is-done" : ""}`}>
      <input type="checkbox" checked={t.status === "done"} aria-label={`Marcar «${t.title}» como hecha`}
        onChange={(e) => void (e.currentTarget.checked ? completeTask(t, guard) : guard(() => setTaskStatus(t.path, "todo")))} />
      <a class="ttitle" href={`#/nota/${enc(t.path)}`} onClick={onEdit && ((e) => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onEdit(t.path); } })}>{t.title}</a>
      {t.status === "doing" && <span class="chip accent">en curso</span>}
      {t.priority && (!isMobile() || t.priority === 1) && <span class="chip">{priorityLabel(t.priority)}</span>}
      {t.due && !(compact && !overdue) && <span class={`chip ${overdue ? "bad" : ""}`}>{relDate(t.due, today)}</span>}
      {t.projectPath && <a class="chip link" href={`#/proyecto/${enc(t.projectPath)}`}>{t.projectTitle}</a>}
      {onFocus && !done && <button class="mini" onClick={onFocus} title="Empezar foco">▶</button>}
    </li>
  );
}

/** Móvil: lo que hay hoy en el calendario, para ver el día de un vistazo sin abrir Calendario. Sin actividades no ocupa sitio. */
function TodayAgenda({ date, rev }: { date: string; rev: number }) {
  const { data } = useApi<CalendarResponse>(`/api/calendar?from=${date}&to=${date}`, rev);
  const items = (data?.items ?? []).filter((i) => i.start.slice(0, 10) <= date && i.end.slice(0, 10) >= date).sort((a, b) => a.start.localeCompare(b.start));
  if (!items.length) return null;
  const when = (i: CalendarEntry) => (i.start.slice(0, 10) < date ? "desde ayer" : i.start.slice(11));
  return (
    <section>
      <h2 class="sec">Agenda de hoy</h2>
      <ul class="agenda">
        {items.map((i) => (
          <li key={i.path} class={`st-${i.state}`}>
            <a href="#/calendario"><b>{when(i)}</b><span>{i.title}</span>{i.state === "active" && <em>en curso</em>}{i.state === "done" && <em>hecho</em>}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TodayScreen({ rev, go, guard, say }: { rev: number; go: Go; guard: Guard; say: Say }) {
  const { data: t, error } = useApi<TodayView>("/api/today", rev);
  if (error) return <div class="empty">No se pudo cargar: {error}</div>;
  if (!t) return <div class="empty muted">Cargando…</div>;
  const start = (path: string) => guard(async () => { await api("POST", "/api/focus/start", { taskPath: path }); say("Foco iniciado."); });
  const nothing = !t.suggestion && t.resume.length === 0 && t.inbox.count === 0;
  const mobile = isMobile();
  return (
    <div class="page narrow">
      <h1>Hoy <span class="muted date">{t.date}</span></h1>
      <KioBox rev={rev} say={say} />
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
            <button onClick={() => void completeTask(t.suggestion!.task, guard)}>Ya está hecha</button>
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
        <section class="card"><div class="eyebrow">Siguiente paso</div><p class="muted">No hay tareas abiertas. Escribe una arriba («llamar a Ana mañana») y Kio la apunta.</p></section>
      )}

      {(t.overdue > 0 || t.inbox.count > 0 || t.proposals > 0) && (
        <div class="pills">
          {t.overdue > 0 && <a class="pill bad" href="#/tareas">{plural(t.overdue, "tarea vencida", "tareas vencidas")}</a>}
          {t.inbox.count > 0 && <a class="pill" href="#/bandeja">{plural(t.inbox.count, "cosa sin organizar", "cosas sin organizar")}</a>}
          {t.proposals > 0 && <a class="pill accent" href="#/propuestas">{plural(t.proposals, "propuesta por revisar", "propuestas por revisar")}</a>}
        </div>
      )}

      {mobile && <TodayAgenda date={t.date} rev={rev} />}
      <HabitsToday rev={rev} />
      <KioRecent rev={rev} say={say} />

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
          <p class="muted">Escribe arriba lo que tengas en la cabeza, sin pensar dónde va. Kio lo guarda donde toca y siempre puedes deshacerlo:</p>
          <ul class="plain ex">
            <li><code>Llamar a Ana mañana</code> → una tarea con fecha</li>
            <li><code>Idea: un blog sobre lo que leo</code> → una nota con etiquetas y enlaces</li>
            <li><code>¿Qué tengo esta semana?</code> → Kio te responde</li>
          </ul>
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
      {r.lastCheckpoint ? <p class="cp">{r.lastCheckpoint.text}</p> : !isMobile() && <p class="cp muted">Sin checkpoint todavía</p>}
    </button>
  );
}

// ───────────────────────────── Bandeja ─────────────────────────────

function InboxView({ rev, go, say, guard }: { rev: number; go: Go; say: Say; guard: Guard }) {
  const { data } = useApi<{ path: string; title: string; mtime: number; excerpt: string }[]>("/api/inbox", rev);
  const mobile = isMobile();
  const props = useApi<Proposal[]>(mobile ? null : "/api/proposals", rev).data ?? [];
  const triaged = new Set(props.map((p) => p.key));
  const organize = () => guard(async () => {
    const r = await api<{ organized: number }>("POST", "/api/assistant/organize");
    say(r.organized ? `Kio ha ordenado ${plural(r.organized, "cosa", "cosas")}. Puedes deshacerlo en Actividad.` : "Nada que ordenar ahora.");
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
        <h1>Sin organizar</h1>
        {data && data.length > 0 && <button onClick={() => void organize()}>Ordenar con Kio</button>}
      </header>
      <p class="muted">Lo que has escrito sin decir dónde va. Kio lo ordena solo cuando está disponible (cada cambio se puede deshacer en <a href="#/asistente/actividad">Actividad</a>), o hazlo tú aquí.</p>
      {data && data.length === 0 && <div class="empty">Todo ordenado.</div>}
      <ul class="cards">
        {(data ?? []).map((n) => (
          <li key={n.path} class="card">
            <a class="ctitle" href={`#/nota/${enc(n.path)}`}>{mobile && n.excerpt ? n.excerpt : n.title}</a>
            {!mobile && n.excerpt && n.excerpt !== n.title && <p class="excerpt">{n.excerpt}</p>}
            <div class="row small">
              <span class="muted">{mobile ? formatAgo(n.mtime, Date.now()) : new Date(n.mtime).toLocaleString("es")}</span>
              {triaged.has(`triage:${n.path}`) && <a class="chip accent" href="#/propuestas">tiene propuesta</a>}
              <span class="grow" />
              <button class="mini" onClick={() => void convert(n.path, "task")}>→ Tarea</button>
              <button class="mini" onClick={() => void convert(n.path, "note")}>→ Nota</button>
              {!mobile && <button class="mini" onClick={() => go(`/nota/${n.path}`)}>Abrir</button>}
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

const STATUS_ES: Record<string, string> = { active: "activo", paused: "en pausa", someday: "algún día", done: "terminado" };

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
          <div class="muted small">{STATUS_ES[r.project.status] ?? r.project.status} · {r.idleDays === null ? "sin actividad registrada" : r.idleDays === 0 ? "activo hoy" : `parado hace ${r.idleDays} d`}</div>
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
            <ul class="tasks">{r.open.map((t) => <TaskLine key={t.path} t={t} today={localToday()} go={go} guard={guard} />)}</ul>
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
  const { data, reload } = useApi<TaskRow[]>("/api/tasks", rev);
  const [showDone, setShowDone] = useState(false);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<{ path: string | null } | null>(null);
  const edit = (path: string) => setForm({ path });
  const mobile = isMobile(); // en el móvil solo hay lista: Tabla y Tablero no caben en la pantalla
  const [storedMode, setModeRaw] = useState<"lista" | "tabla" | "tablero">(() => { const m = lsGet("tasks.mode"); return m === "tabla" || m === "tablero" ? m : "lista"; });
  const mode = mobile ? "lista" : storedMode;
  const setMode = (m: typeof mode) => { setModeRaw(m); lsSet("tasks.mode", m); };
  const list = (data ?? []).filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase()) || (t.projectTitle ?? "").toLowerCase().includes(q.toLowerCase()));
  const doing = list.filter((t) => t.status === "doing");
  const open = list.filter((t) => t.status === "todo").sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || (a.priority ?? 9) - (b.priority ?? 9));
  const closed = list.filter((t) => t.status === "done" || t.status === "dropped").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")).slice(0, 50);
  // Función, no componente: un componente definido aquí se recrea en cada render y desmonta las filas (y el foco del título que abrió el formulario).
  const group = (title: string, items: TaskRow[], compact = false) => items.length ? (
    <section><h2 class="sec">{title} <span class="muted">{items.length}</span></h2><ul class="tasks">{items.map((t) => <TaskLine key={t.path} t={t} today={today} go={go} guard={guard} onEdit={edit} compact={compact} />)}</ul></section>
  ) : null;
  // Móvil: lo pendiente se agrupa por cuándo toca, no en una sola lista.
  const byDue = (pred: (due: string | null) => boolean) => open.filter((t) => pred(t.due));
  const overdue = byDue((d) => !!d && !!today && d < today);
  const dueToday = byDue((d) => !!d && d === today);
  const upcoming = byDue((d) => !!d && (!today || d > today));
  const undated = byDue((d) => !d);
  return (
    <div class={`page ${mode === "lista" ? "narrow" : "wide"}`}>
      <header class="page-head"><h1>Tareas</h1><div class="row">
        {!mobile && <div class="seg" role="tablist" aria-label="Vista">
          {(["lista", "tabla", "tablero"] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} class={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}
        </div>}
        <input class="search" placeholder="Filtrar…" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        {mobile && <button class="primary add-compact" aria-label="Añadir tarea" onClick={() => setForm({ path: null })}>+ Tarea</button>}
      </div></header>
      {!mobile && <div class="addbar"><button class="primary" onClick={() => setForm({ path: null })}>Añadir tarea</button></div>}
      {data && data.length === 0 && <div class="empty">{mobile ? <>Sin tareas. Toca <b>+ Tarea</b> para crear la primera.</> : <>Sin tareas. Crea una con <code>t …</code> desde Quick (o pulsa <kbd>c</kbd>).</>}</div>}
      {mode === "tabla" && <TaskTable tasks={list} today={today} guard={guard} fmt={relDate} onEdit={edit} />}
      {mode === "tablero" && <TaskBoard tasks={list} today={today} guard={guard} fmt={relDate} onEdit={edit} />}
      {mode === "lista" && <>
        {group("En curso", doing)}
        {mobile ? <>
          {group("Vencidas", overdue, true)}
          {group("Hoy", dueToday, true)}
          {group("Próximas", upcoming)}
          {group("Sin fecha", undated, true)}
        </> : group("Pendientes", open)}
        <div class="row"><button class={`chip btn ${showDone ? "on" : ""}`} onClick={() => setShowDone(!showDone)}>{showDone ? "Ocultar completadas" : "Mostrar completadas"}</button></div>
        {showDone && group("Completadas", closed)}
      </>}
      {form && <TaskForm path={form.path} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
    </div>
  );
}

// ───────────────────────────── Notas ─────────────────────────────

function NotesView({ rev, go, onNew, onJournal }: { rev: number; go: Go; onNew(type: "note" | "resource", folder?: string): void; onJournal(): void }) {
  const { data } = useApi<NoteListItem[]>("/api/notes", rev);
  const [type, setType] = useState<"all" | "note" | "resource">("all");
  const [folder, setFolder] = useState("all");
  const [q, setQ] = useState("");
  const label: Record<string, string> = { all: "Todas", note: "Notas", resource: "Recursos" };
  const knowledge = (data ?? []).filter(isKnowledgeNote);
  const folders = extractFolders(knowledge);
  const activeFolder = folder !== "all" && folders.some((f) => f.folder === folder) ? folder : "all";
  const createFolder = activeFolder !== "all" && activeFolder !== "(Raíz)" ? activeFolder : undefined;
  const list = listKnowledgeNotes(knowledge, { subType: type, folder: activeFolder, query: q });
  const reset = () => { setType("all"); setFolder("all"); setQ(""); };
  return (
    <div class="page narrow">
      <header class="page-head">
        <h1>Notas</h1>
        <div class="row">
          <input class="search" placeholder="Filtrar por título, #etiqueta o ruta…" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          <button class="ghost" onClick={onJournal}>Diario de hoy</button>
          <button class="primary" onClick={() => onNew("note", createFolder)}>Nueva nota</button>
        </div>
      </header>
      <div class="notes-filters">
        {folders.length > 0 && (
          <div class="chips">
            <button class={`chip btn ${activeFolder === "all" ? "on" : ""}`} onClick={() => setFolder("all")}>Todas las carpetas ({knowledge.length})</button>
            {folders.map((f) => (
              <button key={f.folder} class={`chip btn folder-chip ${activeFolder === f.folder ? "on" : ""}`} onClick={() => setFolder(f.folder)}>
                {f.folder} · {f.count}
              </button>
            ))}
          </div>
        )}
      </div>
      <ul class="rows">
        {list.slice(0, 400).map((n) => {
          const fld = noteFolder(n.path);
          return (
            <li key={n.path}>
              {n.icon && <span class="note-row-icon" aria-hidden="true">{n.icon}</span>}
              <a href={`#/nota/${enc(n.path)}`}>{n.title}</a>
              {n.type === "resource" && <span class="chip">{label[n.type]}</span>}
              <button type="button" class="chip btn folder-chip" onClick={() => setFolder(fld === activeFolder ? "all" : fld)} title="Filtrar por carpeta">{fld}</button>
              <span class="tags-inline">
                {(n.tags ?? []).slice(0, 3).map((t) => (
                  <button key={t} type="button" class="chip btn" onClick={() => setQ(`#${t}`)}>{t}</button>
                ))}
              </span>
              <span class="muted small path">{n.path}</span>
            </li>
          );
        })}
      </ul>
      {data && knowledge.length === 0 && <div class="empty">Todavía no hay notas ni recursos de conocimiento.</div>}
      {data && knowledge.length > 0 && list.length === 0 && (
        <div class="empty">
          Nada coincide con el filtro actual. <button class="ghost" onClick={reset}>Ver todas</button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Propuestas ─────────────────────────────


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
  const mobile = isMobile();
  const online = useOffline().online;
  const act = async (p: Proposal, what: "apply" | "reject") => {
    // En el móvil un toque suelto no aplica nada: se confirma lo que se va a tocar (nunca se aplica solo).
    if (mobile && what === "apply" && !(await askConfirm({ title: "¿Aplicar esta propuesta?", body: `${p.title} · ${plural(p.ops.length, "cambio", "cambios")}. Revisa lo que se tocará antes de confirmar.`, confirm: "Aplicar", danger: p.ops.some((o) => o.op === "trash" || o.op === "move" || o.op === "update") }))) return;
    const r = await guard(() => api<Proposal>("POST", `/api/proposals/${p.id}/${what}`));
    if (r) {
      if (r.status === (what === "apply" ? "applied" : "rejected")) say(what === "apply" ? "Aplicada." : "Descartada.");
      else say(r.error || "La propuesta no se resolvió.", true);
      reload();
    }
  };
  return (
    <div class="page narrow">
      <header class="page-head"><h1>Propuestas</h1>
        {!mobile && <button onClick={() => void guard(async () => { const r = await api<Proposal[]>("POST", "/api/triage"); say(r.length ? `${r.length} nuevas.` : "Nada nuevo."); })}>Revisar bandeja</button>}
      </header>
      {!mobile && <AiPanel rev={rev} say={say} guard={guard} />}
      <p class="muted">Todo cambio que no hagas tú directamente pasa por aquí. Ves exactamente qué se tocará; si el archivo cambió desde que se propuso, la propuesta se aborta entera.</p>
      {mobile && <p class="muted small">Desde el móvil ves y resuelves las propuestas que nacieron aquí, con el portátil encendido.</p>}
      {mobile && !online && <div class="notice bad" role="status">Sin conexión: las propuestas solo se aprueban con el portátil encendido y con red. Nada se guarda para después.</div>}
      {data && data.length === 0 && <div class="empty">No hay propuestas pendientes.</div>}
      {(data ?? []).map((p) => (
        <section key={p.id} class="card">
          <div class="eyebrow">{p.source}</div>
          <h2>{p.title}</h2>
          <p class="muted">{p.rationale}</p>
          {p.ops.map((op, i) => <OpView key={i} op={op} />)}
          <div class="row proposal-actions">
            <button class="primary" disabled={mobile && !online} onClick={() => void act(p, "apply")}>Aplicar</button>
            <button disabled={mobile && !online} onClick={() => void act(p, "reject")}>Descartar</button>
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

/** Pantallas que en el móvil viven dentro de «Más»: con una de ellas abierta, ese botón es el activo. */
const MORE_ROUTES = ["/calendario", "/bases", "/ajustes"];

function BottomNav({ active, pending, proposals, onMore }: { active: string; pending: number; proposals: number; onMore(): void }) {
  const items: [string, string, string][] = [["/hoy", "Hoy", "hoy"], ["/notas", "Notas", "notas"], ["/tareas", "Tareas", "tareas"]];
  const link = ([route, label, icon]: [string, string, string]) => <a key={route} href={`#${route}`} class={active === route ? "active" : ""}><Icon name={icon} /><span>{label}</span></a>;
  return (
    <nav class="bottomnav" aria-label="Navegación">
      {items.slice(0, 2).map(link)}
      <a href="#/asistente" class={`nav-kio ${active === "/asistente" ? "active" : ""}`} aria-label="Kio"><KioFace state="idle" size={34} />{proposals > 0 && <b class="nav-badge" aria-label={`${proposals} propuestas`}>{proposals}</b>}</a>
      {items.slice(2).map(link)}
      <button class={MORE_ROUTES.includes(active) ? "active" : ""} onClick={onMore}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg><span>Más</span>{pending > 0 && <b class="nav-badge" aria-label={`${pending} cambios pendientes`}>{pending}</b>}</button>
    </nav>
  );
}

/** «Más»: el resto de pantallas en el móvil. */
function MoreSheet({ onClose, onSearch, onJournal }: { onClose(): void; onSearch(): void; onJournal(): void }) {
  const rest = visibleNav().filter((n) => !["/hoy", "/notas", "/tareas", "/asistente"].includes(n.route));
  return (
    <div class="scrim sheet-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal sheet" role="dialog" aria-label="Más">
        <ul class="sheet-list">
          <li><button onClick={onSearch}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><span>Buscar</span></button></li>
          {rest.map((n) => <li key={n.route}><a href={`#${n.route}`} onClick={onClose}><Icon name={n.icon} /><span>{n.label}</span></a></li>)}
          <li><a href="#/diario" onClick={(e) => { e.preventDefault(); onJournal(); }}><Icon name="diario" /><span>Diario de hoy</span></a></li>
          <li class="sheet-sep"><a href="#/ajustes" onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg><span>Ajustes</span></a></li>
        </ul>
      </div>
    </div>
  );
}

/** Ajustes: Kio, conexión y dispositivos, apariencia y avisos, en una sola pantalla. */
function SettingsView({ mobile, demo, theme, setTheme, onManageKio, children }: { mobile: boolean; demo: boolean; theme: string; setTheme(t: string): void; onManageKio(): void; children: preact.ComponentChildren }) {
  return (
    <div class="page narrow settings">
      <h1>Ajustes</h1>
      {!demo && <KioSettings mobile={mobile} onManage={onManageKio} />}
      <section class="card">
        <div class="eyebrow">Apariencia</div>
        <div class="seg" role="radiogroup" aria-label="Tema">
          {([["auto", "Sistema"], ["light", "Claro"], ["dark", "Oscuro"]] as const).map(([v, l]) => <button key={v} role="radio" aria-checked={theme === v} class={theme === v ? "on" : ""} onClick={() => setTheme(v)}>{l}</button>)}
        </div>
        {!mobile && !demo && <div class="row"><CompanionModeButton /></div>}
      </section>
      {mobile && !demo && <PushSetting />}
      {children}
    </div>
  );
}

type EngineInfo = { engine: string; provider: string | null; model: string | null; origin: string | null; local: boolean };

/** Kio en una línea: qué modelo usa, dónde corre y si responde. Lo avanzado (proveedores, endpoints) queda detrás de un botón. */
function KioSettings({ mobile, onManage }: { mobile: boolean; onManage(): void }) {
  const state = useApi<{ engine: EngineInfo | null }>("/api/assistant/state", 0).data;
  const status = useApi<{ ok: boolean; reason?: string }>("/api/assistant/status", 0);
  const e = state?.engine;
  const where = e?.local ? "en tu ordenador" : e?.origin ? `en ${e.origin.replace(/^https?:\/\//, "")}` : "";
  return (
    <section class="card">
      <div class="eyebrow">Kio</div>
      <h2 class={status.data && !status.data.ok ? "bad-text" : ""}>
        {status.data ? (status.data.ok ? "✓ " : "✕ ") : ""}{e?.model ?? "Modelo sin configurar"}{where && <span class="muted"> · {where}</span>}
      </h2>
      <p class="muted">{!status.data ? "Comprobando…" : status.data.ok ? (e?.local ? "Responde. Tus notas no salen de tu ordenador." : "Responde. Las notas que lee se envían a ese servidor.") : status.data.reason ?? "No responde."}</p>
      <p class="muted small">Kioku funciona igual sin Kio: puedes escribir, buscar y organizar a mano. Lo que escribas mientras no responde se guarda en «Sin organizar».</p>
      {!mobile && <div class="row"><button onClick={onManage}>Cambiar modelo…</button><a class="pill" href="#/asistente/actividad">Lo que ha hecho Kio</a></div>}
    </section>
  );
}

function PushSetting() {
  const [push, setPush] = useState<PushState>("unsupported");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { void currentState().then(setPush).catch((e) => setError(errText(e))).finally(() => setBusy(false)); }, []);
  const toggle = async () => {
    setBusy(true); setError("");
    try { if (push === "on") await disablePush(); else await enablePush(); }
    catch (e) { setError(errText(e)); }
    try { setPush(await currentState()); } catch (e) { setError(errText(e)); }
    setBusy(false);
  };
  const label = { on: "Avisos: activados", off: "Activar avisos", denied: "Bloqueados en Ajustes de iOS", unsupported: "No disponibles: instala la app en la pantalla de inicio" }[push];
  return (
    <section class="card">
      <div class="eyebrow">Avisos</div>
      <button disabled={busy || push === "unsupported" || push === "denied"} onClick={() => void toggle()}>{label}</button>
      {error && <p class="bad-text" role="alert">{error}</p>}
    </section>
  );
}

/** Estado de la copia sin conexión: capturas sin enviar, última sincronización y espacio usado. */
function OfflineSection({ off }: { off: OfflineState }) {
  const [queue, setQueue] = useState<QueuedCapture[]>([]);
  const [used, setUsed] = useState<string | null>(null);
  const [mutations, setMutations] = useState<StoredMutation[]>([]);
  const [error, setError] = useState("");
  const refreshMutations = () => void loadMutations().then(setMutations);
  useEffect(() => { void loadQueue().then(setQueue); refreshMutations(); }, [off.pending, off.failed, off.mutations, off.syncing]);
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
      {!off.durable && <p class="bad-text">El almacenamiento persistente no está disponible; no se pueden guardar ediciones ni tareas.</p>}
      {error && <p class="bad-text" role="alert">{error}</p>}
      {mutations.filter(o => o.state !== "applied").map(o => <div class="failed-capture" key={o.body.opId}>
        <p><b>{o.state === "conflict" ? "Conflicto" : o.state === "failed" ? "No se pudo enviar" : "Pendiente o bloqueado"}</b> · {o.body.path}<br />
          {o.state === "conflict" && o.result && <>El original se conservó. <a href={`#/nota/${enc(o.result.path)}`}>Abrir copia de conflicto</a>.</>}
          {o.error && <span class="muted small">{o.error}</span>}</p>
        {o.state === "failed" && <button onClick={() => void retryMutation(o.body.opId).then(refreshMutations).catch(e => setError(errText(e)))}>Reintentar</button>}
        {(o.state === "conflict" || o.state === "failed") && <button onClick={() => void (async () => {
          if (!await askConfirm({ title: "¿Descartar cambios locales de esta nota?", body: "Se descartan el borrador y los cambios sin enviar de esta nota. La copia de conflicto del servidor se conserva.", confirm: "Descartar cambios locales", danger: true })) return;
          try { await resetMutationPath(o.body.path); await syncNow(); refreshMutations(); } catch (e) { setError(errText(e)); }
        })()}>Resolver y descartar cambios locales</button>}
      </div>)}
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
      <input class="big-input" autofocus placeholder={isMobile() ? "Escribe lo que tengas en la cabeza…" : "Idea suelta · t tarea !mañana @proyecto p1 · d decisión · n nota"} value={text}
        onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
      {isMobile() && (
        <div class="chips capture-examples" role="group" aria-label="Ejemplos">
          {[["t ", "Tarea"], ["n ", "Nota"], ["d ", "Decisión"]].map(([prefix, label]) => <button key={prefix} class="chip btn" onClick={() => setText(prefix + text.replace(/^[tnd] /, ""))}>{label}</button>)}
        </div>
      )}
      <p class="muted small">{isMobile() ? "Sin más, va a la Bandeja. Con Tarea, Nota o Decisión se guarda ya clasificada. Pulsa Intro para guardar." : "Enter para guardar. Sin prefijo va a la Bandeja; nada se organiza solo."}</p>
    </Modal>
  );
}

interface PaletteItem { label: string; hint?: string; run(): void }

function Palette(p: { go(r: string): void; onClose(): void; newNote(): void; newProject(): void; journal(): void; toggleFocus(): void; focusActive: boolean; manageAssistant(): void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const cmds: PaletteItem[] = [
    ...visibleNav().map((n) => ({ label: `Ir a ${n.label}`, hint: isMobile() ? undefined : `g ${n.key}`, run: () => p.go(n.route) })),
    { label: "Nueva nota", run: p.newNote },
    ...(isMobile() ? [] : [{ label: "Nuevo proyecto", run: p.newProject }, { label: "Modelo de Kio", run: p.manageAssistant }]),
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
    ["g h · a · n · t · c · d  ·  b bandeja · p proyectos · g grafo · r propuestas · s ajustes", "Ir a Hoy · Kio · Notas · Tareas · Calendario · Bases (y a Sin organizar, Proyectos, Grafo, Propuestas o Ajustes)"],
    ["Ctrl Enter (editor)", "Seguir [[enlace]] o marcar casilla"], ["/ · Ctrl B · Ctrl I (editor)", "Menú de formato · negrita · cursiva"], ["Ctrl S (editor)", "Guardar ahora (si no, autoguardado)"], ["j · k · Enter · x", "En listas: bajar · subir · abrir · marcar hecha"], ["Esc", "Cerrar"],
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

/** Un enlace de vinculación abierto en una pestaña de Kioku ya cargada solo cambia el hash: la pantalla debe seguirlo sin recargar. */
function Root() {
  const [token, setToken] = useState(() => enrollmentToken(location.hash));
  useEffect(() => {
    const h = () => setToken(enrollmentToken(location.hash));
    addEventListener("hashchange", h);
    return () => removeEventListener("hashchange", h);
  }, []);
  return !bootDemo && token ? <DeviceEnrollment key={token} /> : <App />;
}

render(<Root />, document.getElementById("root")!);
