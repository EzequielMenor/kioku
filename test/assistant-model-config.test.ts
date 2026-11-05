import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ModelConfigError, MODEL_OVERRIDE_FILE, describeCredentials, describeModel, describeProviders, parseModelOverride, resolveModel, resolveModelSettings, resolveProviderSecrets, serializeModelOverride,
} from "../src/assistant/model-config.ts";
import { parseAssistantConfig } from "../src/assistant/policy.ts";

/** Vault y «home del usuario» temporales: nunca se toca ~/.hermes ni un vault real. */
function env(o: { assistant?: string; hermesYaml?: string; dotenv?: string } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "kioku-model-"));
  const homeDir = path.join(root, "vault");
  const userHome = path.join(root, "userhome");
  mkdirSync(path.join(homeDir, ".kioku"), { recursive: true });
  mkdirSync(path.join(userHome, ".hermes"), { recursive: true });
  if (o.assistant !== undefined) writeFileSync(path.join(homeDir, ".kioku/assistant.json"), o.assistant);
  if (o.hermesYaml !== undefined) writeFileSync(path.join(userHome, ".hermes/config.yaml"), o.hermesYaml);
  if (o.dotenv !== undefined) writeFileSync(path.join(userHome, ".hermes/.env"), o.dotenv);
  return { root, homeDir, userHome, done: () => rmSync(root, { recursive: true, force: true }) };
}

const resolve = (e: ReturnType<typeof env>) => resolveModelSettings({ homeDir: e.homeDir, userHome: e.userHome });

test("sin configuración: Codex por defecto y sin modelo fijado", async () => {
  const e = env();
  try { assert.deepEqual(await resolve(e), { provider: "openai-codex" }); } finally { e.done(); }
});

test("compatibilidad: `model` como texto en assistant.json sigue fijando solo el modelo de Codex", async () => {
  const e = env({ assistant: JSON.stringify({ model: "gpt-5.5", exclude: ["Privado/"] }) });
  try { assert.deepEqual(await resolve(e), { provider: "openai-codex", model: "gpt-5.5" }); } finally { e.done(); }
});

test("compatibilidad: model.default del config de Hermes sin provider → Codex con ese modelo (YAML con comentarios y comillas)", async () => {
  const e = env({ hermesYaml: "# mi config\nmodel:\n  default: 'gpt-5.4' # el bueno\nagent:\n  max_turns: 90\n" });
  try { assert.deepEqual(await resolve(e), { provider: "openai-codex", model: "gpt-5.4" }); } finally { e.done(); }
});

test("hereda provider/default/base_url/api_mode del config de Hermes del usuario", async () => {
  const e = env({ hermesYaml: "model:\n  provider: custom\n  default: llama3.1\n  base_url: http://localhost:11434/v1\n  api_mode: chat_completions\n  api_key: sk-no-copiar\n" });
  try {
    assert.deepEqual(await resolve(e), { provider: "custom", model: "llama3.1", baseUrl: "http://localhost:11434/v1", apiMode: "chat_completions" });
  } finally { e.done(); }
});

test("acepta `model: nombre` (forma corta de Hermes) con provider top-level inexistente → Codex", async () => {
  const e = env({ hermesYaml: "model: gpt-5.3\n" });
  try { assert.deepEqual(await resolve(e), { provider: "openai-codex", model: "gpt-5.3" }); } finally { e.done(); }
});

test("assistant.json (texto) cambia solo el modelo y conserva el provider heredado", async () => {
  const e = env({ assistant: '{"model":"anthropic/claude-x"}', hermesYaml: "model:\n  provider: openrouter\n  default: otro/modelo\n" });
  try { assert.deepEqual(await resolve(e), { provider: "openrouter", model: "anthropic/claude-x" }); } finally { e.done(); }
});

test("assistant.json (objeto) manda sobre el config de Hermes y no mezcla campos de otro provider", async () => {
  const e = env({
    assistant: JSON.stringify({ model: { provider: "openrouter", default: "openai/gpt-x" } }),
    hermesYaml: "model:\n  provider: custom\n  default: llama3\n  base_url: http://localhost:11434/v1\n  api_mode: chat_completions\n",
  });
  try { assert.deepEqual(await resolve(e), { provider: "openrouter", model: "openai/gpt-x" }); } finally { e.done(); }
});

