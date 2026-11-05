import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { mobileAllowed } from "../src/server/mobile.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { HermesEngine, type AssistantEngine } from "../src/assistant/engine.ts";
import { FakeEngine } from "../src/assistant/fake-engine.ts";
import { MODEL_OVERRIDE_FILE } from "../src/assistant/model-config.ts";
import { tmpVault } from "./helpers.ts";

const KEY = "b".repeat(64);
const SECRET = ["sk", "SENTINELA", "no", "debe", "aparecer", "9f3a1c77" + "d0b24e5a"].join("-");
const ENV_SECRET = ["sk", "or", "DEL", "ENV", "no", "debe", "salir", "12345678" + "90abcdef"].join("-");
const ASSISTANT_JSON = JSON.stringify({ exclude: ["Privado/"], model: "gpt-5.5" }, null, 2) + "\n";

/** Vault, web y «home del usuario» temporales; el motor real de Hermes solo con binarios de mentira que nunca se lanzan. */
async function setup(o: { engine?: "hermes" | "fake" | "none"; assistant?: string | null; dotenv?: string } = {}) {
  const { root, cleanup } = tmpVault({ "Privado/Secreto.md": "---\nid: 01HXAAAAAAAAAAAAAAAAAAAAAA\ncreated: 2026-10-27T00:00:00.000Z\ntype: note\n---\nreservado\n" });
  const base = mkdtempSync(path.join(tmpdir(), "kioku-mgmt-"));
  const web = path.join(base, "web");
  const userHome = path.join(base, "userhome");
  mkdirSync(web);
  mkdirSync(path.join(userHome, ".hermes/hermes-agent/venv/bin"), { recursive: true });
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  writeFileSync(path.join(userHome, ".hermes/hermes-agent/venv/bin/hermes"), "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(path.join(userHome, ".hermes/auth.json"), "{}");
  writeFileSync(path.join(userHome, ".hermes/.env"), o.dotenv ?? `OPENROUTER_API_KEY=${ENV_SECRET}\n`);
  mkdirSync(path.join(root, ".kioku"), { recursive: true });
  if (o.assistant !== null) writeFileSync(path.join(root, ".kioku/assistant.json"), o.assistant ?? ASSISTANT_JSON);
  let spawned = 0;
  const hermes = new HermesEngine({
    homeDir: root, userHome, bwrapBin: "/usr/bin/env", platform: "linux", env: {},
    spawnFn: (() => { spawned++; const c = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill(): void }; c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.kill = () => undefined; setImmediate(() => { c.stdout.end("Ok."); c.emit("close", 0); }); return c; }) as never,
  });
  const engine: AssistantEngine | undefined = o.engine === "fake" ? new FakeEngine() : o.engine === "none" ? undefined : hermes;
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: web, key: KEY, assistant: engine ? { engine } : undefined });
  const mobileKey = loadOrCreateMobileKey(root);
  const call = async (method: string, p: string, body?: unknown, key: string | null = KEY, headers: Record<string, string> = {}) => {
    const r = await fetch(srv.url + p, {
      method, headers: { ...(key ? { "x-kioku-key": key } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() as any };
  };
  const file = path.join(root, ".kioku", MODEL_OVERRIDE_FILE);
  const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : null);
  const internal = () => readdirSync(path.join(root, ".kioku")).sort();
  return { j, srv, root, userHome, call, file, read, internal, mobileKey, spawned: () => spawned, done: async () => { await srv.close(); j.close(); cleanup(); rmSync(base, { recursive: true, force: true }); } };
}

const URL_MODEL = "/api/assistant/model";

test("gestión API (rol completo): estado → guardar → releer → heredar, con requisitos detectados", async () => {
  const s = await setup();
  try {
    const first = await s.call("GET", URL_MODEL);
    assert.equal(first.status, 200);
    assert.deepEqual(first.json.override, { state: "none" });
    assert.deepEqual(first.json.effective, { provider: "openai-codex", model: "gpt-5.5", baseOrigin: null, apiMode: null, source: "assistant.json" });
    assert.deepEqual(first.json.readiness, { ok: true });
    assert.ok(first.json.providers.length >= 9 && first.json.apiModes.length === 3);

    const put = await s.call("PUT", URL_MODEL, { provider: "openrouter", model: "anthropic/claude-sonnet-4" });
    assert.equal(put.status, 200);
    assert.deepEqual(put.json.effective, { provider: "openrouter", model: "anthropic/claude-sonnet-4", baseOrigin: null, apiMode: null, source: "ui" });
    assert.deepEqual(put.json.credentials, { required: true, names: ["OPENROUTER_API_KEY"], state: "found", name: "OPENROUTER_API_KEY", source: "hermes-env" });
    assert.equal(put.json.readiness.ok, true);
    assert.deepEqual(JSON.parse(s.read(s.file)!), { managed_by: "kioku-ui", model: { provider: "openrouter", default: "anthropic/claude-sonnet-4" } });
    assert.deepEqual((await s.call("GET", URL_MODEL)).json, put.json, "releer devuelve lo guardado");
    assert.equal(s.read(path.join(s.root, ".kioku/assistant.json")), ASSISTANT_JSON, "assistant.json intacto");

    const reset = await s.call("PUT", URL_MODEL, { inherit: true });
    assert.equal(reset.status, 200);
    assert.deepEqual(reset.json.override, { state: "none" });
    assert.equal(reset.json.effective.source, "assistant.json");
    assert.equal(s.read(s.file), null);
    assert.equal(s.read(path.join(s.root, ".kioku/assistant.json")), ASSISTANT_JSON);
    assert.equal(s.spawned(), 0, "gestionar el modelo no lanza Hermes ni Docker");
  } finally { await s.done(); }
});

test("gestión API: ni el valor de la clave del .env ni el de ninguna entrada aparecen en respuestas ni en disco", async () => {
  const s = await setup();
  try {
    const responses = [
      await s.call("GET", URL_MODEL),
      await s.call("PUT", URL_MODEL, { provider: "openrouter", model: "a/b" }),
      await s.call("PUT", URL_MODEL, { provider: "openrouter", api_key: SECRET }),
      await s.call("PUT", URL_MODEL, { provider: "openrouter", model: SECRET }),
      await s.call("PUT", URL_MODEL, { provider: SECRET }),
      await s.call("PUT", URL_MODEL, { provider: "custom", base_url: `https://u:${SECRET}@llm.example.com/v1` }),
      await s.call("PUT", URL_MODEL, { provider: "custom", base_url: `https://llm.example.com/v1?key=${SECRET}`, confirm_origin: "https://llm.example.com" }),
    ];
    assert.deepEqual(responses.map((r) => r.status), [200, 200, 400, 400, 400, 400, 400]);
    for (const r of responses) assert.ok(!r.text.includes(SECRET) && !r.text.includes(ENV_SECRET), r.text);
    assert.ok(!s.read(s.file)!.includes(SECRET));
    assert.match(responses[2].json.error, /clave/);
  } finally { await s.done(); }
});

test("gestión API: destino remoto exige confirmar el origen exacto; sin él o con otro, 400 con aviso y nada cambia", async () => {
  const s = await setup({ dotenv: "OPENAI_API_KEY=sk-x-remoto\n" });
  try {
    const body = { provider: "custom", model: "m", base_url: "https://llm.example.com/v1" };
    for (const confirm_origin of [undefined, "", "https://otro.example.com", "https://llm.example.com/"]) {
      const r = await s.call("PUT", URL_MODEL, { ...body, confirm_origin });
      assert.equal(r.status, 400);
      assert.match(r.json.error, /https:\/\/llm\.example\.com/);
      assert.match(r.json.error, /OPENAI_API_KEY/);
      assert.equal(s.read(s.file), null);
    }
    const ok = await s.call("PUT", URL_MODEL, { ...body, confirm_origin: "https://llm.example.com" });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.effective.baseOrigin, "https://llm.example.com");
    assert.equal(ok.json.credentials.state, "found");
    const before = s.read(s.file);
    const other = await s.call("PUT", URL_MODEL, { ...body, base_url: "https://nuevo.example.org/v1", confirm_origin: "https://llm.example.com" });
    assert.equal(other.status, 400);
    assert.equal(s.read(s.file), before, "la confirmación de un host no sirve para otro");
  } finally { await s.done(); }
});

