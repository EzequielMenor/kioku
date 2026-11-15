// Kioku Companion dentro de Kioku: el personaje (Kio) flotando en una esquina y un panel compacto para hablarle.
// Es una vista más del mismo agente: conversación, estado y ajustes vienen del daemon (companion-store), así que
// lo que se haga aquí aparece igual en la página Asistente y en el compañero de escritorio.
import { useEffect, useRef, useState } from "preact/hooks";
import { api, lsGet, lsSet, onChange } from "./api.ts";
import { CHARACTER_NAME, createFace, themePalette, type Face, type FaceState } from "./companion-face.ts";
import { createCompanionStore, faceState, viewContext, type CompanionEvent, type CompanionState } from "./companion-store.ts";
import { askConfirm } from "./dialogs.tsx";
import { OpView } from "./proposal-ops.tsx";
import type { CompanionMode, MessageView, Proposal, UndoRecord } from "./types.ts";
import "./companion.css";

export const companion = createCompanionStore({ api, onEvent: (cb) => onChange((e) => cb(e as CompanionEvent)) });

/** Estado compartido del compañero. `enabled`: solo el escritorio conecta (el móvil tiene su propia conversación privada). */
export function useCompanion(enabled = true): CompanionState {
  const [s, set] = useState(companion.getState());
  useEffect(() => {
    if (!enabled) return;
    companion.start();
    set(companion.getState());
    return companion.subscribe(set);
  }, [enabled]);
  return s;
}

const STATE_TEXT: Record<FaceState, string> = {
  idle: "Listo", listening: "Te escucho", thinking: "Pensando…", responding: "Respondiendo…",
  awaiting_confirmation: "Espera tu decisión", success: "Hecho", error: "Algo falló", quiet: "En concentración",
};

/** El personaje. Se anima solo mientras está a la vista y respeta «reducir movimiento». */
export function KioFace({ state, size = 56 }: { state: FaceState; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const face = useRef<Face | null>(null);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const f = createFace(ref.current!, { palette: themePalette, reducedMotion: reduced });
    face.current = f;
    f.set(state);
    f.start();
    const vis = () => (document.hidden ? f.stop() : f.start());
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); f.stop(); };
  }, []);
  useEffect(() => { face.current?.set(state); }, [state]);
  return <canvas ref={ref} class="kio-face" style={{ width: `${size}px`, height: `${size}px` }} data-state={state} aria-hidden="true" />;
}

/** Avisa al daemon de si Kioku está en primer plano: con Kioku delante manda este personaje y el de escritorio se retira. */
function usePresence(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const id = Math.random().toString(36).slice(2, 10);
    const focused = () => !document.hidden && document.hasFocus();
    const report = () => companion.presence(id, focused());
    report();
    const beat = setInterval(() => { if (focused()) report(); }, 10_000);
    addEventListener("focus", report);
    addEventListener("blur", report);
    document.addEventListener("visibilitychange", report);
    addEventListener("pagehide", () => companion.presence(id, false));
    return () => { clearInterval(beat); removeEventListener("focus", report); removeEventListener("blur", report); document.removeEventListener("visibilitychange", report); companion.presence(id, false); };
  }, [enabled]);
}

const MODE_LABEL: Record<CompanionMode, string> = { active: "visible", focus: "concentración", hidden: "oculto" };
const NEXT_MODE: Record<CompanionMode, CompanionMode> = { active: "focus", focus: "hidden", hidden: "active" };

/** Botón de la barra lateral: muestra el modo del compañero y lo cambia (también lo recupera cuando está oculto). */
export function CompanionModeButton() {
  const s = useCompanion();
  if (!s.ready) return null;
  const mode = s.companion.mode;
  return (
    <button class="side-btn subtle" title="Visible · Concentración (mínimo y en silencio) · Oculto" onClick={() => void companion.setMode(NEXT_MODE[mode])}>
      {CHARACTER_NAME}: {MODE_LABEL[mode]}
    </button>
  );
}

type Say = (text: string, error?: boolean) => void;

