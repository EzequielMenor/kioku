// Motor del asistente: lo que JARVIS necesita de «quien piensa». Hermes es una implementación; otra podría ser una API compatible con OpenAI.
import type { AssistantSession } from "./session.ts";

export interface AssistantEngine {
  available(): Promise<{ ok: boolean; reason?: string }>;
  ask(i: { message: string; conversation: string; session: AssistantSession; daemonUrl: string }): Promise<{ answer: string }>;
}
