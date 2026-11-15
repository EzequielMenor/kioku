import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { NativeEngine, inlineToolCalls, readCompletionStream, stripThinking } from "../src/assistant/native-engine.ts";
import { RouterEngine, readEngineChoice } from "../src/assistant/router-engine.ts";
import { isTailnetHost } from "../src/assistant/model-config.ts";
import type { AssistantEngine } from "../src/assistant/engine.ts";
import { tmpVault } from "./helpers.ts";

type Reply = { content?: string; tool_calls?: { name: string; args: unknown }[]; chunks?: string[]; status?: number; error?: string; hang?: boolean; drop?: boolean; delayMs?: number };

/** Servidor «chat completions» de mentira: cada petición consume la siguiente respuesta programada. */
async function fakeModel(script: Reply[], o: { models?: string[] } = {}) {
  const requests: any[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ data: (o.models ?? ["qwen-test"]).map((id) => ({ id })) })); }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const r = script.shift() ?? { content: "(sin guion)" };
    if (r.hang) return; // nunca responde
    if (r.delayMs) await new Promise((x) => setTimeout(x, r.delayMs));
    if (r.status) { res.writeHead(r.status, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: r.error ?? "fallo" } })); }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: object, finish: string | null = null) => res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`);
    for (const piece of r.chunks ?? (r.content ? [r.content] : [])) send({ content: piece });
    if (r.drop) return res.destroy(); // el modelo se reinicia a mitad de la respuesta
    (r.tool_calls ?? []).forEach((t, index) => {
      const a = JSON.stringify(t.args);
      send({ tool_calls: [{ index, id: `call_${index}`, function: { name: t.name, arguments: a.slice(0, 5) } }] });
      send({ tool_calls: [{ index, function: { arguments: a.slice(5) } }] });
    });
    send({}, r.tool_calls ? "tool_calls" : "stop");
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/v1`, requests, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

async function setup(script: Reply[], o: { engineOpts?: object; models?: string[]; model?: string } = {}) {
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  const userHome = mkdtempSync(path.join(tmpdir(), "kioku-home-"));
  const model = await fakeModel(script, { models: o.models });
  mkdirSync(path.join(root, ".kioku"), { recursive: true });
  writeFileSync(path.join(root, ".kioku", "assistant.json"), JSON.stringify({ model: { provider: "custom", default: o.model ?? "qwen-test", base_url: model.url } }));
  const j = await Kioku.open({ root });
  const engine = new NativeEngine({ homeDir: root, userHome, env: {}, retryDelayMs: [10, 10], ...o.engineOpts });
  const srv = await startServer(j, { port: 0, webDir: web, assistant: { engine }, agentState: { successMs: 30, errorMs: 30 } });
  const ask = async (message: string, extra: object = {}) => {
    const r = await fetch(`${srv.url}/api/assistant/ask`, { method: "POST", headers: { "x-kioku-key": srv.key, "content-type": "application/json" }, body: JSON.stringify({ message, ...extra }) });
    return { status: r.status, json: (await r.json()) as any };
  };
  return { j, srv, root, model, engine, ask, done: async () => { await srv.close(); await model.close(); j.close(); cleanup(); } };
}

test("flujo de texto: oculta el razonamiento <think> aunque la etiqueta llegue partida y acumula las llamadas a herramientas", async () => {
  const enc = new TextEncoder();
  const lines = [
    { delta: { content: "<thi" } }, { delta: { content: "nk>dudo</th" } }, { delta: { content: "ink>Hola" } }, { delta: { content: " mundo" } },
    { delta: { tool_calls: [{ index: 0, id: "a", function: { name: "search", arguments: '{"que' } }] } },
    { delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"x"}' } }] } },
  ];
  async function* body() { for (const l of lines) yield enc.encode(`data: ${JSON.stringify({ choices: [l] })}\n\n`); yield enc.encode("data: [DONE]\n\n"); }
  let seen = "";
  const r = await readCompletionStream(body(), { text: (t) => (seen += t) });
  assert.equal(seen, "Hola mundo");
  assert.equal(stripThinking(r.content), "Hola mundo");
  assert.deepEqual(r.toolCalls, [{ id: "a", type: "function", function: { name: "search", arguments: '{"query":"x"}' } }]);
});

test("un modelo pequeño que escribe <tool_call> en el texto también se entiende", () => {
  const calls = inlineToolCalls('Voy a buscar.\n<tool_call>\n{"name": "search", "arguments": {"query": "leche"}}\n</tool_call>');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "search");
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { query: "leche" });
});

