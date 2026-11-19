// Qué modelo usa Hermes y con qué credenciales. Tres fuentes, de más a menos prioridad: el override de la interfaz
// (`.kioku/assistant-model.json`, solo lo escribe Kioku), `.kioku/assistant.json` (sección `model`) y el
// `~/.hermes/config.yaml` del usuario; sin ninguna se usa Codex (la suscripción), como siempre.
// Todo falla cerrado con errores accionables que nunca repiten el valor recibido (podría ser una clave pegada por error),
// y las credenciales se resuelven una a una: jamás se copian a ficheros del vault ni se reenvía el entorno entero.
import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export const DEFAULT_PROVIDER = "openai-codex";
const OPENCODE_GO_BASE = "https://opencode.ai/inference/go/openai/v1";

/** Override que escribe la interfaz de Kioku: es un fichero aparte para no reescribir `assistant.json` (y sus exclusiones). */
export const MODEL_OVERRIDE_FILE = "assistant-model.json";
export const MODEL_OVERRIDE_OWNER = "kioku-ui";

export type ModelSource = "ui" | "assistant.json" | "hermes" | "default";

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
  "opencode-go": { keys: ["OPENCODE_GO_API_KEY"] },
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

/**
 * Red privada de Tailscale: direcciones 100.64.0.0/10 y nombres MagicDNS `*.ts.net`. El tráfico va cifrado por WireGuard
 * entre equipos del propio usuario, así que ahí se admite `http://` (p. ej. Ollama en otro equipo del tailnet).
 */
export function isTailnetHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h.endsWith(".ts.net")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  return !!m && Number(m[1]) === 100 && Number(m[2]) >= 64 && Number(m[2]) <= 127 && Number(m[3]) <= 255 && Number(m[4]) <= 255;
}

/** Destino propio del usuario: esta máquina o un equipo de su tailnet. Solo ahí se admite `http://` y un endpoint sin clave. */
export const isTrustedHost = (host: string): boolean => isLocalHost(host) || isTailnetHost(host);

function checkBaseUrl(v: unknown, where: string): string {
  const bad = () => new ModelConfigError(`${where}: «base_url» debe ser una URL https:// (http:// solo hacia localhost o hacia un equipo de tu tailnet de Tailscale) sin usuario ni contraseña`);
  if (typeof v !== "string" || v.length === 0 || v.length > 300) throw bad();
  let u: URL;
  try { u = new URL(v); } catch { throw bad(); }
  if (u.username || u.password || u.hash) throw bad();
  if (!(u.protocol === "https:" || (u.protocol === "http:" && isTrustedHost(u.hostname)))) throw bad();
  return v;
}

function checkApiMode(v: unknown, where: string): string {
  if (typeof v !== "string" || !API_MODES.includes(v)) throw new ModelConfigError(`${where}: «api_mode» debe ser uno de ${API_MODES.join(", ")}`);
  return v;
}

interface Raw { provider?: string; default?: string; base_url?: string; api_mode?: string }

export interface ModelOverride {
  provider: string;
  model?: string;
  baseUrl?: string;
  apiMode?: string;
  /** Origen remoto que el usuario confirmó que recibirá la clave; solo existe con un `base_url` no local. */
  acknowledgedOrigin?: string;
}

export interface ProviderInfo { id: string; keys: string[]; keylessLocal: boolean; ownBaseUrl: boolean }

export function describeProviders(): ProviderInfo[] {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, keys: [...p.keys], keylessLocal: !!p.keylessLocal, ownBaseUrl: !!p.ownBaseUrl }));
}

export const apiModes = (): string[] => [...API_MODES];

const OVERRIDE_WHERE = `.kioku/${MODEL_OVERRIDE_FILE}`;
const SECRET_SHAPE = /^(?:(?:sk|pk|rk|gsk|xai|hf|ghp|gho|pplx|oc_sk)[-_][A-Za-z0-9_-]{16,}|github_pat_\S+|AIza[A-Za-z0-9_-]{20,})$/;

