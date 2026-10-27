import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { tmpVault } from "./helpers.ts";

async function setup() {
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  writeFileSync(path.join(web, "quick.html"), "<h1>quick</h1>");
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: web });
  const call = async (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(srv.url + p, {
      method, headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: await r.json().catch(() => null) as any };
  };
  return { j, srv, call, root, done: async () => { await srv.close(); j.close(); cleanup(); } };
}

test("API: flujo completo captura → hoy → foco → retomar", async () => {
  const s = await setup();
  try {
    assert.equal((await s.call("GET", "/api/health")).json.ok, true);
    const proj = await s.call("POST", "/api/project/create", { title: "Alfa" });
    assert.equal(proj.json.path, "Proyectos/Alfa.md");
    assert.equal((await s.call("POST", "/api/capture", { text: "t Hacer cosa @alfa !hoy" })).json.kind, "task");
    const today = (await s.call("GET", "/api/today")).json;
    assert.equal(today.suggestion.task.title, "Hacer cosa");
    await s.call("POST", "/api/focus/start", { taskPath: today.suggestion.task.path });
    assert.equal((await s.call("GET", "/api/focus")).json.active, true);
    await s.call("POST", "/api/capture", { text: "idea aparcada" });
    assert.equal((await s.call("GET", "/api/inbox")).json.length, 0);
    await s.call("POST", "/api/focus/end", { checkpoint: "dejado a medias", done: false });
    assert.equal((await s.call("GET", "/api/inbox")).json.length, 1);
    const card = (await s.call("GET", "/api/project?path=" + encodeURIComponent("Proyectos/Alfa.md"))).json;
    assert.equal(card.lastCheckpoint.text, "dejado a medias");
    const found = (await s.call("GET", "/api/search?q=alfa")).json;
    assert.equal(found[0].path, "Proyectos/Alfa.md");
  } finally { await s.done(); }
});

test("API: guardado con hash, conflicto 409, y 404", async () => {
  const s = await setup();
  try {
    const c = await s.call("POST", "/api/note/create", { title: "N", body: "uno\n" });
    const n = (await s.call("GET", "/api/note?path=" + encodeURIComponent(c.json.path))).json;
    const ok = await s.call("PUT", "/api/note", { path: c.json.path, text: n.text + "dos\n", hash: n.hash });
    assert.equal(ok.status, 200);
    const stale = await s.call("PUT", "/api/note", { path: c.json.path, text: "x", hash: n.hash });
    assert.equal(stale.status, 409);
    assert.equal((await s.call("GET", "/api/nope")).status, 404);
  } finally { await s.done(); }
});

test("Seguridad: rutas internas/traversal, Host, Origin y content-type", async () => {
  const s = await setup();
  try {
    for (const bad of [".kioku/index.db", "../x.md", ".obsidian/a.md", "/etc/passwd.md"]) {
      const r = await s.call("GET", "/api/note?path=" + encodeURIComponent(bad));
      assert.ok(r.status === 400, `${bad} → ${r.status}`);
    }
    assert.equal((await s.call("GET", "/api/health", undefined, { origin: "https://evil.example" })).status, 403);
    // Host falso (DNS rebinding)
    const res = await new Promise<number>((resolve) => {
      import("node:http").then(({ default: http }) => {
        const url = new URL(s.srv.url);
        const req = http.request({ host: url.hostname, port: url.port, path: "/api/health", headers: { host: "evil.example" } }, (r) => { r.resume(); resolve(r.statusCode!); });
        req.end();
      });
    });
    assert.equal(res, 403);
    // POST "simple" sin application/json (CSRF por formulario)
    const r = await fetch(s.srv.url + "/api/capture", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ text: "x" }) });
    assert.equal(r.status, 415);
    assert.equal((await s.call("GET", "/")).status, 200);
  } finally { await s.done(); }
});