test("assistant.json (objeto) con el mismo provider hereda base_url/api_mode que él no define", async () => {
  const e = env({
    assistant: JSON.stringify({ model: { provider: "custom", default: "qwen" } }),
    hermesYaml: "model:\n  provider: custom\n  default: llama3\n  base_url: https://llm.example.com/v1\n  api_mode: chat_completions\n",
  });
  try { assert.deepEqual(await resolve(e), { provider: "custom", model: "qwen", baseUrl: "https://llm.example.com/v1", apiMode: "chat_completions" }); } finally { e.done(); }
});

test("assistant.json con base_url propio para `custom` y api_mode válidos", async () => {
  const e = env({ assistant: JSON.stringify({ model: { provider: "custom", default: "m", base_url: "https://llm.example.com/v1", api_mode: "anthropic_messages" } }) });
  try { assert.deepEqual(await resolve(e), { provider: "custom", model: "m", baseUrl: "https://llm.example.com/v1", apiMode: "anthropic_messages" }); } finally { e.done(); }
});

test("no hace falta leer el config de Hermes si assistant.json lo define todo (aunque esté roto)", async () => {
  const e = env({ assistant: JSON.stringify({ model: { provider: "openai-codex", default: "gpt-5.5" } }), hermesYaml: "model: [sin cerrar\n" });
  try { assert.deepEqual(await resolve(e), { provider: "openai-codex", model: "gpt-5.5" }); } finally { e.done(); }
});

test("el parser de exclusiones sigue funcionando con la sección model del mismo fichero", () => {
  const txt = JSON.stringify({ exclude: ["Privado/"], model: { provider: "openrouter", default: "x/y" } });
  assert.deepEqual(parseAssistantConfig(txt), { exclude: ["Privado/"] });
});

async function rejectsWith(e: ReturnType<typeof env>, re: RegExp, forbidden: string[] = []) {
  await assert.rejects(resolve(e), (err: Error) => {
    assert.ok(err instanceof ModelConfigError, String(err));
    assert.match(err.message, re);
    for (const f of forbidden) assert.ok(!err.message.includes(f), `el error no debe repetir «${f}»`);
    return true;
  });
}

test("falla cerrado con error accionable: assistant.json roto, provider desconocido, claves o campos no permitidos", async () => {
  const cases: [string, RegExp, string[]][] = [
    ["{no json", /assistant\.json/, []],
    [JSON.stringify({ model: 42 }), /model/, []],
    [JSON.stringify({ model: ["a"] }), /model/, []],
    [JSON.stringify({ model: { provider: "inventado-ia" } }), /provider.*openrouter/s, ["inventado-ia"]],
    [JSON.stringify({ model: { provider: "openrouter", api_key: "sk-secreto-123" } }), /api_key.*clave|clave.*api_key/si, ["sk-secreto-123"]],
    [JSON.stringify({ model: { provider: "openrouter", toolsets: ["terminal"] } }), /toolsets|campo/i, []],
    [JSON.stringify({ model: { provider: "openrouter", default: "con espacio\nnueva línea" } }), /default/, ["nueva línea"]],
    [JSON.stringify({ model: { provider: "openrouter", default: "x".repeat(300) } }), /default/, []],
    [JSON.stringify({ model: { provider: "custom", default: "m" } }), /base_url/, []],
    [JSON.stringify({ model: { provider: "custom", default: "m", base_url: "http://llm.example.com/v1" } }), /https|local/i, ["llm.example.com"]],
    [JSON.stringify({ model: { provider: "custom", default: "m", base_url: "https://usuario:pass-secreta@llm.example.com/v1" } }), /base_url/, ["pass-secreta"]],
    [JSON.stringify({ model: { provider: "custom", default: "m", base_url: "no es url" } }), /base_url/, []],
    [JSON.stringify({ model: { provider: "openrouter", default: "m", base_url: "https://evil.example.com/v1" } }), /base_url.*custom|custom.*base_url/s, ["evil.example.com"]],
    [JSON.stringify({ model: { provider: "custom", default: "m", base_url: "https://llm.example.com/v1", api_mode: "rm -rf" } }), /api_mode/, ["rm -rf"]],
  ];
  for (const [assistant, re, forbidden] of cases) {
    const e = env({ assistant });
    try { await rejectsWith(e, re, forbidden); } finally { e.done(); }
  }
});

