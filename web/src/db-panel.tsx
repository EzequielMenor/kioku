// Panel «Filtros y orden» de una base: edita la vista en curso (filtros, orden, agrupación y columnas). Guardarla lo hace databases.tsx.
import { label } from "./db-common.ts";
import type { Column, Filter, FilterOp, View } from "./types.ts";

/* ───────────────────────── filtros / orden / agrupación / columnas ───────────────────────── */

const OPS: { op: FilterOp; label: string; needsValue: boolean }[] = [
  { op: "is", label: "es", needsValue: true }, { op: "is_not", label: "no es", needsValue: true },
  { op: "contains", label: "contiene", needsValue: true }, { op: "empty", label: "está vacío", needsValue: false },
  { op: "not_empty", label: "no está vacío", needsValue: false }, { op: "gt", label: "mayor que", needsValue: true },
  { op: "lt", label: "menor que", needsValue: true }, { op: "before", label: "antes de", needsValue: true },
  { op: "after", label: "después de", needsValue: true }, { op: "checked", label: "marcado", needsValue: false },
];

export function ViewPanel({ view, available, edit }: { view: View; available: Column[]; edit(p: Partial<View>): void }) {
  const first = available[0]?.key ?? "title";
  const setFilter = (i: number, f: Filter) => edit({ filter: view.filter.map((x, j) => (j === i ? f : x)) });
  const cols = view.columns.length ? view.columns : available.filter((c) => c.key !== "tags").map((c) => c.key);
  const propSelect = (value: string, onChange: (v: string) => void, aria: string) => (
    <select value={value} onChange={(e) => onChange(e.currentTarget.value)} aria-label={aria}>
      {available.map((c) => <option key={c.key} value={c.key}>{label(c.key)}</option>)}
      {!available.some((c) => c.key === value) && <option value={value}>{value}</option>}
    </select>
  );
  return (
    <section class="dbpanel" aria-label="Ajustes de la vista">
      <div>
        <h3 class="sec">Filtros</h3>
        {view.filter.map((f, i) => {
          const spec = OPS.find((o) => o.op === f.op)!;
          const col = available.find((c) => c.key === f.prop);
          return (
            <div class="frow" key={i}>
              {propSelect(f.prop, (v) => setFilter(i, { prop: v, op: f.op, value: f.value }), "Propiedad")}
              <select value={f.op} onChange={(e) => setFilter(i, { prop: f.prop, op: e.currentTarget.value as FilterOp, value: f.value })} aria-label="Condición">
                {OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
              </select>
              {spec.needsValue && (col?.options
                ? <select value={String(f.value ?? "")} onChange={(e) => setFilter(i, { ...f, value: e.currentTarget.value })} aria-label="Valor">
                    <option value="">—</option>{col.options.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                  </select>
                : <input value={String(f.value ?? "")} type={col?.type === "date" || f.op === "before" || f.op === "after" ? "date" : "text"} aria-label="Valor"
                    onInput={(e) => setFilter(i, { ...f, value: col?.type === "number" && e.currentTarget.value !== "" && !Number.isNaN(Number(e.currentTarget.value)) ? Number(e.currentTarget.value) : e.currentTarget.value })} />)}
              <button class="subtle" aria-label="Quitar filtro" onClick={() => edit({ filter: view.filter.filter((_, j) => j !== i) })}>✕</button>
            </div>
          );
        })}
        <button class="subtle" onClick={() => edit({ filter: [...view.filter, { prop: first, op: "is", value: "" }] })}>+ Filtro</button>
      </div>
      <div>
        <h3 class="sec">Orden</h3>
        {view.sort.map((s, i) => (
          <div class="frow" key={i}>
            {propSelect(s.prop, (v) => edit({ sort: view.sort.map((x, j) => (j === i ? { ...x, prop: v } : x)) }), "Ordenar por")}
            <select value={s.dir} onChange={(e) => edit({ sort: view.sort.map((x, j) => (j === i ? { ...x, dir: e.currentTarget.value as "asc" | "desc" } : x)) })} aria-label="Dirección">
              <option value="asc">ascendente</option><option value="desc">descendente</option>
            </select>
            <button class="subtle" aria-label="Quitar orden" onClick={() => edit({ sort: view.sort.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button class="subtle" onClick={() => edit({ sort: [...view.sort, { prop: first, dir: "asc" }] })}>+ Orden</button>
        <h3 class="sec">Agrupar por</h3>
        <select value={view.group ?? ""} onChange={(e) => edit({ group: e.currentTarget.value || null })} aria-label="Agrupar por">
          <option value="">Sin agrupar</option>
          {available.map((c) => <option key={c.key} value={c.key}>{label(c.key)}</option>)}
        </select>
      </div>
      <div>
        <h3 class="sec">Columnas</h3>
        <div class="colpick">
          {available.map((c) => (
            <label key={c.key}>
              <input type="checkbox" checked={cols.includes(c.key)}
                onChange={(e) => edit({ columns: e.currentTarget.checked ? [...cols, c.key] : cols.filter((k) => k !== c.key) })} /> {label(c.key)}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
