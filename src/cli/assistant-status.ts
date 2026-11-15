// `kioku assistant status`: qué motor, proveedor y modelo atenderían la próxima consulta, y si están listos.
// Pregunta al mismo enrutador que usa el daemon, así que informa del proveedor activo (Ollama por el motor nativo,
// Codex u otros por Hermes) en vez de dar por hecho que el asistente es Hermes.
import type { EngineInfo } from "../assistant/engine.ts";

export interface StatusEngine {
  available(): Promise<{ ok: boolean; reason?: string }>;
  describe?(): Promise<EngineInfo>;
}

const ENGINE_TEXT: Record<EngineInfo["engine"], string> = {
  native: "nativo de Kioku (habla directo con un endpoint compatible con OpenAI, p. ej. Ollama)",
  hermes: "Hermes Agent (aislado en su jaula)",
  fake: "motor de pruebas",
};

export async function assistantStatusLines(engine: StatusEngine): Promise<string[]> {
  const [av, info] = await Promise.all([
    engine.available().catch((e: unknown) => ({ ok: false, reason: e instanceof Error ? e.message : String(e) })),
    engine.describe ? engine.describe().catch(() => null) : Promise.resolve(null),
  ]);
  const lines = [av.ok ? "Asistente: listo" : `Asistente: no disponible — ${av.reason ?? "sin motivo"}`];
  // Sin proveedor resuelto (configuración ilegible, p. ej.) el motivo de arriba ya lo dice todo.
  if (!info?.provider) return lines;
  lines.push(`  Motor:      ${ENGINE_TEXT[info.engine] ?? info.engine}`);
  lines.push(`  Proveedor:  ${info.provider}${info.model ? ` · modelo ${info.model}` : " · sin modelo elegido"}`);
  if (info.origin) {
    lines.push(`  Destino:    ${info.origin} (${info.local ? "local: el texto de tus notas no sale de tus equipos" : "remoto: el texto de las notas que lea sale de tu equipo"})`);
  } else if (info.engine === "hermes") {
    lines.push("  Destino:    el servicio del proveedor (remoto: el texto de las notas que lea sale de tu equipo)");
  }
  return lines;
}
