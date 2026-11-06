import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api.ts";
import { askConfirm } from "./dialogs.tsx";
import { useApi } from "./hooks.ts";
import { OpView } from "./proposal-ops.tsx";
import type { Proposal } from "./types.ts";

/** Propuestas reales y visibles para el rol actual; nunca se aplican sin confirmación. */
export function AssistantProposals({ rev, busy, offline }: { rev: number; busy: boolean; offline: boolean }) {
  const { data, error, reload } = useApi<Proposal[]>("/api/proposals?status=pending", rev);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState("");
  const [acting, setActing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!busy) reload(); }, [busy]);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { (trigger.current ?? document.querySelector<HTMLElement>(".assistant-page .composer textarea"))?.focus(); };
  }, [open]);
  const act = async (p: Proposal, action: "apply" | "reject") => {
    if (offline || acting) return;
    if (!(await askConfirm({ title: action === "apply" ? "¿Aplicar esta propuesta?" : "¿Descartar esta propuesta?", body: `${p.title} · ${p.ops.length} ${p.ops.length === 1 ? "cambio" : "cambios"}.`, confirm: action === "apply" ? "Aplicar" : "Descartar", danger: action === "reject" || p.ops.some((o) => o.op === "trash" || o.op === "move" || o.op === "update") }))) return;
    setActing(true); setProblem("");
    try {
      const result = await api<Proposal>("POST", `/api/proposals/${p.id}/${action}`);
      if (result.status === "failed") setProblem(result.error || "No se pudo aplicar la propuesta.");
      else if (result.status !== (action === "apply" ? "applied" : "rejected")) setProblem("La propuesta no se resolvió. Revisa su estado.");
      reload();
    } catch (e) { setProblem((e as Error).message); reload(); }
    finally { setActing(false); }
  };
  const key = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
    if (e.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")];
    if (!items.length) return;
    if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items[items.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === items[items.length - 1]) { e.preventDefault(); items[0].focus(); }
  };
  const pending = data ?? [];
  return <>
    {pending.length > 0 && <aside class="assistant-dock"><div><strong>{pending.length === 1 ? "Una propuesta pendiente" : `${pending.length} propuestas pendientes`}</strong><div class="small muted">Revisa los cambios antes de decidir.</div></div><button ref={trigger} onClick={() => { setProblem(""); setOpen(true); }}>Revisar</button></aside>}
    {error && <p class="bad-text" role="alert">No se pudieron cargar las propuestas: {error}</p>}
    {open && <div class="scrim sheet-scrim assistant-review" onKeyDown={key} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div class="modal sheet" role="dialog" aria-modal="true" aria-label="Revisar propuestas" ref={box}>
        <header class="row"><h2>Antes de cambiar</h2><span class="grow" /><button onClick={() => setOpen(false)} aria-label="Cerrar revisión">Cerrar</button></header>
        {offline && <p role="status">Sin conexión: no se pueden aplicar ni descartar propuestas.</p>}
        {problem && <p class="bad-text" role="alert">{problem}</p>}
        {!pending.length && <p>No hay propuestas pendientes.</p>}
        {pending.map((p) => <section class="assistant-review-item" key={p.id}>
          <div class="eyebrow">{p.source}</div><h3>{p.title}</h3><p class="muted">{p.rationale}</p>
          {p.ops.map((op, i) => <OpView key={i} op={op} />)}
          <div class="row"><button class="primary" disabled={offline || acting} onClick={() => void act(p, "apply")}>Aplicar</button><button disabled={offline || acting} onClick={() => void act(p, "reject")}>Descartar</button></div>
        </section>)}
      </div>
    </div>}
  </>;
}