test("el motor nativo ejecuta herramientas reales de Kioku y responde con el resultado", async () => {
  const s = await setup([
    { tool_calls: [{ name: "create_task", args: { title: "Comprar leche" } }] },
    { chunks: ["He creado ", "la tarea."] },
  ]);
  try {
    const r = await s.ask("crea una tarea: comprar leche");
    assert.equal(r.status, 200);
    assert.equal(r.json.answer, "He creado la tarea.");
    assert.equal(r.json.actions.length, 1, "la acción queda con su Deshacer");
    assert.ok(s.j.index.tasks({}).some((t) => t.title === "Comprar leche"), "la tarea existe de verdad en el vault");
    // El modelo solo recibe herramientas de Kioku, y el resultado de la herramienta vuelve en la segunda vuelta.
    const names = s.model.requests[0].tools.map((t: any) => t.function.name);
    assert.ok(names.includes("create_task") && names.includes("propose") && names.includes("remember"));
    assert.ok(!names.some((n: string) => /shell|exec|terminal|bash|file/i.test(n)), "no hay herramientas de sistema");
    const second = s.model.requests[1].messages;
    assert.equal(second.at(-1).role, "tool");
    assert.match(second.at(-1).content, /Tareas\/Comprar leche\.md/);
    assert.match(second[0].content, /Asistente de Kioku/);
  } finally { await s.done(); }
});

test("una herramienta inventada o con argumentos rotos vuelve al modelo como error, sin ejecutar nada", async () => {
  const s = await setup([
    { tool_calls: [{ name: "run_shell", args: { cmd: "rm -rf ~" } }] },
    { content: "No puedo hacer eso." },
  ]);
  try {
    const r = await s.ask("borra mi disco");
    assert.equal(r.status, 200);
    assert.match(s.model.requests[1].messages.at(-1).content, /no existe/);
    assert.equal(r.json.actions.length, 0);
  } finally { await s.done(); }
});

test("lo destructivo sale como propuesta: el agente queda esperando confirmación hasta que el usuario decide", async () => {
  const path0 = "Bandeja/Idea vieja.md";
  const s = await setup([{ tool_calls: [{ name: "propose", args: { title: "Descartar idea", rationale: "Lo pidió", ops: [{ op: "trash", path: path0 }] } }] }, { content: "Queda una propuesta." }]);
  try {
    await s.j.capture("Idea vieja");
    assert.equal(s.j.inbox()[0].path, path0);
    const r = await s.ask("borra la idea vieja");
    assert.equal(r.status, 200);
    assert.equal(r.json.message.proposals.length, 1);
    assert.ok(s.j.vault.exists(path0), "nada se borra sin aprobación");
    assert.equal(s.srv.companion.agent.snapshot().state, "awaiting_confirmation");
    const id = r.json.message.proposals[0].id;
    const ap = await fetch(`${s.srv.url}/api/proposals/${id}/apply`, { method: "POST", headers: { "x-kioku-key": s.srv.key, "content-type": "application/json" }, body: "{}" });
    assert.equal(ap.status, 200);
    await new Promise((x) => setTimeout(x, 30));
    assert.equal(s.srv.companion.agent.snapshot().state, "idle");
    assert.ok(!s.j.vault.exists(path0), "aplicada tras confirmar");
  } finally { await s.done(); }
});

test("reinicio del modelo a mitad de respuesta: reintenta la misma vuelta y termina bien", async () => {
  const s = await setup([{ chunks: ["Empiezo a"], drop: true }, { content: "Respuesta completa." }]);
  try {
    const events: any[] = [];
    s.j.bus.on("change", (e: any) => { if (e.kind === "assistant.delta") events.push(e); });
    const r = await s.ask("hola");
    assert.equal(r.status, 200);
    assert.equal(r.json.answer, "Respuesta completa.");
    assert.equal(s.model.requests.length, 2);
    assert.ok(events.some((e) => e.reset), "el texto parcial se descarta en la interfaz al reintentar");
  } finally { await s.done(); }
});

test("errores 5xx se reintentan; un 4xx se explica sin reintentar", async () => {
  const s = await setup([{ status: 503, error: "loading model" }, { content: "Ya estoy." }, { status: 400, error: "registry.ollama.ai/x does not support tools" }]);
  try {
    assert.equal((await s.ask("hola")).json.answer, "Ya estoy.");
    const bad = await s.ask("otra");
    assert.equal(bad.status, 502);
    assert.match(bad.json.error, /no admite herramientas/);
    assert.equal(s.model.requests.length, 3);
    // El fallo queda en la conversación compartida y el estado pasa por «error».
    const conv = await s.srv.companion.conversation();
    assert.equal(conv.messages.at(-1)!.error, true);
  } finally { await s.done(); }
});

test("un modelo que no contesta se corta por tiempo de espera con un mensaje accionable", async () => {
  const s = await setup([{ hang: true }], { engineOpts: { firstByteMs: 120, retries: 0 } });
  try {
    const r = await s.ask("hola");
    assert.equal(r.status, 502);
    assert.match(r.json.error, /no empezó a responder a tiempo/);
  } finally { await s.done(); }
});

