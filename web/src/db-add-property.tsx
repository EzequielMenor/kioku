// Columna final «+» de la tabla (solo escritorio): abre un popover con nombre y tipo y añade la propiedad al esquema de la base.
import { useRef, useState } from "preact/hooks";
import { PROP_TYPE_LABEL, PROP_TYPE_ORDER } from "./db-common.ts";
import { editSchema } from "./db-schema.ts";
import type { HeaderMenuCtx } from "./db-header-menu.tsx";
import { Popover } from "./popover.tsx";
import type { PropType } from "./types.ts";

export function AddPropertyButton({ ctx }: { ctx: HeaderMenuCtx }) {
  const btn = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<PropType>("text");
  const close = () => setOpen(false);

  const submit = async () => {
    const n = name.trim();
    if (!n || busy.current) return;
    busy.current = true;
    try {
      const op = { op: "add-property", name: n, type } as const;
      if (await editSchema(op, ctx)) { ctx.onSchema(op); setName(""); setType("text"); close(); }
    } finally { busy.current = false; }
  };

  return (
    <>
      <button class="th add-prop" ref={btn} aria-label="Añadir propiedad" title="Añadir propiedad" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>+</button>
      {open && (
        <Popover anchor={btn.current} label="Nueva propiedad" onClose={close}>
          <div class="pop-section">
            <label class="pop-field">
              <span>Nombre</span>
              <input aria-label="Nombre de la nueva propiedad" value={name} onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }} />
            </label>
            <label class="pop-field">
              <span>Tipo</span>
              <select aria-label="Tipo de la nueva propiedad" value={type} onChange={(e) => setType(e.currentTarget.value as PropType)}>
                {PROP_TYPE_ORDER.map((t) => <option key={t} value={t}>{PROP_TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <button class="primary" disabled={!name.trim()} onClick={() => void submit()}>Añadir</button>
          </div>
        </Popover>
      )}
    </>
  );
}
