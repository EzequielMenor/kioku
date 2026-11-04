// Qué modelo usa Hermes y con qué credenciales. Dos fuentes: `.kioku/assistant.json` (sección `model`) manda sobre
// el `~/.hermes/config.yaml` del usuario, y sin ninguna de las dos se usa Codex (la suscripción), como siempre.
// Todo falla cerrado con errores accionables que nunca repiten el valor recibido (podría ser una clave pegada por error),
// y las credenciales se resuelven una a una: jamás se copian a ficheros del vault ni se reenvía el entorno entero.
import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export const DEFAULT_PROVIDER = "openai-codex";

export interface ModelSettings {
  provider: string;
  model?: string;
  baseUrl?: string;
  apiMode?: string;
}

export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigError";
  }
}

interface ProviderSpec {
  /** Variables de entorno de la clave; se usa la primera que exista, con su propio nombre dentro de la jaula. */
  keys: string[];
  /** Con endpoint local (localhost) la clave es opcional. */
  keylessLocal?: boolean;
  /** Acepta `base_url` definido en assistant.json (el resto solo lo hereda del config de Hermes del usuario). */
  ownBaseUrl?: boolean;
}

// Lista cerrada: añadir un proveedor es una decisión de código, no de un fichero editable por el vault.
const PROVIDERS: Record<string, ProviderSpec> = {
  "openai-codex": { keys: [] },
  openrouter: { keys: ["OPENROUTER_API_KEY"] },
  anthropic: { keys: ["ANTHROPIC_API_KEY"] },
  gemini: { keys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"] },
  deepseek: { keys: ["DEEPSEEK_API_KEY"] },
  zai: { keys: ["GLM_API_KEY", "ZAI_API_KEY"] },
  "kimi-coding": { keys: ["KIMI_API_KEY"] },
  minimax: { keys: ["MINIMAX_API_KEY"] },
  ollama: { keys: ["OLLAMA_API_KEY"], keylessLocal: true, ownBaseUrl: true },
  "ollama-launch": { keys: ["OLLAMA_API_KEY"], keylessLocal: true, ownBaseUrl: true },
  custom: { keys: ["OPENAI_API_KEY"], keylessLocal: true, ownBaseUrl: true },
};

const API_MODES = ["chat_completions", "codex_responses", "anthropic_messages"];
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const MAX_FILE = 256 * 1024;
const MAX_SECRET = 4096;
const MODEL_FIELDS = ["provider", "default", "base_url", "api_mode"];

const providerList = () => Object.keys(PROVIDERS).join(", ");

function checkProvider(v: unknown, where: string): string {
  if (typeof v !== "string" || !Object.hasOwn(PROVIDERS, v)) {
    throw new ModelConfigError(`${where}: «provider» no está soportado por Kioku. Proveedores válidos: ${providerList()}. Fíjalo en .kioku/assistant.json → "model": { "provider": … }`);
  }
  return v;
}

function checkModelName(v: unknown, where: string, field = "default"): string {
  if (typeof v !== "string" || v.length === 0 || v.length > 200 || !MODEL_RE.test(v)) {
    throw new ModelConfigError(`${where}: «${field}» debe ser el nombre del modelo (letras, números y . _ : / @ + -; sin espacios; máx. 200)`);
  }
  return v;
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

function checkBaseUrl(v: unknown, where: string): string {
  const bad = () => new ModelConfigError(`${where}: «base_url» debe ser una URL https:// (http:// solo hacia localhost) sin usuario ni contraseña`);
  if (typeof v !== "string" || v.length === 0 || v.length > 300) throw bad();
  let u: URL;
  try { u = new URL(v); } catch { throw bad(); }
  if (u.username || u.password || u.hash) throw bad();
  if (!(u.protocol === "https:" || (u.protocol === "http:" && isLocalHost(u.hostname)))) throw bad();
  return v;
}

function checkApiMode(v: unknown, where: string): string {
  if (typeof v !== "string" || !API_MODES.includes(v)) throw new ModelConfigError(`${where}: «api_mode» debe ser uno de ${API_MODES.join(", ")}`);
  return v;
}

interface Raw { provider?: string; default?: string; base_url?: string; api_mode?: string }

async function readText(file: string): Promise<string | null> {
  try {
    const text = await fs.readFile(file, "utf8");
    if (text.length > MAX_FILE) throw new ModelConfigError(`${path.basename(file)} es demasiado grande`);
    return text;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (e instanceof ModelConfigError) throw e;
    throw new ModelConfigError(`No puedo leer ${path.basename(file)}: revisa sus permisos`);
  }
}

/** Sección `model` de `.kioku/assistant.json`: texto (solo el modelo, como siempre) u objeto con los campos de Hermes. */
async function readVault(homeDir: string): Promise<Raw> {
  const text = await readText(path.join(homeDir, ".kioku", "assistant.json"));
  if (text === null) return {};
  const where = ".kioku/assistant.json";
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new ModelConfigError(`${where} no es JSON válido: corrígelo para usar el asistente`); }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new ModelConfigError(`${where} debe ser un objeto JSON`);
  const m = (json as { model?: unknown }).model;
  if (m === undefined || m === null || m === "") return {};
  if (typeof m === "string") return { default: checkModelName(m, `${where} → model`, "model") };
  if (typeof m !== "object" || Array.isArray(m)) throw new ModelConfigError(`${where}: «model» debe ser el nombre del modelo o un objeto { "provider", "default", "base_url", "api_mode" }`);
  const o = m as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (/key|token|secret|password/i.test(k)) throw new ModelConfigError(`${where}: no pongas claves en este fichero (${/^[a-z_]{1,32}$/.test(k) ? `«${k}»` : "ese campo"} no está permitido). Guarda la clave en ~/.hermes/.env o en el entorno de Kioku`);
    if (!MODEL_FIELDS.includes(k)) throw new ModelConfigError(`${where}: campo de «model» no permitido. Solo ${MODEL_FIELDS.join(", ")}`);
  }
  const where2 = `${where} → model`;
  const r: Raw = {};
  if (o.provider !== undefined) r.provider = checkProvider(o.provider, where2);
  if (o.default !== undefined) r.default = checkModelName(o.default, where2);
  if (o.base_url !== undefined) r.base_url = checkBaseUrl(o.base_url, where2);
  if (o.api_mode !== undefined) r.api_mode = checkApiMode(o.api_mode, where2);
  if (r.base_url && !PROVIDERS[r.provider ?? ""]?.ownBaseUrl) {
    throw new ModelConfigError(`${where2}: «base_url» solo se admite con provider "custom" (para otros proveedores se hereda de tu config de Hermes)`);
  }
  return r;
}