/** Solo campos conocidos; los que parecen una clave se rechazan sin repetir el valor (el nombre solo si es corto y neutro). */
export function rejectFields(o: Record<string, unknown>, allowed: string[], where: string): void {
  for (const k of Object.keys(o)) {
    if (/key|token|secret|password/i.test(k)) throw new ModelConfigError(`${where}: no pongas claves aquí (${/^[a-z_]{1,32}$/.test(k) ? `«${k}»` : "ese campo"} no está permitido). Guarda la clave en Gestión del asistente → Modelo (o en ~/.hermes/.env o el entorno de Kioku)`);
    if (!allowed.includes(k)) throw new ModelConfigError(`${where}: campo no permitido. Solo ${allowed.join(", ")}`);
  }
}

/**
 * Selección completa del override, la misma para el fichero y para lo que envía la interfaz. Más estricta que `assistant.json`:
 * sin query en la URL (ahí viajan claves) y, si el destino es remoto, el origen exacto debe haber sido confirmado.
 */
export function checkModelOverride(raw: { provider?: unknown; model?: unknown; base_url?: unknown; api_mode?: unknown }, ack: unknown, where: string, ackField: string): ModelOverride {
  const o: ModelOverride = { provider: checkProvider(raw.provider, where) };
  if (raw.model !== undefined) {
    o.model = checkModelName(raw.model, where, "default");
    if (SECRET_SHAPE.test(o.model)) throw new ModelConfigError(`${where}: «default» parece una clave de API; ahí va el nombre del modelo, y la clave en Gestión del asistente → Modelo (o en ~/.hermes/.env)`);
  }
  if (raw.api_mode !== undefined) o.apiMode = checkApiMode(raw.api_mode, where);
  const own = PROVIDERS[o.provider].ownBaseUrl;
  if (raw.base_url === undefined) {
    if (own) throw new ModelConfigError(`${where}: el proveedor "custom" necesita «base_url» (URL https://, o http:// local)`);
    if (ack !== undefined) throw new ModelConfigError(`${where}: «${ackField}» solo se admite con un destino remoto`);
    return o;
  }
  if (!own) throw new ModelConfigError(`${where}: «base_url» solo se admite con provider "custom" (para otros proveedores se hereda de tu config de Hermes)`);
  o.baseUrl = checkBaseUrl(raw.base_url, where);
  const url = new URL(o.baseUrl);
  if (url.search) throw new ModelConfigError(`${where}: «base_url» no puede llevar parámetros (?…): no pongas claves en la URL`);
  if (isLocalHost(url.hostname)) {
    if (ack !== undefined) throw new ModelConfigError(`${where}: «${ackField}» solo se admite con un destino remoto`);
    return o;
  }
  if (ack !== url.origin) {
    throw new ModelConfigError(`${where}: ${url.origin} es un destino remoto y recibiría tu clave OPENAI_API_KEY. Confirma exactamente ese origen en «${ackField}» solo si confías en él`);
  }
  o.acknowledgedOrigin = ack;
  return o;
}

export function parseModelOverride(text: string): ModelOverride {
  const where = OVERRIDE_WHERE;
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new ModelConfigError(`${where} no es JSON válido: corrígelo o bórralo a mano para usar el asistente`); }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new ModelConfigError(`${where} debe ser un objeto JSON`);
  const top = json as Record<string, unknown>;
  rejectFields(top, ["managed_by", "model", "acknowledged_origin"], where);
  if (top.managed_by !== MODEL_OVERRIDE_OWNER) throw new ModelConfigError(`${where} no lo creó la interfaz de Kioku: revísalo o bórralo a mano`);
  const m = top.model;
  if (!m || typeof m !== "object" || Array.isArray(m)) throw new ModelConfigError(`${where}: «model» debe ser un objeto { "provider", "default", "base_url", "api_mode" }`);
  rejectFields(m as Record<string, unknown>, MODEL_FIELDS, `${where} → model`);
  const f = m as Record<string, unknown>;
  return checkModelOverride({ provider: f.provider, model: f.default, base_url: f.base_url, api_mode: f.api_mode }, top.acknowledged_origin, `${where} → model`, "acknowledged_origin");
}

