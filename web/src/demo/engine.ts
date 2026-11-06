// Motor en el navegador para el modo Demo interactivo (Vercel / portfolio).
// Implementa el contrato de /api/* sobre los archivos Markdown en memoria + localStorage.
import { parseBlock, taskEstimate, type CalendarState } from "../../../src/core/calendar.ts";
import { parseCapture } from "../../../src/core/capture.ts";
import { availableColumns, matchesSource, parseDatabase, queryRows, type DbRow, type View } from "../../../src/core/database.ts";
import { addDays, diffDays, localDate, localTime } from "../../../src/core/dates.ts";
import type { NoteType, SearchHit, TaskRow, TaskStatus } from "../../../src/core/index.ts";
import { appendToSection, normKey, parseNote, renderNote, sectionItems, setFrontmatter, splitFrontmatter } from "../../../src/core/markdown.ts";
import type { Proposal } from "../../../src/core/proposals.ts";
import { ApiError, lsGet, lsSet, type ChangeEvent } from "../api.ts";
import type { AreaRow, CalendarEntry, CalendarProject, CalendarResponse, CalendarTask, CaptureResult, FocusState, NoteInfo, NoteListItem, ResumeCard, Suggestion, TodayView, UndoRecord } from "../types.ts";
import { buildSeedState, simpleHash, type DemoState } from "./seed.ts";

const STORAGE_KEY = "kioku.demo.state.v1";
const DEMO_MODE_KEY = "kioku.demo.active";

const FOLDERS: Record<string, string> = {
  capture: "Bandeja",
  task: "Tareas",
  project: "Proyectos",
  note: "Notas",
  journal: "Diario",
  resource: "Recursos",
  database: "Bases",
  block: "Calendario",
  area: "Areas",
};

let memState: DemoState | null = null;
const changeListeners = new Set<(e: ChangeEvent) => void>();

export function onDemoChange(cb: (e: ChangeEvent) => void): () => void {
  changeListeners.add(cb);
  return () => {
    changeListeners.delete(cb);
  };
}

function emitChange(kind: string, path?: string | null, extra?: Partial<ChangeEvent>): void {
  const ev: ChangeEvent = { kind, path, ...extra };
  for (const fn of changeListeners) {
    try {
      fn(ev);
    } catch {
      /* ignorar */
    }
  }
}

/** Alojamientos estáticos que solo sirven la demo (no hay daemon detrás). Un host propio o privado nunca se da por demo. */
export function isStaticDemoHost(hostname: string): boolean {
  return hostname.endsWith(".vercel.app");
}

/** La demo solo arranca en un host estático reconocido o si el usuario la pide (`?demo=1`, `#/demo` o la marca que dejó al activarla). */
export function isDemoMode(): boolean {
  if (typeof window === "undefined") return memState !== null;
  const params = new URLSearchParams(location.search);
  if (params.get("demo") === "1" || location.hash.startsWith("#/demo")) return true;
  if (isStaticDemoHost(location.hostname)) return true;
  return lsGet(DEMO_MODE_KEY) === "1";
}

export function enableDemoMode(): void {
  lsSet(DEMO_MODE_KEY, "1");
  getState();
}

export function disableDemoMode(): void {
  try {
    localStorage.removeItem(DEMO_MODE_KEY);
  } catch {
    /* ignorar */
  }
}

export function resetDemoState(now = new Date()): DemoState {
  const fresh = buildSeedState(now);
  memState = fresh;
  lsSet(STORAGE_KEY, JSON.stringify(fresh));
  emitChange("reindex", null);
  return fresh;
}

function getState(): DemoState {
  if (memState) return memState;
  const today = localDate(new Date());
  const raw = lsGet(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed && parsed.version === 1 && parsed.files && parsed.seedDate === today) {
        memState = parsed;
        return parsed;
      }
    } catch {
      /* reconstruir */
    }
  }
  const fresh = buildSeedState(new Date());
  memState = fresh;
  lsSet(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveState(): void {
  if (!memState) return;
  lsSet(STORAGE_KEY, JSON.stringify(memState));
}

function cleanFileName(title: string): string {
  const s = title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80)
    .trim();
  return s || "Sin título";
}

function uniquePath(st: DemoState, candidate: string): string {
  if (!st.files[candidate]) return candidate;
  const base = candidate.replace(/\.md$/i, "");
  let i = 2;
  while (st.files[`${base} (${i}).md`]) i++;
  return `${base} (${i}).md`;
}

interface ParsedEntry {
  path: string;
  text: string;
  hash: string;
  mtime: number;
  title: string;
  type: NoteType;
  tags: string[];
  fm: Record<string, unknown>;
  fmError: boolean;
  body: string;
  links: { target: string; anchor: string | null; alias: string | null; embed: boolean }[];
}

function allEntries(st: DemoState): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  for (const [path, file] of Object.entries(st.files)) {
    const p = parseNote(file.text, path);
    const folder = path.split("/")[0];
    const inferredType: NoteType =
      folder === "Bandeja"
        ? "capture"
        : folder === "Tareas"
          ? "task"
          : folder === "Proyectos"
            ? "project"
            : folder === "Diario"
              ? "journal"
              : folder === "Bases"
                ? "database"
                : folder === "Calendario"
                  ? "block"
                  : folder === "Areas"
                    ? "area"
                    : "note";
    const rawType = typeof p.frontmatter.type === "string" ? p.frontmatter.type : inferredType;
    out.push({
      path,
      text: file.text,
      hash: simpleHash(file.text),
      mtime: file.mtime,
      title: p.title,
      type: rawType as NoteType,
      tags: p.tags,
      fm: p.frontmatter,
      fmError: p.frontmatterError,
      body: p.body,
      links: p.links,
    });
  }
  return out;
}

function resolveTarget(entries: ParsedEntry[], rawTarget: string): ParsedEntry | null {
  const t = rawTarget.replace(/\.md$/i, "").trim();
  if (!t) return null;
  const nk = normKey(t);
  for (const e of entries) {
    if (normKey(e.path.replace(/\.md$/i, "")) === nk) return e;
  }
  for (const e of entries) {
    const base = e.path.replace(/\.md$/i, "").split("/").pop() ?? "";
    if (normKey(e.title) === nk || normKey(base) === nk) return e;
    const aliases = Array.isArray(e.fm.aliases) ? e.fm.aliases.map(String) : [];
    if (aliases.some((a) => normKey(a) === nk)) return e;
  }
  return null;
}

