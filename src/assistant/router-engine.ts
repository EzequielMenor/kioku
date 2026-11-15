// Un solo asistente, varios motores: decide quién atiende cada consulta según la configuración vigente.
//   · `native`  → Kioku habla directo con un endpoint «chat completions» (Ollama y compatibles).
//   · `hermes`  → Hermes Agent en su jaula (Codex por suscripción y el resto de proveedores).
// `.kioku/assistant.json → "engine"` fija uno; sin él («auto») Ollama y `custom` van por el nativo y lo demás por Hermes.
// No hay cambio automático de proveedor cuando uno falla: enviar las notas a otro destino lo decide el usuario.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AskInput, AssistantEngine, EngineInfo } from "./engine.ts";
import { ModelConfigError, resolveModelSettings } from "./model-config.ts";
import type { ModelManagement } from "./model-management.ts";
import { NATIVE_PROVIDERS, type NativeEngine } from "./native-engine.ts";

export type EngineChoice = "auto" | "native" | "hermes";
const AUTO_NATIVE = new Set(["ollama", "custom"]);

/** Lee `engine` de assistant.json. Ausente o fichero inexistente = auto; un valor desconocido falla cerrado. */
export async function readEngineChoice(homeDir: string): Promise<EngineChoice> {
  let text: string;
  try { text = await fs.readFile(path.join(homeDir, ".kioku", "assistant.json"), "utf8"); }
  catch { return "auto"; }
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new ModelConfigError(".kioku/assistant.json no es JSON válido: corrígelo para usar el asistente"); }
  const v = json && typeof json === "object" ? (json as { engine?: unknown }).engine : undefined;
  if (v === undefined || v === null || v === "" || v === "auto") return "auto";
  if (v === "native" || v === "hermes") return v;
  throw new ModelConfigError('.kioku/assistant.json: «engine» debe ser "auto", "native" o "hermes"');
}

export class RouterEngine implements AssistantEngine {
  readonly isolatesMobile: boolean;
  readonly modelManagement?: ModelManagement;
  private o: { homeDir: string; userHome: string; hermes: AssistantEngine; native: NativeEngine };

  constructor(o: { homeDir: string; userHome: string; hermes: AssistantEngine; native: NativeEngine }) {
    this.o = o;
    this.isolatesMobile = !!o.hermes.isolatesMobile && o.native.isolatesMobile;
    this.modelManagement = o.hermes.modelManagement;
  }

  /** Motor vigente; los errores de configuración se devuelven como motivo, sin lanzar. */
  async pick(): Promise<{ engine: AssistantEngine; name: "native" | "hermes" } | { reason: string }> {
    try {
      const choice = await readEngineChoice(this.o.homeDir);
      if (choice === "hermes") return { engine: this.o.hermes, name: "hermes" };
      const { provider } = await resolveModelSettings({ homeDir: this.o.homeDir, userHome: this.o.userHome });
      if (choice === "native") {
        if (!NATIVE_PROVIDERS[provider]) return { reason: `El motor nativo no atiende el proveedor "${provider}". Elige Ollama o un endpoint compatible con OpenAI en «Modelo del asistente», o quita "engine": "native" de .kioku/assistant.json.` };
        return { engine: this.o.native, name: "native" };
      }
      return AUTO_NATIVE.has(provider) ? { engine: this.o.native, name: "native" } : { engine: this.o.hermes, name: "hermes" };
    } catch (e) {
      if (e instanceof ModelConfigError) return { reason: e.message };
      throw e;
    }
  }

  async available(): Promise<{ ok: boolean; reason?: string }> {
    const p = await this.pick();
    return "reason" in p ? { ok: false, reason: p.reason } : p.engine.available();
  }

  async describe(): Promise<EngineInfo> {
    const p = await this.pick();
    if ("reason" in p) return { engine: "native", provider: null, model: null, origin: null, local: false };
    return (await p.engine.describe?.()) ?? { engine: p.name, provider: null, model: null, origin: null, local: false };
  }

  /** Modelos del endpoint nativo (para el selector); vacío si el motor vigente no es el nativo. */
  async models(): Promise<string[]> {
    const p = await this.pick();
    return "reason" in p || p.name !== "native" ? [] : this.o.native.models();
  }

  async ask(i: AskInput): Promise<{ answer: string }> {
    const p = await this.pick();
    if ("reason" in p) throw new Error(p.reason);
    return p.engine.ask(i);
  }
}