export function serializeModelOverride(o: ModelOverride): string {
  const model: Record<string, string> = { provider: o.provider };
  if (o.model !== undefined) model.default = o.model;
  if (o.baseUrl !== undefined) model.base_url = o.baseUrl;
  if (o.apiMode !== undefined) model.api_mode = o.apiMode;
  return JSON.stringify({ managed_by: MODEL_OVERRIDE_OWNER, model, ...(o.acknowledgedOrigin ? { acknowledged_origin: o.acknowledgedOrigin } : {}) }, null, 2) + "\n";
}

/** Detecta lecturas fallidas de archivos desalojados en iCloud Drive (`dataless`, macOS `EDEADLK` / errno -11). */
export function isCloudDatalessReadError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as NodeJS.ErrnoException;
  return err.errno === -11
    || err.code === "EDEADLK"
    || err.code === "Unknown system error -11"
    || err.code === "ETIMEDOUT";
}

function describeConfigReadError(e: unknown, where: string): ModelConfigError {
  if (e instanceof ModelConfigError) return e;
  if (isCloudDatalessReadError(e)) {
    return new ModelConfigError(
      `No se pudo descargar ${where} desde iCloud Drive (archivo solo en la nube). En Finder, haz clic derecho sobre la carpeta de tu bóveda y elige «Mantener descargado», o cambia la bóveda a una carpeta local fuera de iCloud.`,
    );
  }
  const code = (e as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM") {
    const macHint = process.platform === "darwin" ? " Si está en Documentos, revisa Ajustes del Sistema → Privacidad y seguridad → Archivos y carpetas." : "";
    return new ModelConfigError(`Kioku no tiene acceso a ${where} (${code}). Revisa el acceso a esa carpeta y al archivo desde la cuenta que ejecuta Kioku.${macHint}`);
  }
  if (code === "ENOTDIR") return new ModelConfigError(`No se puede acceder a ${where}: verifica que la bóveda y .kioku sean carpetas.`);
  return new ModelConfigError(`No se pudo leer ${where}. Comprueba que la bóveda esté disponible y vuelve a intentarlo.`);
}

/** Override de la interfaz: `null` si no existe; si existe y no es válido (o no es un fichero normal) falla cerrado. */
export async function readModelOverride(homeDir: string): Promise<ModelOverride | null> {
  const file = path.join(homeDir, ".kioku", MODEL_OVERRIDE_FILE);
  let text: string;
  try {
    const st = await fs.lstat(file);
    if (!st.isFile()) throw new ModelConfigError(`${OVERRIDE_WHERE} debe ser un fichero normal (no un enlace ni una carpeta)`);
    text = await fs.readFile(file, "utf8");
  } catch (e) {
    if (e instanceof ModelConfigError) throw e;
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw describeConfigReadError(e, OVERRIDE_WHERE);
  }
  if (text.length > MAX_FILE) throw new ModelConfigError(`${MODEL_OVERRIDE_FILE} es demasiado grande`);
  return parseModelOverride(text);
}

async function readText(file: string, where = path.basename(file)): Promise<string | null> {
  try {
    const text = await fs.readFile(file, "utf8");
    if (text.length > MAX_FILE) throw new ModelConfigError(`${path.basename(file)} es demasiado grande`);
    return text;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw describeConfigReadError(e, where);
  }
}