test("falla cerrado: el config de Hermes del usuario es YAML inválido o su provider no está soportado y no hay override", async () => {
  let e = env({ hermesYaml: "model: [sin cerrar\n" });
  try { await rejectsWith(e, /config\.yaml/); } finally { e.done(); }
  e = env({ hermesYaml: "- solo\n- una lista\n" });
  try { await rejectsWith(e, /config\.yaml/); } finally { e.done(); }
  e = env({ hermesYaml: "model:\n  provider: nous\n  default: x\n" });
  try { await rejectsWith(e, /assistant\.json/, ["nous-secreto"]); } finally { e.done(); }
  e = env({ hermesYaml: "model:\n  provider: custom\n  default: m\n  base_url: http://llm.example.com/v1\n" });
  try { await rejectsWith(e, /https|local/i); } finally { e.done(); }
});

test("no escribe nada en el vault al resolver (solo lee)", async () => {
  const txt = JSON.stringify({ model: { provider: "openrouter", default: "a/b" } });
  const e = env({ assistant: txt });
  try {
    await resolve(e);
    assert.equal(readFileSync(path.join(e.homeDir, ".kioku/assistant.json"), "utf8"), txt);
  } finally { e.done(); }
});

test("describeModel: texto de estado sin secretos", () => {
  assert.equal(describeModel({ provider: "openrouter", model: "a/b" }), "openrouter · a/b");
  assert.equal(describeModel({ provider: "openai-codex" }), "openai-codex · modelo por defecto");
  assert.ok(!describeModel({ provider: "custom", model: "m", baseUrl: "https://llm.example.com/v1" }).includes("llm.example.com"));
});

// ---------- Credenciales ----------

test("Codex no necesita claves: ningún secreto", async () => {
  const e = env();
  try { assert.deepEqual(await resolveProviderSecrets({ provider: "openai-codex" }, { userHome: e.userHome, env: { OPENROUTER_API_KEY: "x" } }), {}); } finally { e.done(); }
});

test("clave de API: solo la variable del provider, desde ~/.hermes/.env o el entorno del daemon; nada más", async () => {
  const e = env({ dotenv: "# claves\nANTHROPIC_API_KEY=sk-otra\nexport OPENROUTER_API_KEY=\"sk-or-1\" # comentario\nTELEGRAM_BOT_TOKEN=nolo\n" });
  try {
    const s = { provider: "openrouter" } as const;
    assert.deepEqual(await resolveProviderSecrets(s, { userHome: e.userHome, env: { PATH: "/usr/bin", AWS_SECRET_ACCESS_KEY: "nolo" } }), { OPENROUTER_API_KEY: "sk-or-1" });
    const e2 = env();
    try {
      assert.deepEqual(await resolveProviderSecrets(s, { userHome: e2.userHome, env: { OPENROUTER_API_KEY: "sk-or-env", AWS_SECRET_ACCESS_KEY: "nolo" } }), { OPENROUTER_API_KEY: "sk-or-env" });
    } finally { e2.done(); }
  } finally { e.done(); }
});

test("provider con varias variables posibles (gemini): usa la primera encontrada con su propio nombre", async () => {
  const e = env({ dotenv: "GEMINI_API_KEY=g-1\n" });
  try { assert.deepEqual(await resolveProviderSecrets({ provider: "gemini" }, { userHome: e.userHome, env: {} }), { GEMINI_API_KEY: "g-1" }); } finally { e.done(); }
});

test("falta la clave: error que nombra la variable y dónde ponerla, sin ecos de otros secretos", async () => {
  const e = env({ dotenv: "ANTHROPIC_API_KEY=sk-ant-ajena\n" });
  try {
    await assert.rejects(resolveProviderSecrets({ provider: "openrouter" }, { userHome: e.userHome, env: {} }), (err: Error) => {
      assert.ok(err instanceof ModelConfigError);
      assert.match(err.message, /OPENROUTER_API_KEY/);
      assert.match(err.message, /\.env/);
      assert.ok(!err.message.includes("sk-ant-ajena"));
      return true;
    });
  } finally { e.done(); }
});

