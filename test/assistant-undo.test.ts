import { test } from "node:test";
import assert from "node:assert/strict";
import { Kioku } from "../src/core/kioku.ts";
import { UndoStore } from "../src/assistant/undo.ts";
import { tmpVault } from "./helpers.ts";

const meta = { sessionId: "s1", tool: "test", summary: "prueba" };

async function setup() {
  const { root, cleanup } = tmpVault();
  const j = await Kioku.open({ root });
  return { j, undo: new UndoStore(j), cleanup };
}

test("undo: deshace la edición de una nota existente", async () => {
  const { j, undo, cleanup } = await setup();
  try {
    const n = await j.createNote({ title: "Cocina", body: "original\n" });
    const snap = await undo.capture([n.path]);
    const cur = await j.readNote(n.path);
    await j.saveNote(n.path, cur.text + "añadido\n", cur.hash);
    const rec = await undo.commit(snap, meta);
    assert.equal(rec.files.length, 1);
    await undo.undo(rec.id);
    assert.equal((await j.readNote(n.path)).text, cur.text);
    j.close();
  } finally { cleanup(); }
});

test("undo: deshace una creación mandándola a la papelera", async () => {
  const { j, undo, cleanup } = await setup();
  try {
    const snap = await undo.capture(["Notas/Nueva.md"]);
    const n = await j.createNote({ title: "Nueva", body: "x" });
    assert.equal(n.path, "Notas/Nueva.md");
    const rec = await undo.commit(snap, meta);
    await undo.undo(rec.id);
    assert.equal(j.vault.exists("Notas/Nueva.md"), false);
    assert.equal(j.index.getNote("Notas/Nueva.md"), null);
    j.close();
  } finally { cleanup(); }
});

test("undo: deshace un movimiento (restaura el origen y quita el destino)", async () => {
  const { j, undo, cleanup } = await setup();
  try {
    const c = await j.capture("Idea suelta");
    const snap = await undo.capture([c.path]);
    const moved = await j.convertCapture(c.path, "note");
    const rec = await undo.commit(snap, meta, [moved.path]);
    assert.equal(rec.files.length, 2);
    await undo.undo(rec.id);
    assert.equal(j.vault.exists(c.path), true);
    assert.equal(j.vault.exists(moved.path), false);
    assert.equal(j.index.getNote(c.path)?.type, "capture");
    j.close();
  } finally { cleanup(); }
});

test("undo: si un fichero cambió después, lanza conflict y no toca ningún otro del grupo", async () => {
  const { j, undo, cleanup } = await setup();
  try {
    const a = await j.createNote({ title: "A", body: "a\n" });
    const b = await j.createNote({ title: "B", body: "b\n" });
    const snap = await undo.capture([a.path, b.path]);
    for (const p of [a.path, b.path]) { const r = await j.readNote(p); await j.saveNote(p, r.text + "IA\n", r.hash); }
    const rec = await undo.commit(snap, meta);
    const rb = await j.readNote(b.path);
    await j.saveNote(b.path, rb.text + "yo\n", rb.hash); // edición del usuario después
    await assert.rejects(undo.undo(rec.id), (e: { code?: string }) => e.code === "conflict");
    assert.match((await j.readNote(a.path)).text, /IA/, "A no se tocó");
    j.close();
  } finally { cleanup(); }
});

test("undo: no se puede deshacer dos veces y list devuelve lo más reciente primero", async () => {
  const { j, undo, cleanup } = await setup();
  try {
    const n = await j.createNote({ title: "Z", body: "z\n" });
    const s1 = await undo.capture([n.path]);
    const r = await j.readNote(n.path);
    await j.saveNote(n.path, r.text + "1\n", r.hash);
    const rec1 = await undo.commit(s1, meta);
    await undo.undo(rec1.id);
    await assert.rejects(undo.undo(rec1.id), (e: { code?: string }) => e.code === "invalid");
    const s2 = await undo.capture([n.path]);
    const r2 = await j.readNote(n.path);
    await j.saveNote(n.path, r2.text + "2\n", r2.hash);
    const rec2 = await undo.commit(s2, meta);
    assert.deepEqual((await undo.list()).map((x) => x.id), [rec2.id, rec1.id]);
    j.close();
  } finally { cleanup(); }
});