/** Sección `model` de `.kioku/assistant.json`: texto (solo el modelo, como siempre) u objeto con los campos de Hermes. */
async function readVault(homeDir: string): Promise<Raw> {
  const where = ".kioku/assistant.json";
  const text = await readText(path.join(homeDir, ".kioku", "assistant.json"), where);
  if (text === null) return {};
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new ModelConfigError(`${where} no es JSON válido: corrígelo para usar el asistente`); }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new ModelConfigError(`${where} debe ser un objeto JSON`);
  const m = (json as { model?: unknown }).model;
  if (m === undefined || m === null || m === "") return {};
  if (typeof m === "string") return { default: checkModelName(m, `${where} → model`, "model") };
  if (typeof m !== "object" || Array.isArray(m)) throw new ModelConfigError(`${where}: «model» debe ser el nombre del modelo o un objeto { "provider", "default", "base_url", "api_mode" }`);
  const o = m as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (/key|token|secret|password/i.test(k)) throw new ModelConfigError(`${where}: no pongas claves en este fichero (${/^[a-z_]{1,32}$/.test(k) ? `«${k}»` : "ese campo"} no está permitido). Guarda la clave en Gestión del asistente → Modelo (o en ~/.hermes/.env o el entorno de Kioku)`);
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
  const text = await readText(path.join(userHome, ".hermes", "config.yaml"), where);
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
  return (await resolveModel(o)).settings;
}

/** Como `resolveModelSettings`, y además dice de qué fuente sale la selección (para mostrarla en la gestión del modelo). */
export async function resolveModel(o: { homeDir: string; userHome: string }): Promise<{ settings: ModelSettings; source: ModelSource }> {
  const override = await readModelOverride(o.homeDir);
  const vault: Raw = override
    ? { provider: override.provider, default: override.model, base_url: override.baseUrl, api_mode: override.apiMode }
    : await readVault(o.homeDir);
  for (const k of Object.keys(vault) as (keyof Raw)[]) if (vault[k] === undefined) delete vault[k];
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
    const baseUrl = effectiveProvider === "opencode-go"
      ? OPENCODE_GO_BASE
      : vault.base_url ?? (inherit.base_url !== undefined ? checkBaseUrl(inherit.base_url, userWhere) : undefined);
    if (baseUrl) s.baseUrl = baseUrl;
    else if (effectiveProvider === "ollama") s.baseUrl = "http://localhost:11434/v1";
    else if (spec.ownBaseUrl) throw new ModelConfigError(`El proveedor "${effectiveProvider}" necesita «base_url» (URL https://, o http:// local): defínelo en .kioku/assistant.json → "model" o en tu config de Hermes`);
  }
  const apiMode = vault.api_mode ?? (provider !== DEFAULT_PROVIDER && inherit.api_mode !== undefined ? checkApiMode(inherit.api_mode, userWhere) : undefined);
  if (apiMode) s.apiMode = apiMode;
  const source: ModelSource = override ? "ui" : Object.keys(vault).length ? "assistant.json" : Object.keys(inherit).length ? "hermes" : "default";
  return { settings: s, source };
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

export type SecretSource = "kioku" | "hermes-env" | "environment";

interface FoundSecret { name: string; value: string; source: SecretSource }

/** Nombre del fichero de claves propio de Kioku (formato `NOMBRE=valor`, una por línea). */
export const KIOKU_CREDENTIALS_FILE = "credentials.env";

/**
 * Almacén de claves de Kioku: FUERA de la bóveda (puede estar en iCloud) y derivado del home del usuario. En macOS,
 * `~/Library/Application Support/Kioku`; en el resto, `$XDG_CONFIG_HOME/kioku` (si es absoluto) o `~/.config/kioku`.
 */
export function kiokuCredentialsPath(userHome: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") return path.join(userHome, "Library", "Application Support", "Kioku", KIOKU_CREDENTIALS_FILE);
  const xdg = env.XDG_CONFIG_HOME;
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(userHome, ".config"), "kioku", KIOKU_CREDENTIALS_FILE);
}

/** Formato propio, sin comillas ni comentarios en el valor: lo que se guarda es exactamente lo que se lee. */
function parseKiokuEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=([^\r\n\u2028\u2029]*)$/.exec(raw.replace(/\r$/, ""));
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/** Fichero de claves de Kioku: `null` si no existe, no es un fichero normal (un enlace no se sigue) o no se puede leer. */
async function readKiokuEnv(o: { userHome: string; env?: NodeJS.ProcessEnv }): Promise<Map<string, string> | null> {
  const file = kiokuCredentialsPath(o.userHome, o.env);
  try {
    const st = await fs.lstat(file);
    if (!st.isFile() || st.size > MAX_FILE) return null;
    return parseKiokuEnv(await fs.readFile(file, "utf8"));
  } catch { return null; }
}

