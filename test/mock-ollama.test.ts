// El Ollama simulado de la prueba de humo de macOS (scripts/mock-ollama.mjs) tiene que hablar la API que usa Kio
// (/api/chat). Esa prueba solo corre en macOS: esta lo comprueba en cualquier sistema, por el motor real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { NativeEngine } from "../src/assistant/native-engine.ts";
import { tmpVault } from "./helpers.ts";

test("el Ollama simulado de la prueba de humo responde por /api/chat y Kio crea la tarea y propone el borrado", async () => {
  const mock = spawn(process.execPath, [path.join(import.meta.dirname, "..", "scripts", "mock-ollama.mjs"), "0"], { stdio: ["ignore", "pipe", "inherit"] });
  const { root, cleanup } = tmpVault();
  try {
    const base = await new Promise<string>((ok, ko) => {
      mock.stdout.on("data", (d: Buffer) => { const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(String(d)); if (m) ok(`http://127.0.0.1:${m[1]}/v1`); });
      mock.on("exit", () => ko(new Error("el simulador no arrancó")));
    });
    const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
    writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
    mkdirSync(path.join(root, ".kioku"), { recursive: true });
    writeFileSync(path.join(root, ".kioku", "assistant.json"), JSON.stringify({ model: { provider: "ollama", default: "qwen3.5:9b", base_url: base } }));
    const j = await Kioku.open({ root });
    const engine = new NativeEngine({ homeDir: root, userHome: mkdtempSync(path.join(tmpdir(), "kioku-home-")), env: {} });
    const srv = await startServer(j, { port: 0, webDir: web, assistant: { engine }, agentState: { successMs: 30, errorMs: 30 } });
    const ask = async (message: string) => {
      const r = await fetch(`${srv.url}/api/assistant/ask`, { method: "POST", headers: { "x-kioku-key": srv.key, "content-type": "application/json" }, body: JSON.stringify({ message }) });
      return { status: r.status, json: (await r.json()) as { answer?: string; error?: string } };
    };
    try {
      const t = await ask("crea una tarea: Comprar pilas");
      assert.equal(t.status, 200, JSON.stringify(t.json));
      assert.ok(j.index.tasks({}).some((x) => x.title === "Comprar pilas"));
      await j.capture("folleto viejo");
      const b = await ask("borra la primera captura");
      assert.equal(b.status, 200, JSON.stringify(b.json));
      assert.match(b.json.answer ?? "", /aprobación/);
    } finally { await srv.close(); j.close(); }
  } finally { mock.kill(); cleanup(); }
});
