import type { Proposal } from "./types.ts";

/** La misma vista de cambios se usa en Propuestas y en la revisión del asistente. */
export function OpView({ op }: { op: Proposal["ops"][number] & { current?: Record<string, unknown> | null } }) {
  switch (op.op) {
    case "create": return <div class="op"><b>Crear</b> <code>{op.path}</code><pre>{op.text}</pre></div>;
    case "update": return <div class="op"><b>Reemplazar contenido de</b> <code>{op.path}</code><pre>{op.text}</pre></div>;
    case "move": return <div class="op"><b>Mover</b> <code>{op.from}</code> → <code>{op.to}</code></div>;
    case "trash": return <div class="op"><b>Mover a la papelera</b> <code>{op.path}</code></div>;
    case "setProp": return <div class="op"><b>Cambiar propiedades de</b> <code>{op.path}</code>
      <table class="diff"><tbody>{Object.entries(op.props).map(([k, v]) => <tr key={k}><td>{k}</td><td class="old">{op.current && k in op.current ? JSON.stringify(op.current[k]) : "—"}</td><td>→</td><td class="new">{v === null ? "(quitar)" : JSON.stringify(v)}</td></tr>)}</tbody></table>
    </div>;
  }
}
