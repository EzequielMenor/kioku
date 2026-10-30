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