test("gestión API: un guardado fallido no cambia ni el override previo ni assistant.json ni deja temporales", async () => {
  const s = await setup();
  try {
    assert.equal((await s.call("PUT", URL_MODEL, { provider: "anthropic", model: "claude-x" })).status, 200);
    const files = s.internal();
    const before = s.read(s.file);
    for (const body of [{ provider: "nope" }, { provider: "openrouter", extra: 1 }, { provider: "custom" }, [] as unknown, "x" as unknown]) {
      assert.equal((await s.call("PUT", URL_MODEL, body)).status, 400);
    }
    const raw = await fetch(s.srv.url + URL_MODEL, { method: "PUT", headers: { "x-kioku-key": KEY, "content-type": "application/json" }, body: "{no es json" });
    assert.equal(raw.status, 400);
    assert.equal(s.read(s.file), before);
    assert.equal(s.read(path.join(s.root, ".kioku/assistant.json")), ASSISTANT_JSON);
    assert.deepEqual(s.internal(), files);
  } finally { await s.done(); }
});

test("gestión API: las exclusiones de assistant.json siguen vigentes tras guardar y heredar", async () => {
  const s = await setup();
  try {
    const sess = s.srv.sessions.open();
    const read = () => fetch(s.srv.url + "/api/assistant/tools/call", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${sess.token}` }, body: JSON.stringify({ name: "read_note", args: { path: "Privado/Secreto.md" } }),
    }).then((r) => r.json()) as Promise<{ isError?: boolean; text: string }>;
    assert.equal((await read()).isError, true);
    await s.call("PUT", URL_MODEL, { provider: "anthropic" });
    const after = await read();
    assert.equal(after.isError, true);
    assert.ok(!after.text.includes("reservado"));
    await s.call("PUT", URL_MODEL, { inherit: true });
    assert.equal((await read()).isError, true);
  } finally { await s.done(); }
});

test("gestión API: el rol móvil recibe 403 en leer, guardar y heredar, sin mutar nada ni filtrar metadatos", async () => {
  const s = await setup();
  try {
    await s.call("PUT", URL_MODEL, { provider: "custom", model: "modelo-privado-xyz", base_url: "http://localhost:11434/v1" });
    const before = s.read(s.file);
    const mobile = [
      await s.call("GET", URL_MODEL, undefined, s.mobileKey),
      await s.call("GET", URL_MODEL + "/", undefined, s.mobileKey),
      await s.call("PUT", URL_MODEL, { provider: "anthropic" }, s.mobileKey),
      await s.call("PUT", URL_MODEL, { inherit: true }, s.mobileKey),
      await s.call("POST", URL_MODEL, { provider: "anthropic" }, s.mobileKey),
      await s.call("DELETE", URL_MODEL, {}, s.mobileKey),
    ];
    for (const r of mobile) {
      assert.equal(r.status, 403, r.text);
      assert.deepEqual(Object.keys(r.json), ["error"]);
      assert.doesNotMatch(r.text, /modelo-privado-xyz|localhost|custom|openrouter|provider|OPENAI|source/i);
    }
    assert.equal(s.read(s.file), before, "el móvil no cambió nada");
    assert.equal(s.read(path.join(s.root, ".kioku/assistant.json")), ASSISTANT_JSON);
    // La lista blanca del móvil sigue cerrada para esta ruta, con cualquier método.
    for (const m of ["GET", "PUT", "POST", "DELETE", "PATCH"]) assert.equal(mobileAllowed(m, URL_MODEL), false, m);
    assert.equal(mobileAllowed("GET", "/api/assistant/status"), true, "lo que el móvil ya podía sigue igual");
    assert.equal(mobileAllowed("GET", "/api/assistant/memory"), false);
  } finally { await s.done(); }
});

test("gestión API: sin clave o solo con token Bearer de sesión → 401 sin leer ni escribir; Bearer no sustituye a la clave", async () => {
  const s = await setup();
  try {
    const sess = s.srv.sessions.open();
    const bearer = { authorization: `Bearer ${sess.token}` };
    for (const [m, body] of [["GET", undefined], ["PUT", { provider: "anthropic" }], ["PUT", { inherit: true }]] as const) {
      for (const headers of [{}, bearer]) {
        const r = await s.call(m, URL_MODEL, body, null, headers);
        assert.equal(r.status, 401);
        assert.doesNotMatch(r.text, /provider|source|openai/i);
      }
      assert.equal((await s.call(m, URL_MODEL, body, "c".repeat(64), bearer)).status, 401, "clave incorrecta + Bearer");
    }
    assert.equal(s.read(s.file), null);
    assert.equal(s.spawned(), 0);
  } finally { await s.done(); }
});

test("gestión API: un origen ajeno (CSRF) no puede cambiar el modelo aunque lleve la clave", async () => {
  const s = await setup();
  try {
    const r = await s.call("PUT", URL_MODEL, { provider: "anthropic" }, KEY, { origin: "https://evil.example.com" });
    assert.equal(r.status, 403);
    assert.equal(s.read(s.file), null);
  } finally { await s.done(); }
});

test("gestión API: otros métodos con el rol completo → 405 y sin cambios", async () => {
  const s = await setup();
  try {
    for (const m of ["POST", "DELETE"]) assert.equal((await s.call(m, URL_MODEL, { provider: "anthropic" })).status, 405);
    assert.equal(s.read(s.file), null);
  } finally { await s.done(); }
});

test("gestión API: override inválido falla cerrado en estado y en preguntas (503) y no lanza Hermes", async () => {
  const s = await setup();
  try {
    writeFileSync(s.file, `{"managed_by":"kioku-ui","model":{"provider":"openrouter","api_key":"${SECRET}"}}`);
    const st = await s.call("GET", URL_MODEL);
    assert.equal(st.status, 200);
    assert.equal(st.json.override.state, "invalid");
    assert.equal(st.json.effective, null);
    assert.equal(st.json.readiness.ok, false);
    assert.ok(!st.text.includes(SECRET));
    const status = await s.call("GET", "/api/assistant/status");
    assert.equal(status.json.ok, false);
    assert.match(status.json.reason, /assistant-model\.json/);
    const ask = await s.call("POST", "/api/assistant/ask", { message: "hola" });
    assert.equal(ask.status, 503);
    assert.ok(!ask.text.includes(SECRET));
    assert.equal(s.spawned(), 0);
    // Reparable desde la interfaz: el fichero tiene la marca propia.
    assert.equal((await s.call("PUT", URL_MODEL, { inherit: true })).status, 200);
    assert.equal(s.read(s.file), null);
  } finally { await s.done(); }
});

test("gestión API: un fichero ajeno en assistant-model.json no se pisa: 409 y queda tal cual", async () => {
  const s = await setup();
  try {
    writeFileSync(s.file, "hecho a mano");
    for (const body of [{ provider: "anthropic" }, { inherit: true }]) {
      const r = await s.call("PUT", URL_MODEL, body);
      assert.equal(r.status, 409);
      assert.match(r.json.error, /assistant-model\.json/);
    }
    assert.equal(s.read(s.file), "hecho a mano");
  } finally { await s.done(); }
});

test("gestión API: motor sin gestión (FakeEngine) o sin motor → 503 accionable, sin crear ficheros", async () => {
  for (const engine of ["fake", "none"] as const) {
    const s = await setup({ engine });
    try {
      const files = s.internal();
      for (const [m, body] of [["GET", undefined], ["PUT", { provider: "anthropic" }]] as const) {
        const r = await s.call(m, URL_MODEL, body);
        assert.equal(r.status, 503);
        assert.match(r.json.error, engine === "fake" ? /no permite gestionar el modelo/ : /no está configurado/);
      }
      assert.deepEqual(s.internal(), files);
    } finally { await s.done(); }
  }
});

test("gestión API (compatibilidad): sin override, estado del asistente y preguntas siguen como antes con assistant.json", async () => {
  const s = await setup();
  try {
    assert.deepEqual((await s.call("GET", "/api/assistant/status")).json, { ok: true });
    assert.deepEqual((await s.call("GET", "/api/assistant/status", undefined, s.mobileKey)).json.ok, true);
    const ask = await s.call("POST", "/api/assistant/ask", { message: "hola", conversation: "c" });
    assert.equal(ask.status, 200);
    assert.equal(ask.json.answer, "Ok.");
    assert.equal(s.spawned(), 1);
    assert.equal(s.read(s.file), null);
    assert.equal((await s.call("GET", "/api/session", undefined, s.mobileKey)).json.role, "mobile");
  } finally { await s.done(); }
});
