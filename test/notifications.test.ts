import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NOTIFY_CONFIG, dueNotifications, parseNotifyConfig, type NotifyEvent, type NotifyTask } from "../src/core/notifications.ts";

const at = (s: string) => new Date(s);
const ev = (o: Partial<NotifyEvent> = {}): NotifyEvent => ({ path: "Calendario/a.md", title: "Dentista", kind: "event", start: "2026-11-05T17:00", end: "2026-11-05T18:00", state: "pending", ...o });
const task = (o: Partial<NotifyTask> = {}): NotifyTask => ({ path: "Tareas/t.md", title: "Informe", due: "2026-11-05", status: "todo", ...o });
const run = (now: string, o: { events?: NotifyEvent[]; tasks?: NotifyTask[]; fired?: string[]; visible?: (p: string) => boolean } = {}) =>
  dueNotifications({ now: at(now), events: o.events ?? [], tasks: o.tasks ?? [], fired: new Set(o.fired ?? []), config: DEFAULT_NOTIFY_CONFIG, visible: o.visible });

test("evento: avisa dentro de la antelación (10 min) y no antes ni una vez empezado", () => {
  assert.equal(run("2026-11-05T16:49:00", { events: [ev()] }).length, 0);
  const n = run("2026-11-05T16:50:00", { events: [ev()] });
  assert.equal(n.length, 1);
  assert.equal(n[0].title, "Dentista");
  assert.match(n[0].body, /17:00/);
  assert.equal(run("2026-11-05T17:00:00", { events: [ev()] }).length, 0);
});

test("evento: no se repite (ledger) y se omite si está terminado", () => {
  const first = run("2026-11-05T16:55:00", { events: [ev()] });
  assert.equal(run("2026-11-05T16:56:00", { events: [ev()], fired: [first[0].id] }).length, 0);
  assert.equal(run("2026-11-05T16:55:00", { events: [ev({ state: "done" })] }).length, 0);
});

test("resumen: a partir de la hora (09:00) agrupa las tareas de hoy y las vencidas, una sola vez por día", () => {
  const tasks = [task(), task({ path: "Tareas/v.md", title: "Vieja", due: "2026-11-01" }), task({ path: "Tareas/f.md", title: "Futura", due: "2026-11-09" }), task({ path: "Tareas/d.md", title: "Hecha", status: "done" })];
  assert.equal(run("2026-11-05T08:59:00", { tasks }).length, 0);
  const n = run("2026-11-05T09:00:00", { tasks });
  assert.equal(n.length, 1);
  assert.match(n[0].title, /2/);
  assert.match(n[0].body, /Informe/);
  assert.match(n[0].body, /Vieja/);
  assert.doesNotMatch(n[0].body, /Futura|Hecha/);
  assert.equal(run("2026-11-05T12:00:00", { tasks, fired: [n[0].id] }).length, 0);
});

test("resumen: sin tareas pendientes de hoy no se envía nada", () => {
  assert.equal(run("2026-11-05T10:00:00", { tasks: [task({ due: "2026-11-09" })] }).length, 0);
});

test("canal: lo que no es visible no aparece en ningún aviso", () => {
  const visible = (p: string) => !p.startsWith("Privado/");
  const tasks = [task({ path: "Privado/s.md", title: "Secreta" })];
  assert.equal(run("2026-11-05T10:00:00", { tasks, visible }).length, 0);
  assert.equal(run("2026-11-05T16:55:00", { events: [ev({ path: "Privado/e.md" })], visible }).length, 0);
  const n = run("2026-11-05T10:00:00", { tasks: [...tasks, task()], visible });
  assert.doesNotMatch(JSON.stringify(n), /Secreta/);
});

test("configuración: valores por defecto, válidos aceptados e inválidos ignorados campo a campo", () => {
  assert.deepEqual(parseNotifyConfig(null), DEFAULT_NOTIFY_CONFIG);
  assert.deepEqual(parseNotifyConfig('{"eventLeadMinutes":30,"digestHour":8,"desktop":false}'), { desktop: false, eventLeadMinutes: 30, digestHour: 8 });
  assert.deepEqual(parseNotifyConfig('{"eventLeadMinutes":-5,"digestHour":30}'), DEFAULT_NOTIFY_CONFIG);
  assert.deepEqual(parseNotifyConfig("{no json"), DEFAULT_NOTIFY_CONFIG);
});
