import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import path from "node:path";

const BRIDGE = path.resolve("src/assistant/bridge.mjs");

async function fakeDaemon(handler: (req: http.IncomingMessage, body: string) => { status: number; json: unknown }) {
  const seen: { method: string; url: string; auth?: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
      const r = handler(req, body);
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

/** Lanza el puente, envía mensajes JSON-RPC y devuelve las respuestas por id. */
async function talk(env: Record<string, string>, messages: object[]): Promise<Map<number, any>> {
  const child = spawn(process.execPath, [BRIDGE], { env: { PATH: process.env.PATH, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  const got = new Map<number, any>();
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); got.set(m.id, m); }
  });
  for (const m of messages) child.stdin.write(JSON.stringify(m) + "\n");
  const want = (messages as { id?: number }[]).filter((m) => m.id !== undefined).length;
  for (let i = 0; i < 200 && got.size < want; i++) await new Promise((r) => setTimeout(r, 25));
  child.stdin.end();
  await new Promise((r) => child.once("close", r));
  return got;
}

test("puente: initialize, tools/list, tools/call y ping contra un daemon falso", async () => {
  const d = await fakeDaemon((req) => req.url!.endsWith("/tools/list")
    ? { status: 200, json: [{ name: "search", description: "Busca", inputSchema: { type: "object" }, level: "read" }] }
    : { status: 200, json: { text: '["Notas/A.md"]', isError: false } });
  try {
    const r = await talk({ KIOKU_URL: d.url, KIOKU_TOKEN: "t".repeat(64) }, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search", arguments: { query: "x" } } },
      { jsonrpc: "2.0", id: 4, method: "ping" },
      { jsonrpc: "2.0", id: 5, method: "resources/list" },
    ]);
    assert.equal(r.get(1).result.serverInfo.name, "kioku");
    assert.deepEqual(r.get(2).result.tools, [{ name: "search", description: "Busca", inputSchema: { type: "object" } }]);
    assert.equal(r.get(3).result.content[0].text, '["Notas/A.md"]');
    assert.equal(r.get(3).result.isError, false);
    assert.deepEqual(r.get(4).result, {});
    assert.equal(r.get(5).error.code, -32601);
    assert.ok(d.seen.every((s) => s.auth === `Bearer ${"t".repeat(64)}`));
    assert.deepEqual(JSON.parse(d.seen.find((s) => s.method === "POST")!.body), { name: "search", args: { query: "x" } });
  } finally { await d.close(); }
});

test("puente: un isError del daemon se propaga", async () => {
  const d = await fakeDaemon(() => ({ status: 200, json: { text: "Ruta no permitida", isError: true } }));
  try {
    const r = await talk({ KIOKU_URL: d.url, KIOKU_TOKEN: "a".repeat(64) }, [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_note", arguments: { path: "../x.md" } } }]);
    assert.equal(r.get(1).result.isError, true);
    assert.equal(r.get(1).result.content[0].text, "Ruta no permitida");
  } finally { await d.close(); }
});

test("puente: si el daemon responde 401 la llamada devuelve isError", async () => {
  const d = await fakeDaemon(() => ({ status: 401, json: { error: "Token de asistente ausente o caducado" } }));
  try {
    const r = await talk({ KIOKU_URL: d.url, KIOKU_TOKEN: "b".repeat(64) }, [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: {} } }]);
    assert.equal(r.get(1).result.isError, true);
    assert.match(r.get(1).result.content[0].text, /caducado/);
  } finally { await d.close(); }
});

test("puente: sin KIOKU_TOKEN sale con código 1", async () => {
  const child = spawn(process.execPath, [BRIDGE], { env: { PATH: process.env.PATH, KIOKU_URL: "http://127.0.0.1:1" }, stdio: "ignore" });
  const code = await new Promise((r) => child.once("close", r));
  assert.equal(code, 1);
});
