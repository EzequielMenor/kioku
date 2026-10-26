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
