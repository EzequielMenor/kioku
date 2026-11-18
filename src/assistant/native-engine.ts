// Motor nativo: Kioku habla directamente con un modelo por la API «chat completions» compatible con OpenAI
// (Ollama, LM Studio, llama.cpp, vLLM, OpenRouter…) y le ofrece SOLO las herramientas de Kioku.
// No hay terminal, ficheros ni red para el modelo: lo único que puede «hacer» es pedir una herramienta, y cada
// llamada pasa por el daemon (`/api/assistant/tools/call`, token de sesión), que impone niveles, exclusiones,
// Deshacer y propuestas igual que con Hermes. Por eso no necesita jaula: aquí no se ejecuta código del modelo.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { soulText, type AskInput, type AssistantEngine, type EngineEvent, type EngineInfo } from "./engine.ts";
import { ModelConfigError, isTrustedHost, resolveModelSettings, resolveProviderSecrets, type ModelSettings } from "./model-config.ts";
import type { AssistantSession } from "./session.ts";

/** Proveedores que el motor nativo sabe atender (todos por «chat completions»). El resto sigue yendo por Hermes. */
export const NATIVE_PROVIDERS: Record<string, { baseUrl?: string; label: string }> = {
  ollama: { baseUrl: "http://localhost:11434/v1", label: "Ollama" },
  custom: { label: "endpoint compatible con OpenAI" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", label: "OpenRouter" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", label: "DeepSeek" },
};

export interface NativeOptions {
  /** Raíz del espacio Kioku (la carpeta que contiene `.kioku/`). */
  homeDir: string;
  userHome?: string;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  /** Tope de toda la consulta (todas las vueltas del modelo y sus herramientas). */
  totalMs?: number;
  /** Espera hasta el primer byte de cada respuesta: cubre la carga en frío del modelo. */
  firstByteMs?: number;
  /** Silencio máximo entre fragmentos de una respuesta en curso. */
  idleMs?: number;
  /** Reintentos ante fallos transitorios (conexión cortada, modelo reiniciándose, 5xx). */
  retries?: number;
  retryDelayMs?: number[];
  maxTurns?: number;
  /** Contexto que se pide a Ollama (`options.num_ctx`). Su valor por defecto (4096) no da ni para el prompt de Kio con sus herramientas. */
  numCtx?: number;
  /** Razonamiento de Ollama (`think`): sin fijar, lo decide el modelo. También `KIOKU_OLLAMA_THINK=0|1`. */
  think?: boolean;
  now?: () => Date;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** Nombre de la herramienta en un mensaje `tool` (lo usa la API nativa de Ollama; no se envía por «chat completions»). */
  name?: string;
}
interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
interface ToolSpecDto { name: string; description: string; inputSchema: object; level?: string }

/** Fallo que merece reintento: el modelo no llegó a hacer nada (una llamada al modelo no tiene efectos en Kioku). */
class Transient extends Error {}
/** Fallo definitivo con un mensaje ya pensado para el usuario. */
class Fatal extends Error {}

const HISTORY_MESSAGES = 16;
const HISTORY_CHARS = 4000;
const MEMORY_CHARS = 4000;
const MEMORY_FILE = "KIOKU.md";
const TOOL_RESULT_CHARS = 24_000;
/** Contexto por defecto para Ollama: el prompt de Kio con sus herramientas ronda los 4.000 tokens y cada resultado suma. */
export const OLLAMA_NUM_CTX = 16_384;

const REMEMBER_TOOL: ToolSpecDto = {
  name: "remember",
  description: "Guarda una preferencia duradera del usuario o de su forma de trabajar (una frase). No es para hechos de notas, tareas o proyectos.",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};

/** Quita el razonamiento que algunos modelos (Qwen, DeepSeek…) dejan dentro del texto. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*$/, "").trim();
}

/** Llamadas a herramientas que un modelo pequeño escribe en el texto (`<tool_call>{…}</tool_call>`) en vez de usar el campo `tool_calls`. */
export function inlineToolCalls(text: string): ToolCall[] {
  const out: ToolCall[] = [];
  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {
    try {
      const v = JSON.parse(m[1]) as { name?: unknown; arguments?: unknown };
      if (typeof v.name !== "string") continue;
      out.push({ id: `inline-${out.length}`, type: "function", function: { name: v.name, arguments: typeof v.arguments === "string" ? v.arguments : JSON.stringify(v.arguments ?? {}) } });
    } catch { /* no era una llamada válida: se queda como texto */ }
  }
  return out;
}

/** Emite solo el texto visible, ocultando lo que va entre <think> y </think> aunque la etiqueta llegue partida. */
function thinkFilter(emit?: (t: string) => void): (piece: string) => void {
  let inThink = false, pending = "";
  return (piece: string) => {
    pending += piece;
    let out = "";
    for (;;) {
      const tag = inThink ? "</think>" : "<think>";
      const at = pending.indexOf(tag);
      if (at >= 0) {
        if (!inThink) out += pending.slice(0, at);
        pending = pending.slice(at + tag.length);
        inThink = !inThink;
        continue;
      }
      // Puede quedar el principio de una etiqueta al final: se retiene hasta saber.
      let keep = 0;
      for (let n = Math.min(tag.length - 1, pending.length); n > 0; n--) if (tag.startsWith(pending.slice(-n))) { keep = n; break; }
      if (!inThink) out += pending.slice(0, pending.length - keep);
      pending = pending.slice(pending.length - keep);
      break;
    }
    if (out) emit?.(out);
  };
}

