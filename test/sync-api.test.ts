import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { tmpVault } from "./helpers.ts";

const KEY = "a".repeat(64);
const FM = (extra: string) => `---\nid: 01HX${Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(22, "0")}\ncreated: 2026-10-27T00:00:00.000Z\n${extra}---\n`;
const SEED = {
  "Notas/Publica.md": FM("type: note\n") + "Texto público. Enlace a [[Secreto]].\n",
  "Privado/Secreto.md": FM("type: note\n") + "MARCASECRETA contenido reservado\n",
  "Privado/Tarea privada.md": FM("type: task\nstatus: todo\n") + "MARCASECRETA tarea\n",
  "Tareas/Tarea publica.md": FM("type: task\nstatus: todo\n") + "Hacer algo\n",
};

async function setup() {
  const { root, cleanup } = tmpVault(SEED);
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  mkdirSync(path.join(root, ".kioku"), { recursive: true });
  writeFileSync(path.join(root, ".kioku", "mobile.json"), JSON.stringify({ exclude: ["Privado/"] }));
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: web, key: KEY });
  const mk = loadOrCreateMobileKey(root);
  const call = async (method: string, p: string, body?: unknown, key: string | null = mk, headers: Record<string, string> = {}) => {
    const r = await fetch(srv.url + p, {
      method, redirect: "manual",
      headers: { ...(key ? { "x-kioku-key": key } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, text: await r.text(), get json() { try { return JSON.parse(this.text); } catch { return null; } } };
  };
  const notes = (paths: unknown) => call("GET", `/api/sync/notes?paths=${encodeURIComponent(typeof paths === "string" ? paths : JSON.stringify(paths))}`);
  return { j, srv, root, call, notes, done: async () => { await srv.close(); j.close(); cleanup(); } };
}

test("manifest: lista las notas visibles con path, mtime y hash, sin lo privado", async () => {
  const s = await setup();
  try {
    const r = await s.call("GET", "/api/sync/manifest");
    assert.equal(r.status, 200);
    const list = r.json as { path: string; mtime: number; hash: string }[];
    assert.deepEqual(list.map((n) => n.path).sort(), ["Notas/Publica.md", "Tareas/Tarea publica.md"]);
    const note = (await s.call("GET", "/api/note?path=Notas%2FPublica.md")).json;
    assert.equal(list.find((n) => n.path === "Notas/Publica.md")!.hash, note.hash);
    assert.equal(typeof list[0].mtime, "number");
    assert.ok(!r.text.includes("Privado"));
  } finally { await s.done(); }
});

test("notes: devuelve el texto pedido, también con comas, # , & y acentos en el nombre", async () => {
  const s = await setup();
  try {
    await s.j.vault.write("Notas/Año, mes & #1.md", FM("type: note\n") + "cuerpo");
    await s.j.reindex();
    const r = await s.notes(["Notas/Año, mes & #1.md", "Notas/Publica.md"]);
    assert.equal(r.status, 200);
    assert.equal(r.json.notes.length, 2);
    assert.match(r.json.notes.find((n: { path: string }) => n.path.startsWith("Notas/Año")).text, /cuerpo/);
    assert.deepEqual(r.json.pending, []);
    assert.deepEqual(r.json.gone, []);
  } finally { await s.done(); }
});

test("notes: una ruta privada, con trucos o no, da 404 a toda la petición y no filtra texto", async () => {
  const s = await setup();
  try {
    for (const bad of ["Privado/Secreto.md", "privado/Secreto.md", "Notas/../Privado/Secreto.md", "Privado//Secreto.md"]) {
      const r = await s.notes(["Notas/Publica.md", bad]);
      assert.equal(r.status, 404, bad);
      assert.ok(!r.text.includes("MARCASECRETA"), bad);
    }
  } finally { await s.done(); }
});

test("notes: más de 50 rutas → 400; JSON inválido → 400; sin clave → 401", async () => {
  const s = await setup();
  try {
    assert.equal((await s.notes(Array.from({ length: 51 }, (_, i) => `Notas/n${i}.md`))).status, 400);
    assert.equal((await s.notes("no es json")).status, 400);
    assert.equal((await s.notes({ a: 1 } as never)).status, 400);
    assert.equal((await s.call("GET", "/api/sync/notes?paths=%5B%5D", undefined, null)).status, 401);
  } finally { await s.done(); }
});

test("notes: lo que no cabe en 1 MiB vuelve en pending, y una nota mayor que el tope sale sola", async () => {
  const s = await setup();
  try {
    const big = (n: number) => FM("type: note\n") + "x".repeat(n);
    for (const n of ["A", "B", "C"]) await s.j.vault.write(`Notas/${n}.md`, big(600 * 1024));
    await s.j.vault.write("Notas/Enorme.md", big(1536 * 1024));
    await s.j.reindex();
    const r = await s.notes(["Notas/A.md", "Notas/B.md", "Notas/C.md"]);
    assert.equal(r.json.notes.length, 1);
    assert.deepEqual(r.json.pending, ["Notas/B.md", "Notas/C.md"]);
    const e = await s.notes(["Notas/Enorme.md"]);
    assert.equal(e.json.notes.length, 1);
    assert.deepEqual(e.json.pending, []);
  } finally { await s.done(); }
});

test("notes: una nota borrada tras el manifest sale en gone", async () => {
  const s = await setup();
  try {
    const r = await s.notes(["Notas/No existe.md", "Notas/Publica.md"]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.gone, ["Notas/No existe.md"]);
    assert.equal(r.json.notes.length, 1);
  } finally { await s.done(); }
});
