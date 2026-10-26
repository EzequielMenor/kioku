// Puente MCP (stdio) entre el agente y el daemon de JARVIS. JS plano y sin dependencias:
// corre dentro de la jaula con el Node montado. No toca ficheros: solo habla HTTP con el daemon,
// que es quien impone los niveles de autonomía (el token acota la sesión).
import readline from "node:readline";

const URL_ = (process.env.JARVIS_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.JARVIS_TOKEN ?? "";
if (!URL_ || !TOKEN) {
  process.stderr.write("jarvis-mcp: faltan JARVIS_URL o JARVIS_TOKEN\n");
  process.exit(1);
}

const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

async function daemon(method, path, body) {
  const r = await fetch(URL_ + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(json?.error ?? `El daemon respondió ${r.status}`);
  return json;
}

async function handle(m) {
  switch (m.method) {
    case "initialize":
      return { protocolVersion: m.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "jarvis", version: "1" } };
    case "ping":
      return {};
    case "tools/list": {
      const specs = await daemon("GET", "/api/assistant/tools/list");
      return { tools: specs.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
    }
    case "tools/call": {
      try {
        const r = await daemon("POST", "/api/assistant/tools/call", { name: m.params?.name, args: m.params?.arguments ?? {} });
        return { content: [{ type: "text", text: r.text }], isError: !!r.isError };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
    default:
      return undefined;
  }
}

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // notificaciones: sin respuesta
  try {
    const result = await handle(m);
    if (result === undefined) out({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `Método no soportado: ${m.method}` } });
    else out({ jsonrpc: "2.0", id: m.id, result });
  } catch (e) {
    out({ jsonrpc: "2.0", id: m.id, error: { code: -32000, message: e.message } });
  }
});
