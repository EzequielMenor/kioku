// Editor de las opciones de una propiedad de selección o multiselección (dentro del menú de su cabecera): punto de color con paleta,
// renombrar, subir/bajar, borrar (pregunta si vaciar el valor en las notas) y «Nueva opción». Cada cambio es una operación de esquema.
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api.ts";
import { askConfirm } from "./dialogs.tsx";
import { OPTION_COLORS, OPTION_LABELS, optionClass } from "./option-colors.ts";
import type { Guard } from "./db-schema.ts";
import type { OptionColor, PropOption, SchemaOp } from "./types.ts";

interface Props {
  prop: string;
  options: PropOption[];
  path: string;
  guard: Guard;
  /** Aplica la operación (con vista previa, confirmación y «Deshacer»); `confirmed` si ya se preguntó. */
  apply(op: SchemaOp, opts?: { confirmed?: boolean }): Promise<boolean>;
}

export function OptionsEditor({ prop, options, path, guard, apply }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  const [palette, setPalette] = useState<string | null>(null);

  // Tras subir o bajar, la fila cambia de sitio y el navegador suelta el foco: vuelve al botón que se pulsó.
  useEffect(() => {
    if (!refocus.current) return;
    root.current?.querySelector<HTMLElement>(`[aria-label="${CSS.escape(refocus.current)}"]`)?.focus();
    refocus.current = null;
  }, [options]);

  const move = (i: number, d: -1 | 1) => {
    const names = options.map((o) => o.name);
    [names[i], names[i + d]] = [names[i + d], names[i]];
    refocus.current = `${d < 0 ? "Subir" : "Bajar"} ${options[i].name}`;
    void apply({ op: "reorder-options", prop, options: names }).then((ok) => { if (!ok) refocus.current = null; });
  };
  const rename = (o: PropOption, value: string) => {
    const to = value.trim();
    if (to && to !== o.name) void apply({ op: "rename-option", prop, option: o.name, to });
  };
  const color = (o: PropOption, c: OptionColor | null) => {
    setPalette(null);
    if ((o.color ?? null) !== c) void apply({ op: "set-option-color", prop, option: o.name, color: c });
  };
  const remove = async (o: PropOption) => {
    // El número de notas sale de previsualizar el borrado con `clear`; «Cancelar» conserva el valor en ellas (la opción se borra igual, con «Deshacer»).
    const plan = await guard(() => api<{ affected: number }>("POST", "/api/database/schema/preview", { path, op: { op: "delete-option", prop, option: o.name, clear: true } }));
    if (!plan) return;
    const n = plan.affected;
    const clear = n > 0 && (await askConfirm({
      title: `¿Vaciar «${o.name}» en ${n === 1 ? "1 nota" : `${n} notas`}?`,
      body: `Se borrará la opción «${o.name}». «Cancelar» la borra sin tocar las notas, que conservan ese valor.`,
      confirm: "Vaciar y borrar",
      danger: true,
    }));
    await apply({ op: "delete-option", prop, option: o.name, ...(clear ? { clear: true } : {}) }, { confirmed: clear });
  };
  const add = async (input: HTMLInputElement) => {
    const name = input.value.trim();
    if (name && (await apply({ op: "add-option", prop, option: name }))) input.value = "";
  };

  return (
    <div ref={root}>
      <h3 class="pop-title">Opciones</h3>
      {options.map((o, i) => (
        <div key={o.name}>
          <div class="opt-row">
            <button class={`opt-dot ${optionClass(o.color)}`} aria-label={`Color de ${o.name}`} aria-expanded={palette === o.name} title={o.color ? OPTION_LABELS[o.color] : "Sin color"}
              onClick={() => setPalette(palette === o.name ? null : o.name)} />
            <input key={o.name} defaultValue={o.name} aria-label={`Renombrar ${o.name}`}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); rename(o, e.currentTarget.value); } }} />
            <button aria-label={`Subir ${o.name}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button aria-label={`Bajar ${o.name}`} disabled={i === options.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button class="danger" aria-label={`Borrar ${o.name}`} onClick={() => void remove(o)}>×</button>
          </div>
          {palette === o.name && (
            <div class="opt-swatches" role="group" aria-label={`Colores de ${o.name}`}>
              {OPTION_COLORS.map((c) => <button key={c} class={optionClass(c)} aria-label={OPTION_LABELS[c]} aria-pressed={o.color === c} onClick={() => color(o, c)}>{OPTION_LABELS[c]}</button>)}
              <button class="opt-none" aria-label="Sin color" aria-pressed={!o.color} onClick={() => color(o, null)}>Sin color</button>
            </div>
          )}
        </div>
      ))}
      <div class="opt-new">
        <input aria-label="Nueva opción" placeholder="Nueva opción (Enter)" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(e.currentTarget); } }} />
      </div>
    </div>
  );
}