test("clave con saltos de línea o vacía se rechaza sin repetirla", async () => {
  const e = env();
  try {
    for (const v of ["", "sk-a\nsk-b", "sk\0x"]) {
      await assert.rejects(resolveProviderSecrets({ provider: "openrouter" }, { userHome: e.userHome, env: { OPENROUTER_API_KEY: v } }), (err: Error) => {
        assert.ok(err instanceof ModelConfigError);
        assert.ok(!err.message.includes("sk-b"));
        return true;
      });
    }
  } finally { e.done(); }
});

test("custom: la clave es opcional solo si el endpoint es local; en remoto es obligatoria", async () => {
  const e = env();
  try {
    assert.deepEqual(await resolveProviderSecrets({ provider: "custom", model: "m", baseUrl: "http://127.0.0.1:11434/v1" }, { userHome: e.userHome, env: {} }), {});
    assert.deepEqual(await resolveProviderSecrets({ provider: "custom", model: "m", baseUrl: "http://localhost:11434/v1" }, { userHome: e.userHome, env: { OPENAI_API_KEY: "k" } }), { OPENAI_API_KEY: "k" });
    await assert.rejects(resolveProviderSecrets({ provider: "custom", model: "m", baseUrl: "https://llm.example.com/v1" }, { userHome: e.userHome, env: {} }), /OPENAI_API_KEY/);
  } finally { e.done(); }
});

// ---------- Override de la interfaz: .kioku/assistant-model.json (JARV-36 T2) ----------

const SECRET = "sk-SENTINELA-no-debe-aparecer-9f3a1c77d0b24e5a";
const overrideText = (model: Record<string, unknown>, extra: Record<string, unknown> = {}) => JSON.stringify({ managed_by: "kioku-ui", model, ...extra });
const withOverride = (text: string, o: Parameters<typeof env>[0] = {}) => {
  const e = env(o);
  writeFileSync(path.join(e.homeDir, ".kioku", MODEL_OVERRIDE_FILE), text);
  return e;
};

test("override: sin fichero todo queda igual y el origen es el de siempre (default, hermes, assistant.json)", async () => {
  const a = env();
  const b = env({ hermesYaml: "model:\n  provider: openrouter\n  default: x/y\n" });
  const c = env({ assistant: '{"model":"gpt-5.5"}' });
  try {
    assert.deepEqual(await resolveModel({ homeDir: a.homeDir, userHome: a.userHome }), { settings: { provider: "openai-codex" }, source: "default" });
    assert.deepEqual(await resolveModel({ homeDir: b.homeDir, userHome: b.userHome }), { settings: { provider: "openrouter", model: "x/y" }, source: "hermes" });
    assert.deepEqual(await resolveModel({ homeDir: c.homeDir, userHome: c.userHome }), { settings: { provider: "openai-codex", model: "gpt-5.5" }, source: "assistant.json" });
  } finally { a.done(); b.done(); c.done(); }
});

test("override: manda sobre assistant.json y sobre Hermes, sin mezclar sus campos, y resolveModelSettings lo respeta", async () => {
  const e = withOverride(overrideText({ provider: "openrouter", default: "anthropic/claude-x" }), {
    assistant: JSON.stringify({ model: { provider: "custom", default: "otro", base_url: "https://llm.example.com/v1" }, exclude: ["Privado/"] }),
    hermesYaml: "model:\n  provider: deepseek\n  default: d\n",
  });
  try {
    assert.deepEqual(await resolveModel({ homeDir: e.homeDir, userHome: e.userHome }), { settings: { provider: "openrouter", model: "anthropic/claude-x" }, source: "ui" });
    assert.deepEqual(await resolve(e), { provider: "openrouter", model: "anthropic/claude-x" });
  } finally { e.done(); }
});

test("override: con el mismo provider hereda de Hermes lo que no define (api_mode) igual que assistant.json", async () => {
  const e = withOverride(overrideText({ provider: "anthropic", default: "claude-x" }), { hermesYaml: "model:\n  provider: anthropic\n  default: viejo\n  api_mode: anthropic_messages\n" });
  try { assert.deepEqual(await resolve(e), { provider: "anthropic", model: "claude-x", apiMode: "anthropic_messages" }); } finally { e.done(); }
});