test("servidor del modelo apagado: el estado lo dice antes de preguntar y la consulta no llega a abrirse", async () => {
  const s = await setup([]);
  try {
    await s.model.close();
    const st = await s.engine.available();
    assert.equal(st.ok, false);
    assert.match(st.reason!, /rechaza la conexión|no responde|No pude hablar/);
    const r = await s.ask("hola");
    assert.equal(r.status, 503);
  } finally { await s.done(); }
});

test("si el modelo configurado no está en el servidor, se dice cuál falta y cuáles hay", async () => {
  const s = await setup([], { models: ["llama-otro"], model: "qwen-test" });
  try {
    const st = await s.engine.available();
    assert.equal(st.ok, false);
    assert.match(st.reason!, /qwen-test.*no está disponible.*llama-otro/s);
    assert.deepEqual(await s.engine.models(), ["llama-otro"]);
  } finally { await s.done(); }
});

test("cancelar corta la generación en curso", async () => {
  const s = await setup([{ content: "tarde", delayMs: 1500 }], { engineOpts: { retries: 0 } });
  try {
    const pending = s.ask("hola");
    await new Promise((x) => setTimeout(x, 150));
    const c = await fetch(`${s.srv.url}/api/assistant/cancel`, { method: "POST", headers: { "x-kioku-key": s.srv.key, "content-type": "application/json" }, body: "{}" });
    assert.equal(((await c.json()) as any).cancelled, 1);
    const r = await pending;
    assert.equal(r.status, 502);
    assert.match(r.json.error, /cancelada/i);
  } finally { await s.done(); }
});

test("la conversación se recuerda entre consultas y la memoria «remember» queda en texto visible", async () => {
  const s = await setup([
    { tool_calls: [{ name: "remember", args: { text: "Prefiere respuestas breves" } }] }, { content: "Anotado." },
    { content: "Sí, lo recuerdo." },
  ]);
  try {
    await s.ask("recuerda que prefiero respuestas breves", { conversation: "c1" });
    await s.ask("¿lo recuerdas?", { conversation: "c1" });
    const third = s.model.requests[2].messages;
    assert.deepEqual(third.slice(1).map((m: any) => m.role), ["user", "assistant", "user"], "el historial viaja en la siguiente consulta");
    assert.match(third[0].content, /Prefiere respuestas breves/, "la memoria entra en las instrucciones");
    assert.match(readFileSync(path.join(s.root, ".kioku/hermes/memories/KIOKU.md"), "utf8"), /- Prefiere respuestas breves/);
  } finally { await s.done(); }
});

test("enrutador: Ollama y custom van por el motor nativo, Codex por Hermes; «engine» lo fija y un valor raro falla cerrado", async () => {
  const { root, cleanup } = tmpVault();
  const userHome = mkdtempSync(path.join(tmpdir(), "kioku-home-"));
  mkdirSync(path.join(root, ".kioku"), { recursive: true });
  const hermes: AssistantEngine = { isolatesMobile: true, available: async () => ({ ok: true }), ask: async () => ({ answer: "hermes" }) };
  const native = new NativeEngine({ homeDir: root, userHome, env: {} });
  const router = new RouterEngine({ homeDir: root, userHome, hermes, native });
  const cfg = (o: object) => writeFileSync(path.join(root, ".kioku", "assistant.json"), JSON.stringify(o));
  try {
    assert.equal(((await router.pick()) as any).name, "hermes", "sin configuración: Codex por Hermes, como siempre");
    cfg({ model: { provider: "ollama", default: "qwen3:8b" } });
    assert.equal(((await router.pick()) as any).name, "native");
    cfg({ engine: "hermes", model: { provider: "ollama", default: "qwen3:8b" } });
    assert.equal(((await router.pick()) as any).name, "hermes");
    cfg({ engine: "native" });
    assert.match(((await router.pick()) as any).reason, /no atiende el proveedor/);
    cfg({ engine: "lo-que-sea" });
    await assert.rejects(readEngineChoice(root), /engine/);
    assert.equal((await router.available()).ok, false);
  } finally { cleanup(); }
});

test("tailnet: http solo hacia localhost o hacia equipos de Tailscale (100.64/10 y *.ts.net)", () => {
  assert.ok(isTailnetHost("100.101.102.103"));
  assert.ok(isTailnetHost("mac-mini.tu-tailnet.ts.net"));
  assert.ok(!isTailnetHost("100.63.0.1"));
  assert.ok(!isTailnetHost("100.128.0.1"));
  assert.ok(!isTailnetHost("192.168.1.10"));
  assert.ok(!isTailnetHost("evil-ts.net.example.com"));
});
