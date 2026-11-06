// Cliente del esquema de una base: previsualiza, confirma si se reescriben notas, aplica y ofrece «Deshacer». Sin JSX.
import { api } from "./api.ts";
import { askConfirm } from "./dialogs.tsx";
import type { SchemaOp } from "./types.ts";

export type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;
export type Say = (text: string, error?: boolean, action?: { label: string; run(): void }) => void;
interface Plan { affected: number; summary: string }

/** Operaciones que, si tocan notas, piden confirmación antes de reescribirlas. */
function confirmCopy(op: SchemaOp): { title: string; confirm: string } | null {
  switch (op.op) {
    case "rename-property": return { title: `Renombrar «${op.name}» a «${op.to}»`, confirm: "Renombrar" };
    case "delete-property": return { title: `Borrar la propiedad «${op.name}»`, confirm: "Borrar" };
    case "rename-option": return { title: `Renombrar la opción «${op.option}» a «${op.to}»`, confirm: "Renombrar" };
    case "delete-option": return op.clear ? { title: `Borrar la opción «${op.option}»`, confirm: "Borrar" } : null;
    default: return null;
  }
}

const notes = (n: number) => (n === 1 ? "1 nota" : `${n} notas`);

/** Aplica una operación de esquema. `false` si se cancela o falla (el error ya se mostró con `say`). `confirmed`: quien llama ya preguntó lo mismo. */
export async function editSchema(op: SchemaOp, ctx: { path: string; guard: Guard; say: Say }, opts: { confirmed?: boolean } = {}): Promise<boolean> {
  const done = await ctx.guard(async () => {
    const plan = await api<Plan>("POST", "/api/database/schema/preview", { path: ctx.path, op });
    const copy = confirmCopy(op);
    if (copy && plan.affected > 0 && !opts.confirmed) {
      const ok = await askConfirm({
        title: copy.title,
        body: `Se reescribirán ${notes(plan.affected)}. Podrás deshacerlo justo después.`,
        confirm: copy.confirm,
        danger: op.op === "delete-property" || op.op === "delete-option",
      });
      if (!ok) return false;
    }
    const r = await api<{ undoId: string; summary: string; affected: number }>("POST", "/api/database/schema", { path: ctx.path, op });
    ctx.say(r.summary, false, { label: "Deshacer", run: () => void ctx.guard(async () => { await api("POST", "/api/assistant/undo", { id: r.undoId }); }) });
    return true;
  });
  return done === true;
}
