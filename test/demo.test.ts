import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { handleDemoApi, onDemoChange, resetDemoState } from "../web/src/demo/engine.ts";
import type { CalendarResponse, CaptureResult, NoteInfo, Proposal, QueryResult, ResumeCard, TodayView } from "../web/src/types.ts";

test("demo engine: carga datos de prueba ricos para Hoy, Proyectos, Bases, Calendario, Grafo y Propuestas", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-06T10:00:00") });
  resetDemoState(new Date("2026-11-06T10:00:00"));

  const today = await handleDemoApi<TodayView>("GET", "/api/today");
  assert.equal(today.date, "2026-11-06");
  assert.ok(today.suggestion, "sugiere una tarea principal para hoy");
  assert.ok(today.resume.length >= 2, "incluye proyectos activos para retomar");
  assert.equal(today.inbox.count, 2);
  assert.equal(today.proposals, 1);

  const projects = await handleDemoApi<ResumeCard[]>("GET", "/api/projects");
  assert.ok(projects.some((p) => p.project.title === "Lanzamiento de Kioku Cloud"));

  const dbs = await handleDemoApi<{ path: string; title: string; rows: number }[]>("GET", "/api/databases");
  assert.ok(dbs.some((d) => d.title === "Biblioteca técnica" && d.rows >= 4));

  const query = await handleDemoApi<QueryResult>("POST", "/api/database/query", { path: "Bases/Biblioteca técnica.md" });
  assert.equal(query.rows.length, 4);

  const graph = await handleDemoApi<{ nodes: { type: string }[]; edges: unknown[] }>("GET", "/api/graph?max=400");
  assert.ok(graph.nodes.length >= 10, "grafo con nodos de ejemplo");
  assert.ok(graph.nodes.every((n) => n.type === "note" || n.type === "resource"), "el grafo solo incluye notas de conocimiento");
  assert.ok(graph.edges.length >= 8, "grafo con enlaces entre notas");

  const cal = await handleDemoApi<CalendarResponse>("GET", "/api/calendar?from=2026-11-06&to=2026-11-06");
  assert.ok(cal.items.length >= 2, "actividades programadas hoy en el calendario");
  assert.ok(cal.areas.length >= 3, "áreas de color en el calendario");
});

test("demo engine: permite capturar, editar notas, aplicar propuestas y restaurar los datos iniciales", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-06T10:00:00") });
  resetDemoState(new Date("2026-11-06T10:00:00"));
  const events: string[] = [];
  const off = onDemoChange((e) => events.push(e.kind));

  try {
    const cap = await handleDemoApi<CaptureResult>("POST", "/api/capture", { text: "t Probar despliegue en Vercel !hoy p1" });
    assert.equal(cap.kind, "task");
    assert.ok(events.includes("note"));

    const note = await handleDemoApi<NoteInfo>("GET", `/api/note?path=${encodeURIComponent(cap.path)}`);
    assert.equal(note.note?.title, "Probar despliegue en Vercel");

    // Renombrar una nota en modo demo actualiza ruta, título y wikilinks entrantes
    const arch = await handleDemoApi<NoteInfo>("GET", `/api/note?path=${encodeURIComponent("Notas/Arquitectura de índices derivados.md")}`);
    const renamed = await handleDemoApi<{ path: string; title: string; hash: string }>("POST", "/api/note/rename", {
      path: arch.path,
      title: "Arquitectura de índices SQLite",
      folder: "Notas/Sistema",
      hash: arch.hash,
    });
    assert.equal(renamed.path, "Notas/Sistema/Arquitectura de índices SQLite.md");
    const philo = await handleDemoApi<NoteInfo>("GET", `/api/note?path=${encodeURIComponent("Notas/Filosofía Local-First.md")}`);
    assert.match(philo.text, /\[\[Arquitectura de índices SQLite\]\]/);

    const props = await handleDemoApi<Proposal[]>("GET", "/api/proposals?status=pending");
    assert.equal(props.length, 1);
    const applied = await handleDemoApi<Proposal>("POST", `/api/proposals/${props[0].id}/apply`, {});
    assert.equal(applied.status, "applied");

    const afterApply = await handleDemoApi<Proposal[]>("GET", "/api/proposals?status=pending");
    assert.equal(afterApply.length, 0);

    const ask = await handleDemoApi<{ answer: string; reads: string[] }>("POST", "/api/assistant/ask", { message: "¿Qué hago hoy?" });
    assert.match(ask.answer, /paso prioritario/);
    assert.ok(ask.reads.length >= 1);

    // Bases: esquema (p. ej. añadir columna Prioridad con opciones y colores), Deshacer y metadatos en demo
    const dbs = await handleDemoApi<{ path: string; title: string }[]>("GET", "/api/databases");
    assert.ok(dbs.length >= 1);
    const dbPath = dbs[0].path;
    const prev = await handleDemoApi<{ affected: number; summary: string }>("POST", "/api/database/schema/preview", {
      path: dbPath,
      op: { op: "add-property", name: "Prioridad", type: "select", options: [{ name: "Alta", color: "red" }, { name: "Baja", color: "gray" }] },
    });
    assert.equal(prev.affected, 0);
    const appliedSchema = await handleDemoApi<{ undoId: string; summary: string }>("POST", "/api/database/schema", {
      path: dbPath,
      op: { op: "add-property", name: "Prioridad", type: "select", options: [{ name: "Alta", color: "red" }, { name: "Baja", color: "gray" }] },
    });
    assert.ok(appliedSchema.undoId);
    const qDb = await handleDemoApi<{ database: { available: { key: string; options?: { name: string; color?: string }[] }[] } }>("POST", "/api/database/query", { path: dbPath });
    assert.ok(qDb.database.available.some((c) => c.key === "Prioridad" && c.options?.some((o) => o.name === "Alta" && o.color === "red")));
    await handleDemoApi("POST", "/api/database/meta", { path: dbPath, icon: "📊" });
    const qMeta = await handleDemoApi<{ database: { icon?: string } }>("POST", "/api/database/query", { path: dbPath });
    assert.equal(qMeta.database.icon, "📊");
    await handleDemoApi("POST", "/api/assistant/undo", { id: appliedSchema.undoId });
    const qUndone = await handleDemoApi<{ database: { available: { key: string }[] } }>("POST", "/api/database/query", { path: dbPath });
    assert.equal(qUndone.database.available.some((c) => c.key === "Prioridad"), false);

    // Restaurar devuelve la demo a su estado original
    resetDemoState(new Date("2026-11-06T10:00:00"));
    const restoredProps = await handleDemoApi<Proposal[]>("GET", "/api/proposals?status=pending");
    assert.equal(restoredProps.length, 1);
  } finally {
    off();
  }
});

test("vercel.json apunta al build estático de dist/web", () => {
  const root = path.join(import.meta.dirname, "..");
  const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.equal(vercel.buildCommand, "npm run build:web");
  assert.equal(vercel.outputDirectory, "dist/web");
});
