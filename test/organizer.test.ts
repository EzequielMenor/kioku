import { test } from "node:test";
import assert from "node:assert/strict";
import { Organizer, organizePrompt } from "../src/server/organizer.ts";

function harness(o: { ready?: boolean; idle?: boolean; fail?: boolean } = {}) {
  let now = 1_000_000;
  const captures = new Map<string, number>(); // path → mtime
  const runs: string[][] = [];
  const org = new Organizer({
    pending: () => [...captures].map(([path, mtime]) => ({ path, mtime })),
    ready: async () => o.ready ?? true,
    idle: () => o.idle ?? true,
    organize: async (paths) => {
      runs.push(paths);
      if (o.fail) throw new Error("modelo caído");
      for (const p of paths) captures.delete(p);
    },
    now: () => now,
  });
  return { org, captures, runs, advance: (ms: number) => { now += ms; }, at: () => now };
}

test("organizador: espera a que la captura repose, ordena de dos en dos y por antigüedad", async () => {
  const h = harness();
  h.captures.set("Bandeja/c.md", h.at());
  h.captures.set("Bandeja/a.md", h.at() - 60_000);
  h.captures.set("Bandeja/b.md", h.at() - 50_000);
  assert.deepEqual(await h.org.tick(), ["Bandeja/a.md", "Bandeja/b.md"], "las más antiguas primero, como mucho dos");
  assert.deepEqual(await h.org.tick(), [], "c acaba de escribirse: se deja reposar (puede seguir editándola)");
  h.advance(25_000);
  assert.deepEqual(await h.org.tick(), ["Bandeja/c.md"]);
});

test("organizador: no interrumpe (Kio ocupado o el usuario acaba de hablarle) y sin modelo no hace nada", async () => {
  const busy = harness({ idle: false });
  busy.captures.set("Bandeja/a.md", 0);
  assert.deepEqual(await busy.org.tick(), []);

  const h = harness();
  h.captures.set("Bandeja/a.md", 0);
  h.org.noteUserActivity();
  assert.deepEqual(await h.org.tick(), [], "el usuario acaba de preguntar: su consulta va primero");
  h.advance(61_000);
  assert.deepEqual(await h.org.tick(), ["Bandeja/a.md"]);

  const off = harness({ ready: false });
  off.captures.set("Bandeja/a.md", 0);
  assert.deepEqual(await off.org.tick(), [], "sin modelo, lo capturado se queda en «Sin organizar», sin perderse");
});

test("organizador: si el modelo falla o deja la captura, la reintenta una vez y luego la deja para el usuario", async () => {
  const h = harness({ fail: true });
  h.captures.set("Bandeja/a.md", 0);
  assert.deepEqual(await h.org.tick(), ["Bandeja/a.md"]);
  assert.deepEqual(await h.org.tick(), ["Bandeja/a.md"]);
  assert.deepEqual(await h.org.tick(), [], "dos intentos y basta: no se queda en bucle gastando el modelo");
  h.captures.set("Bandeja/a.md", 5); // el usuario la edita: es otra captura
  assert.deepEqual(await h.org.tick(), ["Bandeja/a.md"]);
});

test("organizador: «Ordenar ahora» no espera reposo ni silencio, pero nunca corre dos veces a la vez", async () => {
  const h = harness();
  h.captures.set("Bandeja/a.md", h.at());
  h.org.noteUserActivity();
  const [first, second] = await Promise.all([h.org.tick({ now: true }), h.org.tick({ now: true })]);
  assert.deepEqual(first, ["Bandeja/a.md"]);
  assert.deepEqual(second, [], "la segunda llamada ve la primera en marcha");
});

test("organizador: el encargo a Kio nombra las rutas exactas, pide convert_capture con título y prohíbe borrar", () => {
  const p = organizePrompt(["Bandeja/a.md", "Bandeja/b.md"], "2026-11-16");
  assert.match(p, /- Bandeja\/a\.md\n- Bandeja\/b\.md/);
  assert.match(p, /convert_capture/);
  assert.match(p, /title/);
  assert.match(p, /2026-11-16/);
  assert.match(p, /No borres/);
});

// ───────── Integración: daemon real + motor de pruebas ─────────
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { FakeEngine } from "../src/assistant/fake-engine.ts";
import { UndoStore } from "../src/assistant/undo.ts";
import { tmpVault } from "./helpers.ts";

test("organizador en el daemon: «Ordenar ahora» convierte lo capturado en notas con Deshacer; sin la opción no hay nada en marcha", async () => {
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(os.tmpdir(), "kioku-org-web-"));
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: web, key: "a".repeat(64), assistant: { engine: new FakeEngine() }, organize: true });
  const post = (p: string) => fetch(srv.url + p, { method: "POST", headers: { "x-kioku-key": srv.key, "content-type": "application/json" }, body: "{}" });
  try {
    await j.capture("las ideas buenas llegan caminando");
    const r = await post("/api/assistant/organize");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).organized, 1);
    assert.equal(j.inbox().length, 0, "«Sin organizar» queda vacía");
    const recs = await new UndoStore(j).list();
    const conv = recs.find((x) => x.tool === "convert_capture");
    assert.ok(conv, "el cambio queda en Actividad");
    await new UndoStore(j).undo(conv!.id);
    assert.equal(j.inbox().length, 1, "Deshacer la devuelve a «Sin organizar»");
  } finally { await srv.close(); j.close(); cleanup(); rmSync(web, { recursive: true, force: true }); }

  const b = tmpVault();
  const j2 = await Kioku.open({ root: b.root });
  const srv2 = await startServer(j2, { port: 0, webDir: web, key: "a".repeat(64), assistant: { engine: new FakeEngine() } });
  try {
    const r = await fetch(srv2.url + "/api/assistant/organize", { method: "POST", headers: { "x-kioku-key": srv2.key, "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 503, "sin organize: true, el daemon no ordena nada por su cuenta");
  } finally { await srv2.close(); j2.close(); b.cleanup(); }
});
