import { test } from "node:test";
import assert from "node:assert/strict";
import { Index } from "../src/core/index.ts";
import { Vault } from "../src/core/vault.ts";
import { tmpVault } from "./helpers.ts";

const FILES = {
  "Proyectos/Jarvis.md": "---\ntype: project\nstatus: active\naliases: [Segundo cerebro]\n---\n# Jarvis\nVer [[Notas/Arquitectura]]\n",
  "Notas/Arquitectura.md": "# Arquitectura\nUsa SQLite como índice. Canción de prueba. Relacionado con [[Jarvis]] y [[Segundo cerebro]].\n",
  "Notas/Otra.md": "Hablo de Arquitectura sin enlazar. #idea\n",
  "Tareas/Cablear watcher.md": '---\ntype: task\nstatus: doing\nproject: "[[Jarvis]]"\ndue: 2026-10-27\npriority: 1\n---\ncuerpo',
  "Notas/Rota.md": "enlace roto [[No existe]]",
  ".obsidian/app.json": "{}",
};

test("sync indexa, resuelve enlaces por nombre/alias/ruta y calcula backlinks", async () => {
  const { root, cleanup } = tmpVault(FILES);
  try {
    const ix = new Index(":memory:");
    const r = await ix.sync(new Vault(root));
    assert.equal(r.added, 5); // .obsidian ignorado
    assert.equal(ix.count(), 5);
    const bl = ix.backlinks("Proyectos/Jarvis.md").map((b) => b.path).sort();
    assert.deepEqual(bl, ["Notas/Arquitectura.md", "Tareas/Cablear watcher.md"]);
    assert.deepEqual(ix.backlinks("Notas/Arquitectura.md").map((b) => b.path), ["Proyectos/Jarvis.md"]);
    const out = ix.outgoing("Notas/Rota.md");
    assert.equal(out[0].path, null);
    // el alias y el nombre apuntan al mismo destino: un solo backlink
    assert.equal(ix.backlinks("Proyectos/Jarvis.md").filter((b) => b.path === "Notas/Arquitectura.md").length, 1);
  } finally { cleanup(); }
});

test("tareas: relación con proyecto resuelta, estado y fecha", async () => {
  const { root, cleanup } = tmpVault(FILES);
  try {
    const ix = new Index(":memory:");
    await ix.sync(new Vault(root));
    const t = ix.tasks({ status: ["todo", "doing"] });
    assert.equal(t.length, 1);
    assert.equal(t[0].projectPath, "Proyectos/Jarvis.md");
    assert.equal(t[0].projectTitle, "Jarvis");
    assert.equal(t[0].due, "2026-10-27");
    assert.equal(t[0].priority, 1);
  } finally { cleanup(); }
});

test("búsqueda: título difuso primero, FTS sin acentos, prefijo", async () => {
  const { root, cleanup } = tmpVault(FILES);
  try {
    const ix = new Index(":memory:");
    await ix.sync(new Vault(root));
    assert.equal(ix.search("arquit")[0].path, "Notas/Arquitectura.md");
    assert.equal(ix.search("arquit")[0].kind, "title");
    const c = ix.search("cancion"); // sin acento encuentra "Canción"
    assert.equal(c[0].path, "Notas/Arquitectura.md");
    assert.equal(c[0].kind, "content");
    assert.match(c[0].snippet, /«Canción»/);
    assert.deepEqual(ix.search("zzzz"), []);
  } finally { cleanup(); }
});

test("menciones sin enlazar", async () => {
  const { root, cleanup } = tmpVault(FILES);
  try {
    const ix = new Index(":memory:");
    await ix.sync(new Vault(root));
    const m = ix.unlinkedMentions("Notas/Arquitectura.md").map((x) => x.path);
    assert.deepEqual(m, ["Notas/Otra.md"]);
  } finally { cleanup(); }
});

test("sync incremental: detecta cambios y borrados; reindex desde cero da el mismo resultado", async () => {
  const { root, cleanup } = tmpVault(FILES);
  try {
    const vault = new Vault(root);
    const ix = new Index(":memory:");
    await ix.sync(vault);
    assert.deepEqual(await ix.sync(vault), { added: 0, updated: 0, removed: 0 });
    await vault.write("Notas/Nueva.md", "nueva [[Jarvis]]");
    await vault.trash("Notas/Rota.md");
    const r = await ix.sync(vault);
    assert.deepEqual(r, { added: 1, updated: 0, removed: 1 });
    const snap = (i: Index) => JSON.stringify({
      n: i.listNotes().map((x) => [x.path, x.hash]).sort(),
      b: i.backlinks("Proyectos/Jarvis.md").map((x) => x.path).sort(),
    });
    const fresh = new Index(":memory:");
    await fresh.sync(vault);
    assert.equal(snap(ix), snap(fresh));
  } finally { cleanup(); }
});

test("YAML inválido: se indexa como texto y se marca", async () => {
  const { root, cleanup } = tmpVault({ "a.md": "---\nx: [roto\n---\ncontenido buscable" });
  try {
    const ix = new Index(":memory:");
    await ix.sync(new Vault(root));
    assert.equal(ix.getNote("a.md")?.fmError, true);
    assert.equal(ix.search("buscable")[0].path, "a.md");
  } finally { cleanup(); }
});

test("graph: nodos conectados, vecindario con focus, ignora enlaces rotos", async () => {
  const { root, cleanup } = tmpVault(FILES);
  try {
    const ix = new Index(":memory:");
    await ix.sync(new Vault(root));
    const g = ix.graph();
    const paths = g.nodes.map((n) => n.path).sort();
    assert.deepEqual(paths, ["Notas/Arquitectura.md", "Proyectos/Jarvis.md", "Tareas/Cablear watcher.md"]);
    assert.equal(g.total, 5);
    assert.equal(g.isolated, 2); // Otra.md y Rota.md (su enlace no resuelve)
    assert.equal(g.edges.length, 3); // Jarvis↔Arquitectura (2 sentidos) + tarea→Jarvis
    const local = ix.graph({ focus: "Tareas/Cablear watcher.md", depth: 1 });
    assert.deepEqual(local.nodes.map((n) => n.path).sort(), ["Proyectos/Jarvis.md", "Tareas/Cablear watcher.md"]);
  } finally { cleanup(); }
});