/** `~/.hermes/config.yaml`: se lee con un parser YAML real, solo la sección `model`. Valores sin validar aún. */
async function readUserHermes(userHome: string): Promise<Raw> {
  const where = "~/.hermes/config.yaml";
  const text = await readText(path.join(userHome, ".hermes", "config.yaml"));
  if (text === null) return {};
  let doc: unknown;
  try { doc = parseYaml(text); } catch { throw new ModelConfigError(`${where} no es YAML válido: corrígelo o fija el modelo en .kioku/assistant.json`); }
  if (doc === null || doc === undefined) return {};
  if (typeof doc !== "object" || Array.isArray(doc)) throw new ModelConfigError(`${where} debe ser un mapa YAML`);
  const m = (doc as { model?: unknown }).model;
  if (m === undefined || m === null) return {};
  if (typeof m === "string") return { default: m };
  if (typeof m !== "object" || Array.isArray(m)) throw new ModelConfigError(`${where}: «model» debe ser un nombre o un mapa`);
  const r: Raw = {};
  for (const k of MODEL_FIELDS) {
    const v = (m as Record<string, unknown>)[k];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string") throw new ModelConfigError(`${where}: «model.${k}» debe ser texto`);
    r[k as keyof Raw] = v;
  }
  return r;
}

export async function resolveModelSettings(o: { homeDir: string; userHome: string }): Promise<ModelSettings> {
  const vault = await readVault(o.homeDir);
  const userWhere = "~/.hermes/config.yaml";
  let provider: string;
  let inherit: Raw = {};
  if (vault.provider) {
    provider = vault.provider;
    // Con provider explícito, el config global solo aporta campos de ese mismo provider; si no se puede leer se ignora.
    const user = await readUserHermes(o.userHome).catch(() => ({} as Raw));
    if ((user.provider ?? DEFAULT_PROVIDER) === provider) inherit = user;
  } else {
    inherit = await readUserHermes(o.userHome);
    provider = inherit.provider === undefined ? DEFAULT_PROVIDER : checkProvider(inherit.provider, userWhere);
  }
  const effectiveProvider = provider === "ollama-launch" ? "ollama" : provider;
  const spec = PROVIDERS[effectiveProvider];
  const s: ModelSettings = { provider: effectiveProvider };
  const model = vault.default ?? (inherit.default !== undefined ? checkModelName(inherit.default, userWhere) : undefined);
  if (model) s.model = model;
  if (effectiveProvider !== DEFAULT_PROVIDER) {
    const baseUrl = vault.base_url ?? (inherit.base_url !== undefined ? checkBaseUrl(inherit.base_url, userWhere) : undefined);
    if (baseUrl) s.baseUrl = baseUrl;
    else if (effectiveProvider === "ollama") s.baseUrl = "http://localhost:11434/v1";
    else if (spec.ownBaseUrl) throw new ModelConfigError(`El proveedor "${effectiveProvider}" necesita «base_url» (URL https://, o http:// local): defínelo en .kioku/assistant.json → "model" o en tu config de Hermes`);
  }
  const apiMode = vault.api_mode ?? (provider !== DEFAULT_PROVIDER && inherit.api_mode !== undefined ? checkApiMode(inherit.api_mode, userWhere) : undefined);
  if (apiMode) s.apiMode = apiMode;
  return s;
}

