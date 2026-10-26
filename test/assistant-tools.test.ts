import { test } from "node:test";
import assert from "node:assert/strict";
import { Jarvis } from "../src/core/jarvis.ts";
import { AssistantTools } from "../src/assistant/tools.ts";
import { SessionRegistry } from "../src/assistant/session.ts";
import { UndoStore } from "../src/assistant/undo.ts";
import { tmpVault } from "./helpers.ts";

async function setup(exclude: string[] = []) {
  const { root, cleanup } = tmpVault();
  const j = await Jarvis.open({ root });
  const proj = await j.createProject("Jarvis");
  const cocina = await j.createNote({ title: "Cocina", body: "receta de lentejas con [[Jarvis]]" });
  await j.createNote({ title: "Secreto", folder: "Privado", body: "lentejas secretas" });
  const cap = await j.capture("Idea suelta de bandeja");
  const tools = new AssistantTools(j, new UndoStore(j), { exclude });
  const s = new SessionRegistry().open();
  const call = async (name: string, args: unknown = {}) => {
    const r = await tools.call(s, name, args);
    return { ...r, json: r.isError ? null : JSON.parse(r.text) };
  };
  return { j, tools, s, call, proj, cocina, cap, cleanup };
}

test("herramientas: search devuelve la nota encontrada", async () => {
  const { j, call, cleanup } = await setup();
  try {
    const r = await call("search", { query: "lentejas" });
    assert.ok(!r.isError);
    assert.ok(r.json.some((h: { path: string }) => h.path === "Notas/Cocina.md"));
    j.close();
  } finally { cleanup(); }
});

test("herramientas: read_note devuelve el texto y lo anota en session.reads", async () => {
  const { j, call, s, cleanup } = await setup();
  try {
    const r = await call("read_note", { path: "Notas/Cocina.md" });
    assert.match(r.json.text, /receta de lentejas/);
    assert.ok(s.reads.has("Notas/Cocina.md"));
    j.close();
  } finally { cleanup(); }
});

test("herramientas: rutas inválidas devuelven isError sin lanzar", async () => {
  const { j, call, cleanup } = await setup();
  try {
    assert.equal((await call("read_note", { path: "../x.md" })).isError, true);
    assert.equal((await call("read_note", { path: "Notas/NoExiste.md" })).isError, true);
    j.close();
  } finally { cleanup(); }
});

test("herramientas: exclude oculta carpetas en search y bloquea read_note", async () => {
  const { j, call, cleanup } = await setup(["Privado/"]);
  try {
    const r = await call("search", { query: "lentejas" });
    assert.ok(r.json.every((h: { path: string }) => !h.path.startsWith("Privado/")));
    assert.equal((await call("read_note", { path: "Privado/Secreto.md" })).isError, true);
    const l = await call("list_notes", {});
    assert.ok(l.json.every((n: { path: string }) => !n.path.startsWith("Privado/")));
    j.close();
  } finally { cleanup(); }
});

test("herramientas: el resto de lecturas devuelven JSON válido", async () => {
  const { j, call, proj, cleanup } = await setup();
  try {
    assert.equal((await call("inbox")).json.length, 1);
    assert.ok(Array.isArray((await call("list_tasks")).json));
    assert.equal((await call("get_project", { path: proj.path })).json.project.title, "Jarvis");
    assert.match((await call("today")).json.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok((await call("neighbors", { path: "Notas/Cocina.md" })).json.outgoing.length >= 1);
    assert.ok(Array.isArray((await call("recent_activity", { days: 7 })).json));
    assert.ok(Array.isArray((await call("list_notes", { type: "project" })).json));
    j.close();
  } finally { cleanup(); }
});

test("herramientas: tool desconocida → isError y specs trae niveles", async () => {
  const { j, call, tools, cleanup } = await setup();
  try {
    const r = await call("rm_rf", {});
    assert.equal(r.isError, true);
    assert.match(r.text, /desconocida/i);
    const names = tools.specs().map((t) => t.name);
    for (const n of ["search", "read_note", "list_notes", "get_project", "today", "inbox", "list_tasks", "neighbors", "recent_activity"]) assert.ok(names.includes(n), n);
    assert.ok(tools.specs().every((t) => ["read", "auto", "approval"].includes(t.level)));
    j.close();
  } finally { cleanup(); }
});

test("herramientas: cada llamada emite assistant.tool y queda como ai.action", async () => {
  const { j, call, cleanup } = await setup();
  try {
    const seen: { kind: string; tool?: string; path?: string }[] = [];
    j.bus.on("change", (e) => { if (e.kind === "assistant.tool") seen.push(e); });
    await call("read_note", { path: "Notas/Cocina.md" });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].tool, "read_note");
    assert.equal(seen[0].path, "Notas/Cocina.md");
    assert.equal(j.index.events({ kinds: ["ai.action"] }).length, 1);
    j.close();
  } finally { cleanup(); }
});