/**
 * Lee una respuesta en streaming (SSE de «chat completions») y la acumula. `onText` recibe solo texto visible
 * (el razonamiento no se enseña); `onActivity` avisa de cualquier fragmento, para el reloj de inactividad.
 */
export async function readCompletionStream(
  body: AsyncIterable<Uint8Array>, on: { text?: (t: string) => void; activity?: () => void } = {},
): Promise<{ content: string; toolCalls: ToolCall[]; finish: string | null }> {
  const dec = new TextDecoder();
  let buf = "", content = "", finish: string | null = null;
  const calls: ToolCall[] = [];
  const visible = thinkFilter(on.text);
  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let j: any;
    try { j = JSON.parse(data); } catch { return; }
    if (j?.error) throw new Fatal(typeof j.error === "string" ? j.error : String(j.error?.message ?? "El modelo devolvió un error"));
    const choice = j?.choices?.[0];
    if (!choice) return;
    const d = choice.delta ?? choice.message ?? {};
    if (typeof d.content === "string" && d.content) { content += d.content; visible(d.content); }
    for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
      const i = typeof tc.index === "number" ? tc.index : calls.length;
      const cur = (calls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
      if (typeof tc.id === "string" && tc.id) cur.id = tc.id;
      if (typeof tc.function?.name === "string") cur.function.name += tc.function.name;
      const a = tc.function?.arguments;
      if (typeof a === "string") cur.function.arguments += a;
      else if (a && typeof a === "object") cur.function.arguments = JSON.stringify(a);
    }
    if (typeof choice.finish_reason === "string") finish = choice.finish_reason;
  };
  for await (const chunk of body) {
    on.activity?.();
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, nl).trimEnd());
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.trim()) handle(buf.trim());
  return { content, toolCalls: calls.filter(Boolean).filter((c) => c.function.name).map((c, i) => ({ ...c, id: c.id || `call-${i}` })), finish };
}

/**
 * Lee una respuesta en streaming de la API nativa de Ollama (`/api/chat`, una línea JSON por fragmento). El razonamiento
 * llega aparte (`thinking`) y no se enseña; las llamadas a herramientas llegan completas, con los argumentos como objeto.
 */
export async function readOllamaStream(
  body: AsyncIterable<Uint8Array>, on: { text?: (t: string) => void; activity?: () => void } = {},
): Promise<{ content: string; toolCalls: ToolCall[]; finish: string | null; reasoning: string }> {
  const dec = new TextDecoder();
  const visible = thinkFilter(on.text);
  let buf = "", content = "", reasoning = "", finish: string | null = null;
  const calls: ToolCall[] = [];
  const handle = (line: string) => {
    if (!line) return;
    let j: any;
    try { j = JSON.parse(line); } catch { return; }
    if (j?.error) {
      // Un error a mitad de la generación suele ser que Ollama no entendió la llamada a herramienta que escribió el
      // modelo (p. ej. «XML syntax error»). Cada generación es distinta, así que se repite la petición.
      const raw = typeof j.error === "string" ? j.error : String(j.error?.message ?? "El modelo devolvió un error");
      throw new Transient(/syntax error|parse|unexpected|invalid character/i.test(raw) ? `El modelo escribió mal una llamada a herramienta (${raw}).` : raw);
    }
    const m = j?.message ?? {};
    if (typeof m.content === "string" && m.content) { content += m.content; visible(m.content); }
    if (typeof m.thinking === "string") reasoning += m.thinking;
    for (const tc of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
      const name = tc?.function?.name;
      if (typeof name !== "string" || !name) continue;
      const a = tc.function.arguments;
      calls.push({ id: typeof tc.id === "string" && tc.id ? tc.id : `call-${calls.length}`, type: "function", function: { name, arguments: typeof a === "string" ? a : JSON.stringify(a ?? {}) } });
    }
    if (j?.done && typeof j.done_reason === "string") finish = j.done_reason;
  };
  for await (const chunk of body) {
    on.activity?.();
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, nl).trim());
      buf = buf.slice(nl + 1);
    }
  }
  handle(buf.trim());
  return { content, toolCalls: calls, finish, reasoning };
}

/** Mensajes en el formato de `/api/chat` de Ollama: argumentos como objeto y el nombre de la herramienta en cada resultado. */
function toOllamaMessages(messages: ChatMessage[]): object[] {
  return messages.map((m) => {
    const out: Record<string, unknown> = { role: m.role, content: m.content ?? "" };
    if (m.tool_calls?.length) {
      out.tool_calls = m.tool_calls.map((c) => {
        let args: unknown = {};
        try { args = c.function.arguments.trim() ? JSON.parse(c.function.arguments) : {}; } catch { args = {}; }
        return { function: { name: c.function.name, arguments: args } };
      });
    }
    if (m.role === "tool" && m.name) out.tool_name = m.name;
    return out;
  });
}

/** Participios de «hacer algo» en el espacio (masculino/femenino, singular/plural). */
const DONE_VERBS = "(?:cread|guardad|apuntad|añadid|anotad|marcad|registrad|actualizad|convertid|borrad|eliminad|movid|enviad|cambiad|programad|organizad|completad|archivad|renombrad)[oa]s?";
/** Formas de afirmar un cambio: «he creado», «creada la tarea», «ya está apuntado», «ha sido actualizada», «Listo:», «Hecho,». */
const CLAIM_RES = [
  new RegExp(`\\b(?:he|hemos)\\s+(?:\\p{L}+\\s+)?${DONE_VERBS}\\b`, "giu"),
  new RegExp(`(?:^|[.!:;\\n]\\s*)${DONE_VERBS}\\b`, "giu"),
  new RegExp(`\\b(?:está|están|queda|quedan|quedó|quedaron|ha sido|han sido)\\s+(?:ya\\s+)?${DONE_VERBS}\\b`, "giu"),
  /(?:^|[.!\n]\s*)(?:listo|hecho)\s*[:,.!]/giu,
];
/**
 * Lo que el modelo dice haber hecho. No cuentan las negaciones de la misma cláusula («no he creado…», «ninguno ha sido
 * marcado») ni las descripciones («los que están registrados son…»).
 */