export function Companion({ route, go, say }: { route: string; go(r: string): void; say: Say }) {
  const s = useCompanion();
  usePresence(s.ready);
  const [open, setOpenRaw] = useState(lsGet("companion.open") === "1");
  const setOpen = (v: boolean) => { setOpenRaw(v); lsSet("companion.open", v ? "1" : "0"); };
  const onAssistantPage = route.split("/").filter(Boolean)[0] === "asistente";

  // «.» abre o cierra el panel cuando no se está escribiendo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "." || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, .cm-editor, [contenteditable]")) return;
      if (document.querySelector(".scrim")) return;
      e.preventDefault();
      setOpen(!(lsGet("companion.open") === "1"));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  if (!s.ready || s.companion.mode === "hidden" || onAssistantPage) return null;
  const quiet = s.companion.quiet;
  const fs = faceState(s.agent, quiet);
  const label = s.agent.label ?? STATE_TEXT[fs];
  // Sin el panel abierto, solo asoma un aviso corto cuando hay algo que atender; en concentración, ni eso.
  const peek = !open && !quiet && (fs === "awaiting_confirmation" || fs === "error" || fs === "thinking" || fs === "responding");

  return (
    <div class={`kio ${open ? "open" : ""} ${quiet ? "quiet" : ""}`} data-state={fs}>
      {open && <CompanionPanel s={s} route={route} go={go} say={say} onClose={() => setOpen(false)} />}
      {peek && <button class="kio-peek" onClick={() => setOpen(true)}>{label}</button>}
      <button class="kio-button" aria-label={`${CHARACTER_NAME}, tu compañero: ${label}. ${open ? "Cerrar" : "Abrir"} el panel`} aria-expanded={open} title={`${CHARACTER_NAME} · ${label}  (.)`} onClick={() => setOpen(!open)}>
        <KioFace state={fs} size={quiet && !open ? 34 : 56} />
      </button>
    </div>
  );
}

function CompanionPanel({ s, route, go, say, onClose }: { s: CompanionState; route: string; go(r: string): void; say: Say; onClose(): void }) {
  const [text, setText] = useState("");
  const [ack, setAck] = useState(lsGet("assistant.privacy.v2") === "1");
  const [status, setStatus] = useState<{ ok: boolean; reason?: string } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const ctx = viewContext(route);
  const busy = s.agent.busy || s.sending;
  const fs = faceState(s.agent, false);

  useEffect(() => { input.current?.focus(); }, [ack]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [s.msgs.length, s.streaming, s.agent.label]);
  useEffect(() => { api<{ ok: boolean; reason?: string }>("GET", "/api/assistant/status").then(setStatus, () => setStatus(null)); }, [s.engine?.model, s.problem]);

  const send = () => {
    if (!text.trim() || busy || !ack) return;
    const m = text;
    setText("");
    companion.listening(false);
    void companion.send(m, { route: ctx.route, path: ctx.path });
  };
  const engine = s.engine;

  return (
    <section class="kio-panel" role="dialog" aria-label={`Conversación con ${CHARACTER_NAME}`} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <header class="kio-head">
        <div class="kio-title">
          <strong>{CHARACTER_NAME}</strong>
          <span class="kio-status" role="status">{s.agent.label ?? STATE_TEXT[fs]}</span>
        </div>
        {engine?.model && <span class={`chip ${engine.local ? "" : "bad"}`} title={engine.local ? "El modelo corre en tus equipos: tus notas no salen de ellos" : "Proveedor remoto: el texto de las notas que lea sale de tu equipo"}>{engine.local ? "local" : "remoto"} · {engine.model}</span>}
        <span class="grow" />
        <button class="kio-icon" title="Nueva conversación" aria-label="Nueva conversación" disabled={busy} onClick={() => void companion.newConversation()}>＋</button>
        <button class={`kio-icon ${s.companion.mode === "focus" ? "on" : ""}`} title="Modo concentración: mínimo y en silencio" aria-label="Modo concentración" aria-pressed={s.companion.mode === "focus"} onClick={() => void companion.setMode(s.companion.mode === "focus" ? "active" : "focus")}>◐</button>
        <button class="kio-icon" title="Abrir la conversación completa" aria-label="Abrir la conversación completa" onClick={() => { onClose(); go("/asistente"); }}>⤢</button>
        <button class="kio-icon" title="Ocultar el compañero (se recupera en la barra lateral)" aria-label="Ocultar el compañero" onClick={() => { say(`${CHARACTER_NAME} se oculta. Recupéralo en la barra lateral.`); void companion.setMode("hidden"); }}>⌄</button>
        <button class="kio-icon" title="Cerrar (Esc)" aria-label="Cerrar el panel" onClick={onClose}>×</button>
      </header>

      <div class="kio-body" aria-live="polite">
        {status && !status.ok && <div class="notice bad">El asistente no está disponible: {status.reason}</div>}
        {!ack && (
          <div class="kio-ack">
            <p>Para responder, {CHARACTER_NAME} <b>lee las notas que necesita</b> con las herramientas de Kioku y envía ese texto al modelo configurado{engine?.model ? <> (<b>{engine.local ? "local" : "remoto"}</b>: {engine.model})</> : null}. Lo pequeño lo hace solo, con <b>Deshacer</b>; borrar, mover o tocar muchas notas te lo propone antes.</p>
            <button class="primary" onClick={() => { lsSet("assistant.privacy.v2", "1"); setAck(true); }}>Entendido</button>
          </div>
        )}
        {ack && s.msgs.length === 0 && !busy && <p class="muted kio-empty">Pregúntame por tus notas, tareas o proyectos, o pídeme que cree o actualice algo. Veo que estás en <b>{ctx.label}</b>.</p>}
        {s.msgs.map((m) => <PanelMessage key={m.id} m={m} say={say} busy={busy} />)}
        {busy && (s.streaming
          ? <div class="bubble assistant"><div class="btext">{s.streaming}<span class="kio-caret" aria-hidden="true" /></div></div>
          : <div class="bubble assistant live"><span class="dots" aria-hidden="true" /> {s.agent.label ?? "Pensando…"}</div>)}
        {s.problem && <div class="notice bad" role="alert">{s.problem} <button class="mini" onClick={() => companion.dismissProblem()}>Vale</button></div>}
        <div ref={bottom} />
      </div>

      <form class="kio-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <div class="kio-context muted small" title="Kio sabe qué tienes delante; el contenido lo lee con sus herramientas y permisos">Viendo: {ctx.label}</div>
        <div class="row">
          <textarea ref={input} rows={Math.min(4, Math.max(1, text.split("\n").length))} value={text} disabled={!ack} aria-label={`Mensaje para ${CHARACTER_NAME}`}
            placeholder={ack ? "Escribe a Kio…  (Enter envía)" : "Acepta el aviso para empezar"}
            onInput={(e) => { const v = (e.target as HTMLTextAreaElement).value; setText(v); companion.listening(v.trim() !== ""); }}
            onBlur={() => companion.listening(false)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }} />
          {s.agent.busy
            ? <button type="button" onClick={() => void companion.cancel()}>Detener</button>
            : <button class="primary" type="submit" disabled={!ack || busy || !text.trim()}>Enviar</button>}
        </div>
      </form>
    </section>
  );
}