// ───────── escritura por niveles ─────────

test("escritura: create_task crea la tarea y devuelve undoId que la deshace", async () => {
  const { j, call, tools, cleanup } = await setup();
  try {
    const r = await call("create_task", { title: "Llamar a Ana", project: "Jarvis", due: "2026-10-30", priority: 1 });
    assert.ok(!r.isError, r.text);
    assert.ok(r.undoId);
    const t = j.index.tasks().find((x) => x.title === "Llamar a Ana")!;
    assert.equal(t.projectTitle, "Jarvis");
    assert.equal(t.due, "2026-10-30");
    assert.equal(t.priority, 1);
    await new UndoStore(j).undo(r.undoId!);
    assert.equal(j.index.tasks().some((x) => x.title === "Llamar a Ana"), false);
    assert.ok(tools.specs().find((x) => x.name === "create_task")!.level === "auto");
    j.close();
  } finally { cleanup(); }
});

test("escritura: set_task_status cambia el estado y Deshacer lo revierte", async () => {
  const { j, call, cleanup } = await setup();
  try {
    const t = await call("create_task", { title: "Tarea X" });
    const path = j.index.tasks().find((x) => x.title === "Tarea X")!.path;
    const r = await call("set_task_status", { path, status: "done" });
    assert.equal(j.index.tasks().find((x) => x.path === path)!.status, "done");
    await new UndoStore(j).undo(r.undoId!);
    assert.equal(j.index.tasks().find((x) => x.path === path)!.status, "todo");
    assert.ok(t.undoId);
    j.close();
  } finally { cleanup(); }
});

test("escritura: set_props rechaza claves no permitidas y no modifica nada", async () => {
  const { j, call, cocina, cleanup } = await setup();
  try {
    const before = (await j.readNote(cocina.path)).text;
    const r = await call("set_props", { path: cocina.path, props: { id: "hack" } });
    assert.equal(r.isError, true);
    assert.equal((await j.readNote(cocina.path)).text, before);
    const ok = await call("set_props", { path: cocina.path, props: { priority: 2 } });
    assert.ok(!ok.isError);
    assert.equal(j.index.getNote(cocina.path)!.fm.priority, 2);
    j.close();
  } finally { cleanup(); }
});

test("escritura: la sexta nota tocada se convierte en propuesta y no modifica el vault", async () => {
  const { j, call, cleanup } = await setup();
  try {
    const paths: string[] = [];
    for (let i = 1; i <= 6; i++) paths.push((await j.createNote({ title: `N${i}`, body: "x\n" })).path);
    for (const p of paths.slice(0, 5)) assert.ok(!(await call("set_props", { path: p, props: { priority: 3 } })).isError);
    const sixth = await call("set_props", { path: paths[5], props: { priority: 3 } });
    assert.equal(sixth.json.escalated, true);
    assert.match(sixth.json.reason, /5/);
    assert.equal(j.index.getNote(paths[5])!.fm.priority, undefined, "el vault no cambió");
    const pend = await j.proposals.list("pending");
    assert.equal(pend.length, 1);
    assert.equal(pend[0].source, "assistant");
    // tocar otra vez una nota ya tocada no cuenta como nueva
    assert.ok(!(await call("set_props", { path: paths[0], props: { priority: 4 } })).json.escalated);
    j.close();
  } finally { cleanup(); }
});

