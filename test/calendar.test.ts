import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarState, freeGaps, parseBlock, parseLocal, taskEstimate } from "../src/core/calendar.ts";

const block = (start = "2026-10-28T10:00", end = "2026-10-28T11:00", kind = "block") => parseBlock({ kind, start, end });

test("calendar validates local minutes, kind, ordered interval and estimates", () => {
  assert.equal(block().kind, "block");
  assert.equal(block(undefined, undefined, "event").kind, "event");
  for (const value of ["2026-02-30T10:00", "2026-10-28T24:00", "2026-10-28T10:00Z", "2026-10-28", "bad"]) {
    assert.throws(() => parseLocal(value), /Fecha/);
  }
  assert.throws(() => block("2026-10-28T11:00"), /posterior/);
  assert.throws(() => block(undefined, undefined, "other"), /Tipo/);
  assert.throws(() => parseBlock({ ...block(), kind: "event", task: "[[X]]" }), /evento/);
  assert.deepEqual([taskEstimate(30), taskEstimate(0), taskEstimate(-1), taskEstimate("30"), taskEstimate(1.5)], [30, null, null, null, null]);
});

test("calendar states have exact start/end boundaries and independent block completion", () => {
  const b = block();
  const state = (time: string) => calendarState(b, new Date(`2026-10-28T${time}:00`));
  assert.equal(state("09:59"), "pending");
  assert.equal(state("10:00"), "active");
  assert.equal(state("10:59"), "active");
  assert.equal(state("11:00"), "unfinished");
  assert.equal(calendarState({ ...b, done_at: "2026-10-28T10:30:00Z" }, new Date("2026-10-28T10:40:00")), "done");
  assert.equal(calendarState(block(undefined, undefined, "event"), new Date("2026-10-28T11:00:00")), "past");
});

test("free time merges overlaps and touching blocks, clips cross-day intervals", () => {
  const gaps = freeGaps([
    block("2026-10-27T23:00", "2026-10-28T08:00"),
    block("2026-10-28T09:00", "2026-10-28T10:00"),
    block("2026-10-28T09:30", "2026-10-28T11:00"),
    block("2026-10-28T11:00", "2026-10-28T12:00"),
    block("2026-10-28T21:00", "2026-10-29T01:00"),
  ], "2026-10-28");
  assert.deepEqual(gaps, [
    { start: "2026-10-28T08:00", end: "2026-10-28T09:00", minutes: 60 },
    { start: "2026-10-28T12:00", end: "2026-10-28T21:00", minutes: 540 },
  ]);
  assert.deepEqual(freeGaps([], "2026-10-28"), [{ start: "2026-10-28T07:00", end: "2026-10-28T22:00", minutes: 900 }]);
});