/** Proveedores cuya clave está guardada en el almacén de Kioku. Solo ids: ni nombres de variable ni valores. */
export async function listKiokuSecretProviders(o: { userHome: string; env?: NodeJS.ProcessEnv }): Promise<string[]> {
  const own = await readKiokuEnv(o);
  if (!own) return [];
  return Object.entries(PROVIDERS).filter(([, p]) => p.keys.length > 0 && !!own.get(p.keys[0])).map(([id]) => id);
}

/** Primera variable del proveedor con valor: de Kioku, de `~/.hermes/.env` o del entorno del daemon. El valor solo lo ve quien lo inyecta. */
async function findSecret(spec: ProviderSpec, o: { userHome: string; env?: NodeJS.ProcessEnv }): Promise<FoundSecret | null> {
  const env = o.env ?? process.env;
  const own = (await readKiokuEnv(o)) ?? new Map<string, string>();
  const dotenv = parseDotenv((await readText(path.join(o.userHome, ".hermes", ".env")).catch(() => null)) ?? "");
  for (const name of spec.keys) {
    const fromKioku = own.get(name);
    const fromFile = dotenv.get(name);
    const value = fromKioku || fromFile || env[name];
    if (value) return { name, value, source: fromKioku ? "kioku" : fromFile ? "hermes-env" : "environment" };
  }
  return null;
}

const badSecret = (value: string) => value.length === 0 || value.length > MAX_SECRET || /[\r\n\0\u2028\u2029]/.test(value);

const SECRETS_HINT = "pégala en Gestión del asistente → Modelo, o defínela en ~/.hermes/.env (o en el entorno con el que arranca Kioku)";

/**
 * Credenciales que necesita el proveedor, solo esas: del almacén de Kioku, de `~/.hermes/.env` o, si no están, del entorno del daemon.
 * Devuelve `{ NOMBRE: valor }` para inyectar en el proceso aislado; Codex y los endpoints locales no necesitan ninguna.
 */
export async function resolveProviderSecrets(s: ModelSettings, o: { userHome: string; env?: NodeJS.ProcessEnv }): Promise<Record<string, string>> {
  const spec = PROVIDERS[s.provider];
  if (!spec || spec.keys.length === 0) return {};
  const found = await findSecret(spec, o);
  if (found) {
    if (badSecret(found.value)) {
      throw new ModelConfigError(`La clave ${found.name} no es válida (vacía, con saltos de línea o demasiado larga): corrígela (${SECRETS_HINT})`);
    }
    return { [found.name]: found.value };
  }
  if (spec.keylessLocal && s.baseUrl && isTrustedHost(new URL(s.baseUrl).hostname)) return {};
  throw new ModelConfigError(`Falta la clave de ${s.provider}: ${spec.keys[0]} ${SECRETS_HINT}`);
}

// ---------- Escritura del almacén de claves de Kioku ----------

/** Variable que Kioku escribe para un proveedor: la fija el servidor (`keys[0]`); el cliente solo elige el proveedor. */
function credentialName(provider: unknown): string {
  const spec = typeof provider === "string" && Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : undefined;
  if (!spec || spec.keys.length === 0) throw new ModelConfigError("Ese proveedor no usa clave de API: elige uno que la necesite");
  return spec.keys[0];
}

/** Las lecturas-modificaciones-escrituras del fichero van de una en una (varias peticiones no pisan las variables de las otras). */
let credentialQueue: Promise<unknown> = Promise.resolve();
function exclusiveCredentials<T>(fn: () => Promise<T>): Promise<T> {
  const run = credentialQueue.then(fn);
  credentialQueue = run.catch(() => undefined);
  return run;
}