test("escritura: Notas/Importado/ siempre pasa por propuesta", async () => {
  const { j, call, cleanup } = await setup();
  try {
    const n = await j.createNote({ title: "Vieja", folder: "Notas/Importado", body: "x\n" });
    const r = await call("append_to_note", { path: n.path, text: "algo" });
    assert.equal(r.json.escalated, true);
    assert.equal((await j.readNote(n.path)).text.includes("algo"), false);
    assert.equal((await j.proposals.list("pending")).length, 1);
    j.close();
  } finally { cleanup(); }
});

test("escritura: append_to_note solo añade al final y conserva el frontmatter", async () => {
  const { j, call, cocina, cleanup } = await setup();
  try {
    const before = (await j.readNote(cocina.path)).text;
    const r = await call("append_to_note", { path: cocina.path, text: "Idea nueva" });
    assert.ok(!r.isError, r.text);
    const after = (await j.readNote(cocina.path)).text;
    assert.ok(after.startsWith(before.trimEnd()));
    assert.match(after, /Idea nueva\n$/);
    assert.equal(j.index.getNote(cocina.path)!.fm.type, "note");
    j.close();
  } finally { cleanup(); }
});

test("escritura: convert_capture, add_checkpoint, add_decision y create_note", async () => {
  const { j, call, cap, proj, cleanup } = await setup();
  try {
    const c = await call("convert_capture", { path: cap.path, kind: "task" });
    assert.ok(!c.isError, c.text);
    assert.equal(j.vault.exists(cap.path), false);
    assert.ok(j.index.tasks().some((t) => t.title.includes("Idea suelta")));
    await new UndoStore(j).undo(c.undoId!);
    assert.equal(j.vault.exists(cap.path), true);
    assert.ok(!(await call("add_checkpoint", { project: "Jarvis", text: "Dejé la API a medias" })).isError);
    assert.ok(!(await call("add_decision", { project: proj.path, text: "Usar Hermes" })).isError);
    const txt = (await j.readNote(proj.path)).text;
    assert.match(txt, /Dejé la API a medias/);
    assert.match(txt, /Usar Hermes/);
    const n = await call("create_note", { title: "Receta", body: "lentejas" });
    assert.ok(j.vault.exists(n.json.path));
    j.close();
  } finally { cleanup(); }
});

test("escritura: propose crea una propuesta pendiente (source assistant) sin tocar ficheros", async () => {
  const { j, call, cocina, cleanup } = await setup();
  try {
    const before = (await j.readNote(cocina.path)).text;
    const r = await call("propose", { title: "Borrar Cocina", rationale: "duplicada", ops: [{ op: "trash", path: cocina.path }] });
    assert.ok(!r.isError, r.text);
    const p = (await j.proposals.get(r.json.proposalId))!;
    assert.equal(p.status, "pending");
    assert.equal(p.source, "assistant");
    assert.equal((p.ops[0] as { before: string }).before.length > 0, true, "el servidor rellena before");
    assert.equal((await j.readNote(cocina.path)).text, before);
    assert.equal((await call("propose", { title: "x", rationale: "y", ops: [{ op: "trash", path: "../fuera.md" }] })).isError, true);
    assert.equal((await call("propose", { title: "x", rationale: "y", ops: [{ op: "rm", path: "Notas/a.md" }] })).isError, true);
    j.close();
  } finally { cleanup(); }
});

test("escritura: queda registrada como ai.action con su undoId", async () => {
  const { j, call, cleanup } = await setup();
  try {
    const r = await call("create_note", { title: "Registro" });
    const ev = j.index.events({ kinds: ["ai.action"] }).find((e) => e.data.tool === "create_note")!;
    assert.equal(ev.data.undoId, r.undoId);
    j.close();
  } finally { cleanup(); }
});

test("herramientas: inbox anota las capturas cuyo texto se entrega en session.reads", async () => {
  const { j, call, s, cap, cleanup } = await setup();
  try {
    await call("inbox");
    assert.ok(s.reads.has(cap.path));
    j.close();
  } finally { cleanup(); }
});
