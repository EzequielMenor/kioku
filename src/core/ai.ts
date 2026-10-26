// Base de IA: un proveedor SOLO puede devolver propuestas (borradores). Nunca escribe en el vault.
// Hoy: proveedor por reglas, determinista y sin red. Un LLM local o remoto se enchufa implementando AIProvider.
import type { Index, NoteRow } from "./index.ts";
import { normKey } from "./markdown.ts";
import type { ProposalDraft } from "./proposals.ts";
import { sanitizeFileName } from "./vault.ts";

export interface TriageInput {
  captures: NoteRow[];
  projects: { path: string; title: string; aliases: string[] }[];
}

export interface AIProvider {
  readonly id: string;
  available(): Promise<boolean>;
  /** Propone qué hacer con las capturas de la Bandeja. */
  proposeTriage(input: TriageInput): Promise<ProposalDraft[]>;
}

const TASK_VERBS =
  /^(llamar|comprar|revisar|enviar|escribir|hacer|terminar|preparar|estudiar|leer|pagar|reservar|arreglar|ordenar|pedir|mandar|agendar|investigar|configurar|implementar|probar|corregir|actualizar|resolver|crear|montar|instalar|migrar|limpiar|borrar|responder|contestar|apuntar|buscar)\b/i;

const STOP = new Set(["para", "como", "sobre", "desde", "hasta", "entre", "este", "esta", "esto", "algo", "tengo", "tiene"]);

function keywords(s: string): string[] {
  return normKey(s).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 5 && !STOP.has(w));
}

/** Borrador de propuesta para una captura: mismas operaciones, decida quien decida (reglas o modelo). */
export function triageDraft(
  c: Pick<NoteRow, "path" | "title" | "hash">, kind: "task" | "note", project: { title: string } | null, rationale: string, source: string,
): ProposalDraft {
  const base = sanitizeFileName(c.title);
  const props: Record<string, unknown> = kind === "task" ? { type: "task", status: "todo" } : { type: "note" };
  if (project) props[kind === "task" ? "project" : "related"] = `[[${project.title}]]`;
  const label = kind === "task" ? "Convertir en tarea" : "Guardar como nota";
  const at = project ? (kind === "task" ? ` de «${project.title}»` : ` relacionada con «${project.title}»`) : "";
  return {
    source, key: `triage:${c.path}`,
    title: `${label}${at}: ${c.title}`,
    rationale,
    ops: [
      { op: "setProp", path: c.path, before: c.hash, props },
      { op: "move", from: c.path, to: `${kind === "task" ? "Tareas" : "Notas"}/${base}.md`, before: c.hash },
    ],
  };
}

export class RulesProvider implements AIProvider {
  readonly id = "rules";

  async available(): Promise<boolean> {
    return true;
  }

  async proposeTriage(input: TriageInput): Promise<ProposalDraft[]> {
    const out: ProposalDraft[] = [];
    for (const c of input.captures) {
      const text = `${c.title} ${c.body}`;
      const nk = normKey(text);
      const words = new Set(keywords(text));

      // Proyecto: coincidencia del título/alias completo (fuerte) o de una palabra distintiva (débil).
      let project: { path: string; title: string } | null = null;
      let why = "";
      for (const p of input.projects) {
        const names = [p.title, ...p.aliases].map(normKey).filter((n) => n.length >= 3);
        if (names.some((n) => nk.includes(n))) { project = p; why = `menciona «${p.title}»`; break; }
      }
      if (!project) {
        for (const p of input.projects) {
          const shared = keywords(p.title).filter((w) => words.has(w));
          if (shared.length) { project = p; why = `comparte la palabra «${shared[0]}» con «${p.title}»`; break; }
        }
      }

      const isTask = TASK_VERBS.test(c.title.trim());
      const why2 = isTask
        ? `Empieza con un verbo de acción («${c.title.split(/\s+/)[0]}»)${project ? " y " + why : ""}.`
        : `No parece una acción${project ? "; " + why : ""}.`;
      out.push(triageDraft(c, isTask ? "task" : "note", project, why2, "rules"));
    }
    return out;
  }
}

/** Datos exactos que se entregarían a cualquier modelo: nada oculto, todo inspeccionable. */
export function triageInput(index: Index, captures: NoteRow[]): TriageInput {
  const projects = index.listNotes({ type: "project", limit: 500 }).map((p) => {
    const full = index.getNote(p.path)!;
    const al = full.fm.aliases;
    return { path: p.path, title: p.title, aliases: Array.isArray(al) ? al.map(String) : typeof al === "string" ? [al] : [] };
  });
  return { captures, projects };
}
