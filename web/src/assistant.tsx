// Asistente: conversación con el motor (Hermes en jaula), actividad en vivo y Deshacer por acción.
import { useEffect, useRef, useState } from "preact/hooks";
import { api, lsGet, lsSet, onChange } from "./api.ts";
import { useApi } from "./hooks.ts";
import { askConfirm } from "./dialogs.tsx";
import type { Proposal, UndoRecord } from "./types.ts";

type Say = (text: string, error?: boolean) => void;
type Msg = { role: "user" | "assistant"; text: string; error?: boolean; reads?: string[]; actions?: UndoRecord[]; proposals?: Proposal[] };

// El historial vive en memoria del cliente (sobrevive a cambiar de pantalla, no a recargar).
let history: Msg[] = [];
let conversation = newId();
function newId(): string { return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }

const SUGGESTIONS = ["¿Qué hago hoy?", "Clasifica mi Bandeja", "Revisa mi espacio: Bandeja, proyectos parados, enlaces rotos y duplicados. Propón lo necesario."];

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** Texto del indicador en vivo a partir de un evento `assistant.tool`. */
export function liveLabel(tool: string, path?: string | null): string {
  const p = path ? ` ${path}` : "";
  if (tool === "read_note" || tool === "get_project") return `Leyendo${p}…`;
  if (tool === "search") return "Buscando en tus notas…";
  if (tool === "inbox") return "Revisando tu Bandeja…";
  if (tool === "today") return "Mirando tu día…";
  if (tool === "list_tasks") return "Revisando tus tareas…";
  if (tool === "list_notes") return "Listando tus notas…";
  if (tool === "list_databases" || tool === "query_database") return "Consultando tus bases de datos…";
  if (tool === "neighbors") return `Mirando los enlaces de${p || " una nota"}…`;
  if (tool === "recent_activity") return "Repasando tu actividad reciente…";
  if (tool === "propose") return "Preparando una propuesta…";
  if (tool === "create_row") return `Añadiendo una fila${path ? ` a ${path}` : ""}…`;
  if (tool.startsWith("create_") || tool.startsWith("add_") || tool === "append_to_note") return `Escribiendo${p}…`;
  if (tool === "set_props" || tool === "set_task_status" || tool === "convert_capture") return `Actualizando${p}…`;
  return `Consultando (${tool})…`;
}

