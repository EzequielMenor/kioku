import { test } from "node:test";
import assert from "node:assert/strict";
import { Kioku } from "../src/core/kioku.ts";
import { Notifier, type Channel } from "../src/server/notifier.ts";
import type { Notification } from "../src/core/notifications.ts";
import { tmpVault } from "./helpers.ts";

async function setup(files: Record<string, string> = {}) {
  const { root, cleanup } = tmpVault(files);
  let now = new Date("2026-11-05T16:00:00");
  const j = await Kioku.open({ root, now: () => now });
  const sent: Notification[] = [];
  const ch: Channel = { name: "fake", enabled: () => true, visible: () => true, send: async (n) => { sent.push(n); } };
  const notifier = new Notifier(j, [ch], () => now);
  return { j, cleanup, sent, ch, notifier, at: (s: string) => { now = new Date(s); } };
}

test("notificador: avisa del evento una sola vez, también tras reiniciar (registro en disco)", async () => {
  const { j, cleanup, sent, ch, notifier, at } = await setup();
  try {
    await j.calendar.create({ id: "evento-dentista", title: "Dentista", kind: "event", start: "2026-11-05T17:00", end: "2026-11-05T18:00" });
    at("2026-11-05T16:30:00");
    await notifier.tick();
    assert.equal(sent.length, 0);
    at("2026-11-05T16:55:00");
    await notifier.tick();
    await notifier.tick();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, "Dentista");
    await new Notifier(j, [ch], () => new Date("2026-11-05T16:56:00")).tick();
    assert.equal(sent.length, 1);
    j.close();
  } finally { cleanup(); }
});

test("notificador: resumen de tareas de hoy a las 9 y solo una vez", async () => {
  const { j, cleanup, sent, notifier, at } = await setup();
  try {
    await j.createNote({ title: "Informe", type: "task", fm: { status: "todo", due: "2026-11-05" } });
    at("2026-11-05T08:00:00"); await notifier.tick();
    assert.equal(sent.length, 0);
    at("2026-11-05T09:01:00"); await notifier.tick();
    at("2026-11-05T15:00:00"); await notifier.tick();
    assert.equal(sent.length, 1);
    assert.match(sent[0].body, /Informe/);
    j.close();
  } finally { cleanup(); }
});

test("notificador: si el envío falla no se marca como enviado y se reintenta; un canal caído no frena al resto", async () => {
  const { j, cleanup, sent, ch, at } = await setup();
  try {
    await j.calendar.create({ id: "evento-reintento", title: "Reunión", kind: "event", start: "2026-11-05T17:00", end: "2026-11-05T18:00" });
    at("2026-11-05T16:55:00");
    let fail = true;
    const flaky: Channel = { name: "flaky", enabled: () => true, visible: () => true, send: async (n) => { if (fail) throw new Error("sin red"); sent.push(n); } };
    const n = new Notifier(j, [flaky, ch], () => new Date("2026-11-05T16:55:00"), () => undefined);
    await n.tick();
    assert.equal(sent.length, 1); // solo el canal sano
    fail = false;
    await n.tick();
    assert.equal(sent.length, 2); // flaky reintenta; el sano no repite
    j.close();
  } finally { cleanup(); }
});

test("notificador: un canal desactivado no envía ni gasta el aviso", async () => {
  const { j, cleanup, sent, at } = await setup();
  try {
    await j.calendar.create({ id: "evento-apagado", title: "X", kind: "event", start: "2026-11-05T17:00", end: "2026-11-05T18:00" });
    at("2026-11-05T16:55:00");
    let on = false;
    const ch: Channel = { name: "off", enabled: () => on, visible: () => true, send: async (n) => { sent.push(n); } };
    const n = new Notifier(j, [ch], () => new Date("2026-11-05T16:55:00"));
    await n.tick();
    assert.equal(sent.length, 0);
    on = true;
    await n.tick();
    assert.equal(sent.length, 1);
    j.close();
  } finally { cleanup(); }
});

test("notificador: una tarea visible de un proyecto oculto para el canal no se menciona", async () => {
  const { j, cleanup, sent, at } = await setup();
  try {
    const proj = await j.createNote({ title: "Reservado", type: "project", folder: "Privado", fm: { status: "active" } });
    await j.createNote({ title: "Tarea del reservado", type: "task", fm: { status: "todo", due: "2026-11-05", project: `[[${proj.path.replace(/\.md$/, "")}]]` } });
    await j.createNote({ title: "Tarea normal", type: "task", fm: { status: "todo", due: "2026-11-05" } });
    const ch: Channel = { name: "movil", enabled: () => true, visible: (p) => !p.startsWith("Privado/"), send: async (n) => { sent.push(n); } };
    at("2026-11-05T10:00:00");
    await new Notifier(j, [ch], () => new Date("2026-11-05T10:00:00")).tick();
    assert.equal(sent.length, 1);
    assert.match(sent[0].body, /Tarea normal/);
    assert.doesNotMatch(JSON.stringify(sent), /reservado/i);
    j.close();
  } finally { cleanup(); }
});

test("notificador: si el canal no puede saber qué es privado, no envía nada (falla cerrado)", async () => {
  const { j, cleanup, sent, at } = await setup();
  try {
    await j.calendar.create({ id: "evento-cerrado", title: "X", kind: "event", start: "2026-11-05T17:00", end: "2026-11-05T18:00" });
    at("2026-11-05T16:55:00");
    const ch: Channel = { name: "roto", prepare: async () => { throw new Error("mobile.json roto"); }, enabled: () => true, visible: () => true, send: async (n) => { sent.push(n); } };
    await new Notifier(j, [ch], () => new Date("2026-11-05T16:55:00"), () => undefined).tick();
    assert.equal(sent.length, 0);
    j.close();
  } finally { cleanup(); }
});