export function claimsAction(text: string): boolean {
  for (const re of CLAIM_RES) {
    for (const m of text.matchAll(re)) {
      const start = m.index + (m[0].length - m[0].replace(/^[.!:;\n\s]+/, "").length);
      const before = text.slice(0, start);
      const clause = before.slice(Math.max(...[".", ",", ";", ":", "!", "?", "\n"].map((c) => before.lastIndexOf(c))) + 1).toLowerCase();
      if (/(?<!\p{L})(?:no|nunca|ningún|ninguno|ninguna|nada)(?!\p{L})/u.test(clause)) continue;
      if (/(?<!\p{L})que\s+$/u.test(clause)) continue;
      return true;
    }
  }
  return false;
}

const NO_ACTION_NUDGE = "[Aviso automático de Kioku] En esta petición no has ejecutado ninguna herramienta que cambie algo, así que no has hecho ningún cambio. " +
  "Si el usuario pidió guardar o cambiar algo, llama ahora a la herramienta adecuada. Si no puedes hacerlo (no hay herramienta para eso o falta un dato), dilo con claridad sin afirmar que lo hiciste.";
const EMPTY_NUDGE = "[Aviso automático de Kioku] Tu respuesta llegó vacía. Si falta algún paso, llama a la herramienta; si no, responde al usuario en una o dos frases.";

/** Etiqueta humana de cada cambio, para resumir lo hecho cuando el modelo no lo cuenta. */
const DONE_LABEL: Record<string, string> = {
  create_note: "Nota creada", create_task: "Tarea creada", create_event: "Evento creado", create_row: "Fila añadida",
  log_habit: "Hábito marcado", log_progress: "Avance apuntado", set_props: "Propiedades cambiadas", set_task_status: "Estado de tarea cambiado",
  convert_capture: "Captura convertida", append_to_note: "Texto añadido",
  remember: "Preferencia guardada",
};

/** «mañana jueves 2026-11-19, viernes 2026-11-20, …»: los 7 días siguientes con su nombre, en hora local. */
export function nextDays(now: Date): string {
  const out: string[] = [];
  for (let k = 1; k <= 7; k++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push(`${k === 1 ? "mañana " : ""}${d.toLocaleDateString("es-ES", { weekday: "long" })} ${iso}`);
  }
  return out.join(", ");
}

export class NativeEngine implements AssistantEngine {
  /** Estado propio por huella de privacidad del móvil (`.kioku/native-mobile/<huella>`): conversación separada y sin memoria del escritorio. */
  readonly isolatesMobile = true;
  private o: NativeOptions;
  private queue: Promise<unknown> = Promise.resolve();
  private probe: { at: number; key: string; result: { ok: boolean; reason?: string } } | null = null;

  constructor(o: NativeOptions) {
    this.o = o;
  }

  private get userHome(): string { return this.o.userHome ?? os.homedir(); }
  private get fetch(): typeof fetch { return this.o.fetchFn ?? fetch; }

  private stateDir(session?: AssistantSession): string {
    if (!session || session.role === "full") return path.join(this.o.homeDir, ".kioku", "native");
    return path.join(this.o.homeDir, ".kioku", "native-mobile", createHash("sha256").update(session.scope ?? "").digest("hex"));
  }

