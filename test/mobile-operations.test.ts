import { test } from "node:test";
import { lstat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { tmpVault } from "./helpers.ts";
import { MemoryStore } from "../web/src/offline/store.ts";
import { MutationQueue } from "../web/src/offline/mutations.ts";
import { materializeTask, reconcileTaskAcknowledgement } from "../web/src/offline/mobile-editing.ts";
import { parseNote } from "../src/core/markdown.ts";

const TEXT = "---\nid: 01J00000000000000000000000\ntype: task\nstatus: todo\n---\nOriginal\n";
async function setup() {
  const v = tmpVault({ "Tareas/A.md": TEXT, "Privado/A.md": TEXT });
  const j = await Kioku.open({ root: v.root, now: () => new Date("2025-01-02T03:04:05.000Z") });
  await j.vault.writeInternal("mobile.json", JSON.stringify({ exclude: ["Privado/"] }));
  const key = loadOrCreateMobileKey(v.root);
  let srv = await startServer(j, { port: 0, webDir: v.root });
  const call = async (body: unknown, route = "/api/mobile/operation", method = "POST") => {
    const r = await fetch(srv.url + route, { method, headers: { "content-type": "application/json", "x-kioku-key": key }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() as any };
  };
  const hash = (await j.vault.read("Tareas/A.md")).hash;
  const op = { opId: "aaaaaaaa-0001", kind: "edit", path: "Tareas/A.md", baseHash: hash, text: TEXT + "Mobile\n" };
  return { j, v, call, op, restart: async () => { await srv.close(); srv = await startServer(j, { port: 0, webDir: v.root }); }, close: async () => { await srv.close(); j.close(); v.cleanup(); } };
}

test("task acknowledgements preserve server timestamp through queued and subsequent edits", async () => {
  for (const queuedBeforeAck of [false, true]) {
    const s = await setup();
    try {
      let id = 0;
      const q = new MutationQueue(new MemoryStore(), () => `aaaaaaaa-00${++id}`);
      const task = materializeTask(TEXT, s.op.path, "done");
      await q.add({ kind: "task", path: s.op.path, baseHash: s.op.baseHash, text: task, status: "done" });
      const latest = task.replace("Original", "Latest body");
      if (queuedBeforeAck) await q.add({ kind: "edit", path: s.op.path, baseHash: s.op.baseHash, text: latest });
      const send = async (body: any) => { const r = await s.call(body); assert.equal(r.status, 200); return r.body; };
      await q.flush(send);
      if (!queuedBeforeAck) {
        const ack = (await q.list())[0].result!;
        assert.equal(typeof ack.text, "string");
        await q.add({ kind: "edit", path: s.op.path, baseHash: ack.hash, text: reconcileTaskAcknowledgement(latest, ack.text!, "done") });
        await q.flush(send);
      }
      const note = await s.j.vault.read(s.op.path);
      const parsed = parseNote(note.text, s.op.path);
      assert.equal(parsed.frontmatter.status, "done");
      assert.equal(String(parsed.frontmatter.done_at), "2025-01-02T03:04:05.000Z");
      assert.equal(parsed.body, "Latest body\n");
    } finally { await s.close(); }
  }
});

test("captured edit added after task acknowledgement applies over HTTP without false conflict", async () => {
  const s = await setup();
  try {
    let id = 0;
    const q = new MutationQueue(new MemoryStore(), () => `aaaaaaaa-00${++id}`);
    const task = materializeTask(TEXT, s.op.path, "done");
    await q.add({ kind: "task", path: s.op.path, baseHash: s.op.baseHash, text: task, status: "done" });
    const captured = { kind: "edit" as const, path: s.op.path, baseHash: s.op.baseHash, text: task.replace("Original", "Latest body") };
    const statuses: number[] = [];
    const send = async (body: any) => { const response = await s.call(body); statuses.push(response.status); if (response.status !== 200) throw new Error(`HTTP ${response.status}`); return response.body; };
    await q.flush(send);
    await q.add(captured);
    await q.flush(send);
    assert.deepEqual(statuses, [200, 200]);
    const parsed = parseNote((await s.j.vault.read(s.op.path)).text, s.op.path);
    assert.equal(parsed.frontmatter.status, "done");
    assert.equal(parsed.frontmatter.done_at, "2025-01-02T03:04:05.000Z");
    assert.equal(parsed.body, "Latest body\n");
  } finally { await s.close(); }
});

test("mobile edits: matching base applies once, including lost response and server restart", async () => {
  const s = await setup();
  try {
    const a = await s.call(s.op);
    assert.equal(a.status, 200); assert.equal(a.body.outcome, "applied");
    assert.equal((await s.j.vault.read(s.op.path)).text, s.op.text);
    await s.restart();
    assert.deepEqual(await s.call(s.op), a);
    assert.equal(s.j.index.listNotes({ limit: 100 }).length, 2);
    const bad = await s.call({ ...s.op, text: "different" });
    assert.equal(bad.status, 400);
    assert.equal((await s.j.vault.read(s.op.path)).text, s.op.text);
  } finally { await s.close(); }
});

test("mobile conflicts: concurrent retries create one copy, preserve external original and survive restart", async () => {
  const s = await setup();
  try {
    await s.j.vault.write(s.op.path, TEXT + "External\n");
    const replies = await Promise.all([s.call(s.op), s.call(s.op)]);
    assert.equal(replies[0].status, 409); assert.deepEqual(replies[0], replies[1]);
    const result = replies[0].body.result;
    assert.equal(result.outcome, "conflict"); assert.match(result.path, /Tareas\/A \(conflicto móvil .*\)\.md$/);
    assert.equal((await s.j.vault.read(result.path)).text, s.op.text);
    assert.equal((await s.j.vault.read(s.op.path)).text, TEXT + "External\n");
    await s.restart(); assert.deepEqual(await s.call(s.op), replies[0]);
    assert.equal(s.j.index.listNotes({ limit: 100 }).length, 3);
  } finally { await s.close(); }
});

test("mobile tasks: explicit done and stale-base done preserve the full mobile snapshot", async () => {
  const s = await setup();
  try {
    const task = { ...s.op, kind: "task", status: "done", text: TEXT };
    const a = await s.call(task); assert.equal(a.status, 200);
    const done = (await s.j.vault.read(task.path)).text;
    assert.match(done, /status: done/); assert.match(done, /done_at:/); assert.match(done, /Original/);
    assert.deepEqual(await s.call(task), a);
    assert.equal((await s.j.vault.read(task.path)).text, done);
    const c = await s.call({ ...task, opId: "aaaaaaaa-0002" });
    assert.equal(c.status, 409);
    assert.match((await s.j.vault.read(c.body.result.path)).text, /status: done/);
    assert.equal((await s.j.vault.read(task.path)).text, done);
  } finally { await s.close(); }
});

test("mobile conflict collision never overwrites an existing note", async () => {
  const s = await setup();
  try {
    const occupied = `Tareas/A (conflicto móvil ${s.op.opId}).md`;
    await s.j.vault.write(occupied, "keep me");
    await s.j.vault.write(s.op.path, TEXT + "external\n");
    const r = await s.call(s.op);
    assert.equal(r.status, 409);
    assert.notEqual(r.body.result.path, occupied);
    assert.equal((await s.j.vault.read(occupied)).text, "keep me");
    assert.equal((await s.j.vault.read(r.body.result.path)).text, s.op.text);
  } finally { await s.close(); }
});

test("una copia de conflicto evita un enlace simbólico colgante", async () => {
  const s = await setup();
  try {
    await s.j.vault.write(s.op.path, TEXT + "external");
    const original = await s.j.vault.read(s.op.path);
    const occupied = `Tareas/A (conflicto móvil ${s.op.opId}).md`;
    await symlink("missing.md", s.j.vault.abs(occupied));
    const r = await s.call(s.op);
    assert.equal(r.status, 409); assert.notEqual(r.body.result.path, occupied);
    assert.equal((await s.j.vault.read(s.op.path)).hash, original.hash);
    assert.equal((await s.j.vault.read(r.body.result.path)).text, s.op.text);
    assert.ok((await lstat(s.j.vault.abs(occupied))).isSymbolicLink());
  } finally { await s.close(); }
});

test("los nombres largos ASCII y Unicode permiten copias y evitan colisiones", async () => {
  const s = await setup();
  try {
    const opId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    for (const [stem, id] of [["a".repeat(200), opId], ["é".repeat(100), "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"]]) {
      const rel = `Tareas/${stem}.md`;
      await s.j.vault.write(rel, TEXT + "external");
      const original = await s.j.vault.read(rel);
      let occupied = "";
      if (stem.startsWith("é")) {
        const suffix = ` (conflicto móvil ${id}).md`;
        occupied = `Tareas/${"é".repeat(Math.floor((240 - Buffer.byteLength(suffix)) / 2))}${suffix}`;
        await writeFile(s.j.vault.abs(occupied), "ocupada", { flag: "wx" });
      }
      const r = await s.call({ ...s.op, path: rel, opId: id });
      assert.equal(r.status, 409);
      assert.equal((await s.j.vault.read(rel)).hash, original.hash);
      assert.equal((await s.j.vault.read(r.body.result.path)).text, s.op.text);
      assert.ok(Buffer.byteLength(path.posix.basename(r.body.result.path)) <= 240);
      if (occupied) { assert.notEqual(r.body.result.path, occupied); assert.equal((await s.j.vault.read(occupied)).text, "ocupada"); }
    }
  } finally { await s.close(); }
});

test("prepared edit survives a failed receipt completion and server restart", async () => {
  const s = await setup();
  const original = s.j.vault.writeInternal.bind(s.j.vault);
  let writes = 0;
  try {
    s.j.vault.writeInternal = async (name, text) => {
      if (name.startsWith("mobile-operations/") && ++writes === 2) throw new Error("simulated crash");
      return original(name, text);
    };
    assert.equal((await s.call(s.op)).status, 500);
    assert.equal((await s.j.vault.read(s.op.path)).text, s.op.text);
    s.j.vault.writeInternal = original;
    await s.restart();
    const retry = await s.call(s.op);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.outcome, "applied");
    assert.equal(s.j.index.listNotes({ limit: 100 }).length, 2);
  } finally { s.j.vault.writeInternal = original; await s.close(); }
});

test("una copia ajena idéntica creada después de preparar no se atribuye a la operación", async () => {
  const s = await setup();
  const publish = s.j.vault.writeExclusive.bind(s.j.vault);
  const target = `Tareas/A (conflicto móvil ${s.op.opId}).md`;
  try {
    await s.j.vault.write(s.op.path, TEXT + "externo\n");
    s.j.vault.writeExclusive = async () => { throw new Error("fallo antes de publicar"); };
    assert.equal((await s.call(s.op)).status, 500);
    await s.j.vault.write(target, s.op.text);
    s.j.vault.writeExclusive = publish;
    await s.restart();
    const r = await s.call(s.op);
    assert.equal(r.status, 409);
    assert.notEqual(r.body.result.path, target);
    assert.equal((await s.j.vault.read(target)).text, s.op.text);
    assert.equal((await s.j.vault.read(r.body.result.path)).text, s.op.text);
    assert.equal((await s.j.vault.read(s.op.path)).text, TEXT + "externo\n");
    assert.deepEqual(await s.call(s.op), r);
  } finally { s.j.vault.writeExclusive = publish; await s.close(); }
});

test("un enlace colgante que aparece tras preparar se evita al reintentar", async () => {
  const s = await setup();
  const publish = s.j.vault.writeExclusive.bind(s.j.vault);
  const target = `Tareas/A (conflicto móvil ${s.op.opId}).md`;
  try {
    await s.j.vault.write(s.op.path, TEXT + "externo\n");
    s.j.vault.writeExclusive = async () => { throw new Error("fallo antes de publicar"); };
    assert.equal((await s.call(s.op)).status, 500);
    await symlink("missing.md", s.j.vault.abs(target));
    s.j.vault.writeExclusive = publish;
    await s.restart();
    const r = await s.call(s.op);
    assert.equal(r.status, 409); assert.notEqual(r.body.result.path, target);
    assert.equal((await s.j.vault.read(r.body.result.path)).text, s.op.text);
    assert.equal((await s.j.vault.read(s.op.path)).text, TEXT + "externo\n");
    assert.ok((await lstat(s.j.vault.abs(target))).isSymbolicLink());
  } finally { s.j.vault.writeExclusive = publish; await s.close(); }
});

test("una copia publicada antes del fallo se recupera sin duplicarla", async () => {
  const s = await setup();
  const publish = s.j.vault.writeExclusive.bind(s.j.vault);
  const target = `Tareas/A (conflicto móvil ${s.op.opId}).md`;
  try {
    await s.j.vault.write(s.op.path, TEXT + "externo\n");
    s.j.vault.writeExclusive = async (...args) => { await publish(...args); throw new Error("fallo después de publicar"); };
    assert.equal((await s.call(s.op)).status, 500);
    assert.equal((await s.j.vault.read(target)).text, s.op.text);
    s.j.vault.writeExclusive = publish;
    await s.restart();
    const r = await s.call(s.op);
    assert.equal(r.status, 409); assert.equal(r.body.result.path, target);
    assert.equal(s.j.index.listNotes({ limit: 100 }).length, 3);
    assert.deepEqual(await s.call(s.op), r);
  } finally { s.j.vault.writeExclusive = publish; await s.close(); }
});

test("un cambio externo durante el guardado preparado produce una copia de conflicto", async () => {
  const s = await setup();
  const save = s.j.saveNote.bind(s.j);
  try {
    s.j.saveNote = async (...args) => { await s.j.vault.write(s.op.path, TEXT + "externo\n"); return save(...args); };
    const r = await s.call(s.op);
    assert.equal(r.status, 409); assert.equal(r.body.code, "mobile-conflict");
    assert.equal(r.body.result.outcome, "conflict");
    assert.equal((await s.j.vault.read(r.body.result.path)).text, s.op.text);
    assert.equal((await s.j.vault.read(s.op.path)).text, TEXT + "externo\n");
    s.j.saveNote = save;
    await s.restart(); assert.deepEqual(await s.call(s.op), r);
  } finally { s.j.saveNote = save; await s.close(); }
});

test("un cambio externo tras una preparación interrumpida crea conflicto al reintentar", async () => {
  const s = await setup();
  const save = s.j.saveNote.bind(s.j);
  try {
    s.j.saveNote = async () => { throw new Error("fallo antes de guardar"); };
    assert.equal((await s.call(s.op)).status, 500);
    s.j.saveNote = save;
    await s.j.vault.write(s.op.path, TEXT + "externo\n");
    await s.restart();
    const r = await s.call(s.op);
    assert.equal(r.status, 409); assert.equal(r.body.code, "mobile-conflict");
    assert.equal((await s.j.vault.read(r.body.result.path)).text, s.op.text);
    assert.equal((await s.j.vault.read(s.op.path)).text, TEXT + "externo\n");
    assert.deepEqual(await s.call(s.op), r);
  } finally { s.j.saveNote = save; await s.close(); }
});

test("existing save and capture routes still work", async () => {
  const s = await setup();
  try {
    const save = await s.call({ path: s.op.path, text: TEXT + "saved\n", hash: s.op.baseHash }, "/api/note", "PUT");
    assert.equal(save.status, 200);
    assert.equal((await s.j.vault.read(s.op.path)).text, TEXT + "saved\n");
    const capture = await s.call({ text: "a capture" }, "/api/capture");
    assert.equal(capture.status, 200);
    assert.equal(typeof capture.body.path, "string");
  } finally { await s.close(); }
});

test("mobile task rejects non-task and invalid YAML snapshots, and symlink paths", async () => {
  const s = await setup();
  try {
    await symlink(path.join(s.v.root, "Tareas"), path.join(s.v.root, "Link"));
    for (const body of [
      { ...s.op, kind: "task", status: "done", text: "plain note" },
      { ...s.op, kind: "task", status: "done", text: "---\ntype: [\n---\n" },
      { ...s.op, path: "Link/A.md" },
      { ...s.op, path: ".hidden/A.md" },
    ]) assert.equal((await s.call(body)).status, 400);
    assert.equal((await s.j.vault.read(s.op.path)).text, TEXT);
    assert.equal(s.j.index.listNotes({ limit: 100 }).length, 2);
  } finally { await s.close(); }
});

test("mobile operations reject invalid/private/deleted notes without creating data; old task API still works", async () => {
  const s = await setup();
  try {
    for (const body of [{ ...s.op, path: "Privado/A.md" }, { ...s.op, path: "Tareas/../Privado/A.md" }]) {
      assert.equal((await s.call(body)).status, 403);
    }
    for (const body of [{ ...s.op, opId: "../../x" }, { ...s.op, baseHash: "" }, { ...s.op, kind: "task", status: "bogus" }, { ...s.op, path: "/tmp/a.md" }]) {
      assert.equal((await s.call(body)).status, 400);
    }
    assert.equal((await s.call({ ...s.op, path: "Tareas/Missing.md" })).status, 404);
    assert.equal(s.j.index.listNotes({ limit: 100 }).length, 2);
    assert.equal((await s.j.vault.read(s.op.path)).text, TEXT);
    const old = await s.call({ path: s.op.path, status: "doing" }, "/api/task/status");
    assert.equal(old.status, 200); assert.match((await s.j.vault.read(s.op.path)).text, /status: doing/);
  } finally { await s.close(); }
});