test("override: custom local no necesita confirmación; remoto solo con la confirmación del origen exacto", async () => {
  const local = withOverride(overrideText({ provider: "custom", default: "llama3", base_url: "http://localhost:11434/v1", api_mode: "chat_completions" }));
  const remote = withOverride(overrideText({ provider: "custom", default: "m", base_url: "https://llm.example.com/v1" }, { acknowledged_origin: "https://llm.example.com" }));
  try {
    assert.deepEqual(await resolve(local), { provider: "custom", model: "llama3", baseUrl: "http://localhost:11434/v1", apiMode: "chat_completions" });
    assert.deepEqual(await resolve(remote), { provider: "custom", model: "m", baseUrl: "https://llm.example.com/v1" });
  } finally { local.done(); remote.done(); }
});

test("override: configuración remota de assistant.json (contrato anterior, sin confirmación) sigue resolviéndose", async () => {
  const e = env({ assistant: JSON.stringify({ model: { provider: "custom", default: "m", base_url: "https://llm.example.com/v1" } }) });
  try { assert.deepEqual(await resolve(e), { provider: "custom", model: "m", baseUrl: "https://llm.example.com/v1" }); } finally { e.done(); }
});

test("override: inválido falla cerrado (no cae en assistant.json, Hermes ni Codex) y nunca repite lo recibido", async () => {
  const bad: [string, string][] = [
    ["JSON roto", `{ "managed_by": "kioku-ui", "${SECRET}`],
    ["no es objeto", "[1]"],
    ["sin marca de la interfaz", JSON.stringify({ model: { provider: "openrouter" } })],
    ["marca ajena", JSON.stringify({ managed_by: "otro", model: { provider: "openrouter" } })],
    ["campo de clave", overrideText({ provider: "openrouter", api_key: SECRET })],
    ["campo de clave arriba", overrideText({ provider: "openrouter" }, { token: SECRET })],
    ["campo inesperado", overrideText({ provider: "openrouter", extra: SECRET })],
    ["campo inesperado arriba", overrideText({ provider: "openrouter" }, { [SECRET]: 1 })],
    ["provider desconocido", overrideText({ provider: SECRET })],
    ["sin provider", overrideText({ default: "m" })],
    ["modelo con forma de clave", overrideText({ provider: "openrouter", default: SECRET })],
    ["modelo inválido", overrideText({ provider: "openrouter", default: `a b ${SECRET}` })],
    ["api_mode inválido", overrideText({ provider: "openrouter", api_mode: SECRET })],
    ["base_url en otro provider", overrideText({ provider: "openrouter", base_url: "https://x.example.com" })],
    ["custom sin base_url", overrideText({ provider: "custom", default: "m" })],
    ["usuario en la URL", overrideText({ provider: "custom", base_url: `https://u:${SECRET}@llm.example.com/v1` }, { acknowledged_origin: "https://llm.example.com" })],
    ["clave en la query", overrideText({ provider: "custom", base_url: `https://llm.example.com/v1?api_key=${SECRET}` }, { acknowledged_origin: "https://llm.example.com" })],
    ["http remoto", overrideText({ provider: "custom", base_url: "http://llm.example.com/v1" }, { acknowledged_origin: "http://llm.example.com" })],
    ["remoto sin confirmar", overrideText({ provider: "custom", base_url: "https://llm.example.com/v1" })],
    ["confirmación de otro origen", overrideText({ provider: "custom", base_url: "https://llm.example.com/v1" }, { acknowledged_origin: "https://otro.example.com" })],
    ["confirmación sobrante en local", overrideText({ provider: "custom", base_url: "http://localhost:1/v1" }, { acknowledged_origin: "http://localhost:1" })],
  ];
  for (const [name, text] of bad) {
    const e = withOverride(text, { assistant: '{"model":"gpt-5.5"}', hermesYaml: "model:\n  provider: openrouter\n  default: x\n" });
    try {
      await assert.rejects(resolve(e), (err: Error) => {
        assert.ok(err instanceof ModelConfigError, name);
        assert.ok(!err.message.includes(SECRET), `${name}: no repite lo recibido`);
        assert.match(err.message, /assistant-model\.json/, name);
        return true;
      }, name);
    } finally { e.done(); }
  }
});

