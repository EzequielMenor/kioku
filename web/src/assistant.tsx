// Asistente: conversación con el motor (Hermes en jaula), actividad en vivo y Deshacer por acción.
import { useEffect, useRef, useState } from "preact/hooks";
import { api, lsGet, lsSet, onChange } from "./api.ts";
import { useApi } from "./hooks.ts";
import { askConfirm } from "./dialogs.tsx";
import type { Proposal, UndoRecord } from "./types.ts";
import { askErrorText, createChat, type Msg } from "./assistant-chat.ts";
import { isMobile } from "./role.ts";
import { useOffline } from "./offline/runtime.ts";
import { AssistantProposals } from "./assistant-proposals.tsx";
import "./assistant-layered.css";

type Say = (text: string, error?: boolean) => void;

// La conversación vive en memoria del cliente, fuera de la vista: sobrevive a cambiar de pantalla (también
// con una consulta en curso) y no a recargar.
const chat = createChat({
  ask: (message, conversation) => api("POST", "/api/assistant/ask", { message, conversation }),
  describeError: (e) => askErrorText(e, isMobile()),
  pendingProposals: () => api<Proposal[]>("GET", "/api/proposals?status=pending"),
  actionsSince: (ts) => api<UndoRecord[]>("GET", "/api/assistant/actions").then((l) => l.filter((a) => a.ts >= ts && !a.undone)),
});
onChange((e) => { if (e.kind === "assistant.tool" && e.tool) chat.setLive(liveLabel(e.tool, e.path)); });

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
  const [{ msgs, busy, live }, setChat] = useState(chat.getState());
  useEffect(() => { setChat(chat.getState()); return chat.subscribe(setChat); }, []);
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const [connection, setConnection] = useState(false);
  const [ack, setAck] = useState(lsGet("assistant.privacy.v2") === "1");
  const mobile = isMobile();
  const online = useOffline().online;
  const offline = mobile && !online; // el asistente es solo en línea: sin conexión no se pregunta ni se encola nada
  const statusRequest = useApi<{ ok: boolean; reason?: string }>("/api/assistant/status", rev);
  const status = statusRequest.data;
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [msgs, live]);
  useEffect(() => { input.current?.focus(); }, [ack]);

  const send = (message: string) => {
    if (!message.trim() || chat.getState().busy || offline) return Promise.resolve();
    setText("");
    return chat.send(message);
  };
  const reset = () => { if (!chat.getState().busy) { chat.reset(); setText(""); setMenu(false); } };

  return (
    <div class="page narrow assistant-page">
      <header class="layered-head">
        <button ref={menuButton} aria-label="Conversaciones" aria-expanded={menu} onClick={() => { setMenu(!menu); setConnection(false); }}>☰</button>
        <h1>Kioku</h1>
        <button aria-label="Estado de conexión" aria-expanded={connection} onClick={() => { setConnection(!connection); setMenu(false); }}>◉</button>
      </header>
      {menu && <nav class="assistant-menu" aria-label="Conversación" onKeyDown={(e) => { if (e.key === "Escape") { setMenu(false); menuButton.current?.focus(); e.stopPropagation(); } }}>
        <span>Conversación actual</span>
        <button onClick={reset} disabled={busy}>Nueva conversación</button>
        <a class="pill" href="#/asistente/actividad">Actividad</a>
        {!mobile && <a class="pill" href="#/asistente/memoria">Memoria</a>}
      </nav>}
      {connection && <div class="assistant-connection" role="status">{offline ? "Sin conexión con Kioku." : status ? status.ok ? "Kioku responde · requisitos detectados. Esto no comprueba la ejecución del asistente." : `Kioku responde · faltan requisitos: ${status.reason ?? "sin detalle"}` : statusRequest.error ? "No se pudo comprobar la conexión con Kioku." : "Comprobando Kioku…"}</div>}

      {status && !status.ok && <div class="notice bad">El asistente no está disponible: {status.reason}</div>}
      {offline && <div class="notice bad" role="status">Sin conexión con tu portátil. El asistente solo funciona con el portátil encendido y con red; no se guarda nada para después.</div>}

      {!ack && (
        <div class="card notice-card">
          <div class="eyebrow">Antes de empezar</div>
          <p>Para responder, el asistente <b>lee las notas que necesita</b> y su texto se envía al modelo y proveedor que configuraste en Hermes. Si el proveedor es remoto, esas notas salen de tu equipo; con un modelo local permanecen allí. Queda registrado qué notas lee en cada consulta y puedes excluir carpetas en <code>.kioku/assistant.json</code>.{mobile && <> Desde el móvil tampoco ve las carpetas privadas del móvil (<code>.kioku/mobile.json</code>).</>}</p>
          <p class="muted small">Lo pequeño y reversible lo hace solo, con botón <b>Deshacer</b>. Borrar, mover o tocar muchas notas siempre te lo propone antes{mobile && <>, y lo apruebas tú aquí mismo en Propuestas</>}.</p>
          <button class="primary" onClick={() => { lsSet("assistant.privacy.v2", "1"); setAck(true); }}>Entendido</button>
        </div>
      )}

      <div class="chat" aria-live="polite">
        {msgs.length === 0 && ack && (
          <div class="chat-empty">
            <p class="muted">Preguntame lo que quieras: pensar una idea, organizar la Bandeja, planificar tu día o retomar un proyecto. No reescribo tus notas sin que me lo pidas.</p>
            <div class="pills">{SUGGESTIONS.map((s) => <button key={s} class="pill" onClick={() => void send(s)}>{s.length > 40 ? "Revisar mi espacio" : s}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => <Bubble key={i} m={m} say={say} />)}
        {busy && <div class="bubble assistant live"><span class="dots" aria-hidden="true" /> {live}</div>}
        <div ref={bottom} />
      </div>

      <div class="assistant-input-area">
      <AssistantProposals rev={rev} busy={busy} offline={offline} />
      <form class="composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea ref={input} rows={2} value={text} disabled={!ack || offline} aria-label="Mensaje para el asistente" placeholder={!ack ? "Acepta el aviso para empezar" : offline ? "Sin conexión con el portátil" : mobile ? "Escribe al asistente…" : "Escribe al asistente…  (Enter envía · Shift+Enter nueva línea)"}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send(text); } }} />
        <button class="primary" type="submit" disabled={!ack || offline || busy || !text.trim()}>Enviar</button>
      </form>
      </div>
    </div>
  );
}

function Bubble({ m, say }: { m: Msg; say: Say }) {
  return (
    <div class={`bubble ${m.role}${m.error ? " error" : ""}`}>
      <div class="btext">{m.text}</div>
      {!!m.reads?.length && (
        <details class="reads"><summary>Ha leído {m.reads.length} {m.reads.length === 1 ? "nota" : "notas"}</summary>
          <ul>{m.reads.map((p) => <li key={p}><a href={`#/nota/${enc(p)}`}>{p}</a></li>)}</ul>
        </details>
      )}
      {m.actions?.map((a) => <ActionRow key={a.id} a={a} say={say} />)}

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
    <details class={`action${undone ? " undone" : ""}`}>
      <summary>Cambio automático · {undone ? "Deshecho" : "Ver detalle y deshacer"}</summary>
      <p>{a.summary}</p>
      <button class="mini" disabled={undone || busy} onClick={() => void undo()}>{undone ? "Deshecho" : "Deshacer"}</button>
    </details>
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
      <p class="muted">Son ficheros de texto en <code>.kioku/hermes/memories/</code>: nada opaco. Puedes borrar lo que no quieras que recuerde.</p>
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
