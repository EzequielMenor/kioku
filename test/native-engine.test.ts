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

type OllamaReply = { content?: string; thinking?: string; tool_calls?: { name: string; args: unknown }[]; done_reason?: string; hang?: boolean; error?: string };

/** Ollama de mentira por su API nativa (`/api/chat`, NDJSON): la que respeta `options.num_ctx`. */
async function fakeOllama(script: OllamaReply[]) {
  const requests: any[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ data: [{ id: "qwen3.5:9b" }] })); }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    requests.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    if (req.url !== "/api/chat") { res.writeHead(404); return res.end("{}"); }
    const r = script.shift() ?? { content: "(sin guion)" };
    if (r.hang) return; // nunca responde
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    const line = (o: object) => res.write(JSON.stringify({ model: "qwen3.5:9b", ...o }) + "\n");
    if (r.error) { line({ error: r.error }); return res.end(); }
    if (r.thinking) line({ message: { role: "assistant", content: "", thinking: r.thinking }, done: false });
    for (const piece of (r.content ?? "").match(/.{1,6}/gs) ?? []) line({ message: { role: "assistant", content: piece }, done: false });
    if (r.tool_calls) line({ message: { role: "assistant", content: "", tool_calls: r.tool_calls.map((t) => ({ function: { name: t.name, arguments: t.args } })) }, done: false });
    line({ message: { role: "assistant", content: "" }, done: true, done_reason: r.done_reason ?? "stop" });
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/v1`, requests, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

async function setupOllama(script: OllamaReply[], engineOpts: object = {}) {
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  const userHome = mkdtempSync(path.join(tmpdir(), "kioku-home-"));
  const model = await fakeOllama(script);
  mkdirSync(path.join(root, ".kioku"), { recursive: true });
  writeFileSync(path.join(root, ".kioku", "assistant.json"), JSON.stringify({ model: { provider: "ollama", default: "qwen3.5:9b", base_url: model.url } }));
  const j = await Kioku.open({ root });
  const engine = new NativeEngine({ homeDir: root, userHome, env: {}, retryDelayMs: [10, 10], ...engineOpts });
  const srv = await startServer(j, { port: 0, webDir: web, assistant: { engine }, agentState: { successMs: 30, errorMs: 30 } });
  const ask = async (message: string) => {
    const r = await fetch(`${srv.url}/api/assistant/ask`, { method: "POST", headers: { "x-kioku-key": srv.key, "content-type": "application/json" }, body: JSON.stringify({ message }) });
    return { status: r.status, json: (await r.json()) as any };
  };
  return { j, srv, model, ask, done: async () => { await srv.close(); await model.close(); j.close(); cleanup(); } };
}

test("Ollama: si no entiende la llamada a herramienta que generó el modelo, repite la petición en vez de fallar", async () => {
  const s = await setupOllama([
    { error: "XML syntax error on line 3: element <function> closed by </parameter>" },
    { tool_calls: [{ name: "create_task", args: { title: "Renovar el DNI" } }] },
    { content: "Hecho." },
  ]);
  try {
    const r = await s.ask("Recuérdame renovar el DNI");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(s.j.index.listNotes({ limit: 50 }).some((n) => n.title === "Renovar el DNI"));
    assert.equal(s.model.requests.filter((q) => q.url === "/api/chat").length, 3);
  } finally { await s.done(); }
});

test("Ollama: usa su API nativa con contexto amplio (num_ctx), entiende sus llamadas a herramientas y oculta el razonamiento", async () => {
  const s = await setupOllama([
    { thinking: "debo crear la tarea", tool_calls: [{ name: "create_task", args: { title: "Renovar el DNI", due: "2026-11-30" } }] },
    { thinking: "ya está", content: "He creado la tarea «Renovar el DNI» para el 30 de noviembre." },
  ]);
  try {
    const r = await s.ask("apúntame renovar el DNI para el 30 de noviembre");
    assert.equal(r.status, 200);
    assert.equal(r.json.answer, "He creado la tarea «Renovar el DNI» para el 30 de noviembre.");
    assert.ok(s.j.index.tasks({}).some((t) => t.title === "Renovar el DNI"), "la tarea existe de verdad");
    const [first, second] = s.model.requests;
    assert.equal(first.url, "/api/chat");
    assert.ok(first.body.options.num_ctx >= 16384, "Ollama por defecto corta a 4096 tokens: el prompt de Kio no cabe");
    assert.equal(first.body.stream, true);
    const call = second.body.messages.find((m: any) => m.tool_calls);
    assert.deepEqual(call.tool_calls[0].function.arguments, { title: "Renovar el DNI", due: "2026-11-30" }, "argumentos como objeto, como los espera Ollama");
    const tool = second.body.messages.at(-1);
    assert.equal(tool.role, "tool");
    assert.equal(tool.tool_name, "create_task");
    assert.match(tool.content, /Renovar el DNI/);
  } finally { await s.done(); }
});

test("respuesta cortada por falta de contexto: se dice claramente, no «(El modelo no devolvió texto.)»", async () => {
  const s = await setupOllama([{ thinking: "Primero necesito averiguar el", done_reason: "length" }]);
  try {
    const r = await s.ask("¿por qué capítulo voy de Juan?");
    assert.doesNotMatch(JSON.stringify(r.json), /no devolvió texto/);
    assert.match(r.json.answer ?? r.json.error, /se cortó|contexto/i);
  } finally { await s.done(); }
});

test("honestidad: si afirma haber hecho algo sin ejecutar ninguna herramienta, Kioku se lo hace notar y el modelo lo hace de verdad", async () => {
  const s = await setupOllama([
    { content: "He creado una tarea «Renovar el DNI» para el 30 de noviembre." },
    { tool_calls: [{ name: "create_task", args: { title: "Renovar el DNI", due: "2026-11-30" } }] },
    { content: "Hecho: tarea «Renovar el DNI» creada en Tareas/Renovar el DNI.md." },
  ]);
  try {
    const r = await s.ask("apúntame renovar el DNI");
    assert.equal(r.status, 200);
    assert.equal(s.model.requests.length, 3);
    assert.match(JSON.stringify(s.model.requests[1].body.messages.at(-1)), /no has ejecutado ninguna herramienta/i);
    assert.ok(s.j.index.tasks({}).some((t) => t.title === "Renovar el DNI"));
    assert.equal(r.json.actions.length, 1);
    assert.match(r.json.answer, /Renovar el DNI/);
  } finally { await s.done(); }
});

test("honestidad: si insiste en afirmar un cambio que no hizo, la respuesta avisa de que no se cambió nada", async () => {
  const s = await setupOllama([
    { content: "He enviado el correo a Ramón." },
    { content: "Listo, he enviado el correo a Ramón." },
  ]);
  try {
    const r = await s.ask("mándale un correo a Ramón");
    assert.equal(r.status, 200);
    assert.equal(r.json.actions.length, 0);
    assert.match(r.json.answer, /no se ha hecho ningún cambio/i);
  } finally { await s.done(); }
});

test("honestidad: negar o preguntar no dispara el aviso («no he creado…», «¿quieres que lo guarde?»)", async () => {
  const s = await setupOllama([{ content: "No he creado ninguna tarea sobre el seguro del coche: no la encuentro." }]);
  try {
    const r = await s.ask("¿ya creaste la tarea del seguro?");
    assert.equal(s.model.requests.length, 1);
    assert.equal(r.json.answer, "No he creado ninguna tarea sobre el seguro del coche: no la encuentro.");
  } finally { await s.done(); }
});

test("sin texto final pero con cambios hechos: Kioku resume lo que de verdad se hizo", async () => {
  const s = await setupOllama([
    { tool_calls: [{ name: "create_note", args: { title: "Viaje a Asturias", body: "Covadonga" } }] },
    { thinking: "ya está", content: "" },
  ]);
  try {
    const r = await s.ask("crea una nota Viaje a Asturias con Covadonga");
    assert.equal(r.status, 200);
    assert.match(r.json.answer, /Viaje a Asturias/);
    assert.doesNotMatch(r.json.answer, /no devolvió texto/);
  } finally { await s.done(); }
});

test("detector de afirmaciones: reconoce «Creada la tarea…», «ya está apuntado», «Listo:» y no las negaciones ni las preguntas", async () => {
  const { claimsAction } = await import("../src/assistant/native-engine.ts");
  for (const yes of ["Creada la tarea «Renovar el DNI» con fecha 2026-11-30.", "Ya está apuntado en tu nota.", "Listo: tarea añadida al proyecto.", "He organizado tu bandeja.", "La nota ha sido actualizada.", "Te lo he apuntado."]) assert.ok(claimsAction(yes), yes);
  for (const no of ["No he creado ninguna tarea.", "¿Quieres que lo guarde en una nota?", "No encuentro el hábito «Correr».", "La tarea no está creada todavía.", "No tengo una herramienta para enviar correos."]) assert.ok(!claimsAction(no), no);
});

test("si se acaba el tiempo después de hacer cambios, el error dice lo que sí se hizo", async () => {
  const s = await setupOllama([
    { tool_calls: [{ name: "create_task", args: { title: "Llamar al electricista" } }] },
    { hang: true },
  ], { totalMs: 1500, firstByteMs: 500, retries: 0 });
  try {
    const r = await s.ask("organiza la bandeja");
    const text = r.json.answer ?? r.json.error;
    assert.ok(s.j.index.tasks({}).some((t) => t.title === "Llamar al electricista"));
    assert.notEqual(r.status, 200);
    assert.match(text, /Llamar al electricista/, "el error menciona el cambio ya aplicado");
  } finally { await s.done(); }
});

test("el prompt incluye un resumen breve del espacio: bases, hábitos por nombre y qué propiedad lleva el progreso", async () => {
  const s = await setupOllama([{ content: "¡Bien hecho!" }]);
  try {
    const db = await s.j.createDatabase({ name: "Hábitos", template: "hábitos" });
    for (const h of ["Ejercicio", "Meditar"]) await s.j.createRow(db.path, { title: h, props: {} });
    await s.j.createDatabase({ name: "Lectura de la Biblia", template: "biblia" });
    await s.ask("hoy he hecho ejercicio");
    const system = s.model.requests[0].body.messages[0].content as string;
    assert.match(system, /## Tu espacio/);
    assert.match(system, /Hábitos[^\n]*Ejercicio[^\n]*Meditar[^\n]*log_habit/);
    assert.match(system, /Lectura de la Biblia[^\n]*Leídos/);
  } finally { await s.done(); }
});

test("el prompt trae los próximos días con su nombre: «este viernes» no se calcula a ojo", async () => {
  const s = await setupOllama([{ content: "Vale." }], { now: () => new Date(2026, 10, 18, 9, 0) });
  try {
    await s.ask("apunta algo para este viernes");
    const system = s.model.requests[0].body.messages[0].content as string;
    assert.match(system, /mañana jueves 2026-11-19/);
    assert.match(system, /viernes 2026-11-20/);
    assert.match(system, /martes 2026-11-24/);
  } finally { await s.done(); }
});

test("una propuesta no se resume como «Hecho»: queda claro que falta tu aprobación", async () => {
  const s = await setupOllama([
    { tool_calls: [{ name: "propose", args: { title: "Borrar nota «Médico»", rationale: "lo pidió", ops: [{ op: "trash", path: "Notas/Médico.md" }] } }] },
    { content: "" },
  ]);
  try {
    await s.j.createNote({ title: "Médico", type: "note", body: "Dra. Pardo" });
    const r = await s.ask("borra la nota del médico");
    const a = r.json.answer as string;
    assert.doesNotMatch(a, /Hecho/);
    assert.match(a, /pendiente de tu aprobación/i);
    assert.match(a, /Borrar nota «Médico»/);
    assert.ok(s.j.index.getNote("Notas/Médico.md"), "la nota sigue ahí");
  } finally { await s.done(); }
});

test("el resumen de un cambio de propiedades dice qué se cambió", async () => {
  const s = await setupOllama([
    { tool_calls: [{ name: "set_props", args: { path: "Notas/Juan.md", props: { Leídos: 3 } } }] },
    { content: "" },
  ]);
  try {
    await s.j.createNote({ title: "Juan", type: "note", body: "x" });
    const r = await s.ask("he leído Juan 3");
    assert.match(r.json.answer, /Notas\/Juan\.md \(Leídos: 3\)/);
  } finally { await s.done(); }
});

test("vuelta vacía tras usar herramientas: se repite sin razonamiento (qwen3.5 a veces anuncia la acción y se para)", async () => {
  const s = await setupOllama([
    { thinking: "miro la bandeja", tool_calls: [{ name: "inbox", args: {} }] },
    { thinking: "Ahora convierto las capturas. Voy a hacerlo:", content: "" },
    { tool_calls: [{ name: "create_task", args: { title: "Llamar al electricista" } }] },
    { thinking: "hecho", content: "He creado la tarea «Llamar al electricista»." },
  ]);
  try {
    const r = await s.ask("organiza la bandeja");
    assert.equal(r.status, 200);
    const reqs = s.model.requests.map((x) => x.body);
    assert.equal(reqs[0].think, undefined, "primera vuelta: lo que decida el modelo");
    assert.equal(reqs[2].think, false, "la vuelta que se quedó vacía se repite sin razonamiento");
    assert.equal(reqs[3].think, undefined, "y después vuelve a lo normal");
    assert.ok(s.j.index.tasks({}).some((t) => t.title === "Llamar al electricista"));
  } finally { await s.done(); }
});

test("vuelta vacía sin haber leído nada: se insiste con razonamiento (sin datos, sin razonar se inventa)", async () => {
  const s = await setupOllama([
    { thinking: "veamos", content: "" },
    { thinking: "busco", tool_calls: [{ name: "list_tasks", args: {} }] },
    { content: "No tienes tareas pendientes." },
  ]);
  try {
    const r = await s.ask("¿qué tareas tengo?");
    assert.equal(r.status, 200);
    assert.equal(s.model.requests[1].body.think, undefined);
    assert.equal(r.json.answer, "No tienes tareas pendientes.");
  } finally { await s.done(); }
});

test("un cambio que Kioku convierte en propuesta (p. ej. por el límite de notas) no se cuenta como hecho", async () => {
  const calls = Array.from({ length: 7 }, (_, n) => ({ name: "create_note", args: { title: `Nota ${n}`, body: "x" } }));
  const s = await setupOllama([{ tool_calls: calls }, { content: "" }]);
  try {
    const r = await s.ask("crea siete notas");
    const a = r.json.answer as string;
    const hechas = (a.match(/Nota creada/g) ?? []).length;
    assert.equal(hechas, s.j.index.listNotes({ type: "note", limit: 50 }).length, "solo las que existen de verdad");
    assert.match(a, /Pendiente de tu aprobación/);
  } finally { await s.done(); }
});

test("si el razonamiento anuncia una herramienta de escritura y no la llama, se repite la vuelta sin razonamiento", async () => {
  const s = await setupOllama([
    { thinking: "Voy a usar create_note con estos parámetros.", content: "Crea la nota «Viaje a Asturias» con las ideas." },
    { tool_calls: [{ name: "create_note", args: { title: "Viaje a Asturias", body: "Covadonga" } }] },
    { content: "Nota «Viaje a Asturias» creada." },
  ]);
  try {
    const r = await s.ask("crea una nota Viaje a Asturias con Covadonga");
    assert.equal(s.model.requests[1].body.think, false);
    assert.ok(s.j.index.listNotes({ limit: 50 }).some((n) => n.title === "Viaje a Asturias"));
    assert.equal(r.json.answer, "Nota «Viaje a Asturias» creada.");
  } finally { await s.done(); }
});