test("override: un fichero demasiado grande o un enlace simbólico se rechazan", async () => {
  const big = withOverride(" ".repeat(300 * 1024));
  const link = env();
  try {
    await assert.rejects(resolve(big), ModelConfigError);
    writeFileSync(path.join(link.root, "otro.json"), overrideText({ provider: "openrouter" }));
    symlinkSync(path.join(link.root, "otro.json"), path.join(link.homeDir, ".kioku", MODEL_OVERRIDE_FILE));
    await assert.rejects(resolve(link), (err: Error) => err instanceof ModelConfigError && /assistant-model\.json/.test(err.message));
  } finally { big.done(); link.done(); }
});

test("override: serializar y volver a leer conserva exactamente la selección, con la marca y sin claves", () => {
  const text = serializeModelOverride({ provider: "custom", model: "m", baseUrl: "https://llm.example.com/v1", apiMode: "chat_completions", acknowledgedOrigin: "https://llm.example.com" });
  assert.deepEqual(JSON.parse(text), {
    managed_by: "kioku-ui",
    model: { provider: "custom", default: "m", base_url: "https://llm.example.com/v1", api_mode: "chat_completions" },
    acknowledged_origin: "https://llm.example.com",
  });
  assert.deepEqual(parseModelOverride(text), { provider: "custom", model: "m", baseUrl: "https://llm.example.com/v1", apiMode: "chat_completions", acknowledgedOrigin: "https://llm.example.com" });
  assert.deepEqual(parseModelOverride(serializeModelOverride({ provider: "openai-codex" })), { provider: "openai-codex" });
});

test("proveedores: lista cerrada con las variables de clave de cada uno (nunca valores)", () => {
  const list = describeProviders();
  assert.deepEqual(list.map((p) => p.id), ["openai-codex", "openrouter", "anthropic", "gemini", "deepseek", "zai", "kimi-coding", "minimax", "custom"]);
  assert.deepEqual(list.find((p) => p.id === "gemini")?.keys, ["GOOGLE_API_KEY", "GEMINI_API_KEY"]);
  assert.deepEqual(list.find((p) => p.id === "custom"), { id: "custom", keys: ["OPENAI_API_KEY"], keylessLocal: true, ownBaseUrl: true });
});

test("credenciales: dice dónde se proporcionan sin devolver ni filtrar nunca el valor", async () => {
  const e = env({ dotenv: `OPENROUTER_API_KEY=${SECRET}\nANTHROPIC_API_KEY=\n` });
  try {
    const o = { userHome: e.userHome, env: { ANTHROPIC_API_KEY: SECRET, DEEPSEEK_API_KEY: "mal\nvalor" } as NodeJS.ProcessEnv };
    assert.deepEqual(await describeCredentials({ provider: "openai-codex" }, o), { required: false, names: [], state: "not-needed" });
    assert.deepEqual(await describeCredentials({ provider: "openrouter" }, o), { required: true, names: ["OPENROUTER_API_KEY"], state: "found", name: "OPENROUTER_API_KEY", source: "hermes-env" });
    assert.deepEqual(await describeCredentials({ provider: "anthropic" }, o), { required: true, names: ["ANTHROPIC_API_KEY"], state: "found", name: "ANTHROPIC_API_KEY", source: "environment" });
    assert.deepEqual(await describeCredentials({ provider: "deepseek" }, o), { required: true, names: ["DEEPSEEK_API_KEY"], state: "invalid", name: "DEEPSEEK_API_KEY" });
    assert.deepEqual(await describeCredentials({ provider: "minimax" }, o), { required: true, names: ["MINIMAX_API_KEY"], state: "missing" });
    assert.deepEqual(await describeCredentials({ provider: "custom", baseUrl: "http://localhost:11434/v1" }, o), { required: false, names: ["OPENAI_API_KEY"], state: "local-keyless" });
    assert.deepEqual(await describeCredentials({ provider: "custom", baseUrl: "https://llm.example.com/v1" }, o), { required: true, names: ["OPENAI_API_KEY"], state: "missing" });
    for (const s of ["openrouter", "anthropic", "deepseek"]) assert.ok(!JSON.stringify(await describeCredentials({ provider: s }, o)).includes(SECRET));
  } finally { e.done(); }
});
