// Menú de la cabecera de una columna de la tabla: renombrar, cambiar el tipo, ordenar, ocultar en esta vista y borrar la propiedad.
// Las columnas de sistema (título, etiquetas, ruta, tipo, modificada) no son propiedades: solo ordenan y, salvo el título, se ocultan.
import { useRef, useState } from "preact/hooks";
import { label, PROP_TYPE_LABEL, PROP_TYPE_ORDER, READONLY } from "./db-common.ts";
import { editSchema } from "./db-schema.ts";
import type { Guard, Say } from "./db-schema.ts";
import { Popover } from "./popover.tsx";
import type { Column, PropType, SchemaOp, View } from "./types.ts";

export interface HeaderMenuCtx {
  path: string;
  guard: Guard;
  say: Say;
  /** Cambia la vista en curso (borrador): orden y columnas visibles. No escribe ficheros. */
  edit(p: Partial<View>): void;
  /** Se llama tras un cambio de esquema aplicado, para limpiar del borrador lo que ya no exista. */
  onSchema(op: SchemaOp): void;
}

export function HeaderMenu({ col, view, keys, ctx }: { col: Column; view: View; keys: string[]; ctx: HeaderMenuCtx }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const busy = useRef(false);
  const cur = view.sort[0];
  const name = label(col.key);
  const isProp = !READONLY.has(col.key);
  const close = () => setOpen(false);

  const run = async (op: SchemaOp): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    try {
      const ok = await editSchema(op, ctx);
      if (ok) { ctx.onSchema(op); close(); }
      return ok;
    } finally { busy.current = false; }
  };
  const rename = (value: string) => {
    const to = value.trim();
    if (to && to !== col.key) void run({ op: "rename-property", name: col.key, to });
  };
  const sort = (dir: "asc" | "desc") => { ctx.edit({ sort: cur?.prop === col.key && cur.dir === dir ? [] : [{ prop: col.key, dir }] }); close(); };
  const hide = () => { ctx.edit({ columns: keys.filter((k) => k !== col.key) }); close(); };

  return (
    <>
      <button class="th" ref={btn} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        {name}{cur?.prop === col.key && <span class="muted">{cur.dir === "asc" ? " ↑" : " ↓"}</span>}
      </button>
      {open && (
        <Popover anchor={btn.current} label={`Propiedad ${name}`} onClose={close}>
          {isProp && (
            <div class="pop-section">
              <label class="pop-field">
                <span>Nombre</span>
                <input aria-label="Nombre de la propiedad" defaultValue={col.key} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); rename(e.currentTarget.value); } }} />
              </label>
              <p class="muted small pop-hint">Enter para renombrar.</p>
              <label class="pop-field">
                <span>Tipo</span>
                <select aria-label="Tipo de la propiedad" value={col.type} onChange={(e) => {
                  const select = e.currentTarget;
                  const type = select.value as PropType;
                  if (type === col.type) return;
                  // Si el cambio se rechaza o se cancela, el selector vuelve al tipo real de la columna.
                  void run({ op: "set-type", name: col.key, type }).then((ok) => { if (!ok && select.isConnected) select.value = col.type; });
                }}>
                  {PROP_TYPE_ORDER.map((t) => <option key={t} value={t}>{PROP_TYPE_LABEL[t]}</option>)}
                </select>
              </label>
            </div>
          )}
          <div class="pop-section pop-list">
            <button class="pop-item" aria-pressed={cur?.prop === col.key && cur.dir === "asc"} onClick={() => sort("asc")}>Orden ↑</button>
            <button class="pop-item" aria-pressed={cur?.prop === col.key && cur.dir === "desc"} onClick={() => sort("desc")}>Orden ↓</button>
            {col.key !== "title" && <button class="pop-item" disabled={keys.length < 2} onClick={hide}>Ocultar en esta vista</button>}
          </div>
          {isProp && (
            <div class="pop-section pop-list">
              <button class="pop-item danger" onClick={() => void run({ op: "delete-property", name: col.key })}>Borrar propiedad</button>
            </div>
          )}
        </Popover>
      )}
    </>
  );
}
