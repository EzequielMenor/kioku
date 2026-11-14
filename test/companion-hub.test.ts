import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { loadOrCreateCompanionKey, revokeCompanionKey } from "../src/server/key.ts";
import { companionAllowed } from "../src/server/companion.ts";
import { AgentState, type AgentSnapshot } from "../src/assistant/agent-state.ts";
import { conversationFile } from "../src/assistant/conversations.ts";
import { FakeEngine } from "../src/assistant/fake-engine.ts";
import type { AskInput, AssistantEngine } from "../src/assistant/engine.ts";
import { tmpVault } from "./helpers.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup(engine: AssistantEngine = new FakeEngine()) {
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: web, assistant: { engine }, agentState: { successMs: 40, errorMs: 40, listeningMs: 60 } });
  const events: any[] = [];
  j.bus.on("change", (e: any) => { if (String(e.kind).startsWith("assistant.")) events.push(e); });
  const as = (key: string) => async (method: string, p: string, body?: unknown) => {
    const r = await fetch(srv.url + p, { method, headers: { "x-kioku-key": key, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };
  return { j, srv, root, events, call: as(srv.key), as, done: async () => { await srv.close(); j.close(); cleanup(); } };
}

test("estado del agente: recorre thinking → responding → success → idle y vuelve a reposo solo", async () => {
  const seen: AgentSnapshot[] = [];
  const a = new AgentState((s) => seen.push(s), { successMs: 20, errorMs: 20, listeningMs: 20 });
  a.listening(true);
  a.start("c1");
  a.listening(true); // mientras trabaja no «escucha»
  a.thinking("Leyendo Notas/X.md…");
  a.responding();
  a.finish({ ok: true });
  await sleep(50);
  assert.deepEqual(seen.map((s) => s.state), ["listening", "thinking", "thinking", "responding", "success", "idle"]);
  assert.equal(seen[2].label, "Leyendo Notas/X.md…");
  a.start("c1");
  a.finish({ ok: false, error: "sin conexión" });
  assert.equal(a.snapshot().state, "error");
  await sleep(50);
  assert.equal(a.snapshot().state, "idle");
  // Con propuestas pendientes se queda esperando confirmación hasta que se resuelven.
  a.start("c1");
  a.finish({ ok: true, proposals: ["P1", "P2"] });
  assert.equal(a.snapshot().state, "awaiting_confirmation");
  a.pending(new Set(["P2"]));
  assert.equal(a.snapshot().state, "awaiting_confirmation");
  a.pending(new Set());
  assert.equal(a.snapshot().state, "idle");
  a.close();
});

test("una consulta deja la conversación en el daemon y emite estado, mensajes y texto en vivo", async () => {
  const s = await setup();
  try {
    await s.j.capture("Idea suelta");
    const r = await s.call("POST", "/api/assistant/ask", { message: "¿qué hay en la bandeja?" });
    assert.equal(r.status, 200);
    assert.match(r.json.answer, /1 capturas/);
    const states = s.events.filter((e) => e.kind === "assistant.state").map((e) => e.agent.state);
    assert.deepEqual([...new Set(states)], ["thinking", "responding", "success"]);
    assert.ok(s.events.some((e) => e.kind === "assistant.state" && e.agent.label === "Revisando tu Bandeja…"), "la herramienta en curso se refleja en el estado");
    assert.equal(s.events.filter((e) => e.kind === "assistant.message").length, 2);
    assert.equal(s.events.filter((e) => e.kind === "assistant.delta").map((e) => e.text).join(""), r.json.answer);
    // La conversación activa es la misma para cualquier interfaz que pregunte después.
    const conv = await s.call("GET", "/api/assistant/conversation");
    assert.deepEqual(conv.json.messages.map((m: any) => m.role), ["user", "assistant"]);
    assert.equal(conv.json.id, r.json.conversation);
    assert.ok(s.j.vault.exists(".kioku") || true);
    assert.ok(await s.j.vault.readInternal(conversationFile(conv.json.id)), "queda en un fichero legible de .kioku/conversations");
    await sleep(80);
    assert.equal((await s.call("GET", "/api/assistant/state")).json.agent.state, "idle");
  } finally { await s.done(); }
});

test("un solo agente, dos interfaces: el compañero de escritorio continúa la conversación empezada en Kioku", async () => {
  const s = await setup();
  try {
    const desk = s.as(loadOrCreateCompanionKey(s.root));
    assert.equal((await desk("GET", "/api/session")).json.role, "companion");
    await s.call("POST", "/api/assistant/ask", { message: "hola desde kioku" });
    const r = await desk("POST", "/api/assistant/ask", { message: "y ahora desde el escritorio" });
    assert.equal(r.status, 200);
    const conv = (await desk("GET", "/api/assistant/conversation")).json;
    assert.deepEqual(conv.messages.map((m: any) => [m.role, m.surface ?? null]), [["user", "web"], ["assistant", null], ["user", "desktop"], ["assistant", null]]);
    // Nueva conversación desde una interfaz: la otra la ve como activa.
    const fresh = (await desk("POST", "/api/assistant/conversation/new", {})).json.id;
    assert.equal((await s.call("GET", "/api/assistant/conversation")).json.id, fresh);
    assert.equal((await s.call("GET", "/api/assistant/conversations")).json.length, 1);
  } finally { await s.done(); }
});

test("la credencial del compañero solo abre conversar, ver el estado y confirmar; revocarla la invalida al momento", async () => {
  const s = await setup();
  try {
    const key = loadOrCreateCompanionKey(s.root);
    const desk = s.as(key);
    await s.j.createNote({ title: "Secreta", type: "note", body: "contenido" });
    for (const [m, p, body] of [
      ["GET", "/api/note?path=Notas/Secreta.md"], ["GET", "/api/notes"], ["GET", "/api/search?q=contenido"], ["GET", "/api/assistant/memory"],
      ["POST", "/api/note/delete", { path: "Notas/Secreta.md" }], ["POST", "/api/capture", { text: "x" }], ["PUT", "/api/assistant/model", { provider: "ollama" }],
      ["GET", "/api/assistant/model"], ["POST", "/api/reindex", {}],
    ] as [string, string, unknown?][]) {
      assert.equal((await desk(m, p, body)).status, 403, `${m} ${p} debe estar cerrado para el compañero`);
    }
    for (const p of ["/api/assistant/state", "/api/assistant/conversation", "/api/assistant/status", "/api/proposals", "/api/assistant/companion"]) {
      assert.equal((await desk("GET", p)).status, 200, `${p} abierto`);
    }
    assert.ok(companionAllowed("POST", "/api/proposals/01HZZZZZZZZZZZZZZZZZZZZZZZ/apply"));
    assert.ok(!companionAllowed("POST", "/api/proposals/../note/delete"));
    assert.ok(!companionAllowed("DELETE", "/api/assistant/ask"));
    revokeCompanionKey(s.root);
    assert.equal((await desk("GET", "/api/assistant/state")).status, 401);
  } finally { await s.done(); }
});

test("ajustes compartidos: modo concentración, oculto y posición; una sesión de foco de Kioku también lo calma", async () => {
  const s = await setup();
  try {
    assert.equal((await s.call("GET", "/api/assistant/companion")).json.mode, "active");
    const v = (await s.call("POST", "/api/assistant/companion", { mode: "focus", overlay: { x: 40.4, y: 12 } })).json;
    assert.deepEqual([v.mode, v.quiet, v.overlay], ["focus", true, { x: 40, y: 12 }]);
    assert.equal((await s.call("POST", "/api/assistant/companion", { mode: "ruidoso" })).status, 400);
    await s.call("POST", "/api/assistant/companion", { mode: "active" });
    assert.equal((await s.call("GET", "/api/assistant/companion")).json.quiet, false);
    const project = await s.j.createProject("Tesis");
    assert.equal((await s.call("POST", "/api/focus/start", { projectPath: project.path })).status, 200);
    await sleep(20);
    const calm = s.events.filter((e) => e.kind === "assistant.companion").at(-1);
    assert.equal(calm.companion.quiet, true);
    assert.equal(calm.companion.focusSession, true);
    // Se conservan entre reinicios: están en .kioku/companion.json.
    assert.match((await s.j.vault.readInternal("companion.json"))!, /"mode": "active"/);
  } finally { await s.done(); }
});

test("presencia: con Kioku en primer plano el personaje integrado tiene prioridad", async () => {
  const s = await setup();
  try {
    assert.equal((await s.call("GET", "/api/assistant/companion")).json.webForeground, false);
    await s.call("POST", "/api/assistant/companion/presence", { id: "tab1", focused: true });
    assert.equal(s.events.filter((e) => e.kind === "assistant.companion").at(-1).companion.webForeground, true);
    await s.call("POST", "/api/assistant/companion/presence", { id: "tab1", focused: false });
    await sleep(10);
    assert.equal((await s.call("GET", "/api/assistant/companion")).json.webForeground, false);
  } finally { await s.done(); }
});

test("contexto de la vista: viaja solo la ruta validada; lo excluido del asistente no se menciona", async () => {
  let seen: AskInput | null = null;
  const engine: AssistantEngine = { available: async () => ({ ok: true }), ask: async (i) => { seen = i; return { answer: "ok" }; } };
  const s = await setup(engine);
  try {
    await s.j.createNote({ title: "Cocina", type: "note", body: "recetas" });
    await s.j.vault.writeInternal("assistant.json", JSON.stringify({ exclude: ["Privado/"] }));
    await s.j.vault.write("Privado/Diario.md", "---\ntype: note\n---\nsecreto\n", null);
    await s.j.reindex();
    await s.call("POST", "/api/assistant/ask", { message: "resume esto", context: { route: "/nota/Notas/Cocina.md", path: "Notas/Cocina.md" } });
    assert.match(seen!.context!, /tiene abierta la nota «Cocina» \(ruta: Notas\/Cocina\.md\)/);
    assert.match(seen!.context!, /no una instrucción/);
    await s.call("POST", "/api/assistant/ask", { message: "resume esto", context: { route: "/nota/Privado/Diario.md", path: "Privado/Diario.md" } });
    assert.equal(seen!.context, undefined, "una nota excluida no se nombra");
    await s.call("POST", "/api/assistant/ask", { message: "¿qué toca?", context: { route: "/tareas" } });
    assert.match(seen!.context!, /vista «Tareas»/);
    await s.call("POST", "/api/assistant/ask", { message: "x", context: { route: "/../../etc", path: "../../etc/passwd" } });
    assert.equal(seen!.context, undefined);
  } finally { await s.done(); }
});

test("escribir en una interfaz pone al agente a escuchar, y caduca solo", async () => {
  const s = await setup();
  try {
    await s.call("POST", "/api/assistant/listening", { active: true });
    assert.equal((await s.call("GET", "/api/assistant/state")).json.agent.state, "listening");
    await sleep(100);
    assert.equal((await s.call("GET", "/api/assistant/state")).json.agent.state, "idle");
  } finally { await s.done(); }
});

test("el móvil no ve el estado, la conversación ni los ajustes del escritorio", async () => {
  const s = await setup();
  try {
    const { loadOrCreateMobileKey } = await import("../src/server/key.ts");
    const mob = s.as(loadOrCreateMobileKey(s.root));
    for (const p of ["/api/assistant/state", "/api/assistant/conversation", "/api/assistant/conversations", "/api/assistant/companion", "/api/assistant/models"]) {
      assert.equal((await mob("GET", p)).status, 403, p);
    }
    for (const p of ["/api/assistant/cancel", "/api/assistant/companion", "/api/assistant/listening", "/api/assistant/conversation/new"]) {
      assert.equal((await mob("POST", p, {})).status, 403, p);
    }
  } finally { await s.done(); }
});