function relationTarget(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^\[\[([^\[\]|#]+)(?:[|#][^\[\]]*)?\]\]$/.exec(v.trim());
  return m ? m[1].trim() : v.trim() || null;
}

function toTaskRow(e: ParsedEntry, entries: ParsedEntry[]): TaskRow {
  const projTarget = relationTarget(e.fm.project);
  const proj = projTarget ? resolveTarget(entries, projTarget) : null;
  const prio = Number(e.fm.priority);
  return {
    path: e.path,
    title: e.title,
    status: (["todo", "doing", "done", "dropped"].includes(String(e.fm.status)) ? String(e.fm.status) : "todo") as TaskStatus,
    priority: [1, 2, 3].includes(prio) ? (prio as 1 | 2 | 3) : null,
    due: typeof e.fm.due === "string" ? e.fm.due : null,
    projectPath: proj?.path ?? null,
    projectTitle: proj?.title ?? projTarget ?? null,
    focus: typeof e.fm.parked === "string" ? e.fm.parked : null,
    doneAt: typeof e.fm.done_at === "string" ? e.fm.done_at : null,
    mtime: e.mtime,
  };
}

function buildResume(proj: ParsedEntry, entries: ParsedEntry[], today: string): ResumeCard {
  const bitacora = sectionItems(proj.body, "Bitácora");
  let lastCheckpoint: ResumeCard["lastCheckpoint"] = null;
  const lastLine = bitacora[bitacora.length - 1];
  if (lastLine) {
    const m = /^(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)\s+[—-]\s+(.*)$/.exec(lastLine);
    lastCheckpoint = m ? { ts: m[1], text: m[2] } : { ts: null, text: lastLine };
  }
  const decisions = sectionItems(proj.body, "Decisiones").slice(-3).reverse();
  const open = entries
    .filter((e) => e.type === "task")
    .map((e) => toTaskRow(e, entries))
    .filter((t) => t.projectPath === proj.path && (t.status === "todo" || t.status === "doing"))
    .sort((a, b) => (a.status === "doing" ? -1 : 0) - (b.status === "doing" ? -1 : 0) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || (a.priority ?? 9) - (b.priority ?? 9));

  const touchedMap = new Map<string, { path: string; title: string; mtime: number }>();
  for (const l of proj.links) {
    const target = resolveTarget(entries, l.target);
    if (target && target.type !== "task" && target.path !== proj.path) {
      touchedMap.set(target.path, { path: target.path, title: target.title, mtime: target.mtime });
    }
  }
  for (const other of entries) {
    if (other.path === proj.path || other.type === "task") continue;
    for (const l of other.links) {
      if (resolveTarget(entries, l.target)?.path === proj.path) {
        touchedMap.set(other.path, { path: other.path, title: other.title, mtime: other.mtime });
      }
    }
  }
  const touched = [...touchedMap.values()].sort((a, b) => b.mtime - a.mtime).slice(0, 5).map(({ path, title }) => ({ path, title }));
  const lastActivity = new Date(proj.mtime).toISOString();
  const idleDays = Math.max(0, diffDays(localDate(new Date(proj.mtime)), today));
  return {
    project: { path: proj.path, title: proj.title, status: String(proj.fm.status ?? "active") },
    idleDays,
    lastActivity,
    lastCheckpoint,
    decisions,
    open,
    touched,
  };
}

function rankTask(t: TaskRow, today: string): Suggestion {
  let score = 10;
  const reasons: string[] = [];
  if (t.status === "doing") {
    score += 45;
    reasons.push("ya está en curso");
  }
  if (t.due) {
    if (t.due < today) {
      score += 60;
      reasons.push("vencida");
    } else if (t.due === today) {
      score += 50;
      reasons.push("vence hoy");
    } else if (t.due === addDays(today, 1)) {
      score += 25;
      reasons.push("vence mañana");
    }
  }
  if (t.priority === 1) {
    score += 30;
    reasons.push("prioridad alta (P1)");
  } else if (t.priority === 2) {
    score += 15;
    reasons.push("prioridad media (P2)");
  }
  if (t.projectTitle) {
    score += 10;
    reasons.push(`proyecto activo`);
  }
  return { task: t, score, reasons };
}

function writeNote(st: DemoState, path: string, text: string): { hash: string } {
  st.files[path] = { text, mtime: Date.now() };
  saveState();
  emitChange("note", path);
  return { hash: simpleHash(text) };
}

function createDemoNote(
  st: DemoState,
  opts: { title: string; type?: NoteType; folder?: string; body?: string; fm?: Record<string, unknown> },
): { path: string; text: string; hash: string } {
  const type = opts.type ?? "note";
  const title = opts.title.trim() || "Sin título";
  const base = cleanFileName(title);
  const folder = opts.folder ?? FOLDERS[type] ?? "Notas";
  const path = uniquePath(st, `${folder}/${base}.md`);
  const fm: Record<string, unknown> = {
    id: `01DEMO${Date.now().toString(36).toUpperCase()}`,
    type,
    ...(base !== title ? { title } : {}),
    ...(opts.fm ?? {}),
    created: new Date().toISOString(),
  };
  const text = renderNote(fm, opts.body ?? `# ${title}\n\n`);
  const { hash } = writeNote(st, path, text);
  return { path, text, hash };
}

function calendarEntryState(kind: "block" | "event", start: string, end: string, doneAt: string | undefined, nowStr: string): CalendarState {
  if (kind === "block" && doneAt) return "done";
  if (nowStr < start) return "pending";
  if (nowStr >= start && nowStr < end) return "active";
  return kind === "event" ? "past" : "unfinished";
}

function buildCalendarDto(e: ParsedEntry, entries: ParsedEntry[], nowStr: string): CalendarEntry | null {
  try {
    const b = parseBlock(e.fm);
    const taskTarget = relationTarget(b.task);
    const taskEntry = taskTarget ? resolveTarget(entries, taskTarget) : null;
    const projTarget = relationTarget(b.project) ?? (taskEntry ? relationTarget(taskEntry.fm.project) : null);
    const projEntry = projTarget ? resolveTarget(entries, projTarget) : null;
    const areaTarget = relationTarget(b.area) ?? (taskEntry ? relationTarget(taskEntry.fm.area) : null);
    const areaEntry = areaTarget ? resolveTarget(entries, areaTarget) : null;
    return {
      path: e.path,
      title: e.title,
      hash: e.hash,
      kind: b.kind,
      start: b.start,
      end: b.end,
      ...(b.done_at ? { done_at: b.done_at } : {}),
      taskPath: taskEntry?.path ?? null,
      projectPath: projEntry?.path ?? null,
      projectTitle: projEntry?.title ?? null,
      areaPath: areaEntry?.path ?? null,
      areaTitle: areaEntry?.title ?? null,
      areaColor: typeof areaEntry?.fm.color === "string" ? areaEntry.fm.color : null,
      state: calendarEntryState(b.kind, b.start, b.end, b.done_at, nowStr),
    };
  } catch {
    return null;
  }
}

export async function handleDemoApi<T>(method: "GET" | "POST" | "PUT", rawPath: string, body?: unknown): Promise<T> {
  const st = getState();
  const entries = allEntries(st);
  const now = new Date();
  const today = localDate(now);
  const nowMinute = `${today}T${localTime(now)}`;

  const qIdx = rawPath.indexOf("?");
  const route = qIdx < 0 ? rawPath : rawPath.slice(0, qIdx);
  const params = new URLSearchParams(qIdx < 0 ? "" : rawPath.slice(qIdx + 1));
  const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  // ── Sesión y salud ──
  if (route === "/api/health") return { ok: true } as T;
  if (route === "/api/session") return { role: "full" } as T;

  // ── Foco ──
  if (route === "/api/focus" && method === "GET") {
    return st.focus as T;
  }
  if (route === "/api/focus/start" && method === "POST") {
    const taskPath = typeof payload.taskPath === "string" ? payload.taskPath : null;
    let projectPath = typeof payload.projectPath === "string" ? payload.projectPath : null;
    const taskEntry = taskPath ? entries.find((e) => e.path === taskPath) : null;
    if (taskEntry && !projectPath) {
      const pt = relationTarget(taskEntry.fm.project);
      projectPath = pt ? resolveTarget(entries, pt)?.path ?? null : null;
    }
    if (taskEntry && String(taskEntry.fm.status ?? "todo") === "todo") {
      writeNote(st, taskEntry.path, setFrontmatter(taskEntry.text, { status: "doing" }));
    }
    const projEntry = projectPath ? entries.find((e) => e.path === projectPath) : null;
    if (!taskEntry && !projEntry) {
      const fallback = entries.find((e) => e.type === "project");
      projectPath = fallback?.path ?? null;
    }
    const activeProj = projectPath ? entries.find((e) => e.path === projectPath) : null;
    st.focus = {
      active: true,
      id: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      taskPath: taskEntry?.path ?? null,
      taskTitle: taskEntry?.title ?? null,
      projectPath: activeProj?.path ?? null,
      projectTitle: activeProj?.title ?? null,
    };
    saveState();
    emitChange("focus", null);
    return st.focus as T;
  }
  if (route === "/api/focus/end" && method === "POST") {
    const started = st.focus.startedAt ? new Date(st.focus.startedAt).getTime() : Date.now() - 15 * 60_000;
    const minutes = Math.max(1, Math.round((Date.now() - started) / 60_000));
    const cp = typeof payload.checkpoint === "string" ? payload.checkpoint.trim() : "";
    if (cp && st.focus.projectPath && st.files[st.focus.projectPath]) {
      const cur = st.files[st.focus.projectPath].text;
      const { fmText, body: noteBody } = splitFrontmatter(cur);
      const next = (fmText === null ? "" : `---\n${fmText}\n---\n`) + appendToSection(noteBody, "Bitácora", `${today} ${localTime(now)} — ${cp}`);
      writeNote(st, st.focus.projectPath, next);
    }
    if (payload.done && st.focus.taskPath && st.files[st.focus.taskPath]) {
      const cur = st.files[st.focus.taskPath].text;
      writeNote(st, st.focus.taskPath, setFrontmatter(cur, { status: "done", done_at: new Date().toISOString() }));
    }
    st.focus = { active: false };
    saveState();
    emitChange("focus", null);
    return { minutes } as T;
  }

  // ── Hoy ──
  if (route === "/api/today" && method === "GET") {
    const openTasks = entries
      .filter((e) => e.type === "task")
      .map((e) => toTaskRow(e, entries))
      .filter((t) => t.status === "todo" || t.status === "doing");
    const ranked = openTasks
      .map((t) => rankTask(t, today))
      .sort((a, b) => b.score - a.score || (a.task.due ?? "9999").localeCompare(b.task.due ?? "9999"));
    const activeProjects = entries
      .filter((e) => e.type === "project" && (!e.fm.status || e.fm.status === "active"))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 3)
      .map((p) => buildResume(p, entries, today));
    const inboxList = entries.filter((e) => e.type === "capture").sort((a, b) => b.mtime - a.mtime);
    const pendingProposals = st.proposals.filter((p) => p.status === "pending").length;
    const view: TodayView = {
      date: today,
      focus: st.focus,
      suggestion: ranked[0] ?? null,
      alternatives: ranked.slice(1, 4),
      resume: activeProjects,
      inbox: {
        count: inboxList.length,
        items: inboxList.slice(0, 3).map((n) => ({ path: n.path, title: n.title })),
      },
      overdue: openTasks.filter((t) => !!t.due && t.due < today).length,
      proposals: pendingProposals,
    };
    return view as T;
  }

  // ── Bandeja y Captura ──
  if (route === "/api/inbox" && method === "GET") {
    const list = entries
      .filter((e) => e.type === "capture")
      .sort((a, b) => b.mtime - a.mtime)
      .map((e) => ({
        path: e.path,
        title: e.title,
        mtime: e.mtime,
        excerpt: e.body.replace(/^#+\s+.*$/gm, "").trim().slice(0, 180) || e.title,
      }));
    return list as T;
  }

  if (route === "/api/capture" && method === "POST") {
    const input = String(payload.text ?? "").trim();
    if (!input) throw new ApiError(400, "Nada que capturar");
    const parsed = parseCapture(input, today);
    const warnings = parsed.unparsed.map((u) => `No entendí la fecha «${u}»`);
    if (parsed.kind === "decision") {
      const proj = parsed.projectQuery
        ? resolveTarget(entries.filter((e) => e.type === "project"), parsed.projectQuery)
        : st.focus.projectPath
          ? entries.find((e) => e.path === st.focus.projectPath) ?? null
          : entries.find((e) => e.type === "project") ?? null;
      if (!proj) throw new ApiError(400, "¿De qué proyecto? Usa @proyecto");
      const { fmText, body: noteBody } = splitFrontmatter(proj.text);
      const next = (fmText === null ? "" : `---\n${fmText}\n---\n`) + appendToSection(noteBody, "Decisiones", `${today} — ${parsed.text}`);
      writeNote(st, proj.path, next);
      const res: CaptureResult = { kind: "decision", path: proj.path, message: `Decisión añadida a «${proj.title}»`, parked: false, warnings };
      return res as T;
    }
    if (parsed.kind === "task") {
      const proj = parsed.projectQuery ? resolveTarget(entries.filter((e) => e.type === "project"), parsed.projectQuery) : null;
      if (parsed.projectQuery && !proj) warnings.push(`No encontré el proyecto «${parsed.projectQuery}»`);
      const fm: Record<string, unknown> = { status: "todo" };
      if (proj) fm.project = `[[${proj.title}]]`;
      if (parsed.due) fm.due = parsed.due;
      if (parsed.priority) fm.priority = parsed.priority;
      const created = createDemoNote(st, { title: parsed.title, type: "task", fm });
      const res: CaptureResult = {
        kind: "task",
        path: created.path,
        message: `Tarea creada${parsed.due ? ` para ${parsed.due}` : ""}`,
        parked: false,
        warnings,
      };
      return res as T;
    }
    const type: NoteType = parsed.kind === "note" ? "note" : "capture";
    const created = createDemoNote(st, {
      title: parsed.title,
      type,
      body: parsed.text !== parsed.title ? `${parsed.text}\n` : `# ${parsed.title}\n\n`,
    });
    const res: CaptureResult = {
      kind: parsed.kind,
      path: created.path,
      message: type === "capture" ? "Guardado en Bandeja" : "Nota creada",
      parked: false,
      warnings,
    };
    return res as T;
  }

  if (route === "/api/capture/convert" && method === "POST") {
    const path = String(payload.path ?? "");
    const kind = payload.kind === "task" ? "task" : "note";
    const file = st.files[path];
    if (!file) throw new ApiError(404, "Captura no encontrada");
    const updated = setFrontmatter(file.text, kind === "task" ? { type: "task", status: "todo" } : { type: "note" });
    const base = path.split("/").pop() ?? "nota.md";
    const dest = uniquePath(st, `${FOLDERS[kind]}/${base}`);
    delete st.files[path];
    writeNote(st, dest, updated);
    return { path: dest } as T;
  }

  // ── Proyectos ──
  if (route === "/api/projects" && method === "GET") {
    const list = entries
      .filter((e) => e.type === "project")
      .sort((a, b) => b.mtime - a.mtime)
      .map((p) => buildResume(p, entries, today));
    return list as T;
  }
  if (route === "/api/project" && method === "GET") {
    const path = params.get("path") ?? "";
    const proj = entries.find((e) => e.path === path);
    if (!proj) throw new ApiError(404, "Proyecto no encontrado");
    return buildResume(proj, entries, today) as T;
  }
  if (route === "/api/project/create" && method === "POST") {
    const title = String(payload.title ?? "").trim() || "Nuevo proyecto";
    const created = createDemoNote(st, {
      title,
      type: "project",
      fm: { status: "active" },
      body: `# ${title}\n\n## Objetivo\n\n## Decisiones\n\n## Bitácora\n`,
    });
    return { path: created.path } as T;
  }
  if ((route === "/api/project/checkpoint" || route === "/api/project/decision") && method === "POST") {
    const path = String(payload.path ?? "");
    const text = String(payload.text ?? "").trim();
    const file = st.files[path];
    if (!file) throw new ApiError(404, "Proyecto no encontrado");
    const { fmText, body: noteBody } = splitFrontmatter(file.text);
    const section = route.endsWith("decision") ? "Decisiones" : "Bitácora";
    const item = route.endsWith("decision") ? `${today} — ${text}` : `${today} ${localTime(now)} — ${text}`;
    const next = (fmText === null ? "" : `---\n${fmText}\n---\n`) + appendToSection(noteBody, section, item);
    writeNote(st, path, next);
    return { ok: true } as T;
  }
  if (route === "/api/context" && method === "GET") {
    const path = params.get("path") ?? "";
    const proj = entries.find((e) => e.path === path);
    if (!proj) throw new ApiError(404, "Proyecto no encontrado");
    const resume = buildResume(proj, entries, today);
    return {
      project: resume.project,
      lastCheckpoint: resume.lastCheckpoint,
      decisions: resume.decisions,
      openTasks: resume.open.map((t) => ({ path: t.path, title: t.title, status: t.status, due: t.due, priority: t.priority })),
      relatedNotes: resume.touched,
      note: "Este es el único payload que Kioku envía cuando consultas a un modelo sobre este proyecto (sin memoria oculta).",
    } as T;
  }

  // ── Tareas ──
  if (route === "/api/tasks" && method === "GET") {
    const statusFilter = params.get("status")?.split(",").filter(Boolean);
    let tasks = entries.filter((e) => e.type === "task").map((e) => toTaskRow(e, entries));
    if (statusFilter?.length) tasks = tasks.filter((t) => statusFilter.includes(t.status));
    return tasks as T;
  }
  if (route === "/api/task/status" && method === "POST") {
    const path = String(payload.path ?? "");
    const status = String(payload.status ?? "todo") as TaskStatus;
    const file = st.files[path];
    if (!file) throw new ApiError(404, "Tarea no encontrada");
    const next = setFrontmatter(file.text, {
      status,
      done_at: status === "done" ? new Date().toISOString() : null,
    });
    writeNote(st, path, next);
    return { ok: true } as T;
  }
  if (route === "/api/task/create" && method === "POST") {
    const title = String(payload.title ?? "").trim();
    if (!title) throw new ApiError(400, "Escribe un título");
    const fm: Record<string, unknown> = { status: (payload.status as string) || "todo" };
    if (payload.due) fm.due = payload.due;
    if (payload.priority) fm.priority = Number(payload.priority);
    if (payload.estimate) fm.estimate = Number(payload.estimate);
    if (typeof payload.projectPath === "string" && payload.projectPath) {
      fm.project = `[[${payload.projectPath.replace(/\.md$/i, "")}]]`;
    }
    if (typeof payload.areaPath === "string" && payload.areaPath) {
      fm.area = `[[${payload.areaPath.replace(/\.md$/i, "")}]]`;
    }
    const created = createDemoNote(st, { title, type: "task", fm });
    return { path: created.path, title, hash: created.hash } as T;
  }
  if (route === "/api/task/update" && method === "POST") {
    const path = String(payload.path ?? "");
    const file = st.files[path];
    if (!file) throw new ApiError(404, "Tarea no encontrada");
    const patch: Record<string, unknown> = {};
    if (payload.title !== undefined) patch.title = String(payload.title).trim();
    if (payload.status !== undefined) {
      patch.status = payload.status;
      patch.done_at = payload.status === "done" ? new Date().toISOString() : null;
    }
    if (payload.due !== undefined) patch.due = payload.due;
    if (payload.priority !== undefined) patch.priority = payload.priority;
    if (payload.estimate !== undefined) patch.estimate = payload.estimate;
    if (payload.projectPath !== undefined) {
      patch.project = payload.projectPath ? `[[${String(payload.projectPath).replace(/\.md$/i, "")}]]` : null;
    }
    if (payload.areaPath !== undefined) {
      patch.area = payload.areaPath ? `[[${String(payload.areaPath).replace(/\.md$/i, "")}]]` : null;
    }
    const next = setFrontmatter(file.text, patch);
    const { hash } = writeNote(st, path, next);
    const parsed = parseNote(next, path);
    return { path, title: parsed.title, hash } as T;
  }

  // ── Notas y Diario ──
  if (route === "/api/notes" && method === "GET") {
    const list: NoteListItem[] = entries.map((e) => ({
      path: e.path,
      title: e.title,
      type: e.type,
      mtime: e.mtime,
      tags: e.tags,
    }));
    return list as T;
  }
  if (route === "/api/note" && method === "GET") {
    const path = params.get("path") ?? "";
    const e = entries.find((x) => x.path === path);
    if (!e) throw new ApiError(404, "Nota no encontrada");
    const outgoing = e.links.map((l) => {
      const target = resolveTarget(entries, l.target);
      return { target: l.target, path: target?.path ?? null, title: target?.title ?? null };
    });
    const backlinks: NoteInfo["backlinks"] = [];
    for (const other of entries) {
      if (other.path === e.path) continue;
      if (other.links.some((l) => resolveTarget(entries, l.target)?.path === e.path)) {
        const line = other.body.split("\n").find((ln) => ln.includes("[[")) ?? "";
        backlinks.push({ path: other.path, title: other.title, type: other.type, context: line.slice(0, 120) });
      }
    }
    const info: NoteInfo = {
      path: e.path,
      text: e.text,
      hash: e.hash,
      note: { title: e.title, type: e.type, tags: e.tags, fm: e.fm, fmError: e.fmError },
      backlinks,
      outgoing,
      unlinked: [],
    };
    return info as T;
  }
  if (route === "/api/note" && method === "PUT") {
    const path = String(payload.path ?? "");
    const text = String(payload.text ?? "");
    const { hash } = writeNote(st, path, text);
    return { hash } as T;
  }
  if (route === "/api/note/create" && method === "POST") {
    const title = String(payload.title ?? "").trim() || "Nueva nota";
    const type = (payload.type as NoteType) || "note";
    const created = createDemoNote(st, { title, type });
    return { path: created.path } as T;
  }
  if (route === "/api/note/props" && method === "POST") {
    const path = String(payload.path ?? "");
    const props = (payload.props && typeof payload.props === "object" ? payload.props : {}) as Record<string, unknown>;
    const file = st.files[path];
    if (!file) throw new ApiError(404, "Nota no encontrada");
    const next = setFrontmatter(file.text, props);
    const { hash } = writeNote(st, path, next);
    return { hash } as T;
  }
  if (route === "/api/note/delete" && method === "POST") {
    const path = String(payload.path ?? "");
    const file = st.files[path];
    if (file) {
      st.trash[path] = file;
      delete st.files[path];
      saveState();
      emitChange("delete", path);
    }
    return { ok: true } as T;
  }
  if (route === "/api/note/open" && method === "POST") {
    return { ok: true } as T;
  }
  if (route === "/api/journal" && method === "POST") {
    const jPath = `Diario/${today}.md`;
    if (!st.files[jPath]) {
      createDemoNote(st, { title: today, type: "journal", folder: "Diario", body: `# ${today}\n\n` });
    }
    return { path: jPath } as T;
  }
  if (route === "/api/resolve" && method === "GET") {
    const q = params.get("q") ?? "";
    const target = resolveTarget(entries, q);
    return { path: target?.path ?? null } as T;
  }

  // ── Búsqueda y Grafo ──
  if (route === "/api/search" && method === "GET") {
    const q = normKey(params.get("q") ?? "");
    const limit = Number(params.get("limit") ?? 20);
    if (!q) return [] as unknown as T;
    const hits: SearchHit[] = [];
    for (const e of entries) {
      if (e.type === "block") continue;
      const titleMatch = normKey(e.title).includes(q);
      const bodyMatch = normKey(e.body).includes(q);
      if (!titleMatch && !bodyMatch) continue;
      const line = e.body.split("\n").find((l) => normKey(l).includes(q)) ?? e.body.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? e.title;
      const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
      const snippet = line.slice(0, 140).replace(re, "«$1»");
      hits.push({
        path: e.path,
        title: e.title,
        type: e.type,
        snippet,
        score: titleMatch ? 10 : 5,
        kind: titleMatch ? "title" : "content",
      });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit) as T;
  }

  if (route === "/api/graph" && method === "GET") {
    const visible = entries.filter((e) => e.type !== "block" && e.type !== "area" && e.type !== "database");
    const idxByPath = new Map<string, number>();
    visible.forEach((e, i) => idxByPath.set(e.path, i));
    const edgeSet = new Set<string>();
    const edges: [number, number][] = [];
    const degree = new Array<number>(visible.length).fill(0);
    for (let i = 0; i < visible.length; i++) {
      for (const l of visible[i].links) {
        const target = resolveTarget(visible, l.target);
        if (!target) continue;
        const j = idxByPath.get(target.path);
        if (j === undefined || i === j) continue;
        const a = Math.min(i, j);
        const b = Math.max(i, j);
        const key = `${a}:${b}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push([a, b]);
          degree[a]++;
          degree[b]++;
        }
      }
    }
    const nodes = visible.map((e, i) => ({
      path: e.path,
      title: e.title,
      type: e.type,
      degree: degree[i],
    }));
    const isolated = nodes.filter((n) => n.degree === 0).length;
    return { nodes, edges, total: nodes.length, isolated } as T;
  }

  // ── Bases de datos ──
  if (route === "/api/databases" && method === "GET") {
    const rows: DbRow[] = entries.map((e) => ({ path: e.path, title: e.title, type: e.type, tags: e.tags, mtime: e.mtime, fm: e.fm }));
    const dbs = rows
      .filter((r) => r.type === "database")
      .map((r) => {
        const def = parseDatabase(r);
        return {
          path: def.path,
          title: def.title,
          rows: rows.filter((x) => matchesSource(def, x)).length,
          views: def.views,
          warnings: def.warnings,
        };
      });
    return dbs as T;
  }
  if (route === "/api/database/query" && method === "POST") {
    const path = String(payload.path ?? "");
    const dbEntry = entries.find((e) => e.path === path && e.type === "database");
    if (!dbEntry) throw new ApiError(404, "Base de datos no encontrada");
    const def = parseDatabase({ path: dbEntry.path, title: dbEntry.title, fm: dbEntry.fm });
    const reqView = payload.view;
    let view: View = def.views[0];
    if (typeof reqView === "string") {
      view = def.views.find((v) => v.name === reqView) ?? def.views[0];
    } else if (reqView && typeof reqView === "object") {
      const probe = parseDatabase({ path: "", title: "", fm: { views: [reqView] } });
      if (probe.views[0]) view = probe.views[0];
    }
    const allRows: DbRow[] = entries
      .map((e) => ({ path: e.path, title: e.title, type: e.type, tags: e.tags, mtime: e.mtime, fm: e.fm }))
      .filter((r) => matchesSource(def, r));
    return {
      ...queryRows(def, view, allRows),
      database: {
        path: def.path,
        title: def.title,
        views: def.views,
        warnings: def.warnings,
        available: availableColumns(def, allRows),
      },
    } as T;
  }
  if (route === "/api/database/create" && method === "POST") {
    const name = String(payload.name ?? "").trim() || "Nueva base";
    const tpl = String(payload.template ?? "vacía");
    const table = (columns: string[]) => ({ name: "Tabla", kind: "table", columns, filter: [], sort: [], group: null });
    const board = (vname: string, group: string, columns: string[]) => ({ name: vname, kind: "board", columns, filter: [], sort: [], group });
    const spec: Record<string, unknown> =
      tpl === "tareas"
        ? {
            source: { type: "task" },
            properties: { status: { type: "select", options: ["todo", "doing", "done", "dropped"] }, due: { type: "date" }, priority: { type: "number" } },
            views: [table(["title", "status", "due", "priority"]), board("Tablero", "status", ["title", "due"])],
          }
        : tpl === "proyectos"
          ? {
              source: { type: "project" },
              properties: { status: { type: "select", options: ["active", "paused", "done"] } },
              views: [table(["title", "status"]), board("Por estado", "status", ["title"])],
            }
          : tpl === "libros"
            ? {
                source: { folder: "Libros/" },
                properties: { Estado: { type: "select", options: ["Quiero leer", "Leyendo", "Leído"] }, Autor: { type: "text" }, Nota: { type: "number" } },
                views: [table(["title", "Estado", "Autor", "Nota"]), board("Por estado", "Estado", ["title", "Autor"])],
              }
            : {
                source: { folder: `${cleanFileName(name)}/` },
                properties: {},
                views: [table(["title"])],
              };
    const created = createDemoNote(st, {
      title: name,
      type: "database",
      fm: spec,
      body: `# ${name}\n\nBase de datos sobre notas Markdown.\n`,
    });
    return { path: created.path } as T;
  }
  if (route === "/api/database/row" && method === "POST") {
    const dbPath = String(payload.path ?? "");
    const title = String(payload.title ?? "").trim() || "Nueva fila";
    const props = (payload.props && typeof payload.props === "object" ? payload.props : {}) as Record<string, unknown>;
    const dbEntry = entries.find((e) => e.path === dbPath && e.type === "database");
    if (!dbEntry) throw new ApiError(404, "Base de datos no encontrada");
    const def = parseDatabase({ path: dbEntry.path, title: dbEntry.title, fm: dbEntry.fm });
    const folder = def.source.folder ? def.source.folder.replace(/\/+$/, "") : FOLDERS[def.source.type ?? "note"] ?? "Notas";
    const type = def.source.type ?? "note";
    const fm: Record<string, unknown> = { ...props };
    if (def.source.tags.length && fm.tags === undefined) fm.tags = def.source.tags;
    if (type === "task" && fm.status === undefined) fm.status = "todo";
    const created = createDemoNote(st, { title, type, folder, fm });
    return { path: created.path } as T;
  }
  if ((route === "/api/database/schema" || route === "/api/database/schema/preview") && method === "POST") {
    throw new ApiError(400, "Editar las propiedades de una base no está disponible en la demo; instala Kioku para probarlo.");
  }
  if (route === "/api/database/view" && method === "POST") {
    const dbPath = String(payload.path ?? "");
    const view = payload.view as View;
    const file = st.files[dbPath];
    if (!file || !view) throw new ApiError(404, "Base de datos no encontrada");
    const parsed = parseNote(file.text, dbPath);
    const views = Array.isArray(parsed.frontmatter.views) ? [...parsed.frontmatter.views] : [];
    const idx = views.findIndex((v) => v && typeof v === "object" && (v as { name?: string }).name === view.name);
    if (idx >= 0) views[idx] = view;
    else views.push(view);
    writeNote(st, dbPath, setFrontmatter(file.text, { views }));
    return { ok: true } as T;
  }
  if (route === "/api/database/view/delete" && method === "POST") {
    const dbPath = String(payload.path ?? "");
    const name = String(payload.name ?? "");
    const file = st.files[dbPath];
    if (!file) throw new ApiError(404, "Base de datos no encontrada");
    const parsed = parseNote(file.text, dbPath);
    const views = (Array.isArray(parsed.frontmatter.views) ? parsed.frontmatter.views : []).filter(
      (v) => !(v && typeof v === "object" && (v as { name?: string }).name === name),
    );
    writeNote(st, dbPath, setFrontmatter(file.text, { views }));
    return { ok: true } as T;
  }

  // ── Calendario y Áreas ──
  if (route === "/api/calendar/projects" && method === "GET") {
    const projects: CalendarProject[] = entries
      .filter((e) => e.type === "project" && (!e.fm.status || e.fm.status === "active"))
      .map((e) => ({ path: e.path, title: e.title }));
    return projects as T;
  }
  if (route === "/api/calendar/areas" && method === "GET") {
    const areas: AreaRow[] = entries
      .filter((e) => e.type === "area")
      .map((e) => ({
        path: e.path,
        title: e.title,
        color: typeof e.fm.color === "string" ? e.fm.color : "#7f9bd6",
        hash: e.hash,
      }));
    return areas as T;
  }
  if (route === "/api/calendar" && method === "GET") {
    const from = params.get("from") ?? today;
    const to = params.get("to") ?? today;
    const items: CalendarEntry[] = [];
    for (const e of entries) {
      if (e.type !== "block" && !e.path.startsWith("Calendario/")) continue;
      const dto = buildCalendarDto(e, entries, nowMinute);
      if (!dto) continue;
      if (dto.end.slice(0, 10) >= from && dto.start.slice(0, 10) <= to) {
        items.push(dto);
      }
    }
    const tasks: CalendarTask[] = entries
      .filter((e) => e.type === "task")
      .map((e) => ({
        ...toTaskRow(e, entries),
        estimate: taskEstimate(e.fm.estimate),
        hash: e.hash,
      }))
      .filter((t) => t.status === "todo" || t.status === "doing");
    const areas: AreaRow[] = entries
      .filter((e) => e.type === "area")
      .map((e) => ({
        path: e.path,
        title: e.title,
        color: typeof e.fm.color === "string" ? e.fm.color : "#7f9bd6",
        hash: e.hash,
      }));
    const resp: CalendarResponse = {
      items,
      tasks,
      invalid: [],
      areas,
      now: nowMinute,
    };
    return resp as T;
  }
  if (route === "/api/calendar/create" && method === "POST") {
    const title = String(payload.title ?? "").trim() || "Actividad";
    const kind = payload.kind === "event" ? "event" : "block";
    const start = String(payload.start ?? `${today}T10:00`);
    const end = String(payload.end ?? `${today}T11:00`);
    const fm: Record<string, unknown> = { title, kind, start, end };
    if (typeof payload.taskPath === "string" && payload.taskPath) fm.task = `[[${payload.taskPath.replace(/\.md$/i, "")}]]`;
    if (typeof payload.areaPath === "string" && payload.areaPath) fm.area = `[[${payload.areaPath.replace(/\.md$/i, "")}]]`;
    const created = createDemoNote(st, { title, type: "block", folder: "Calendario", fm });
    const freshEntries = allEntries(st);
    const entry = freshEntries.find((e) => e.path === created.path)!;
    return buildCalendarDto(entry, freshEntries, nowMinute) as T;
  }
  if ((route === "/api/calendar/move" || route === "/api/calendar/update" || route === "/api/calendar/finish" || route === "/api/calendar/area" || route === "/api/calendar/link") && method === "POST") {
    const path = String(payload.path ?? "");
    const file = st.files[path];
    if (!file) throw new ApiError(404, "Actividad no encontrada");
    const patch: Record<string, unknown> = {};
    if (route === "/api/calendar/finish") {
      patch.done_at = new Date().toISOString();
    } else if (route === "/api/calendar/area") {
      patch.area = payload.areaPath ? `[[${String(payload.areaPath).replace(/\.md$/i, "")}]]` : null;
    } else if (route === "/api/calendar/link") {
      if (payload.task && typeof payload.task === "object") {
        const tInput = payload.task as Record<string, unknown>;
        const createdTask = await handleDemoApi<{ path: string }>("POST", "/api/task/create", tInput);
        patch.task = `[[${createdTask.path.replace(/\.md$/i, "")}]]`;
      } else {
        patch.task = payload.taskPath ? `[[${String(payload.taskPath).replace(/\.md$/i, "")}]]` : null;
      }
    } else {
      if (payload.title !== undefined) patch.title = String(payload.title).trim();
      if (payload.kind !== undefined) patch.kind = payload.kind;
      if (payload.start !== undefined) patch.start = payload.start;
      if (payload.end !== undefined) patch.end = payload.end;
    }
    const next = setFrontmatter(file.text, patch);
    writeNote(st, path, next);
    const freshEntries = allEntries(st);
    const entry = freshEntries.find((e) => e.path === path)!;
    return buildCalendarDto(entry, freshEntries, nowMinute) as T;
  }
  if (route === "/api/calendar/delete" && method === "POST") {
    const path = String(payload.path ?? "");
    if (st.files[path]) {
      st.trash[path] = st.files[path];
      delete st.files[path];
      saveState();
      emitChange("delete", path);
    }
    return { ok: true } as T;
  }
  if (route === "/api/calendar/restore" && method === "POST") {
    const path = String(payload.path ?? "");
    const trashed = st.trash[path];
    if (!trashed) throw new ApiError(404, "No está en la papelera");
    delete st.trash[path];
    writeNote(st, path, trashed.text);
    const freshEntries = allEntries(st);
    const entry = freshEntries.find((e) => e.path === path)!;
    return buildCalendarDto(entry, freshEntries, nowMinute) as T;
  }
  if ((route === "/api/calendar/areas/create" || route === "/api/calendar/areas/update") && method === "POST") {
    const title = String(payload.title ?? "").trim() || "Área";
    const color = typeof payload.color === "string" ? payload.color : "#7f9bd6";
    if (route.endsWith("create")) {
      const created = createDemoNote(st, { title, type: "area", folder: "Areas", fm: { title, color } });
      return { path: created.path, title, color, hash: created.hash } as T;
    }
    const path = String(payload.path ?? "");
    const file = st.files[path];
    if (!file) throw new ApiError(404, "Área no encontrada");
    const next = setFrontmatter(file.text, { title, color });
    const { hash } = writeNote(st, path, next);
    return { path, title, color, hash } as T;
  }

  // ── Propuestas e IA ──
  if (route === "/api/proposals" && method === "GET") {
    const status = params.get("status") ?? "pending";
    return st.proposals.filter((p) => p.status === status) as T;
  }
  if (route === "/api/triage" && method === "POST") {
    const have = new Set(st.proposals.filter((p) => p.status === "pending").map((p) => p.key));
    const captures = entries.filter((e) => e.type === "capture" && !have.has(`triage:${e.path}`));
    const created: Proposal[] = [];
    for (const c of captures) {
      const isTask = /^(llamar|comprar|revisar|enviar|escribir|hacer|terminar|preparar|configurar|implementar|probar)\b/i.test(c.title);
      const kind = isTask ? "task" : "note";
      const base = cleanFileName(c.title);
      const prop: Proposal = {
        id: `prop-demo-${Date.now()}-${created.length + 1}`,
        createdAt: new Date().toISOString(),
        source: "rules",
        status: "pending",
        key: `triage:${c.path}`,
        title: `${kind === "task" ? "Convertir en tarea" : "Guardar como nota"}: ${c.title}`,
        rationale: isTask
          ? `Empieza con un verbo de acción («${c.title.split(/\s+/)[0]}»).`
          : "Es una idea o referencia para archivar en Notas.",
        ops: [
          { op: "setProp", path: c.path, before: c.hash, props: kind === "task" ? { type: "task", status: "todo" } : { type: "note" } },
          { op: "move", from: c.path, to: `${FOLDERS[kind]}/${base}.md`, before: c.hash },
        ],
      };
      st.proposals.push(prop);
      created.push(prop);
    }
    if (created.length) {
      saveState();
      emitChange("proposals", null);
    }
    return created as T;
  }
  const propMatch = /^\/api\/proposals\/([^/]+)\/(apply|reject)$/.exec(route);
  if (propMatch && method === "POST") {
    const [, id, action] = propMatch;
    const p = st.proposals.find((x) => x.id === id);
    if (!p) throw new ApiError(404, "Propuesta no encontrada");
    if (action === "reject") {
      p.status = "rejected";
      p.resolvedAt = new Date().toISOString();
    } else {
      for (const op of p.ops) {
        if (op.op === "setProp" && st.files[op.path]) {
          st.files[op.path].text = setFrontmatter(st.files[op.path].text, op.props);
          st.files[op.path].mtime = Date.now();
        } else if (op.op === "move" && st.files[op.from]) {
          const dest = uniquePath(st, op.to);
          st.files[dest] = { text: st.files[op.from].text, mtime: Date.now() };
          delete st.files[op.from];
        } else if (op.op === "trash" && st.files[op.path]) {
          st.trash[op.path] = st.files[op.path];
          delete st.files[op.path];
        } else if (op.op === "create") {
          const dest = uniquePath(st, op.path);
          st.files[dest] = { text: op.text, mtime: Date.now() };
        }
      }
      p.status = "applied";
      p.resolvedAt = new Date().toISOString();
    }
    saveState();
    emitChange("proposals", null);
    return p as T;
  }
  if (route === "/api/ai" && method === "GET") {
    return {
      configured: true,
      model: "hermes-demo-local",
      baseUrl: "http://127.0.0.1:11434/v1",
      local: true,
      apiKeyEnv: null,
    } as T;
  }
  if (route === "/api/ai/preview" && method === "GET") {
    const captures = entries.filter((e) => e.type === "capture");
    if (!captures.length) return null as T;
    return {
      endpoint: "http://127.0.0.1:11434/v1/chat/completions",
      model: "hermes-demo-local",
      local: true,
      captures: captures.length,
      hash: "demo-preview-hash",
      messages: [
        { role: "system", content: "Clasifica cada captura de la Bandeja como tarea o nota e indica si pertenece a algún proyecto activo. Nunca inventes rutas: Kioku construye las operaciones verificadas por hash." },
        { role: "user", content: JSON.stringify({ captures: captures.map((c) => ({ path: c.path, title: c.title, body: c.body.trim() })) }, null, 2) },
      ],
    } as T;
  }
  if (route === "/api/ai/triage" && method === "POST") {
    return handleDemoApi<T>("POST", "/api/triage", {});
  }

  // ── Asistente ──
  if (route === "/api/assistant/status" && method === "GET") {
    return { ok: true } as T;
  }
  if (route === "/api/assistant/actions" && method === "GET") {
    return st.actions as T;
  }
  if (route === "/api/assistant/undo" && method === "POST") {
    const id = String(payload.id ?? "");
    const act = st.actions.find((a) => a.id === id);
    if (!act) throw new ApiError(404, "Acción no encontrada");
    for (const f of act.files) {
      if (f.beforeText === null) delete st.files[f.path];
      else st.files[f.path] = { text: f.beforeText, mtime: Date.now() };
    }
    act.undone = new Date().toISOString();
    saveState();
    emitChange("note", null);
    return act as T;
  }
  if (route === "/api/assistant/memory" && method === "GET") {
    return st.memories as T;
  }
  if (route === "/api/assistant/memory/delete" && method === "POST") {
    const path = String(payload.path ?? "");
    st.memories = st.memories.filter((m) => m.path !== path);
    saveState();
    return { ok: true } as T;
  }
  if (route === "/api/assistant/model") {
    return {
      effective: {
        provider: "openai-codex",
        model: "Modo Demo Interactivo",
        baseOrigin: null,
        apiMode: null,
        source: "default",
      },
      override: { state: "none" },
      credentials: { state: "not-needed", source: null },
      providers: [
        { id: "openai-codex", keys: [], ownBaseUrl: false, keylessLocal: false },
        { id: "anthropic", keys: ["ANTHROPIC_API_KEY"], ownBaseUrl: false, keylessLocal: false },
        { id: "gemini", keys: ["GEMINI_API_KEY"], ownBaseUrl: false, keylessLocal: false },
        { id: "custom", keys: ["OPENAI_API_KEY"], ownBaseUrl: true, keylessLocal: true },
      ],
      apiModes: ["chat_completions", "responses"],
      readiness: { ok: true },
    } as T;
  }
  if (route === "/api/assistant/ask" && method === "POST") {
    const msg = String(payload.message ?? "").trim();
    const low = normKey(msg);
    emitChange("assistant.tool", null, { tool: "today" });

    if (low.includes("bandeja") || low.includes("clasifica") || low.includes("revisa mi espacio")) {
      const created = await handleDemoApi<Proposal[]>("POST", "/api/triage", {});
      const inboxReads = entries.filter((e) => e.type === "capture").map((e) => e.path);
      return {
        answer: created.length
          ? `He revisado tu Bandeja (${inboxReads.length} capturas) y he dejado **${created.length} propuesta(s)** lista(s) para que las apruebes aquí mismo o en la sección **Propuestas**. Recuerda que el asistente nunca mueve ni sobrescribe notas sin tu confirmación.`
          : `He revisado tu Bandeja y tus proyectos activos («Lanzamiento de Kioku Cloud» y «Portfolio y Marca Personal»). Todas las capturas actuales ya tienen una propuesta pendiente de revisión.`,
        reads: inboxReads.length ? inboxReads : ["Proyectos/Lanzamiento de Kioku Cloud.md"],
        actions: [],
      } as T;
    }

    if (low.includes("hoy") || low.includes("empiezo") || low.includes("hacer")) {
      const todayView = await handleDemoApi<TodayView>("GET", "/api/today");
      const top = todayView.suggestion?.task;
      return {
        answer: top
          ? `Para hoy (${today}) tu paso prioritario es **«${top.title}»** (${todayView.suggestion!.reasons.join(" · ")}).\n\nAdemás tienes ${todayView.inbox.count} captura(s) en la Bandeja y ${todayView.proposals} propuesta(s) por revisar. ¿Quieres iniciar un bloque de foco en esa tarea?`
          : `No tienes tareas urgentes abiertas para hoy. Puedes capturar una nueva con la tecla \`c\` o revisar tus proyectos activos.`,
        reads: [
          ...(top ? [top.path] : []),
          "Proyectos/Lanzamiento de Kioku Cloud.md",
          `Diario/${today}.md`,
        ],
        actions: [],
      } as T;
    }

    return {
      answer: `*(Modo Demo Interactivo)* He consultado tus notas locales para responder a: «${msg}».\n\nEn una instalación real de **Kioku** (Kioku Cloud es solo una idea planificada, no existe servicio alojado), aquí responde el agente Hermes aislado en jaula leyendo únicamente las notas necesarias (máximo 5 por consulta), aplicando cambios pequeños con botón **Deshacer** y enviando cualquier cambio estructural a **Propuestas**.`,
      reads: ["Notas/Filosofía Local-First.md", "Notas/Seguridad del asistente en jaula.md"],
      actions: [],
    } as T;
  }

  return {} as T;
}