/** Resumen apto para estado/logs: nunca incluye URL, rutas ni credenciales. */
export function describeModel(s: ModelSettings): string {
  return `${s.provider} · ${s.model ?? "modelo por defecto"}`;
}

/** Lee `KEY=valor` (con `export`, comillas y comentarios) de un .env. Solo se consultan nombres concretos; nunca se devuelve el mapa. */
function parseDotenv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    const quote = val[0];
    if (quote === '"' || quote === "'") {
      const end = val.indexOf(quote, 1);
      val = end > 0 ? val.slice(1, end) : val.slice(1);
    } else {
      val = val.replace(/\s+#.*$/, "");
    }
    out.set(key, val);
  }
  return out;
}

/**
 * Credenciales que necesita el proveedor, solo esas: de `~/.hermes/.env` o, si no están, del entorno del daemon.
 * Devuelve `{ NOMBRE: valor }` para inyectar en el proceso aislado; Codex y los endpoints locales no necesitan ninguna.
 */
export async function resolveProviderSecrets(s: ModelSettings, o: { userHome: string; env?: NodeJS.ProcessEnv }): Promise<Record<string, string>> {
  const spec = PROVIDERS[s.provider];
  if (!spec || spec.keys.length === 0) return {};
  const env = o.env ?? process.env;
  const dotenv = parseDotenv((await readText(path.join(o.userHome, ".hermes", ".env")).catch(() => null)) ?? "");
  for (const name of spec.keys) {
    const value = dotenv.get(name) || env[name];
    if (!value) continue;
    if (value.length > MAX_SECRET || /[\r\n\0]/.test(value)) {
      throw new ModelConfigError(`La clave ${name} no es válida (vacía, con saltos de línea o demasiado larga): corrígela en ~/.hermes/.env o en el entorno de Kioku`);
    }
    return { [name]: value };
  }
  if (spec.keylessLocal && s.baseUrl && isLocalHost(new URL(s.baseUrl).hostname)) return {};
  throw new ModelConfigError(`Falta la clave de ${s.provider}: define ${spec.keys[0]} en ~/.hermes/.env (o en el entorno con el que arranca Kioku)`);
}
