import { test } from "node:test";
import assert from "node:assert/strict";
import { Kioku } from "../src/core/kioku.ts";
import { tmpVault } from "./helpers.ts";

const input = { id: "calendar-test-001", title: "Trabajo", kind: "block" as const, start: "2026-10-28T10:00", end: "2026-10-28T11:00" };

test("calendar persists independent blocks and estimates, survives reindex and retries", async () => {
  const { root, cleanup } = tmpVault();
  const j = await Kioku.open({ root, now: () => new Date("2026-10-28T10:20:00") });
  try {
    const task = await j.createNote({ title: "Escribir", type: "task", fm: { status: "todo", estimate: 30 } });
    const b = await j.calendar.create({ ...input, taskPath: task.path });
    assert.equal(b.state, "active");
    assert.equal(b.taskPath, task.path);
    assert.equal(j.index.getNote(b.path)!.type, "block");
    assert.match((await j.readNote(b.path)).text, /kind: block/);
    assert.equal((await j.calendar.create({ ...input, taskPath: task.path })).path, b.path);
    assert.equal(j.calendar.range("2026-10-28", "2026-10-28").items.length, 1);
    assert.deepEqual(j.calendar.range("2026-10-28", "2026-10-28").tasks.map((t) => t.estimate), [30]);
    const done = await j.calendar.finish(b.path, b.hash);
    assert.equal(done.state, "done");
    assert.equal(j.index.tasks()[0].status, "todo");
    assert.equal((await j.calendar.finish(b.path, b.hash)).done_at, done.done_at);
    await j.reindex();
    assert.equal(j.calendar.range("2026-10-28", "2026-10-28").items[0].state, "done");
    const other = await j.calendar.create({ ...input, id: "calendar-test-002", taskPath: task.path });
    await j.setTaskStatus(task.path, "done");
    assert.equal(j.calendar.range("2026-10-28", "2026-10-28").items.find((x) => x.path === other.path)!.done_at, undefined);
    assert.deepEqual(j.calendar.range("2026-10-28", "2026-10-28").tasks, []);
  } finally { j.close(); cleanup(); }
});

test("calendar rejects invalid writes without effects and preserves unrelated Markdown when moving", async () => {
  const { root, cleanup } = tmpVault();
  const j = await Kioku.open({ root });
  try {
    const b = await j.calendar.create(input);
    const original = await j.readNote(b.path);
    await assert.rejects(j.calendar.move(b.path, "2026-10-28T12:00", "2026-10-28T11:00", b.hash), /posterior/);
    await assert.rejects(j.calendar.create({ ...input, id: "calendar-test-003", taskPath: "missing.md" }), /tarea/);
    assert.equal((await j.readNote(b.path)).text, original.text);
    assert.equal(j.index.count(), 1);
    await j.setProps(b.path, { custom: "preservar" });
    await assert.rejects(j.calendar.move(b.path, "2026-10-29T10:00", "2026-10-29T11:00", b.hash), /cambió/);
    const current = await j.readNote(b.path);
    const moved = await j.calendar.move(b.path, "2026-10-29T10:00", "2026-10-29T11:00", current.hash);
    assert.equal(j.index.getNote(b.path)!.fm.custom, "preservar");
    assert.equal(moved.start, "2026-10-29T10:00");
    assert.equal(j.calendar.range("2026-10-28", "2026-10-28").items.length, 0);
    const event = await j.calendar.create({ ...input, id: "calendar-event-001", kind: "event" });
    await assert.rejects(j.calendar.finish(event.path, event.hash), /evento/);
    assert.throws(() => j.calendar.range("2026-02-30", "2026-10-28"), /Fecha/);
  } finally { j.close(); cleanup(); }
});

test("calendar update changes title, kind, times and keeps the rest of the Markdown", async () => {
  const { root, cleanup } = tmpVault();
  const j = await Kioku.open({ root, now: () => new Date("2026-10-28T09:00:00") });
  try {
    const task = await j.createNote({ title: "Escribir", type: "task", fm: { status: "todo" } });
    const b = await j.calendar.create({ ...input, taskPath: task.path });
    const u = await j.calendar.update(b.path, { title: "  Gimnasio ", start: "2026-10-29T18:00", end: "2026-10-29T19:00" }, b.hash);
    assert.equal(u.title, "Gimnasio");
    assert.equal(u.start, "2026-10-29T18:00");
    assert.equal(u.taskPath, task.path, "los campos no pedidos no cambian");
    const same = await j.calendar.update(u.path, { title: "Gimnasio" }, u.hash);
    assert.equal(same.hash, u.hash, "sin cambios no se escribe");
    const ev = await j.calendar.update(u.path, { kind: "event" }, u.hash);
    assert.equal(ev.kind, "event");
    assert.equal(ev.taskPath, task.path, "un evento conserva el enlace a su tarea");
    await assert.rejects(j.calendar.update(ev.path, { title: "   " }, ev.hash), /título/);
    await assert.rejects(j.calendar.update(ev.path, { end: "2026-10-29T17:00" }, ev.hash), /posterior/);
    await assert.rejects(j.calendar.update(ev.path, { title: "Otro" }, u.hash), /cambió/);
    assert.equal(j.calendar.range("2026-10-29", "2026-10-29").items[0].title, "Gimnasio", "los rechazos no escriben");
    await assert.rejects(j.calendar.update(task.path, { title: "x" }, "h"), /actividad/);
  } finally { j.close(); cleanup(); }
});

test("calendar remove sends to trash and restore brings it back; neither touches other notes", async () => {
  const { root, cleanup } = tmpVault();
  const j = await Kioku.open({ root, now: () => new Date("2026-10-28T09:00:00") });
  try {
    const note = await j.createNote({ title: "Nota", type: "note" });
    const b = await j.calendar.create(input);
    await assert.rejects(j.calendar.remove(b.path, "hash-viejo"), /cambió/);
    assert.equal(j.calendar.range("2026-10-28", "2026-10-28").items.length, 1);
    await j.calendar.remove(b.path, b.hash);
    assert.equal(j.calendar.range("2026-10-28", "2026-10-28").items.length, 0);
    assert.equal(j.vault.exists(b.path), false);
    await assert.rejects(j.calendar.remove(note.path, note.hash), /actividad/);
    assert.ok(j.index.getNote(note.path));
    const back = await j.calendar.restore(b.path);
    assert.equal(back.title, "Trabajo");
    assert.equal(j.calendar.range("2026-10-28", "2026-10-28").items.length, 1);
    await assert.rejects(j.calendar.restore(b.path), /ya existe|Ya existe/i);
    await assert.rejects(j.calendar.restore("Calendario/nunca-borrada-1.md"), /papelera/);
    await assert.rejects(j.calendar.restore("Notas/otra.md"), /actividad/);
  } finally { j.close(); cleanup(); }
});
