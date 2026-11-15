// Botón para crear una propiedad/columna en la base (en cabecera «+» de Tabla, barra superior o panel Personalizar):
// permite definir opciones iniciales con color y ofrece atajos rápidos tipo Notion (Prioridad, Estado, etc.).
import { useRef, useState } from "preact/hooks";
import { PROP_TYPE_LABEL, PROP_TYPE_ORDER } from "./db-common.ts";
import { editSchema } from "./db-schema.ts";
import type { HeaderMenuCtx } from "./db-header-menu.tsx";
import { OPTION_COLORS, OPTION_LABELS, optionClass } from "./option-colors.ts";
import { Popover } from "./popover.tsx";
import type { OptionColor, PropOption, PropType } from "./types.ts";

interface PropertyPreset {
  label: string;
  name: string;
  type: PropType;
  options?: PropOption[];
}

export const PROPERTY_PRESETS: readonly PropertyPreset[] = [
  { label: "Prioridad", name: "Prioridad", type: "select", options: [{ name: "Alta", color: "red" }, { name: "Media", color: "yellow" }, { name: "Baja", color: "gray" }] },
  { label: "Estado", name: "Estado", type: "select", options: [{ name: "Pendiente", color: "gray" }, { name: "En curso", color: "blue" }, { name: "Hecho", color: "green" }] },
  { label: "Etiquetas", name: "Etiquetas", type: "multi", options: [{ name: "Importante", color: "orange" }, { name: "Idea", color: "purple" }, { name: "Referencia", color: "blue" }] },
  { label: "Fecha límite", name: "Fecha límite", type: "date" },
  { label: "Completado", name: "Completado", type: "checkbox" },
];

const CYCLE_COLORS: (OptionColor | undefined)[] = [undefined, ...OPTION_COLORS];

export function AddPropertyButton({ ctx, labelText = "+", variant = "th" }: { ctx: HeaderMenuCtx; labelText?: string; variant?: "th" | "btn" }) {
  const btn = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<PropType>("text");
  const [opts, setOpts] = useState<PropOption[]>([]);
  const [optDraft, setOptDraft] = useState("");
  const reset = () => { setName(""); setType("text"); setOpts([]); setOptDraft(""); };
  const close = () => setOpen(false);

  const mergeDraftOptions = (raw: string, base: PropOption[]): PropOption[] => {
    const out = [...base];
    const seen = new Set(out.map((o) => o.name.toLowerCase()));
    for (const part of raw.split(",")) {
      const clean = part.trim();
      if (!clean || seen.has(clean.toLowerCase())) continue;
      seen.add(clean.toLowerCase());
      out.push({ name: clean });
    }
    return out;
  };

  const applyCreate = async (propName: string, propType: PropType, propOpts?: PropOption[]) => {
    if (!propName || busy.current) return;
    busy.current = true;
    try {
      const op = {
        op: "add-property",
        name: propName,
        type: propType,
        ...(propOpts && propOpts.length ? { options: propOpts } : {}),
      } as const;
      if (await editSchema(op, ctx)) {
        ctx.onSchema(op);
        reset();
        close();
      }
    } finally { busy.current = false; }
  };

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    const hasOpts = type === "select" || type === "multi";
    const finalOpts = hasOpts ? mergeDraftOptions(optDraft, opts) : undefined;
    await applyCreate(n, type, finalOpts);
  };

  const addDraftChip = () => {
    if (!optDraft.trim()) return;
    setOpts((prev) => mergeDraftOptions(optDraft, prev));
    setOptDraft("");
  };

  const cycleColor = (idx: number) => {
    setOpts((prev) => prev.map((o, i) => {
      if (i !== idx) return o;
      const cur = CYCLE_COLORS.indexOf(o.color);
      const next = CYCLE_COLORS[(cur + 1) % CYCLE_COLORS.length];
      return next ? { name: o.name, color: next } : { name: o.name };
    }));
  };

  const hasOpts = type === "select" || type === "multi";

  return (
    <>
      <button
        type="button"
        class={variant === "th" ? "th add-prop" : "chip btn"}
        ref={btn}
        aria-label={variant === "th" ? "Añadir propiedad" : labelText}
        title="Añadir columna o propiedad"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {labelText}
      </button>
      {open && (
        <Popover anchor={btn.current} label="Nueva propiedad" onClose={close}>
          <div class="pop-section">
            <label class="pop-field">
              <span>Nombre</span>
              <input aria-label="Nombre de la nueva propiedad" placeholder="Ej. Prioridad, Autor…" value={name} onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }} />
            </label>
            <label class="pop-field">
              <span>Tipo</span>
              <select aria-label="Tipo de la nueva propiedad" value={type} onChange={(e) => setType(e.currentTarget.value as PropType)}>
                {PROP_TYPE_ORDER.map((t) => <option key={t} value={t}>{PROP_TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            {hasOpts && (
              <div class="pop-seed-opts">
                <input
                  aria-label="Opciones iniciales"
                  placeholder="Opciones (ej. Alta, Media, Baja) + Enter"
                  value={optDraft}
                  onInput={(e) => setOptDraft(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDraftChip(); } }}
                />
                {opts.length > 0 && (
                  <div class="opt-list" style="margin-top:6px">
                    {opts.map((o, idx) => (
                      <span key={o.name} class={`opt-chip ${optionClass(o.color)} chip-rm`}>
                        <button type="button" class="chip-color-btn" title={`Cambiar color (${o.color ? OPTION_LABELS[o.color] : "Sin color"})`} onClick={() => cycleColor(idx)}>
                          {o.name}
                        </button>
                        <button type="button" class="chip-x" aria-label={`Quitar opción ${o.name}`} onClick={() => setOpts((p) => p.filter((_, j) => j !== idx))}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                {opts.length > 0 && type === "select" && <p class="muted small pop-hint">Pulsa una opción para rotar su color.</p>}
              </div>
            )}
            <button type="button" class="primary" disabled={!name.trim()} onClick={() => void submit()}>Añadir</button>
          </div>
          <div class="pop-section">
            <div class="muted small pop-hint" style="margin-bottom:6px">Atajos en 1 clic:</div>
            <div class="opt-list">
              {PROPERTY_PRESETS.map((p) => (
                <button key={p.label} type="button" class="chip btn" onClick={() => void applyCreate(p.name, p.type, p.options)}>
                  + {p.label}
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
