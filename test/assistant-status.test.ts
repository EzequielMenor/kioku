import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assistantStatusLines } from "../src/cli/assistant-status.ts";
import { NativeEngine } from "../src/assistant/native-engine.ts";
import { RouterEngine } from "../src/assistant/router-engine.ts";
import type { AssistantEngine } from "../src/assistant/engine.ts";
import { tmpVault } from "./helpers.ts";

const cli = path.resolve(import.meta.dirname, "../src/cli/main.ts");

test("assistant status: informa del motor, proveedor, modelo y destino activos", async () => {
  const lines = await assistantStatusLines({
    available: async () => ({ ok: true }),
    describe: async () => ({ engine: "native", provider: "ollama", model: "qwen3:8b", origin: "http://127.0.0.1:11434", local: true }),
  });
  assert.equal(lines[0], "Asistente: listo");
  assert.match(lines[1], /Motor:\s+nativo de Kioku/);
  assert.match(lines[2], /Proveedor:\s+ollama · modelo qwen3:8b/);
  assert.match(lines[3], /Destino:\s+http:\/\/127\.0\.0\.1:11434 \(local/);
  assert.ok(!lines.join("\n").includes("Hermes"), "con Ollama no se habla de Hermes");
});

test("assistant status: un proveedor remoto por Hermes se dice tal cual, y el fallo lleva su motivo", async () => {
  const remote = await assistantStatusLines({
    available: async () => ({ ok: true }),
    describe: async () => ({ engine: "hermes", provider: "openai-codex", model: "gpt-5.5", origin: null, local: false }),
  });
  assert.match(remote[1], /Hermes Agent/);
  assert.match(remote[3], /remoto/);
  const down = await assistantStatusLines({
    available: async () => ({ ok: false, reason: "No hay respuesta de Ollama en http://mac-mini:11434" }),
    describe: async () => ({ engine: "native", provider: "ollama", model: "qwen3:8b", origin: "http://mac-mini:11434", local: true }),
  });
  assert.equal(down[0], "Asistente: no disponible — No hay respuesta de Ollama en http://mac-mini:11434");
  assert.match(down[2], /ollama/, "aunque falle, se ve qué proveedor está activo");
  // Sin proveedor resuelto (configuración rota) basta el motivo.
  assert.deepEqual(await assistantStatusLines({ available: async () => ({ ok: false, reason: "assistant.json no es JSON válido" }), describe: async () => ({ engine: "native", provider: null, model: null, origin: null, local: false }) }),
    ["Asistente: no disponible — assistant.json no es JSON válido"]);
  // Un motor que lanza no rompe la orden.
  assert.match((await assistantStatusLines({ available: async () => { throw new Error("boom"); } }))[0], /no disponible — boom/);
});

test("assistant status: con Ollama configurado usa el enrutador real y no depende de Hermes", async () => {
  const { root, cleanup } = tmpVault();
  try {
    mkdirSync(path.join(root, ".kioku"), { recursive: true });
    writeFileSync(path.join(root, ".kioku", "assistant.json"), JSON.stringify({ model: { provider: "ollama", default: "qwen3:8b", base_url: "http://127.0.0.1:11434/v1" } }));
    const calls: string[] = [];
    const fetchFn = (async (url: string | URL) => { calls.push(String(url)); return new Response(JSON.stringify({ data: [{ id: "qwen3:8b" }] }), { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;
    const hermes: AssistantEngine = { available: async () => ({ ok: false, reason: "No encuentro Hermes Agent" }), ask: async () => { throw new Error("no"); } };
    const engine = new RouterEngine({ homeDir: root, userHome: root, hermes, native: new NativeEngine({ homeDir: root, userHome: root, env: {}, fetchFn }) });
    const lines = await assistantStatusLines(engine);
    assert.equal(lines[0], "Asistente: listo", lines.join("\n"));
    assert.match(lines.join("\n"), /ollama · modelo qwen3:8b/);
    assert.match(lines.join("\n"), /local/);
    assert.ok(calls.some((u) => u.endsWith("/models")), "comprueba el endpoint real");
  } finally { cleanup(); }
});

test("kioku assistant status (CLI): con Ollama sin servidor explica el fallo del proveedor activo, no el de Hermes", () => {
  const { root, cleanup } = tmpVault();
  try {
    mkdirSync(path.join(root, ".kioku"), { recursive: true });
    // Puerto 9 (discard): nada escucha ahí.
    writeFileSync(path.join(root, ".kioku", "assistant.json"), JSON.stringify({ model: { provider: "ollama", default: "qwen3:8b", base_url: "http://127.0.0.1:9/v1" } }));
    const r = spawnSync(process.execPath, ["--no-warnings", cli, "assistant", "status"], { encoding: "utf8", env: { ...process.env, KIOKU_HOME: root, HOME: root } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Asistente: no disponible — /);
    assert.match(r.stdout, /Proveedor:\s+ollama · modelo qwen3:8b/);
    assert.ok(!/bwrap|Hermes Agent \(/.test(r.stdout.split("\n")[0]), "el motivo es del proveedor activo");
  } finally { cleanup(); }
});
