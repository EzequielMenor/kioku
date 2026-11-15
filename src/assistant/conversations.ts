// Conversaciones con el asistente, guardadas en el daemon (`.kioku/conversations/<id>.json`): texto plano, legible y
// borrable. Son la única copia: el panel de Kioku y el compañero de escritorio leen y escriben la misma, así que
// cambiar de interfaz no pierde el hilo.
import { createHash } from "node:crypto";
import { ulid } from "../core/ids.ts";
import type { Vault } from "../core/vault.ts";

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: string;
  error?: boolean;
  /** Notas leídas para responder. */
  reads?: string[];
  /** Identificadores de las acciones automáticas (Deshacer) de esta respuesta. */
  actions?: string[];
  /** Identificadores de las propuestas que nacieron en esta respuesta. */
  proposals?: string[];
  /** Interfaz desde la que se escribió («web», «desktop», «cli»…). */
  surface?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
}

const MAX_MESSAGES = 400;
const DIR = "conversations";
const SAFE = /^[A-Za-z0-9_-]{1,80}$/;

export const newConversationId = (now = Date.now()): string => `c-${ulid(now).toLowerCase()}`;

/** Nombre de fichero de una conversación: el propio id si es simple; si no, su huella (nunca una ruta). */
export function conversationFile(id: string): string {
  return `${DIR}/${SAFE.test(id) ? id : `h-${createHash("sha256").update(id).digest("hex").slice(0, 40)}`}.json`;
}

const titleOf = (text: string): string => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "Conversación";
};

export class ConversationStore {
  private vault: Vault;
  /** Las escrituras de una misma conversación van en fila. */
  private queues = new Map<string, Promise<unknown>>();

  constructor(vault: Vault) {
    this.vault = vault;
  }

  async get(id: string): Promise<Conversation | null> {
    const text = await this.vault.readInternal(conversationFile(id));
    if (!text) return null;
    try {
      const c = JSON.parse(text) as Conversation;
      return c && Array.isArray(c.messages) ? c : null;
    } catch {
      return null; // ilegible: se trata como inexistente, sin pisarla hasta que se escriba de nuevo
    }
  }

  append(id: string, m: Omit<StoredMessage, "id" | "ts"> & { ts?: string }): Promise<StoredMessage> {
    const run = (this.queues.get(id) ?? Promise.resolve()).then(async () => {
      const now = new Date();
      const cur = (await this.get(id)) ?? { id, title: "", createdAt: now.toISOString(), updatedAt: now.toISOString(), messages: [] };
      const msg: StoredMessage = { ...m, id: ulid(Math.max(now.getTime(), 0)), ts: m.ts ?? now.toISOString() };
      cur.messages = [...cur.messages, msg].slice(-MAX_MESSAGES);
      if (!cur.title && m.role === "user") cur.title = titleOf(m.text);
      cur.updatedAt = msg.ts;
      await this.vault.writeInternal(conversationFile(id), JSON.stringify(cur, null, 2) + "\n");
      return msg;
    });
    this.queues.set(id, run.catch(() => undefined));
    return run;
  }

  async list(limit = 30): Promise<{ id: string; title: string; updatedAt: string; count: number }[]> {
    const out: { id: string; title: string; updatedAt: string; count: number }[] = [];
    for (const f of await this.vault.listInternal(DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const c = JSON.parse((await this.vault.readInternal(`${DIR}/${f}`)) ?? "") as Conversation;
        if (c?.id && c.messages?.length) out.push({ id: c.id, title: c.title || "Conversación", updatedAt: c.updatedAt, count: c.messages.length });
      } catch { /* ilegible: se ignora */ }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }

  async remove(id: string): Promise<void> {
    await this.vault.removeInternal(conversationFile(id));
  }
}
