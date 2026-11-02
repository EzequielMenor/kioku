import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../web/src/offline/store.ts";
import { MutationQueue } from "../web/src/offline/mutations.ts";
import { SendError } from "../web/src/offline/queue.ts";
import { parseNote } from "../src/core/markdown.ts";
import type { MutationBody } from "../web/src/offline/store.ts";

const applied = (path: string, hash: string) => ({ outcome: "applied" as const, path, hash });
const make = (s = new MemoryStore()) => { let id = 0; return { s, q: new MutationQueue(s, () => `op-${++id}`) }; };

test("captured successors added after acknowledgements retain chain and canonical timestamp", async () => {
  const { q } = make();
  const task = "---\ntype: task\nstatus: done\n---\nold body";
  const canonical = "---\ntype: task\nstatus: done\ndone_at: 2025-01-02T03:04:05.000Z\n---\nold body";
  await q.add({ kind: "task", path: "a", baseHash: "old", text: task, status: "done" });
  const successor = { kind: "edit" as const, path: "a", baseHash: "old", text: task.replace("old body", "new body") };
  await q.flush(async b => ({ ...applied(b.path, "acknowledged"), text: canonical }));
  for (const [expected, next] of [["acknowledged", "second"], ["second", "third"]]) {
    await q.add(successor);
    let outgoing: MutationBody | undefined;
    await q.flush(async b => { outgoing = b; return { ...applied(b.path, next), text: b.text }; });
    assert.ok(outgoing);
    assert.equal(outgoing.baseHash, expected);
    const note = parseNote(outgoing.text, "a");
    assert.equal(note.frontmatter.done_at, "2025-01-02T03:04:05.000Z");
    assert.equal(note.body, "new body");
  }
  await q.add({ ...successor, baseHash: "third" });
  let outgoing: MutationBody | undefined;
  await q.flush(async b => { outgoing = b; return applied(b.path, "fourth"); });
  assert.ok(outgoing);
  assert.equal(outgoing.baseHash, "third");
  assert.equal(parseNote(outgoing.text, "a").frontmatter.done_at, "2025-01-02T03:04:05.000Z");
});

test("lost response replays frozen body after reopening and rebases dependent snapshot", async () => {
  const { s, q } = make();
  await q.add({ kind: "edit", path: "a", baseHash: "h0", text: "one" });
  const bodies: unknown[] = [];
  await q.flush(async b => { bodies.push(b); throw new TypeError("lost"); });
  await q.add({ kind: "edit", path: "a", baseHash: "h0", text: "two" });
  const reopened = new MutationQueue(s);
  await reopened.flush(async b => { bodies.push(b); return applied(b.path, b.text === "one" ? "h1" : "h2"); });
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal((bodies[2] as { baseHash: string }).baseHash, "h1");
  assert.equal(await reopened.draft("a"), undefined);
});

test("edits during flush retain newer draft and share one in-flight flush", async () => {
  const { q } = make();
  await q.add({ kind: "edit", path: "a", baseHash: "h0", text: "one" });
  let release!: () => void, started!: () => void;
  const wait = new Promise<void>(r => { release = r; });
  const ready = new Promise<void>(r => { started = r; });
  let calls = 0;
  const send = async (b: { path: string }) => { calls++; started(); await wait; return applied(b.path, "h1"); };
  const first = q.flush(send); await ready;
  assert.equal(q.flush(send), first);
  await q.add({ kind: "edit", path: "a", baseHash: "h0", text: "two" });
  release(); await first;
  assert.equal(calls, 1);
  assert.equal((await q.draft("a"))?.text, "two");
  assert.equal((await q.list()).filter(x => x.state === "pending").length, 1);
});

test("conflict blocks descendants only; discard refuses dependent operations", async () => {
  const { q } = make();
  const a = await q.add({ kind: "edit", path: "a", baseHash: "h", text: "one" });
  await q.add({ kind: "edit", path: "a", baseHash: "h", text: "two" });
  await q.add({ kind: "edit", path: "b", baseHash: "h", text: "other" });
  const sent: string[] = [];
  await q.flush(async b => { sent.push(b.path); return b.path === "a" ? { outcome: "conflict", path: "a conflict", hash: "hc" } : applied(b.path, "hb"); });
  assert.deepEqual(sent, ["a", "b"]);
  assert.deepEqual((await q.list()).map(x => x.state), ["conflict", "pending", "applied"]);
  await assert.rejects(q.discard(a.body.opId), /depend/);
});

test("permanent rejections preserve payload and retry uses same body; unrelated path proceeds", async () => {
  for (const code of [400, 403, 404]) {
    const { q } = make();
    const a = await q.add({ kind: "edit", path: "a", baseHash: "h", text: "one" });
    await q.add({ kind: "edit", path: "a", baseHash: "h", text: "two" });
    await q.add({ kind: "edit", path: "b", baseHash: "h", text: "ok" });
    let first: unknown;
    await q.flush(async b => { if (b.path === "a") { first = b; throw new SendError(String(code), false); } return applied(b.path, "hb"); });
    assert.deepEqual((await q.list()).map(x => x.state), ["failed", "pending", "applied"]);
    await q.retry(a.body.opId);
    await q.flush(async b => { if (b.opId === a.body.opId) assert.deepEqual(b, first); return applied(b.path, "next"); });
  }
});

test("late task acknowledgement preserves newer status and draft, including frozen dependent replay", async () => {
  const { q } = make();
  const first = "---\ntype: task\nstatus: done\n---\nold";
  const newer = "---\ntype: task\nstatus: doing\n---\nnew body";
  await q.add({ kind: "task", path: "a", baseHash: "h", text: first, status: "done" });
  let release!: () => void, started!: () => void;
  const wait = new Promise<void>(r => { release = r; });
  const ready = new Promise<void>(r => { started = r; });
  const flush = q.flush(async b => { started(); await wait; return { ...applied(b.path, "h1"), text: first.replace("---\nold", "done_at: 2025-01-02T03:04:05.000Z\n---\nold") }; });
  await ready;
  await q.add({ kind: "task", path: "a", baseHash: "h", text: newer, status: "doing" });
  release(); await flush;
  assert.equal((await q.draft("a"))?.text, newer);
  let sent: unknown;
  await q.flush(async b => { sent = b; throw new Error("lost"); });
  await q.flush(async b => { assert.deepEqual(b, sent); assert.equal(b.text, newer); assert.equal(b.status, "doing"); return applied(b.path, "h2"); });
});

test("task operation keeps explicit status and full local snapshot", async () => {
  const { q } = make();
  await q.add({ kind: "task", path: "a", baseHash: "h", text: "pending note body", status: "doing" });
  await q.flush(async b => { assert.equal(b.kind, "task"); assert.equal(b.status, "doing"); assert.equal(b.text, "pending note body"); return applied(b.path, "h2"); });
});

test("drafts and operations survive replica clearing and clear removes all", async () => {
  const { s, q } = make();
  await s.putNotes([{ path: "a", text: "replica", hash: "h", mtime: 1 }]);
  await q.add({ kind: "edit", path: "a", baseHash: "h", text: "draft" });
  await s.clearReplica();
  assert.equal(await s.getNote("a"), undefined);
  assert.equal((await q.draft("a"))?.text, "draft");
  assert.equal((await q.list()).length, 1);
  await s.clear();
  assert.equal(await q.draft("a"), undefined);
  assert.deepEqual(await q.list(), []);
});
