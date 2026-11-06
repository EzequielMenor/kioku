import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MODEL_OVERRIDE_FILE, ModelConfigError } from "../src/assistant/model-config.ts";
import { ModelManagement, ModelManagementError } from "../src/assistant/model-management.ts";

const SECRET = ["sk", "SENTINELA", "no", "debe", "aparecer", "9f3a1c77" + "d0b24e5a"].join("-");

/** Vault y «home del usuario» temporales: nunca se toca ~/.hermes ni un vault real. */
function setup(o: { assistant?: string; hermesYaml?: string; dotenv?: string; env?: NodeJS.ProcessEnv } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "kioku-mm-"));
  const homeDir = path.join(root, "vault");
  const userHome = path.join(root, "userhome");
  mkdirSync(path.join(homeDir, ".kioku"), { recursive: true });
  mkdirSync(path.join(userHome, ".hermes"), { recursive: true });
  if (o.assistant !== undefined) writeFileSync(path.join(homeDir, ".kioku/assistant.json"), o.assistant);
  if (o.hermesYaml !== undefined) writeFileSync(path.join(userHome, ".hermes/config.yaml"), o.hermesYaml);
  if (o.dotenv !== undefined) writeFileSync(path.join(userHome, ".hermes/.env"), o.dotenv);
  const file = path.join(homeDir, ".kioku", MODEL_OVERRIDE_FILE);
  const mm = new ModelManagement({ homeDir, userHome: () => userHome, env: o.env ?? {} });
  const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : null);
  return { root, homeDir, userHome, file, mm, read, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("estado inicial: sin override, origen por defecto, Codex sin clave, lista cerrada de proveedores", async () => {
  const s = setup();
  try {
    const st = await s.mm.state();
    assert.deepEqual(st.override, { state: "none" });
    assert.deepEqual(st.effective, { provider: "openai-codex", model: null, baseOrigin: null, apiMode: null, source: "default" });
    assert.equal(st.error, null);
    assert.deepEqual(st.credentials, { required: false, names: [], state: "not-needed" });
    assert.ok(st.providers.some((p) => p.id === "custom" && p.ownBaseUrl));
    assert.ok(st.apiModes.includes("chat_completions"));
    assert.equal(s.read(s.file), null, "leer el estado no crea nada");
  } finally { s.done(); }
});

test("guardar escribe solo assistant-model.json, lo devuelve en el estado y se resuelve como origen «ui»", async () => {
  const assistant = JSON.stringify({ exclude: ["Privado/"], model: "gpt-5.5" }, null, 4) + "\n";
  const s = setup({ assistant, hermesYaml: "model:\n  provider: deepseek\n  default: d\n", dotenv: `OPENROUTER_API_KEY=${SECRET}\n` });
  try {
    const st = await s.mm.save({ provider: "openrouter", model: "anthropic/claude-sonnet-4" });
    assert.deepEqual(st.override, { state: "ui", provider: "openrouter", model: "anthropic/claude-sonnet-4", baseUrl: null, apiMode: null, acknowledgedOrigin: null });
    assert.deepEqual(st.effective, { provider: "openrouter", model: "anthropic/claude-sonnet-4", baseOrigin: null, apiMode: null, source: "ui" });
    assert.deepEqual(st.credentials, { required: true, names: ["OPENROUTER_API_KEY"], state: "found", name: "OPENROUTER_API_KEY", source: "hermes-env" });
    assert.equal(s.read(path.join(s.homeDir, ".kioku/assistant.json")), assistant, "assistant.json (exclusiones incluidas) intacto byte a byte");
    assert.deepEqual(JSON.parse(s.read(s.file)!), { managed_by: "kioku-ui", model: { provider: "openrouter", default: "anthropic/claude-sonnet-4" } });
    assert.ok(!JSON.stringify(st).includes(SECRET) && !s.read(s.file)!.includes(SECRET), "ni la clave ni su valor salen del .env");
    assert.deepEqual(readdirSync(path.join(s.homeDir, ".kioku")).sort(), [MODEL_OVERRIDE_FILE, "assistant.json"], "escritura atómica: sin temporales");
  } finally { s.done(); }
});

test("guardar acepta campos vacíos como ausentes y reemplaza el override anterior", async () => {
  const s = setup();
  try {
    await s.mm.save({ provider: "custom", model: "llama3", base_url: "http://localhost:11434/v1", api_mode: "chat_completions" });
    const st = await s.mm.save({ provider: "anthropic", model: "", base_url: null, api_mode: "", confirm_origin: "" });
    assert.deepEqual(st.override, { state: "ui", provider: "anthropic", model: null, baseUrl: null, apiMode: null, acknowledgedOrigin: null });
    assert.deepEqual(JSON.parse(s.read(s.file)!), { managed_by: "kioku-ui", model: { provider: "anthropic" } });
  } finally { s.done(); }
});

test("custom local se guarda sin confirmación; el estado solo muestra el origen del destino", async () => {
  const s = setup();
  try {
    const st = await s.mm.save({ provider: "custom", model: "llama3.1", base_url: "http://localhost:11434/v1/", api_mode: "chat_completions" });
    assert.equal(st.effective?.baseOrigin, "http://localhost:11434");
    assert.deepEqual(st.credentials, { required: false, names: ["OPENAI_API_KEY"], state: "local-keyless" });
    assert.equal(st.override.state === "ui" && st.override.baseUrl, "http://localhost:11434/v1/");
  } finally { s.done(); }
});

test("destino remoto: sin confirmar o con otro origen se rechaza sin cambios; con el origen exacto se guarda y se registra", async () => {
  const s = setup();
  try {
    const body = { provider: "custom", model: "m", base_url: "https://llm.example.com/v1" };
    for (const confirm_origin of [undefined, "", "https://otro.example.com", "https://llm.example.com/", "http://llm.example.com", "HTTPS://LLM.EXAMPLE.COM"]) {
      await assert.rejects(s.mm.save({ ...body, confirm_origin }), (e: Error) => e instanceof ModelConfigError && e.message.includes("https://llm.example.com") && /OPENAI_API_KEY/.test(e.message));
      assert.equal(s.read(s.file), null);
    }
    const st = await s.mm.save({ ...body, confirm_origin: "https://llm.example.com" });
    assert.equal(st.effective?.baseOrigin, "https://llm.example.com");
    assert.equal(JSON.parse(s.read(s.file)!).acknowledged_origin, "https://llm.example.com");
    // Cambiar a otro host remoto exige una confirmación nueva: la anterior no vale.
    await assert.rejects(s.mm.save({ ...body, base_url: "https://nuevo.example.org/v1", confirm_origin: "https://llm.example.com" }), ModelConfigError);
    assert.equal(JSON.parse(s.read(s.file)!).model.base_url, "https://llm.example.com/v1");
  } finally { s.done(); }
});

test("entradas inválidas: se rechazan sin repetir lo recibido y sin tocar override ni assistant.json", async () => {
  const assistant = '{"exclude":["Privado/"]}';
  const s = setup({ assistant });
  try {
    await s.mm.save({ provider: "openrouter", model: "a/b" });
    const before = s.read(s.file);
    const bad: unknown[] = [
      null, [], "texto", 7,
      {}, { provider: "no-existe" }, { provider: SECRET },
      { provider: "openrouter", api_key: SECRET }, { provider: "openrouter", token: SECRET }, { provider: "openrouter", password: SECRET },
      { provider: "openrouter", [SECRET]: "x" }, { provider: "openrouter", inherit: true },
      { provider: "openrouter", model: SECRET }, { provider: "openrouter", model: `a b ${SECRET}` }, { provider: "openrouter", model: 12 },
      { provider: "openrouter", api_mode: SECRET }, { provider: "openrouter", base_url: "https://x.example.com/v1" },
      { provider: "custom" }, { provider: "custom", base_url: "not a url" }, { provider: "custom", base_url: 5 },
      { provider: "custom", base_url: `https://usuario:${SECRET}@llm.example.com/v1`, confirm_origin: "https://llm.example.com" },
      { provider: "custom", base_url: `https://llm.example.com/v1?api_key=${SECRET}`, confirm_origin: "https://llm.example.com" },
      { provider: "custom", base_url: "https://llm.example.com/v1#frag", confirm_origin: "https://llm.example.com" },
      { provider: "custom", base_url: "http://llm.example.com/v1", confirm_origin: "http://llm.example.com" },
      { provider: "custom", base_url: "http://localhost:1/v1", confirm_origin: "http://localhost:1" },
      { provider: "anthropic", confirm_origin: "https://llm.example.com" },
      { provider: "custom", base_url: "https://llm.example.com/v1", confirm_origin: true },
    ];
    for (const input of bad) {
      await assert.rejects(s.mm.save(input), (e: Error) => {
        assert.ok(e instanceof ModelConfigError, JSON.stringify(input));
        assert.ok(!e.message.includes(SECRET), `no repite lo recibido: ${JSON.stringify(input)}`);
        return true;
      });
      assert.equal(s.read(s.file), before, "el override no cambia");
      assert.equal(s.read(path.join(s.homeDir, ".kioku/assistant.json")), assistant);
    }
    assert.deepEqual(readdirSync(path.join(s.homeDir, ".kioku")).sort(), [MODEL_OVERRIDE_FILE, "assistant.json"]);
  } finally { s.done(); }
});

test("restablecer (heredar) borra solo el override propio y devuelve la configuración anterior; es idempotente", async () => {
  const assistant = '{"exclude":["Privado/"],"model":"gpt-5.5"}';
  const s = setup({ assistant });
  try {
    await s.mm.save({ provider: "anthropic", model: "claude-x" });
    const st = await s.mm.reset();
    assert.deepEqual(st.override, { state: "none" });
    assert.deepEqual(st.effective, { provider: "openai-codex", model: "gpt-5.5", baseOrigin: null, apiMode: null, source: "assistant.json" });
    assert.equal(s.read(s.file), null);
    assert.equal(s.read(path.join(s.homeDir, ".kioku/assistant.json")), assistant);
    assert.deepEqual((await s.mm.reset()).override, { state: "none" });
  } finally { s.done(); }
});

test("un fichero que no es de la interfaz (ajeno, enlace) no se sobrescribe ni se borra: conflicto accionable", async () => {
  const s = setup();
  try {
    const foreign = '{ "model": "mio" } // hecho a mano';
    writeFileSync(s.file, foreign);
    for (const op of [() => s.mm.save({ provider: "openrouter" }), () => s.mm.reset()]) {
      await assert.rejects(op(), (e: Error) => e instanceof ModelManagementError && /assistant-model\.json/.test(e.message));
      assert.equal(s.read(s.file), foreign);
    }
    rmSync(s.file);
    writeFileSync(path.join(s.root, "objetivo.json"), '{"managed_by":"kioku-ui","model":{"provider":"openrouter"}}');
    symlinkSync(path.join(s.root, "objetivo.json"), s.file);
    await assert.rejects(s.mm.save({ provider: "anthropic" }), ModelManagementError);
    await assert.rejects(s.mm.reset(), ModelManagementError);
    assert.equal(readFileSync(path.join(s.root, "objetivo.json"), "utf8"), '{"managed_by":"kioku-ui","model":{"provider":"openrouter"}}');
  } finally { s.done(); }
});

test("override propio pero inválido: el estado falla cerrado con el error, y guardar o restablecer lo repara", async () => {
  const s = setup({ assistant: '{"model":"gpt-5.5"}' });
  try {
    writeFileSync(s.file, JSON.stringify({ managed_by: "kioku-ui", model: { provider: "custom", base_url: "https://llm.example.com/v1" } }));
    let st = await s.mm.state();
    assert.equal(st.override.state, "invalid");
    assert.match((st.override as { error: string }).error, /assistant-model\.json/);
    assert.equal(st.effective, null);
    assert.match(st.error!, /assistant-model\.json/);
    assert.equal(st.credentials, null);
    st = await s.mm.reset();
    assert.deepEqual(st.override, { state: "none" });
    assert.equal(st.effective?.source, "assistant.json");
    writeFileSync(s.file, '{"managed_by":"kioku-ui","model":{"provider":"nope"}}');
    assert.equal((await s.mm.save({ provider: "gemini" })).override.state, "ui");
  } finally { s.done(); }
});

test("override ajeno inválido: el estado lo marca inválido (falla cerrado) sin ofrecer borrarlo", async () => {
  const s = setup();
  try {
    writeFileSync(s.file, "no es json " + SECRET);
    const st = await s.mm.state();
    assert.equal(st.override.state, "invalid");
    assert.ok(!JSON.stringify(st).includes(SECRET));
    assert.equal(st.effective, null);
  } finally { s.done(); }
});

test("el estado explica errores del resto de la configuración sin secretos (config de Hermes rota, clave ausente)", async () => {
  const s = setup({ hermesYaml: "model: [sin cerrar\n" });
  try {
    const st = await s.mm.state();
    assert.equal(st.effective, null);
    assert.match(st.error!, /config\.yaml/);
    const ok = await s.mm.save({ provider: "deepseek" });
    assert.deepEqual(ok.credentials, { required: true, names: ["DEEPSEEK_API_KEY"], state: "missing" });
  } finally { s.done(); }
});

test("guardados concurrentes se serializan: el fichero final es siempre una selección completa y válida", async () => {
  const s = setup();
  try {
    const picks = ["openrouter", "anthropic", "gemini", "deepseek", "zai"].map((provider) => ({ provider, model: `m-${provider}` }));
    await Promise.all(picks.map((p) => s.mm.save(p)));
    const final = JSON.parse(s.read(s.file)!);
    assert.ok(picks.some((p) => p.provider === final.model.provider && final.model.default === p.model));
    assert.deepEqual(readdirSync(path.join(s.homeDir, ".kioku")), [MODEL_OVERRIDE_FILE]);
  } finally { s.done(); }
});

test("el home del usuario es el inyectado: nunca se lee el ~/.hermes real", async () => {
  const s = setup({ hermesYaml: "model:\n  provider: openrouter\n  default: x/inyectado\n" });
  try {
    assert.equal((await s.mm.state()).effective?.model, "x/inyectado");
  } finally { s.done(); }
});
