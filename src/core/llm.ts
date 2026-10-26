// Proveedor LLM opcional (API compatible con OpenAI: Ollama, llama.cpp, LM Studio, o una API remota con clave propia).
// Garantías: solo se usa cuando el usuario lo pide y tras ver el payload EXACTO; la clave vive en una variable de entorno
// (nunca en disco); el modelo solo clasifica capturas — las operaciones las construye JARVIS y pasan por Propuestas.
import { createHash } from "node:crypto";
import { triageDraft, type AIProvider, type TriageInput } from "./ai.ts";
import { normKey } from "./markdown.ts";
import type { ProposalDraft } from "./proposals.ts";

export interface LlmConfig {
  baseUrl: string; // p. ej. http://127.0.0.1:11434/v1
  model: string;
  /** Nombre de la variable de entorno que contiene la clave (opcional; Ollama no la necesita). */
  apiKeyEnv?: string;
}

export interface LlmPayload {
  endpoint: string;
  model: string;
  /** true si el destino es esta misma máquina: los datos no salen de ella. */
  local: boolean;
  messages: { role: "system" | "user"; content: string }[];
  captures: number;
  /** Huella del payload: el servidor exige que coincida con lo que el usuario vio antes de enviar. */
  hash: string;
}

export const MAX_CAPTURES = 20;
const MAX_BODY = 600;

export function parseLlmConfig(text: string | null): LlmConfig | null {
  if (!text) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.baseUrl !== "string" || typeof o.model !== "string" || !o.model.trim()) return null;
  let u: URL;
  try { u = new URL(o.baseUrl); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const apiKeyEnv = typeof o.apiKeyEnv === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(o.apiKeyEnv) ? o.apiKeyEnv : undefined;
  return { baseUrl: o.baseUrl.replace(/\/+$/, ""), model: o.model.trim(), apiKeyEnv };
}

export const isLocalUrl = (baseUrl: string): boolean => {
  const h = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
};

const SYSTEM = [
  "Eres el clasificador de la Bandeja de JARVIS, un segundo cerebro local. Recibes capturas rápidas y una lista de proyectos.",
  "Para cada captura decide: kind = \"task\" si es una acción concreta que hay que hacer, o \"note\" si es información/idea.",
  "Si la captura pertenece claramente a uno de los proyectos dados, indica su título EXACTO en project; si no, null.",
  "No inventes proyectos ni rutas. Responde SOLO con JSON: {\"items\":[{\"path\":\"…\",\"kind\":\"task|note\",\"project\":\"…\"|null,\"reason\":\"una frase breve en español\"}]}",
].join("\n");

export function buildPayload(cfg: LlmConfig, input: TriageInput): LlmPayload | null {
  const caps = input.captures.slice(0, MAX_CAPTURES);
  if (!caps.length) return null;
  const user = JSON.stringify({
    projects: input.projects.map((p) => ({ title: p.title, aliases: p.aliases })),
    captures: caps.map((c) => ({ path: c.path, title: c.title, text: c.body.trim().slice(0, MAX_BODY) })),
  }, null, 2);
  const messages = [{ role: "system" as const, content: SYSTEM }, { role: "user" as const, content: user }];
  const endpoint = `${cfg.baseUrl}/chat/completions`;
  const hash = createHash("sha256").update(JSON.stringify({ endpoint, model: cfg.model, messages })).digest("hex").slice(0, 16);
  return { endpoint, model: cfg.model, local: isLocalUrl(cfg.baseUrl), messages, captures: caps.length, hash };
}

/** Extrae y valida la respuesta del modelo. Todo lo que no encaje con la bandeja real se descarta. */
export function parseTriageReply(text: string, input: TriageInput): ProposalDraft[] {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("La respuesta del modelo no contiene JSON");
  let data: unknown;
  try { data = JSON.parse(m[0]); } catch { throw new Error("La respuesta del modelo no es JSON válido"); }
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) throw new Error("La respuesta del modelo no trae «items»");
  const byPath = new Map(input.captures.map((c) => [c.path, c]));
  const out: ProposalDraft[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const cap = typeof o.path === "string" ? byPath.get(o.path) : undefined;
    if (!cap || seen.has(cap.path) || (o.kind !== "task" && o.kind !== "note")) continue;
    seen.add(cap.path);
    const want = typeof o.project === "string" ? normKey(o.project) : "";
    const project = want ? input.projects.find((p) => normKey(p.title) === want) ?? null : null;
    const reason = typeof o.reason === "string" ? o.reason.replace(/\s+/g, " ").trim().slice(0, 240) : "";
    out.push(triageDraft(cap, o.kind, project, reason || "Sin explicación del modelo.", ""));
  }
  return out;
}

export class LlmProvider implements AIProvider {
  readonly id: string;
  private cfg: LlmConfig;
  private fetchImpl: typeof fetch;

  constructor(cfg: LlmConfig, fetchImpl: typeof fetch = fetch) {
    this.cfg = cfg;
    this.id = `llm:${cfg.model}`;
    this.fetchImpl = fetchImpl;
  }

  async available(): Promise<boolean> {
    return true;
  }

  async proposeTriage(input: TriageInput): Promise<ProposalDraft[]> {
    const payload = buildPayload(this.cfg, input);
    if (!payload) return [];
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.cfg.apiKeyEnv) {
      const key = process.env[this.cfg.apiKeyEnv];
      if (!key) throw new Error(`Falta la variable de entorno ${this.cfg.apiKeyEnv} (clave de la API)`);
      headers.authorization = `Bearer ${key}`;
    }
    const res = await this.fetchImpl(payload.endpoint, {
      method: "POST", headers, signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({ model: payload.model, messages: payload.messages, temperature: 0, stream: false }),
    });
    if (!res.ok) throw new Error(`El modelo respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Respuesta inesperada del modelo");
    return parseTriageReply(content, input).map((d) => ({ ...d, source: this.id }));
  }
}
