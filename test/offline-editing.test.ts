import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../web/src/offline/store.ts";
import { MutationQueue } from "../web/src/offline/mutations.ts";
import { materializeTask, reconcileTaskAcknowledgement, requireDurable, sendMobileOperation } from "../web/src/offline/mobile-editing.ts";
import { SendError } from "../web/src/offline/queue.ts";

test("task acknowledgement reconciles timestamp without replacing newer body or status", () => {
  const old = "---\ntype: task\nstatus: done\n---\nold";
  const canonical = "---\ntype: task\nstatus: done\ndone_at: 2025-01-02T03:04:05.000Z\n---\nold";
  const typed = old.replace("old", "newest body");
  assert.match(reconcileTaskAcknowledgement(typed, canonical, "done"), /done_at: 2025-01-02T03:04:05.000Z[\s\S]*newest body/);
  const newer = materializeTask(typed, "a.md", "doing");
  const reconciled = reconcileTaskAcknowledgement(newer, canonical, "done");
  assert.match(reconciled, /status: doing[\s\S]*newest body/);
  assert.doesNotMatch(reconciled, /done_at/);
});

test("task snapshots preserve body and enforce durable storage", () => {
  assert.match(materializeTask("---\ntype: task\nstatus: todo\n---\nEdited body", "a.md", "done"), /status: done[\s\S]*Edited body/);
  assert.throws(() => materializeTask("---\na: [\n---\nbody", "a.md", "done"), /YAML/);
  assert.throws(() => requireDurable(false), /almacenamiento/);
  assert.doesNotThrow(() => requireDurable(true));
});

test("transport classifies conflict, authorization and failures", async () => {
  const body = { opId: "x", kind: "edit" as const, path: "a", baseHash: "h", text: "body" };
  const response = (status: number, payload: unknown) => async () => new Response(JSON.stringify(payload), { status });
  assert.deepEqual(await sendMobileOperation(body, response(409, { code: "mobile-conflict", result: { outcome: "conflict", path: "copy", hash: "h2" } })), { outcome: "conflict", path: "copy", hash: "h2" });
  let unauthorized = 0;
  await assert.rejects(sendMobileOperation(body, response(401, {}), () => { unauthorized++; }), (e: unknown) => e instanceof SendError && e.retryable);
  assert.equal(unauthorized, 1);
  for (const status of [400, 403, 404, 408, 429, 500]) await assert.rejects(sendMobileOperation(body, response(status, {})), (e: unknown) => e instanceof SendError && e.retryable === (status >= 500 || status === 408 || status === 429));
  assert.deepEqual(await sendMobileOperation(body, response(200, applied("a", "h"))), applied("a", "h"));
});

const applied = (path: string, hash: string) => ({ outcome: "applied" as const, path, hash });

test("acknowledged edit stops overlaying remote updates and new edit uses the remote base", async () => {
  const store = new MemoryStore();
  let id = 0;
  const queue = new MutationQueue(store, () => String(++id));
  await queue.add({ kind: "edit", path: "a", baseHash: "initial", text: "local" });
  await queue.flush(async b => applied(b.path, "first"));
  assert.equal(await queue.overlay("a"), undefined);
  await queue.add({ kind: "edit", path: "a", baseHash: "remote", text: "new edit" });
  await queue.flush(async b => { assert.equal(b.baseHash, "remote"); return applied(b.path, "last"); });
});

test("reset is blocked during sending and clears only the selected local chain", async () => {
  const store = new MemoryStore(); let id = 0;
  const queue = new MutationQueue(store, () => String(++id));
  await queue.add({ kind: "edit", path: "a", baseHash: "h", text: "a" });
  await queue.add({ kind: "edit", path: "b", baseHash: "h", text: "b" });
  let release!: () => void, started!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const flushing = queue.flush(async b => { started(); await wait; return { outcome: "conflict", path: `${b.path} copy`, hash: "copy" }; });
  await ready; await assert.rejects(queue.resetPath("a"), /envío/);
  release(); await flushing;
  await queue.resetPath("a");
  assert.equal(await queue.draft("a"), undefined);
  assert.equal((await queue.draft("b"))?.text, "b");
  assert.deepEqual((await queue.list()).map(o => o.body.path), ["b"]);
  await queue.add({ kind: "edit", path: "a", baseHash: "fresh", text: "again" });
  assert.equal((await queue.list()).find(o => o.body.path === "a")?.predecessor, undefined);
});

test("late acknowledgement cannot erase a newer draft", async () => {
  const store = new MemoryStore();
  let id = 0;
  const queue = new MutationQueue(store, () => String(++id));
  await queue.add({ kind: "edit", path: "a", baseHash: "initial", text: "first" });
  let release!: () => void, started!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const flush = queue.flush(async b => { started(); await wait; return applied(b.path, "first hash"); });
  await ready;
  await queue.add({ kind: "edit", path: "a", baseHash: "initial", text: "second" });
  release(); await flush;
  assert.equal((await queue.overlay("a"))?.text, "second");
  await queue.flush(async b => { assert.equal(b.baseHash, "first hash"); return applied(b.path, "second hash"); });
  assert.equal(await queue.overlay("a"), undefined);
});
