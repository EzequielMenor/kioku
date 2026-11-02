// Planificador puro de avisos: decide qué toca avisar ahora; no envía nada ni toca el disco.
// Cada canal (escritorio, push) lleva su propio registro `fired` y su filtro `visible`.
import { localDate } from "./dates.ts";
import { parseLocal } from "./calendar.ts";

export interface NotifyConfig { desktop: boolean; eventLeadMinutes: number; digestHour: number }
export const DEFAULT_NOTIFY_CONFIG: NotifyConfig = { desktop: true, eventLeadMinutes: 10, digestHour: 9 };

export interface NotifyEvent { path: string; title: string; kind: "block" | "event"; start: string; end: string; state: string }
export interface NotifyTask { path: string; title: string; due: string | null; status: string }
export interface Notification { id: string; kind: "event" | "digest"; title: string; body: string; paths: string[] }

/** Lee `.kioku/notifications.json`; cada campo inválido o ausente toma su valor por defecto. */
export function parseNotifyConfig(raw: string | null): NotifyConfig {
  let o: Record<string, unknown> = {};
  try { const v = raw ? JSON.parse(raw) : {}; if (v && typeof v === "object" && !Array.isArray(v)) o = v as Record<string, unknown>; } catch { /* config rota: valores por defecto */ }
  const d = DEFAULT_NOTIFY_CONFIG;
  return {
    desktop: typeof o.desktop === "boolean" ? o.desktop : d.desktop,
    eventLeadMinutes: Number.isInteger(o.eventLeadMinutes) && (o.eventLeadMinutes as number) >= 0 && (o.eventLeadMinutes as number) <= 1440 ? (o.eventLeadMinutes as number) : d.eventLeadMinutes,
    digestHour: Number.isInteger(o.digestHour) && (o.digestHour as number) >= 0 && (o.digestHour as number) <= 23 ? (o.digestHour as number) : d.digestHour,
  };
}

export function dueNotifications(input: {
  now: Date; events: NotifyEvent[]; tasks: NotifyTask[]; fired: ReadonlySet<string>; config: NotifyConfig; visible?: (path: string) => boolean;
}): Notification[] {
  const { now, config, fired } = input;
  const visible = input.visible ?? (() => true);
  const out: Notification[] = [];
  for (const e of input.events) {
    if (e.state === "done" || !visible(e.path)) continue;
    const id = `event:${e.path}:${e.start}`;
    if (fired.has(id)) continue;
    let start: Date;
    try { start = parseLocal(e.start); } catch { continue; }
    const until = start.getTime() - now.getTime();
    if (until <= 0 || until > config.eventLeadMinutes * 60_000) continue;
    out.push({ id, kind: "event", title: e.title, body: `${e.kind === "event" ? "Evento" : "Bloque"} a las ${e.start.slice(11)}`, paths: [e.path] });
  }
  const today = localDate(now), id = `digest:${today}`;
  if (!fired.has(id) && now.getHours() >= config.digestHour) {
    const open = input.tasks.filter((t) => (t.status === "todo" || t.status === "doing") && t.due && t.due <= today && visible(t.path))
      .sort((a, b) => a.due!.localeCompare(b.due!) || a.title.localeCompare(b.title));
    if (open.length) {
      const shown = open.slice(0, 5).map((t) => `• ${t.title}${t.due! < today ? ` (vencida ${t.due})` : ""}`);
      if (open.length > 5) shown.push(`… y ${open.length - 5} más`);
      out.push({ id, kind: "digest", title: `Hoy: ${open.length} ${open.length === 1 ? "tarea" : "tareas"}`, body: shown.join("\n"), paths: open.map((t) => t.path) });
    }
  }
  return out;
}