test("API: propuestas con diff y aplicar/rechazar", async () => {
  const s = await setup();
  try {
    await s.call("POST", "/api/capture", { text: "Comprar leche" });
    const made = (await s.call("POST", "/api/triage", {})).json;
    assert.equal(made.length, 1);
    const list = (await s.call("GET", "/api/proposals")).json;
    assert.equal(list[0].ops[0].op, "setProp");
    const applied = await s.call("POST", `/api/proposals/${made[0].id}/apply`, {});
    assert.equal(applied.json.status, "applied");
    assert.equal((await s.call("GET", "/api/tasks?status=todo")).json[0].title, "Comprar leche");
  } finally { await s.done(); }
});

test("API bases: crear, listar, añadir fila, consultar, guardar vista y editar celda", async () => {
  const s = await setup();
  try {
    const created = await s.call("POST", "/api/database/create", { name: "Libros", template: "libros" });
    assert.equal(created.status, 200);
    assert.equal(created.json.path, "Bases/Libros.md");
    assert.equal((await s.call("GET", "/api/databases")).json[0].title, "Libros");

    const row = await s.call("POST", "/api/database/row", { path: created.json.path, title: "Dune", props: { Estado: "Leyendo", Nota: 9 } });
    assert.equal(row.json.path, "Libros/Dune.md");
    const edit = await s.call("POST", "/api/note/props", { path: row.json.path, props: { Estado: "Leído" } });
    assert.equal(edit.json.fm.Estado, "Leído");

    const q = (await s.call("GET", "/api/database?path=" + encodeURIComponent(created.json.path) + "&view=" + encodeURIComponent("Por estado"))).json;
    assert.deepEqual(q.groups.map((g: any) => g.key), ["Leído"]);
    assert.equal(q.database.views.length, 2);

    const adhoc = (await s.call("POST", "/api/database/query", { path: created.json.path, view: { name: "x", kind: "table", columns: ["title"], filter: [{ prop: "Estado", op: "is", value: "Leyendo" }], sort: [], group: null } })).json;
    assert.equal(adhoc.total, 0);

    const saved = await s.call("POST", "/api/database/view", { path: created.json.path, view: { name: "Leídos", kind: "list", columns: ["title"], filter: [{ prop: "Estado", op: "is", value: "Leído" }], sort: [], group: null } });
    assert.equal(saved.status, 200);
    assert.equal((await s.call("GET", "/api/databases")).json[0].views.length, 3);
    const del = await s.call("POST", "/api/database/view/delete", { path: created.json.path, name: "Leídos" });
    assert.equal(del.status, 200);
    assert.equal((await s.call("GET", "/api/databases")).json[0].views.length, 2);
  } finally { await s.done(); }
});

test("API bases: errores claros y las mismas protecciones que el resto de la API", async () => {
  const s = await setup();
  try {
    const db = (await s.call("POST", "/api/database/create", { name: "Libros", template: "libros" })).json;
    assert.equal((await s.call("GET", "/api/database?path=Bases/Nada.md")).status, 404);
    assert.equal((await s.call("GET", "/api/database?path=" + encodeURIComponent(db.path) + "&view=Nope")).status, 404);
    const n = (await s.call("POST", "/api/note/create", { title: "Normal" })).json;
    assert.equal((await s.call("GET", "/api/database?path=" + encodeURIComponent(n.path))).status, 400);
    assert.equal((await s.call("POST", "/api/database/view", { path: db.path, view: { name: "Mala", kind: "galaxia" } })).status, 400);
    assert.equal((await s.call("POST", "/api/database/row", { path: db.path, title: "X", props: { a: { b: 1 } } })).status, 400);
    assert.equal((await s.call("GET", "/api/database?path=../../etc/passwd")).status, 400);
    assert.equal((await s.call("POST", "/api/database/create", { name: "" })).status, 400);
    assert.equal((await s.call("POST", "/api/database/create", { name: "X", template: "rara" })).status, 400);
    assert.equal((await s.call("POST", "/api/database/row", { path: db.path, title: "Z" }, { origin: "http://evil.example" })).status, 403);
  } finally { await s.done(); }
});
