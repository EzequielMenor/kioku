// Sesiones del asistente: una por consulta. El token solo vale mientras la sesión está abierta.
import { randomBytes } from "node:crypto";

/** Quién consulta: el escritorio (clave completa) o el móvil (con su privacidad atada a cada llamada de la sesión). */
export type AssistantRole = "full" | "mobile";

/** El identificador de una sesión del móvil lo fija el servidor: así Deshacer y las propuestas saben de qué rol salieron. */
export const MOBILE_SESSION_PREFIX = "mobile-";
export const MOBILE_PROPOSAL_PREFIX = "mobile:";
export const isMobileSessionId = (id: string): boolean => id.startsWith(MOBILE_SESSION_PREFIX);

/** Marca de origen de las propuestas hechas desde una sesión del móvil (clave de la propuesta; el modelo no la elige). */
export const proposalOrigin = (s: AssistantSession): { key?: string } => (s.role === "mobile" ? { key: `${MOBILE_PROPOSAL_PREFIX}${s.id}` } : {});

export interface AssistantSession {
  id: string;
  token: string;
  role: AssistantRole;
  /** Huella de las exclusiones con que se abrió una consulta del móvil: si cambian, el motor debe empezar de cero (memoria y conversación). */
  scope: string;
  /** Notas modificadas en esta consulta (para el límite de MAX_NOTES_PER_QUERY). */
  touched: Set<string>;
  /** Notas leídas en esta consulta (se muestran al usuario). */
  reads: Set<string>;
  openedAt: number;
}

export class SessionRegistry {
  private byId = new Map<string, AssistantSession>();

  open(role: AssistantRole = "full", scope = ""): AssistantSession {
    const s: AssistantSession = {
      id: (role === "mobile" ? MOBILE_SESSION_PREFIX : "") + randomBytes(8).toString("hex"), token: randomBytes(32).toString("hex"), role, scope,
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
