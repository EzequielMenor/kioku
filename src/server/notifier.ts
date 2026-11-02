// Reparte los avisos que decide src/core/notifications.ts. Cada canal tiene su registro en
// .kioku/notify-<canal>.json, así que un canal caído reintenta sin repetir a los demás.
import { execFile } from "node:child_process";
import { addDays, localDate } from "../core/dates.ts";
import type { Kioku } from "../core/kioku.ts";
import { dueNotifications, parseNotifyConfig, type Notification, type NotifyConfig } from "../core/notifications.ts";

export interface Channel {
  name: string;
  /** Refresca lo que el canal necesita saber antes de decidir (p. ej. carpetas privadas). */
  prepare?(): Promise<void>;
  enabled(config: NotifyConfig): boolean;
  /** Qué rutas puede mencionar este canal (el push al móvil no ve las carpetas privadas). */
  visible(path: string): boolean;
  send(n: Notification): Promise<void>;
}

const KEEP_MS = 7 * 86_400_000;
const CONFIG_FILE = "notifications.json";

export class Notifier {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private j: Kioku;
  private channels: Channel[];
  private now: () => Date;
  private onError: (channel: string, e: unknown) => void;

  constructor(j: Kioku, channels: Channel[], now: () => Date = () => new Date(), onError: (channel: string, e: unknown) => void = (c, e) => console.error(`Aviso (${c}) no enviado: ${(e as Error).message}`)) {
    this.j = j; this.channels = channels; this.now = now; this.onError = onError;
  }

  start(intervalMs = 30_000): void {
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const config = parseNotifyConfig(await this.j.vault.readInternal(CONFIG_FILE));
      const now = this.now(), today = localDate(now);
      for (const c of this.channels) { try { await c.prepare?.(); } catch (e) { this.onError(c.name, e); } }
      const active = this.channels.filter((c) => c.enabled(config));
      if (!active.length) return;
      const events = this.j.calendar.range(today, addDays(today, 1)).items;
      const tasks = this.j.index.tasks({ status: ["todo", "doing"] });
      for (const ch of active) {
        const file = `notify-${ch.name}.json`;
        const ledger = await this.readLedger(file, now);
        let changed = false;
        for (const n of dueNotifications({ now, events, tasks, fired: new Set(Object.keys(ledger)), config, visible: ch.visible })) {
          try { await ch.send(n); ledger[n.id] = now.toISOString(); changed = true; } catch (e) { this.onError(ch.name, e); }
        }
        if (changed) await this.j.vault.writeInternal(file, JSON.stringify(ledger));
      }
    } finally { this.busy = false; }
  }

  private async readLedger(file: string, now: Date): Promise<Record<string, string>> {
    let raw: Record<string, string> = {};
    try { const v = JSON.parse((await this.j.vault.readInternal(file)) ?? "{}"); if (v && typeof v === "object" && !Array.isArray(v)) raw = v; } catch { /* registro roto: se empieza de cero */ }
    return Object.fromEntries(Object.entries(raw).filter(([, ts]) => now.getTime() - Date.parse(ts) < KEEP_MS));
  }
}

/** Aviso nativo del escritorio con notify-send; sin dependencias ni red. */
export function desktopChannel(): Channel {
  return {
    name: "desktop",
    enabled: (c) => c.desktop,
    visible: () => true,
    send: (n) => new Promise((resolve, reject) => {
      execFile("notify-send", ["-a", "Kioku", "-u", "normal", "-i", "appointment-soon", n.title, n.body], { timeout: 5000 }, (e) => (e ? reject(e) : resolve()));
    }),
  };
}
