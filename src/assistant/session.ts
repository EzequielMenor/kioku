// Sesiones del asistente: una por consulta. El token solo vale mientras la sesión está abierta.
import { randomBytes } from "node:crypto";

export interface AssistantSession {
  id: string;
  token: string;
  /** Notas modificadas en esta consulta (para el límite de MAX_NOTES_PER_QUERY). */
  touched: Set<string>;
  /** Notas leídas en esta consulta (se muestran al usuario). */
  reads: Set<string>;
  openedAt: number;
}

export class SessionRegistry {
  private byId = new Map<string, AssistantSession>();

  open(): AssistantSession {
    const s: AssistantSession = {
      id: randomBytes(8).toString("hex"), token: randomBytes(32).toString("hex"),
      touched: new Set(), reads: new Set(), openedAt: Date.now(),
    };
    this.byId.set(s.id, s);
    return s;
  }

  byToken(token: string | undefined): AssistantSession | null {
    if (!token) return null;
    for (const s of this.byId.values()) if (s.token === token) return s;
    return null;
  }

  close(id: string): void {
    this.byId.delete(id);
  }
}
