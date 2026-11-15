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