/** Texto actual del fichero (`null` si no existe); un enlace o una carpeta no se siguen ni se pisan. */
async function readKiokuEnvText(file: string): Promise<string | null> {
  try {
    const st = await fs.lstat(file);
    if (!st.isFile()) throw new ModelConfigError("El fichero de claves de Kioku debe ser un fichero normal (no un enlace ni una carpeta): revísalo o bórralo a mano");
    if (st.size > MAX_FILE) throw new ModelConfigError("El fichero de claves de Kioku es demasiado grande");
    return await fs.readFile(file, "utf8");
  } catch (e) {
    if (e instanceof ModelConfigError) throw e;
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ModelConfigError("No se pudo leer el almacén de claves de Kioku. Revisa el acceso a su carpeta y vuelve a intentarlo.");
  }
}

/** Sustituye la línea de `name` (y sus duplicados) por `value`, o la quita con `null`; conserva todo lo demás. */
function withVariable(text: string, name: string, value: string | null): string {
  const lines = text.length ? text.split("\n") : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const own = (l: string) => l.replace(/\r$/, "").startsWith(`${name}=`);
  const out: string[] = [];
  let placed = false;
  for (const l of lines) {
    if (!own(l)) { out.push(l); continue; }
    if (value !== null && !placed) { out.push(`${name}=${value}`); placed = true; }
  }
  if (value !== null && !placed) out.push(`${name}=${value}`);
  return out.length ? out.join("\n") + "\n" : "";
}

async function writeKiokuEnv(file: string, text: string): Promise<void> {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${KIOKU_CREDENTIALS_FILE}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(dir, 0o700);
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/m.test(text)) { // sin ninguna variable no se deja un fichero vacío
      await fs.rm(file, { force: true });
      return;
    }
    await fs.writeFile(tmp, text, { mode: 0o600, flag: "wx" });
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, file);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw new ModelConfigError("No se pudo guardar el almacén de claves de Kioku. Revisa el acceso a su carpeta y vuelve a intentarlo.");
  }
}

/** Guarda la clave del proveedor en el almacén de Kioku. Valida el valor sin repetirlo en ningún error. */
export async function saveKiokuSecret(provider: unknown, value: unknown, o: { userHome: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  const name = credentialName(provider);
  if (typeof value !== "string") throw new ModelConfigError("La clave debe ser texto");
  const clean = value.trim();
  if (badSecret(clean)) throw new ModelConfigError(`La clave no es válida (vacía, con saltos de línea o de más de ${MAX_SECRET} caracteres)`);
  const file = kiokuCredentialsPath(o.userHome, o.env);
  await exclusiveCredentials(async () => writeKiokuEnv(file, withVariable((await readKiokuEnvText(file)) ?? "", name, clean)));
}

/** Quita del almacén de Kioku la clave del proveedor (si no estaba, no hace nada). No toca `~/.hermes/.env` ni el entorno. */
export async function removeKiokuSecret(provider: unknown, o: { userHome: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  const name = credentialName(provider);
  const file = kiokuCredentialsPath(o.userHome, o.env);
  await exclusiveCredentials(async () => {
    const text = await readKiokuEnvText(file);
    if (text !== null) await writeKiokuEnv(file, withVariable(text, name, null));
  });
}

export interface CredentialStatus {
  required: boolean;
  names: string[];
  state: "not-needed" | "found" | "missing" | "invalid" | "local-keyless";
  name?: string;
  source?: SecretSource;
}

/** Cómo se proporciona la clave del proveedor, solo con metadatos (nombre de la variable y de dónde sale): jamás el valor. */
export async function describeCredentials(s: ModelSettings, o: { userHome: string; env?: NodeJS.ProcessEnv }): Promise<CredentialStatus> {
  const spec = PROVIDERS[s.provider];
  if (!spec || spec.keys.length === 0) return { required: false, names: [], state: "not-needed" };
  const local = !!(spec.keylessLocal && s.baseUrl && isTrustedHost(new URL(s.baseUrl).hostname));
  const base = { required: !local, names: [...spec.keys] };
  const found = await findSecret(spec, o);
  if (found) return badSecret(found.value) ? { ...base, state: "invalid", name: found.name } : { ...base, state: "found", name: found.name, source: found.source };
  return { ...base, state: local ? "local-keyless" : "missing" };
}
