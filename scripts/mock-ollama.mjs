#!/usr/bin/env node
// SOLO PRUEBAS: un Ollama de mentira en 127.0.0.1 (por defecto :11434) que anuncia qwen3.5:9b y responde a
// «chat completions» en streaming pidiendo herramientas de Kioku como lo haría un modelo con tool calling:
//   «…bandeja…» → inbox → resumen · «…tarea: X» → create_task · «borra…» → inbox → propose(trash).
// Lo usa la prueba de humo de macOS para recorrer el camino real (motor nativo → Ollama → herramientas → Kio)
// sin descargar un modelo de 6 GB. Uso: node scripts/mock-ollama.mjs [puerto]
import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? 11434);
const MODEL = "qwen3.5:9b";
let calls = 0;

function sse(res, chunks) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const c of chunks) res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", model: MODEL, choices: [c] })}\n\n`);
  res.end("data: [DONE]\n\n");
}

const say = (res, text) => sse(res, [...text.split(/(?<=\s)/).map((w) => ({ index: 0, delta: { content: w } })), { index: 0, delta: {}, finish_reason: "stop" }]);
const call = (res, name, args) => sse(res, [
  { index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${++calls}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } },
  { index: 0, delta: {}, finish_reason: "tool_calls" },
]);

function chat(body, res) {
  const msgs = body.messages ?? [];
  const tools = new Set((body.tools ?? []).map((t) => t.function?.name));
  const lastUser = msgs.map((m, i) => [m, i]).filter(([m]) => m.role === "user").pop();
  const text = String(lastUser?.[0]?.content ?? "");
  const after = msgs.slice((lastUser?.[1] ?? -1) + 1);
  const calledTools = after.filter((m) => m.role === "assistant").flatMap((m) => m.tool_calls ?? []).map((c) => c.function.name);
  const lastTool = [...after].reverse().find((m) => m.role === "tool");
  let parsed = null;
  try { parsed = JSON.parse(lastTool?.content ?? "null"); } catch { /* texto */ }
  if (!body.tools) return say(res, "Listo.");
  if (/tarea/i.test(text)) {
    if (!calledTools.includes("create_task") && tools.has("create_task")) return call(res, "create_task", { title: text.replace(/.*tarea:?\s*/i, "").slice(0, 80) || "Tarea" });
    return say(res, "He creado la tarea. Si no era lo que querías, pulsa Deshacer.");
  }
  if (!calledTools.includes("inbox") && tools.has("inbox")) return call(res, "inbox", {});
  const inbox = Array.isArray(parsed) ? parsed : [];
  if (/borra|elimina/i.test(text)) {
    if (!calledTools.includes("propose") && inbox[0] && tools.has("propose")) {
      return call(res, "propose", { title: `Descartar «${inbox[0].title}»`, rationale: "Lo has pedido en el chat", ops: [{ op: "trash", path: inbox[0].path }] });
    }
    return say(res, "Borrar siempre necesita tu aprobación: te he dejado una propuesta para que la confirmes.");
  }
  return say(res, inbox.length ? `Tienes ${inbox.length} ${inbox.length === 1 ? "captura" : "capturas"} en la Bandeja:\n${inbox.map((c) => `· ${c.title}`).join("\n")}` : "La Bandeja está vacía.");
}

createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => { raw += d; });
  req.on("end", () => {
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: MODEL, model: MODEL, details: { parameter_size: "9B" } }] }));
    if (req.method === "GET" && url === "/v1/models") return res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model" }] }));
    if (req.method === "GET" && (url === "/" || url === "/api/version")) return res.end(url === "/" ? "Ollama is running" : JSON.stringify({ version: "mock" }));
    if (req.method === "POST" && url === "/v1/chat/completions") {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* vacío */ }
      return chat(body, res);
    }
    res.writeHead(404).end("{}");
  });
}).listen(PORT, "127.0.0.1", () => console.log(`mock ollama en http://127.0.0.1:${PORT} (${MODEL})`));
