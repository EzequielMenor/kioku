// Kio ordena «Sin organizar» por su cuenta: convierte cada captura en nota o tarea con un título claro, etiquetas y
// enlaces. Lo capturado ya está a salvo en disco antes de que esto actúe, así que sin modelo no se pierde nada; cada
// cambio lo aplican las herramientas de escritura del asistente y queda en Actividad con Deshacer.

export interface OrganizerDeps {
  /** Capturas pendientes (sin las aparcadas por el foco). */
  pending(): { path: string; mtime: number }[];
  /** ¿Hay modelo que responda ahora? */
  ready(): Promise<boolean>;
  /** ¿Kio está libre (sin una consulta del usuario en curso)? */
  idle(): boolean;
  /** Encarga a Kio ordenar estas capturas. */
  organize(paths: string[]): Promise<void>;
  now(): number;
}

/** Capturas por encargo: cada conversión toca la captura y crea una nota; dos caben en el límite de 5 notas por consulta. */
export const ORGANIZE_BATCH = 2;
/** Una captura recién escrita se deja reposar: puede que el usuario aún la esté completando. */
export const SETTLE_MS = 20_000;
/** Tras una pregunta del usuario, su conversación va primero (un modelo local atiende una consulta a la vez). */
export const QUIET_MS = 60_000;
/** Intentos por captura (misma ruta y misma versión): si el modelo falla o la deja, queda para el usuario. */
export const MAX_ATTEMPTS = 2;

export class Organizer {
  private d: OrganizerDeps;
  private attempts = new Map<string, number>();
  private running = false;
  private lastUser = -Infinity;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(d: OrganizerDeps) { this.d = d; }

  /** El usuario acaba de hablar con Kio: el ordenado espera. */
  noteUserActivity(): void { this.lastUser = this.d.now(); }

  /** Una pasada. `now`: «Ordenar ahora» del usuario, sin esperar reposo ni silencio. Devuelve las rutas encargadas. */
  async tick(o: { now?: boolean } = {}): Promise<string[]> {
    if (this.running) return [];
    const t = this.d.now();
    if (!o.now && (t - this.lastUser < QUIET_MS || !this.d.idle())) return [];
    const key = (c: { path: string; mtime: number }) => `${c.path}@${c.mtime}`;
    const due = this.d.pending()
      .filter((c) => (o.now || t - c.mtime >= SETTLE_MS) && (this.attempts.get(key(c)) ?? 0) < MAX_ATTEMPTS)
      .sort((a, b) => a.mtime - b.mtime)
      .slice(0, ORGANIZE_BATCH);
    if (!due.length) return [];
    this.running = true;
    try {
      if (!(await this.d.ready())) return [];
      for (const c of due) this.attempts.set(key(c), (this.attempts.get(key(c)) ?? 0) + 1);
      const paths = due.map((c) => c.path);
      try { await this.d.organize(paths); } catch { /* se reintenta en otra pasada, hasta MAX_ATTEMPTS */ }
      return paths;
    } finally {
      this.running = false;
    }
  }

  start(everyMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick().catch(() => undefined); }, everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** El encargo que recibe Kio. Rutas exactas, qué herramienta usar y qué no hacer nunca. */
export function organizePrompt(paths: string[], today: string): string {
  return [
    "Ordena estas capturas de «Sin organizar» (rutas exactas):",
    ...paths.map((p) => `- ${p}`),
    "",
    `Hoy es ${today}. Para cada captura, lee su texto (read_note) y conviértela con convert_capture:`,
    "- kind \"task\" si es algo por hacer (con due AAAA-MM-DD si dice el día); si no, kind \"note\".",
    "- title: corto y claro (será el nombre de la nota). tags: de 1 a 3 temas en minúsculas.",
    "- Si registra algo de una base (un hábito hecho, una lectura), actualiza también esa fila.",
    "- Si hay una nota existente claramente relacionada (búscala con search), añade al final de la nota nueva una línea «Relacionado: [[Título]]» con append_to_note.",
    "No borres, no muevas ni reescribas el texto del usuario. Al terminar, responde con una línea por captura diciendo qué hiciste.",
  ].join("\n");
}