function PanelMessage({ m, say, busy }: { m: MessageView; say: Say; busy: boolean }) {
  return (
    <div class={`bubble ${m.role}${m.error ? " error" : ""}`}>
      <div class="btext">{m.text}</div>
      {!!m.reads?.length && <div class="kio-reads muted small">Leyó {m.reads.length} {m.reads.length === 1 ? "nota" : "notas"}: {m.reads.slice(0, 3).map((p, i) => <span key={p}>{i > 0 && ", "}<a href={`#/nota/${encodeURI(p)}`}>{p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/, "")}</a></span>)}{m.reads.length > 3 && "…"}</div>}
      {m.actions.map((a) => <PanelAction key={a.id} a={a} say={say} />)}
      {m.proposals.map((p) => <PanelProposal key={p.id} p={p} say={say} busy={busy} />)}
    </div>
  );
}

function PanelAction({ a, say }: { a: UndoRecord; say: Say }) {
  const [working, setWorking] = useState(false);
  const undo = async () => {
    setWorking(true);
    try { await api("POST", "/api/assistant/undo", { id: a.id }); say("Deshecho."); await companion.reload(); }
    catch (e) { say((e as Error).message, true); }
    finally { setWorking(false); }
  };
  return (
    <div class={`action${a.undone ? " undone" : ""}`}>
      <span>{a.summary}</span>
      <button class="mini" disabled={!!a.undone || working} onClick={() => void undo()}>{a.undone ? "Deshecho" : "Deshacer"}</button>
    </div>
  );
}

/** Confirmación de una propuesta: se ve qué cambiará y nada ocurre hasta pulsar Aplicar. */
function PanelProposal({ p, say, busy }: { p: Proposal; say: Say; busy: boolean }) {
  const [working, setWorking] = useState(false);
  const act = async (what: "apply" | "reject") => {
    const risky = p.ops.some((o) => o.op === "trash" || o.op === "move" || o.op === "update");
    if (what === "apply" && risky && !(await askConfirm({ title: "¿Aplicar esta propuesta?", body: `${p.title} · ${p.ops.length} ${p.ops.length === 1 ? "cambio" : "cambios"}. Lo borrado va a la papelera de Kioku.`, confirm: "Aplicar", danger: true }))) return;
    setWorking(true);
    try {
      const r = await api<Proposal>("POST", `/api/proposals/${p.id}/${what}`);
      if (r.status === "failed") say(r.error || "No se pudo aplicar la propuesta.", true);
      else say(what === "apply" ? "Propuesta aplicada." : "Propuesta descartada.");
      await companion.reload();
    } catch (e) { say((e as Error).message, true); }
    finally { setWorking(false); }
  };
  const done = p.status !== "pending";
  return (
    <div class={`kio-proposal ${done ? "done" : ""}`}>
      <div class="eyebrow">{done ? (p.status === "applied" ? "Aplicada" : p.status === "rejected" ? "Descartada" : "No se pudo aplicar") : "Necesita tu confirmación"}</div>
      <strong>{p.title}</strong>
      <p class="muted small">{p.rationale}</p>
      <details><summary>{p.ops.length} {p.ops.length === 1 ? "cambio" : "cambios"}</summary>{p.ops.map((op, i) => <OpView key={i} op={op} />)}</details>
      {!done && <div class="row"><button class="primary" disabled={working || busy} onClick={() => void act("apply")}>Aplicar</button><button disabled={working || busy} onClick={() => void act("reject")}>Descartar</button></div>}
    </div>
  );
}