export function AssistantView({ rev, say, go }: { rev: number; say: Say; go(r: string): void }) {
  const [msgs, setMsgs] = useState<Msg[]>(history);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [ack, setAck] = useState(lsGet("assistant.privacy") === "1");
  const status = useApi<{ ok: boolean; reason?: string }>("/api/assistant/status", rev).data;
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const push = (m: Msg) => { history = [...history, m]; setMsgs(history); };
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [msgs, live]);
  useEffect(() => { input.current?.focus(); }, [ack]);
  useEffect(() => onChange((e) => { if (e.kind === "assistant.tool" && e.tool) setLive(liveLabel(e.tool, e.path)); }), []);

  const pendingIds = async () => new Set((await api<Proposal[]>("GET", "/api/proposals?status=pending")).map((p) => p.id));

  const send = async (message: string) => {
    const m = message.trim();
    if (!m || busy) return;
    setText("");
    push({ role: "user", text: m });
    setBusy(true);
    setLive("Pensando…");
    const startedAt = new Date().toISOString();
    try {
      const before = await pendingIds().catch(() => new Set<string>());
      const r = await api<{ answer: string; reads: string[]; actions: UndoRecord[] }>("POST", "/api/assistant/ask", { message: m, conversation });
      const after = await api<Proposal[]>("GET", "/api/proposals?status=pending").catch(() => [] as Proposal[]);
      push({ role: "assistant", text: r.answer, reads: r.reads, actions: r.actions, proposals: after.filter((p) => !before.has(p.id) && p.source === "assistant") });
    } catch (e) {
      // Si falló a medias, lo que ya cambió sigue siendo deshacible: se muestra igualmente.
      const actions = await api<UndoRecord[]>("GET", "/api/assistant/actions").then((l) => l.filter((a) => a.ts >= startedAt && !a.undone), () => []);
      push({ role: "assistant", text: (e as Error).message, error: true, actions });
    } finally {
      setBusy(false);
      setLive(null);
    }
  };

  const reset = () => { history = []; conversation = newId(); setMsgs([]); };

  return (
    <div class="page narrow assistant-page">
      <header class="page-head">
        <h1>Asistente</h1>
        <div class="row">
          <a class="pill" href="#/asistente/actividad">Actividad</a>
          <a class="pill" href="#/asistente/memoria">Memoria</a>
          {msgs.length > 0 && <button class="mini" onClick={reset} disabled={busy}>Nueva conversación</button>}
        </div>
      </header>

      {status && !status.ok && <div class="notice bad">El asistente no está disponible: {status.reason}</div>}

      {!ack && (
        <div class="card notice-card">
          <div class="eyebrow">Antes de empezar</div>
          <p>Para responder, el asistente <b>lee las notas que necesita</b> y su texto se envía al proveedor del modelo (OpenAI, a través de tu suscripción de Codex). Queda registrado qué notas lee en cada consulta y puedes excluir carpetas en <code>.jarvis/assistant.json</code>.</p>
          <p class="muted small">Lo pequeño y reversible lo hace solo, con botón <b>Deshacer</b>. Borrar, mover o tocar muchas notas siempre te lo propone antes.</p>
          <button class="primary" onClick={() => { lsSet("assistant.privacy", "1"); setAck(true); }}>Entendido</button>
        </div>
      )}

      <div class="chat" aria-live="polite">
        {msgs.length === 0 && ack && (
          <div class="chat-empty">
            <p class="muted">Pídeme lo que quieras sobre tu espacio: organizar la Bandeja, ver qué hacer hoy, retomar un proyecto, crear tareas…</p>
            <div class="pills">{SUGGESTIONS.map((s) => <button key={s} class="pill" onClick={() => void send(s)}>{s.length > 40 ? "Revisar mi espacio" : s}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => <Bubble key={i} m={m} say={say} go={go} />)}
        {busy && <div class="bubble assistant live"><span class="dots" aria-hidden="true" /> {live}</div>}
        <div ref={bottom} />
      </div>

      <form class="composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea ref={input} rows={2} value={text} disabled={!ack} placeholder={ack ? "Escribe al asistente…  (Enter envía · Shift+Enter nueva línea)" : "Acepta el aviso para empezar"}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send(text); } }} />
        <button class="primary" type="submit" disabled={!ack || busy || !text.trim()}>Enviar</button>
      </form>
    </div>
  );
}

function Bubble({ m, say, go }: { m: Msg; say: Say; go(r: string): void }) {
  return (
    <div class={`bubble ${m.role}${m.error ? " error" : ""}`}>
      <div class="btext">{m.text}</div>
      {!!m.reads?.length && (
        <details class="reads"><summary>Ha leído {m.reads.length} {m.reads.length === 1 ? "nota" : "notas"}</summary>
          <ul>{m.reads.map((p) => <li key={p}><a href={`#/nota/${enc(p)}`}>{p}</a></li>)}</ul>
        </details>
      )}
      {m.actions?.map((a) => <ActionRow key={a.id} a={a} say={say} />)}
      {!!m.proposals?.length && (
        <div class="action proposal">
          <span>{m.proposals.length === 1 ? "Ha dejado una propuesta" : `Ha dejado ${m.proposals.length} propuestas`} pendiente{m.proposals.length === 1 ? "" : "s"} de tu aprobación</span>
          <button class="mini" onClick={() => go("/propuestas")}>Revisar</button>
        </div>
      )}
    </div>
  );
}

function ActionRow({ a, say }: { a: UndoRecord; say: Say }) {
  const [undone, setUndone] = useState(!!a.undone);
  const [busy, setBusy] = useState(false);
  const undo = async () => {
    setBusy(true);
    try { await api("POST", "/api/assistant/undo", { id: a.id }); setUndone(true); say("Deshecho."); }
    catch (e) { say((e as Error).message, true); }
    finally { setBusy(false); }
  };
  return (
    <div class={`action${undone ? " undone" : ""}`}>
      <span>{undone ? "↶ " : "✓ "}{a.summary}</span>
      <button class="mini" disabled={undone || busy} onClick={() => void undo()}>{undone ? "Deshecho" : "Deshacer"}</button>
    </div>
  );
}

/** Todo lo que el asistente ha hecho por su cuenta, con Deshacer. */
export function AssistantActivity({ rev, say }: { rev: number; say: Say }) {
  const { data, reload } = useApi<UndoRecord[]>("/api/assistant/actions", rev);
  return (
    <div class="page narrow">
      <header class="page-head"><h1>Actividad del asistente</h1><a class="pill" href="#/asistente">Volver</a></header>
      <p class="muted">Cada cambio automático queda aquí. Deshacer solo funciona si no has tocado la nota desde entonces (si la editaste tú, avisa del conflicto y no pisa nada).</p>
      {data && data.length === 0 && <div class="empty">El asistente aún no ha hecho cambios por su cuenta.</div>}
      <ul class="cards">
        {(data ?? []).map((a) => (
          <li key={a.id} class="card activity">
            <div>
              <div class="ctitle">{a.summary}</div>
              <div class="muted small">{new Date(a.ts).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })} · {a.files.map((f) => f.path).join(", ")}</div>
            </div>
            <ActivityUndo a={a} say={say} onDone={reload} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActivityUndo({ a, say, onDone }: { a: UndoRecord; say: Say; onDone(): void }) {
  const [busy, setBusy] = useState(false);
  if (a.undone) return <span class="muted small">Deshecho</span>;
  return (
    <button class="mini" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await api("POST", "/api/assistant/undo", { id: a.id }); say("Deshecho."); onDone(); }
      catch (e) { say((e as Error).message, true); }
      finally { setBusy(false); }
    }}>Deshacer</button>
  );
}

/** Lo que el asistente recuerda entre conversaciones: texto plano, visible y borrable. */
export function AssistantMemory({ rev, say }: { rev: number; say: Say }) {
  const { data, reload } = useApi<{ path: string; text: string }[]>("/api/assistant/memory", rev);
  const forget = async (path: string) => {
    if (!(await askConfirm({ title: "Borrar este recuerdo", body: `El asistente dejará de recordar lo de «${path}». No se puede deshacer.`, confirm: "Borrar", danger: true }))) return;
    try { await api("POST", "/api/assistant/memory/delete", { path }); say("Recuerdo borrado."); reload(); }
    catch (e) { say((e as Error).message, true); }
  };
  return (
    <div class="page narrow">
      <header class="page-head"><h1>Qué recuerda el asistente</h1><a class="pill" href="#/asistente">Volver</a></header>
      <p class="muted">Son ficheros de texto en <code>.jarvis/hermes/memories/</code>: nada opaco. Puedes borrar lo que no quieras que recuerde.</p>
      {data && data.length === 0 && <div class="empty">Todavía no recuerda nada.</div>}
      <ul class="cards">
        {(data ?? []).map((m) => (
          <li key={m.path} class="card memory">
            <div>
              <div class="ctitle">{m.path}</div>
              <pre class="memtext">{m.text}</pre>
            </div>
            <button class="mini" onClick={() => void forget(m.path)}>Borrar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
