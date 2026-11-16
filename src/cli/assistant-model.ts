// `kioku assistant model …`: fija el modelo del asistente sin abrir la interfaz (lo usa la app de macOS en su
// configuración inicial). Escribe el mismo override que el panel «Modelo del asistente» (`.kioku/assistant-model.json`),
// nunca `assistant.json`, y con las mismas validaciones.
import os from "node:os";
import { isTailnetHost } from "../assistant/model-config.ts";
import { ModelManagement } from "../assistant/model-management.ts";

/** Modelo local por defecto en el Mac: cabe en 16 GB de memoria unificada y sabe usar herramientas. */
export const DEFAULT_OLLAMA_MODEL = "qwen3.5:9b";
export const MODEL_USAGE = `uso: kioku assistant model ollama [modelo] [--base-url URL]   (por defecto ${DEFAULT_OLLAMA_MODEL} en http://localhost:11434/v1)\n     kioku assistant model reset   ·   kioku assistant model status`;

export async function assistantModelCommand(home: string, args: string[], userHome = os.homedir()): Promise<{ lines: string[]; code: number }> {
  const m = new ModelManagement({ homeDir: home, userHome: () => userHome });
  const [sub, ...rest] = args;
  const describe = (s: Awaited<ReturnType<ModelManagement["state"]>>) =>
    s.effective ? `Modelo del asistente: ${s.effective.provider} · ${s.effective.model ?? "(por defecto)"}${s.effective.baseOrigin ? ` · ${s.effective.baseOrigin}` : ""}` : `Modelo del asistente sin resolver: ${s.error}`;
  try {
    if (sub === "ollama") {
      const bi = rest.indexOf("--base-url");
      const baseUrl = bi >= 0 ? rest[bi + 1] : undefined;
      if (bi >= 0 && !baseUrl) return { lines: [MODEL_USAGE], code: 1 };
      const model = rest.filter((_, i) => i !== bi && i !== bi + 1)[0] ?? DEFAULT_OLLAMA_MODEL;
      const base = baseUrl ?? "http://localhost:11434/v1";
      // Un Ollama de tu tailnet no recibe ninguna clave: escribir su dirección aquí ya es confirmarlo.
      let host = "";
      try { host = new URL(base).hostname; } catch { /* lo rechaza la validación */ }
      const s = await m.save({ provider: "ollama", model, base_url: base, ...(isTailnetHost(host) ? { confirm_origin: new URL(base).origin } : {}) });
      return { lines: [`✓ ${describe(s)}`, "Lo atiende el motor nativo de Kioku: el texto de tus notas no sale de tus equipos."], code: 0 };
    }
    if (sub === "reset") return { lines: [`✓ ${describe(await m.reset())}`], code: 0 };
    if (sub === "status" || sub === undefined) return { lines: [describe(await m.state())], code: 0 };
    return { lines: [MODEL_USAGE], code: 1 };
  } catch (e) {
    return { lines: [(e as Error).message], code: 1 };
  }
}