  /** Configuración efectiva: mismo origen que Hermes (override de la interfaz → assistant.json → ~/.hermes/config.yaml). */
  private async settings(): Promise<{ settings: ModelSettings; base: string; headers: Record<string, string> }> {
    const settings = await resolveModelSettings({ homeDir: this.o.homeDir, userHome: this.userHome });
    const spec = NATIVE_PROVIDERS[settings.provider];
    if (!spec) throw new ModelConfigError(`El motor nativo de Kioku no atiende el proveedor "${settings.provider}" (sí: ${Object.keys(NATIVE_PROVIDERS).join(", ")}). Usa el motor Hermes para ese proveedor.`);
    const base = (settings.baseUrl ?? spec.baseUrl ?? "").replace(/\/+$/, "");
    if (!base) throw new ModelConfigError(`El proveedor "${settings.provider}" necesita «base_url»`);
    if (!settings.model) throw new ModelConfigError(`Falta el nombre del modelo: elígelo en «Modelo del asistente» o en .kioku/assistant.json → "model"`);
    const secrets = await resolveProviderSecrets({ ...settings, baseUrl: base }, { userHome: this.userHome, env: this.o.env });
    const key = Object.values(secrets)[0];
    return { settings, base, headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) } };
  }

  async describe(): Promise<EngineInfo> {
    try {
      const { settings, base } = await this.settings();
      const u = new URL(base);
      return { engine: "native", provider: settings.provider, model: settings.model ?? null, origin: u.origin, local: isTrustedHost(u.hostname) };
    } catch {
      return { engine: "native", provider: null, model: null, origin: null, local: false };
    }
  }

  /** Modelos que ofrece el endpoint (`GET /models`), para elegir sin teclear el nombre. */
  async models(): Promise<string[]> {
    const { base, headers } = await this.settings();
    const r = await this.fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`El endpoint respondió ${r.status} al listar modelos`);
    const j = (await r.json()) as { data?: { id?: unknown }[] };
    return (j.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === "string").sort();
  }

  /** Comprobación real y barata: ¿responde el endpoint y tiene el modelo? Se guarda unos segundos para no sondear en cada pulsación. */
  async available(): Promise<{ ok: boolean; reason?: string }> {
    let cfg: Awaited<ReturnType<NativeEngine["settings"]>>;
    try { cfg = await this.settings(); }
    catch (e) { if (e instanceof ModelConfigError) return { ok: false, reason: e.message }; throw e; }
    const key = `${cfg.base}|${cfg.settings.model}`;
    const fresh = this.probe && this.probe.key === key && Date.now() - this.probe.at < (this.probe.result.ok ? 15_000 : 3_000);
    if (fresh) return this.probe!.result;
    let result: { ok: boolean; reason?: string };
    try {
      const r = await this.fetch(`${cfg.base}/models`, { headers: cfg.headers, signal: AbortSignal.timeout(4000) });
      if (!r.ok) result = { ok: false, reason: this.explainStatus(r.status, "", cfg) };
      else {
        const ids = (((await r.json().catch(() => ({}))) as { data?: { id?: unknown }[] }).data ?? []).map((m) => String(m.id));
        const wanted = cfg.settings.model!;
        const has = ids.length === 0 || ids.some((id) => id === wanted || id === `${wanted}:latest` || id.split(":")[0] === wanted);
        result = has ? { ok: true } : { ok: false, reason: `El modelo «${wanted}» no está disponible en ${new URL(cfg.base).origin}. Disponibles: ${ids.slice(0, 8).join(", ") || "ninguno"}${cfg.settings.provider === "ollama" ? `. Descárgalo con: ollama pull ${wanted}` : ""}` };
      }
    } catch (e) {
      result = { ok: false, reason: this.explainNetwork(e, cfg) };
    }
    this.probe = { at: Date.now(), key, result };
    return result;
  }

  private where(cfg: { base: string; settings: ModelSettings }): string {
    return `${NATIVE_PROVIDERS[cfg.settings.provider]?.label ?? cfg.settings.provider} (${new URL(cfg.base).origin})`;
  }

  private explainNetwork(e: unknown, cfg: { base: string; settings: ModelSettings }): string {
    const cause = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code ?? "";
    const name = (e as Error)?.name ?? "";
    const host = new URL(cfg.base).hostname;
    const remote = !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
    const where = this.where(cfg);
    if (name === "TimeoutError" || name === "AbortError") return `${where} no responde (tiempo de espera agotado).${remote ? " Comprueba que ese equipo está encendido, sin suspender, y conectado a Tailscale." : " Comprueba que el servidor del modelo está en marcha."}`;
    if (cause === "ECONNREFUSED") return `${where} rechaza la conexión: el servidor del modelo no está en marcha${remote ? " o solo escucha en su propio localhost. En el Mac: `launchctl setenv OLLAMA_HOST <IP de Tailscale del Mac>:11434` y reinicia Ollama (ver docs/assistant-local.md)" : " (arranca Ollama con `ollama serve`)"}.`;
    if (cause === "ENOTFOUND" || cause === "EAI_AGAIN") return `No encuentro el equipo de ${where}: revisa el nombre en «base_url» y que Tailscale esté conectado.`;
    if (cause === "EHOSTUNREACH" || cause === "ENETUNREACH" || cause === "ETIMEDOUT") return `No hay ruta hasta ${where}: el equipo está apagado, suspendido o fuera de la red.`;
    return `No pude hablar con ${where}: ${cause || (e as Error)?.message || "error de red"}.`;
  }

  private explainStatus(status: number, detail: string, cfg: { base: string; settings: ModelSettings }): string {
    const where = this.where(cfg);
    const d = detail.replace(/\s+/g, " ").slice(0, 200);
    if (status === 401) return `${where} rechaza la clave: revisa la variable del proveedor en ~/.hermes/.env o en el entorno de Kioku.`;
    if (status === 403) return `${where} rechaza la petición (403). Si es Ollama detrás de un proxy, no acepta ese nombre de host: publícalo con OLLAMA_HOST en la IP de Tailscale (docs/assistant-local.md).`;
    if (status === 404) return /model/i.test(d) ? `El modelo «${cfg.settings.model}» no existe en ${where}.${cfg.settings.provider === "ollama" ? ` Descárgalo con: ollama pull ${cfg.settings.model}` : ""}` : `${where} no ofrece la API «chat completions» en esa dirección (404): revisa que «base_url» termine en /v1.`;
    if (status === 400 && /tool/i.test(d)) return `El modelo «${cfg.settings.model}» no admite herramientas (tool calling): elige uno que sí (p. ej. un Qwen con «tools»).`;
    return `${where} respondió ${status}${d ? `: ${d}` : ""}.`;
  }

  ask(i: AskInput): Promise<{ answer: string }> {
    // Una consulta a la vez: un modelo local atiende una sola generación con calidad, y el historial no admite carreras.
    const run = this.queue.then(() => this.run(i));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(i: AskInput): Promise<{ answer: string }> {
    let cfg: Awaited<ReturnType<NativeEngine["settings"]>>;
    try { cfg = await this.settings(); }
    catch (e) { if (e instanceof ModelConfigError) throw new Error(e.message); throw e; }

    const dir = this.stateDir(i.session);
    const sessionFile = path.join(dir, "sessions", `${createHash("sha256").update(i.conversation).digest("hex").slice(0, 32)}.json`);
    let history: { role: "user" | "assistant"; content: string }[] = [];
    try { history = (JSON.parse(await fs.readFile(sessionFile, "utf8")) as { messages: typeof history }).messages ?? []; } catch { /* conversación nueva */ }

    const full = i.session.role === "full";
    const memory = full ? await this.readMemory() : "";
    const now = (this.o.now ?? (() => new Date()))();
    const system = [
      soulText({ memory: "native" }),
      `## Ahora\n- Fecha y hora local del usuario: ${now.toLocaleString("sv")} (${now.toLocaleDateString("es-ES", { weekday: "long" })}).\n- Próximos días (úsalos tal cual para «mañana», «el viernes», «la semana que viene»): ${nextDays(now)}.`,
      memory ? `## Lo que recuerdas del usuario\n${memory}` : "",
    ].filter(Boolean).join("\n");
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: i.context ? `${i.context}\n\n${i.message}` : i.message },
    ];

    const daemon = async (method: "GET" | "POST", p: string, body?: unknown) => {
      const r = await this.fetch(`${i.daemonUrl}${p}`, {
        method, headers: { authorization: `Bearer ${i.session.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error((j as { error?: string } | null)?.error ?? `El daemon respondió ${r.status}`);
      return j;
    };
    const specs = [...((await daemon("GET", "/api/assistant/tools/list")) as ToolSpecDto[]), ...(full ? [REMEMBER_TOOL] : [])];
    const space = await this.spaceSummary(daemon);
    if (space) messages[0].content += `\n${space}`;
    const known = new Set(specs.map((s) => s.name));
    const level = new Map(specs.map((s) => [s.name, s.level ?? "write"]));
    const writeTools = new Set(specs.filter((s) => (s.level ?? "write") !== "read").map((s) => s.name));
    const tools = specs.map((s) => ({ type: "function", function: { name: s.name, description: s.description, parameters: s.inputSchema } }));

    const deadline = Date.now() + (this.o.totalMs ?? 240_000);
    const maxTurns = this.o.maxTurns ?? 12;
    let answer = "";
    /** Cambios que de verdad se aplicaron en esta consulta (o propuestas creadas): la base para no aceptar afirmaciones vacías. */
    const done: string[] = [];
    /** Propuestas creadas: no son cambios hechos, esperan la aprobación del usuario. */
    const proposed: string[] = [];
    const summary = () => [
      done.length ? `Hecho:\n${done.map((d) => `- ${d}`).join("\n")}` : "",
      proposed.length ? `Pendiente de tu aprobación (no se ha cambiado nada todavía; revísalo en Propuestas):\n${proposed.map((d) => `- ${d}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
    let nudged = false;
    /** Se usó alguna herramienta (también de lectura): el modelo ya tiene datos delante. */
    let toolsRan = false;
    /** Ya se repitió una vuelta vacía sin razonamiento. */
    let retriedPlain = false;
    let plainNext = false;
    let keepIfNoCall: string | undefined;
    try {
    for (let turn = 0; ; turn++) {
      if (i.signal?.aborted) throw new Error("Consulta cancelada.");
      i.onEvent?.({ type: "thinking" });
      // En la última vuelta ya no se ofrecen herramientas: el modelo debe contestar con lo que tiene.
      const last = turn >= maxTurns - 1;
      const prev = messages.at(-1);
      const afterNudge = prev?.role === "user" && typeof prev.content === "string" && prev.content.startsWith("[Aviso automático de Kioku]");
      const res = await this.complete(cfg, messages, last ? undefined : tools, deadline, i, plainNext ? false : undefined);
      plainNext = false;
      const before = keepIfNoCall;
      keepIfNoCall = undefined;
      const calls = res.toolCalls.length ? res.toolCalls : last ? [] : inlineToolCalls(res.content);
      if (!calls.length) {
        answer = stripThinking(res.content).replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
        // Repetida por una acción anunciada y sin llamar a nada tampoco: era una pregunta («¿qué hábitos he marcado?»
        // razona sobre log_habit). Vale la primera respuesta si no afirmaba ningún cambio.
        if (before) answer = before;
        // Contesta al aviso («Entendido.», «Tienes razón:»), no al usuario, que no lo ha visto.
        else if (afterNudge) answer = answer.replace(/^(?:entendido|de acuerdo|vale|tienes razón|gracias por el (?:aviso|recordatorio)[^.:!]*)\s*[.,:!]\s*/iu, "");
        const cut = res.finish === "length";
        // Un modelo pequeño a veces dice «he creado…» sin haber llamado a nada, o se queda sin decir nada: se le avisa una vez.
        const acted = done.length + proposed.length;
        // «Voy a usar create_note…» en el razonamiento y ninguna llamada: lo anunció y no lo hizo. Se repite sin razonamiento.
        const announced = "reasoning" in res && typeof res.reasoning === "string"
          ? [...writeTools].find((t) => new RegExp(`\\b${t}\\b`).test(res.reasoning as string)) : undefined;
        if (announced && !acted && !cut && !last && !retriedPlain) {
          retriedPlain = true;
          plainNext = true;
          if (answer && !claimsAction(answer)) keepIfNoCall = answer;
          messages.push({ role: "assistant", content: answer || null }, { role: "user", content: `[Aviso automático de Kioku] Has pensado en usar ${announced}, pero no lo has llamado, así que no se ha hecho nada. Si el usuario te lo pidió o te cuenta algo que se guarda (un hábito hecho, una lectura, algo por hacer, un dato), llámalo ahora sin preguntar. Si solo preguntaba, responde sin afirmar que está hecho.` });
          continue;
        }
        // qwen3.5 con razonamiento a veces anuncia la acción («Voy a convertirlas…») y se para sin llamar a nada. Si ya leyó
        // datos y aún no cambió nada, se repite esa vuelta sin razonamiento: actúa con lo que tiene delante. Sin datos no:
        // sin razonar se inventa. Si ya cambió algo, basta con el resumen de lo hecho.
        if (!answer && !cut && !last && toolsRan && !acted && !retriedPlain && cfg.settings.provider === "ollama") {
          retriedPlain = true;
          plainNext = true;
          messages.push({ role: "user", content: EMPTY_NUDGE });
          continue;
        }
        if (!nudged && !last && !cut && ((!done.length && claimsAction(answer)) || (!answer && !acted))) {
          nudged = true;
          messages.push({ role: "assistant", content: answer || null }, { role: "user", content: answer ? NO_ACTION_NUDGE : EMPTY_NUDGE });
          continue;
        }
        if (!done.length && claimsAction(answer) && !proposed.length) {
          answer = "No se ha hecho ningún cambio: el asistente dijo haberlo hecho, pero no llegó a usar ninguna herramienta (o no hay una para eso). Revisa la petición o hazlo tú desde Kioku.";
        } else if (!done.length && proposed.length && (!answer || claimsAction(answer))) {
          answer = summary();
        } else if (!answer && acted) {
          answer = summary();
        } else if (cut) {
          const why = "La respuesta del modelo se cortó porque se quedó sin contexto (memoria de trabajo). Prueba con una petición más corta o empieza una conversación nueva.";
          answer = answer ? `${answer}\n\n(${why})` : why;
          if (acted) answer += `\n\n${summary()}`;
        }
        break;
      }
      messages.push({ role: "assistant", content: stripThinking(res.content).replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim() || null, tool_calls: calls });
      for (const c of calls) {
        if (i.signal?.aborted) throw new Error("Consulta cancelada.");
        const r = await this.runTool(c, known, daemon);
        toolsRan = true;
        if (r.ok && level.get(c.function.name) !== "read") {
          if (c.function.name === "propose") proposed.push(this.describeProposal(c));
          // Kioku puede convertir un cambio en propuesta (límite de notas por consulta, carpeta protegida): no está hecho.
          else if (/"escalated"\s*:\s*true/.test(r.text)) proposed.push(`${this.describeDone(c, r.text).replace(/^[^:]+/, (l) => l.replace(/ (creada|creado|añadida|marcado|apuntado|convertida|cambiadas|cambiado|añadido)$/, ""))}`);
          else done.push(this.describeDone(c, r.text));
        }
        messages.push({ role: "tool", tool_call_id: c.id, name: c.function.name, content: r.text });
      }
    }
    } catch (e) {
      // Si se corta (tiempo, red, cancelación) después de haber cambiado algo, se dice qué cambió: nada queda a escondidas.
      if (!done.length && !proposed.length) throw e;
      throw new Error(`${(e as Error).message}\n\nAntes de cortarse (lo hecho se puede deshacer en «Lo que ha hecho Kio»):\n${summary()}`);
    }

    const keep = [...history, { role: "user" as const, content: i.message.slice(0, HISTORY_CHARS) }, { role: "assistant" as const, content: answer.slice(0, HISTORY_CHARS) }].slice(-HISTORY_MESSAGES);
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(sessionFile, JSON.stringify({ conversation: i.conversation, messages: keep }, null, 2) + "\n", { mode: 0o600 });
    return { answer: answer || "(El modelo no devolvió texto.)" };
  }

  /** Ejecuta una herramienta pedida por el modelo. Nunca lanza: lo que falle vuelve al modelo como error para que rectifique. */
  private async runTool(c: ToolCall, known: Set<string>, daemon: (m: "GET" | "POST", p: string, b?: unknown) => Promise<unknown>): Promise<{ ok: boolean; text: string }> {
    const name = c.function.name;
    const fail = (text: string) => ({ ok: false, text });
    if (!known.has(name)) return fail(`Error: la herramienta «${name.slice(0, 60)}» no existe. Usa solo las herramientas de Kioku que tienes.`);
    let args: unknown;
    try { args = c.function.arguments.trim() ? JSON.parse(c.function.arguments) : {}; }
    catch { return fail("Error: los argumentos no son JSON válido. Repite la llamada con un objeto JSON."); }
    if (!args || typeof args !== "object" || Array.isArray(args)) return fail("Error: los argumentos deben ser un objeto JSON.");
    if (name === REMEMBER_TOOL.name) {
      const text = await this.remember((args as { text?: unknown }).text);
      return { ok: text === "Guardado en la memoria.", text };
    }
    try {
      const r = (await daemon("POST", "/api/assistant/tools/call", { name, args })) as { text: string; isError?: boolean };
      const text = r.text.length > TOOL_RESULT_CHARS ? `${r.text.slice(0, TOOL_RESULT_CHARS)}\n…(resultado recortado: afina la búsqueda o pide menos elementos)` : r.text;
      return r.isError ? fail(`Error: ${text}`) : { ok: true, text };
    } catch (e) {
      return fail(`Error: ${(e as Error).message}`);
    }
  }

  /**
   * «Tu espacio»: qué bases hay y, en las de hábitos, cómo se llama cada uno. A un modelo pequeño le ahorra búsquedas
   * y evita que guarde «hoy hice ejercicio» como nota en vez de marcar el hábito. Pasa por las herramientas (con sus
   * exclusiones); si algo falla, simplemente no se añade.
   */
  private async spaceSummary(daemon: (m: "GET" | "POST", p: string, b?: unknown) => Promise<unknown>): Promise<string> {
    type Db = { path: string; title: string; rows: number; views: { kind: string; track?: string; total?: string }[] };
    const call = async (name: string, args: object) => {
      const r = (await daemon("POST", "/api/assistant/tools/call", { name, args })) as { text: string; isError?: boolean };
      return r.isError ? null : JSON.parse(r.text);
    };
    try {
      const dbs = ((await call("list_databases", {})) ?? []) as Db[];
      if (!dbs.length) return "";
      const lines: string[] = [];
      for (const d of dbs.slice(0, 12)) {
        const habits = d.views.find((v) => v.kind === "habits");
        const progress = d.views.find((v) => v.kind === "progress");
        if (habits) {
          const q = (await call("query_database", { path: d.path })) as { rows?: { title?: string }[] } | null;
          const names = (q?.rows ?? []).map((r) => r.title).filter(Boolean).slice(0, 20);
          lines.push(`- ${d.title} (${d.path}): hábitos ${names.length ? names.map((n) => `«${n}»`).join(", ") : "(ninguno todavía)"}. Para marcar uno hecho usa log_habit con su nombre.`);
        } else if (progress?.track) {
          lines.push(`- ${d.title} (${d.path}): ${d.rows} filas; el avance va en la propiedad «${progress.track}»${progress.total ? ` (de «${progress.total}»)` : ""}. Para apuntarlo usa log_progress con el nombre de la fila y el número (p. ej. «he leído Juan 3» → item «Juan», value 3).`);
        } else lines.push(`- ${d.title} (${d.path}): ${d.rows} filas.`);
      }
      return `## Tu espacio\n${lines.join("\n")}`.slice(0, 1500);
    } catch {
      return "";
    }
  }

  private describeProposal(c: ToolCall): string {
    try { const a = JSON.parse(c.function.arguments) as { title?: unknown }; if (typeof a.title === "string" && a.title) return a.title.slice(0, 200); } catch { /* sin título */ }
    return "Propuesta de cambio";
  }

  /** Una línea honesta sobre un cambio aplicado, con la ruta que devolvió Kioku (no la que dijo el modelo). */
  private describeDone(c: ToolCall, result: string): string {
    const label = DONE_LABEL[c.function.name] ?? `Hecho con ${c.function.name}`;
    let where = "";
    try {
      const out = JSON.parse(result) as { path?: unknown; habit?: unknown; date?: unknown };
      if (typeof out.habit === "string") where = `${out.habit}${typeof out.date === "string" ? `, ${out.date}` : ""}`;
      else if (typeof (out as { item?: unknown }).item === "string") {
        const o = out as Record<string, unknown>;
        const k = Object.keys(o).find((x) => !["path", "item", "total"].includes(x) && typeof o[x] === "number");
        where = `${o.item}${k ? ` (${k}: ${o[k]}${typeof o.total === "number" ? ` de ${o.total}` : ""})` : ""}`;
      }
      else if (typeof out.path === "string") where = out.path;
    } catch { /* resultado en texto */ }
    if (!where) {
      try { const a = JSON.parse(c.function.arguments) as { path?: unknown; title?: unknown }; where = typeof a.path === "string" ? a.path : typeof a.title === "string" ? a.title : ""; } catch { /* sin detalle */ }
    }
    if (c.function.name === "set_props") {
      try {
        const props = (JSON.parse(c.function.arguments) as { props?: Record<string, unknown> }).props ?? {};
        const shown = Object.entries(props).slice(0, 4).map(([k, v]) => `${k}: ${v === null ? "(quitada)" : Array.isArray(v) ? v.join(", ") : String(v)}`.slice(0, 80));
        if (shown.length) where += ` (${shown.join(" · ")})`;
      } catch { /* sin detalle */ }
    }
    return where ? `${label}: ${where}` : label;
  }

  private memoryDir(): string { return path.join(this.o.homeDir, ".kioku", "hermes", "memories"); }

  /** Memoria compartida con Hermes: los mismos ficheros de texto visibles (y borrables) en «Qué recuerda el asistente». */
  private async readMemory(): Promise<string> {
    let out = "";
    try {
      for (const f of (await fs.readdir(this.memoryDir())).sort()) {
        if (f.startsWith(".")) continue;
        const t = await fs.readFile(path.join(this.memoryDir(), f), "utf8").catch(() => "");
        if (t.trim()) out += `${t.trim()}\n`;
        if (out.length > MEMORY_CHARS) break;
      }
    } catch { /* sin memoria todavía */ }
    return out.slice(0, MEMORY_CHARS).trim();
  }

  private async remember(text: unknown): Promise<string> {
    if (typeof text !== "string" || !text.trim()) return "Error: falta «text».";
    const line = text.replace(/\s+/g, " ").trim().slice(0, 300);
    if (/https?:\/\/|<\s*\w/.test(line)) return "Error: la memoria es solo para preferencias en texto plano, sin enlaces ni HTML.";
    const file = path.join(this.memoryDir(), MEMORY_FILE);
    const cur = await fs.readFile(file, "utf8").catch(() => "");
    if (cur.length > 8000) return "Error: la memoria está llena. Pide al usuario que revise «Qué recuerda el asistente».";
    if (cur.split("\n").some((l) => l.trim() === `- ${line}`)) return "Ya lo recordaba.";
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${cur.trimEnd()}${cur.trim() ? "\n" : ""}- ${line}\n`);
    return "Guardado en la memoria.";
  }

  /** Una vuelta del modelo con reintentos: si la conexión se corta o el servidor se reinicia, se repite la misma petición. */
  private async complete(cfg: Awaited<ReturnType<NativeEngine["settings"]>>, messages: ChatMessage[], tools: unknown[] | undefined, deadline: number, i: AskInput, think?: boolean) {
    const retries = this.o.retries ?? 2;
    const delays = this.o.retryDelayMs ?? [800, 2500];
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.completeOnce(cfg, messages, tools, deadline, i, think);
      } catch (e) {
        if (!(e instanceof Transient) || attempt >= retries || i.signal?.aborted) throw e instanceof Transient || e instanceof Fatal ? new Error(e.message) : e;
        const wait = delays[Math.min(attempt, delays.length - 1)] ?? 1000;
        if (Date.now() + wait >= deadline) throw new Error(e.message);
        i.onEvent?.({ type: "retry", attempt: attempt + 1, reason: e.message });
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  private async completeOnce(cfg: Awaited<ReturnType<NativeEngine["settings"]>>, messages: ChatMessage[], tools: unknown[] | undefined, deadline: number, i: AskInput, thinkOverride?: boolean) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Fatal("El asistente tardó demasiado y se canceló.");
    const ac = new AbortController();
    let why: "first" | "idle" | "total" | "user" | null = null;
    const abort = (w: NonNullable<typeof why>) => { why ??= w; ac.abort(); };
    const onUser = () => abort("user");
    i.signal?.addEventListener("abort", onUser, { once: true });
    const total = setTimeout(() => abort("total"), left);
    let timer = setTimeout(() => abort("first"), Math.min(left, this.o.firstByteMs ?? 120_000));
    const beat = () => { clearTimeout(timer); timer = setTimeout(() => abort("idle"), this.o.idleMs ?? 60_000); };
    let produced = false;
    try {
      // Ollama por su API nativa: es la única que respeta `num_ctx` (por «chat completions» se queda en 4096 tokens y corta).
      const ollama = cfg.settings.provider === "ollama";
      const numCtx = this.o.numCtx ?? (Number((this.o.env ?? process.env).KIOKU_OLLAMA_NUM_CTX) || OLLAMA_NUM_CTX);
      const thinkEnv = (this.o.env ?? process.env).KIOKU_OLLAMA_THINK;
      const think = thinkOverride ?? this.o.think ?? (thinkEnv === "0" ? false : thinkEnv === "1" ? true : undefined);
      const r = ollama
        ? await this.fetch(`${cfg.base.replace(/\/v1$/, "")}/api/chat`, {
          method: "POST", headers: cfg.headers, signal: ac.signal,
          body: JSON.stringify({ model: cfg.settings.model, messages: toOllamaMessages(messages), stream: true, options: { num_ctx: numCtx }, ...(think === undefined ? {} : { think }), ...(tools ? { tools } : {}) }),
        })
        : await this.fetch(`${cfg.base}/chat/completions`, {
          method: "POST", headers: cfg.headers, signal: ac.signal,
          body: JSON.stringify({ model: cfg.settings.model, messages: messages.map(({ name: _n, ...m }) => m), stream: true, ...(tools ? { tools } : {}) }),
        });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        let msg = detail;
        try { const j = JSON.parse(detail) as { error?: unknown }; msg = typeof j.error === "string" ? j.error : String((j.error as { message?: unknown })?.message ?? detail); } catch { /* texto plano */ }
        const text = this.explainStatus(r.status, msg, cfg);
        // 5xx y 429: el servidor del modelo se está reiniciando, cargando o saturado.
        throw r.status >= 500 || r.status === 429 ? new Transient(text) : new Fatal(text);
      }
      beat();
      if (ollama) {
        if (!r.body) throw new Transient("El modelo cerró la conexión sin responder.");
        return await readOllamaStream(r.body as unknown as AsyncIterable<Uint8Array>, {
          activity: beat,
          text: (t) => { produced = true; i.onEvent?.({ type: "delta", text: t } satisfies EngineEvent); },
        });
      }
      if (!(r.headers.get("content-type") ?? "").includes("text/event-stream")) {
        // Servidor que ignora `stream`: respuesta JSON completa.
        const j = (await r.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
        const m = j.choices?.[0]?.message ?? {};
        const content = m.content ?? "";
        if (stripThinking(content)) i.onEvent?.({ type: "delta", text: stripThinking(content) });
        return { content, toolCalls: (m.tool_calls ?? []).map((c, n) => ({ id: c.id || `call-${n}`, type: "function" as const, function: { name: c.function?.name ?? "", arguments: typeof c.function?.arguments === "string" ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {}) } })).filter((c) => c.function.name), finish: null };
      }
      if (!r.body) throw new Transient("El modelo cerró la conexión sin responder.");
      return await readCompletionStream(r.body as unknown as AsyncIterable<Uint8Array>, {
        activity: beat,
        text: (t) => { produced = true; i.onEvent?.({ type: "delta", text: t } satisfies EngineEvent); },
      });
    } catch (e) {
      if (e instanceof Transient || e instanceof Fatal) throw e;
      if (why === "user") throw new Fatal("Consulta cancelada.");
      if (why === "total") throw new Fatal("El asistente tardó demasiado y se canceló.");
      if (why === "first") throw new Fatal(`${this.where(cfg)} no empezó a responder a tiempo. Si el modelo se estaba cargando, vuelve a intentarlo en unos segundos.`);
      if (why === "idle") throw new Transient(`${this.where(cfg)} dejó de responder a mitad de la respuesta.`);
      // Error de red (conexión rechazada, cortada, modelo reiniciado): reintentable. Lo ya mostrado se descarta en la interfaz al reintentar.
      const text = produced ? `Se cortó la conexión con ${this.where(cfg)} a mitad de la respuesta.` : this.explainNetwork(e, cfg);
      throw new Transient(text);
    } finally {
      clearTimeout(total);
      clearTimeout(timer);
      i.signal?.removeEventListener("abort", onUser);
    }
  }
}
