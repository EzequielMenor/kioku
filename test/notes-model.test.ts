import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFolders, listKnowledgeNotes, noteFolder } from "../web/src/notes-model.ts";

const SAMPLE = [
  { path: "Notas/Arquitectura.md", title: "Arquitectura", type: "note", mtime: 50, tags: ["sqlite", "local"] },
  { path: "Notas/Diseño/Tinta.md", title: "Tinta", type: "note", mtime: 40, tags: ["ui"] },
  { path: "Recursos/Guía SQLite.md", title: "Guía SQLite", type: "resource", mtime: 30, tags: ["sqlite"] },
  { path: "Tareas/Hacer algo.md", title: "Hacer algo", type: "task", mtime: 90, tags: [] },
  { path: "Proyectos/Kioku.md", title: "Kioku", type: "project", mtime: 80, tags: [] },
  { path: "Bandeja/Captura.md", title: "Captura", type: "capture", mtime: 70, tags: [] },
  { path: "Diario/2026-11-15.md", title: "2026-11-15", type: "journal", mtime: 60, tags: [] },
  { path: "Bases/Libros.md", title: "Libros", type: "database", mtime: 55, tags: [] },
  { path: "Calendario/bloque.md", title: "Bloque", type: "block", mtime: 99, tags: [] },
  { path: "Areas/Trabajo.md", title: "Trabajo", type: "area", mtime: 98, tags: [] },
];

test("listKnowledgeNotes: separa notas de conocimiento (note/resource) del resto de tipos", () => {
  const all = listKnowledgeNotes(SAMPLE, { subType: "all", folder: "all", query: "" });
  assert.deepEqual(all.map((n) => n.path), [
    "Notas/Arquitectura.md",
    "Notas/Diseño/Tinta.md",
    "Recursos/Guía SQLite.md",
  ]);

  const onlyResources = listKnowledgeNotes(SAMPLE, { subType: "resource", folder: "all", query: "" });
  assert.deepEqual(onlyResources.map((n) => n.path), ["Recursos/Guía SQLite.md"]);

  const inSubfolder = listKnowledgeNotes(SAMPLE, { subType: "all", folder: "Notas/Diseño", query: "" });
  assert.deepEqual(inSubfolder.map((n) => n.path), ["Notas/Diseño/Tinta.md"]);

  const byTag = listKnowledgeNotes(SAMPLE, { subType: "all", folder: "all", query: "#sqlite" });
  assert.deepEqual(byTag.map((n) => n.path), ["Notas/Arquitectura.md", "Recursos/Guía SQLite.md"]);
});

test("extractFolders y noteFolder: agrupa por carpeta y subcarpeta sobre notas de conocimiento", () => {
  assert.equal(noteFolder("Suelta.md"), "(Raíz)");
  assert.equal(noteFolder("Notas/Diseño/Tinta.md"), "Notas/Diseño");
  assert.deepEqual(extractFolders(SAMPLE), [
    { folder: "Notas", count: 1 },
    { folder: "Notas/Diseño", count: 1 },
    { folder: "Recursos", count: 1 },
  ]);
});

test("las filas de una base (una carpeta como «Biblia/») no inundan Notas: se apartan con su recuento por base", async () => {
  const { splitBaseRows } = await import("../web/src/notes-model.ts");
  const items = [
    { path: "Notas/Viaje.md", title: "Viaje", type: "note", mtime: 1 },
    { path: "Biblia/Juan.md", title: "Juan", type: "note", mtime: 2 },
    { path: "Biblia/Génesis.md", title: "Génesis", type: "note", mtime: 3 },
    { path: "Hábitos/Meditar.md", title: "Meditar", type: "note", mtime: 4 },
    { path: "Bibliografía/Libro.md", title: "Libro", type: "note", mtime: 5 },
  ];
  const bases = [
    { path: "Bases/Lectura de la Biblia.md", title: "Lectura de la Biblia", source: { folder: "Biblia/", type: null, tags: [] } },
    { path: "Bases/Hábitos.md", title: "Hábitos", source: { folder: "Hábitos", type: null, tags: [] } },
    { path: "Bases/Tareas.md", title: "Tareas", source: { folder: null, type: "task", tags: [] } },
  ];
  const r = splitBaseRows(items, bases);
  assert.deepEqual(r.notes.map((n) => n.path), ["Notas/Viaje.md", "Bibliografía/Libro.md"], "«Bibliografía/» no es «Biblia/»");
  assert.deepEqual(r.bases, [{ path: "Bases/Lectura de la Biblia.md", title: "Lectura de la Biblia", count: 2 }, { path: "Bases/Hábitos.md", title: "Hábitos", count: 1 }]);
  assert.deepEqual(splitBaseRows(items, []).notes.length, 5, "sin bases, nada cambia");
});

test("título visible: se muestra si el texto no empieza ya por ese mismo título como encabezado", async () => {
  const { needsTitleHeading } = await import("../web/src/notes-model.ts");
  assert.equal(needsTitleHeading("Fontanero Ramón: 1.850 €", "Presupuesto cocina"), true, "nota sin encabezado (las que crea Kio)");
  assert.equal(needsTitleHeading("# Presupuesto cocina\n\nFontanero…", "Presupuesto cocina"), false, "ya lo lleva: no se duplica");
  assert.equal(needsTitleHeading("---\nid: x\ntype: note\n---\n\n#  presupuesto  COCINA \ntexto", "Presupuesto cocina"), false, "tras el frontmatter, sin distinguir mayúsculas ni espacios");
  assert.equal(needsTitleHeading("---\nid: x\n---\n# Otra cosa\n", "Presupuesto cocina"), true, "un encabezado distinto no es el título");
  assert.equal(needsTitleHeading("", "Vacía"), true);
});
