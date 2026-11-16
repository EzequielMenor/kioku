// Asistente: conversación con el motor (Hermes en jaula), actividad en vivo y Deshacer por acción.
import { useEffect, useRef, useState } from "preact/hooks";
import { api, lsGet, lsSet, onChange } from "./api.ts";
import { useApi } from "./hooks.ts";
import { askConfirm } from "./dialogs.tsx";
import type { Proposal, UndoRecord } from "./types.ts";
import { activityOrigin, askErrorText, createChat, type Msg } from "./assistant-chat.ts";
import { isMobile } from "./role.ts";
import { useOffline } from "./offline/runtime.ts";
import { AssistantProposals } from "./assistant-proposals.tsx";
import { KioFace, companion, useCompanion } from "./companion.tsx";
import { faceState } from "./companion-store.ts";
import "./assistant-layered.css";

type Say = (text: string, error?: boolean) => void;

// La conversación vive en memoria del cliente, fuera de la vista: sobrevive a cambiar de pantalla (también
// con una consulta en curso) y no a recargar.
const chat = createChat({
  ask: (message, conversation) => api("POST", "/api/assistant/ask", { message, conversation }),
  describeError: (e) => askErrorText(e, isMobile()),
  pendingProposals: () => api<Proposal[]>("GET", "/api/proposals?status=pending"),
  actionsSince: (ts) => api<UndoRecord[]>("GET", "/api/assistant/actions").then((l) => l.filter((a) => a.ts >= ts && !a.undone && !activityOrigin(a))),
});
onChange((e) => { if (e.kind === "assistant.tool" && e.tool) chat.setLive(liveLabel(e.tool, e.path)); });

/**
 * La conversación con Kio vista desde cualquier pantalla: en escritorio la del daemon (compartida con el compañero),
 * en el móvil la de este cliente. `send` devuelve false si Kio no llegó a atender el mensaje (no disponible).
 */
export function useKioThread(): { msgs: Msg[]; busy: boolean; live: string | null; streaming: string } {
  const mobile = isMobile();
  const [legacy, setLegacy] = useState(chat.getState());
  useEffect(() => { if (!mobile) return; setLegacy(chat.getState()); return chat.subscribe(setLegacy); }, [mobile]);
  const shared = useCompanion(!mobile);
  if (mobile) return { msgs: legacy.msgs, busy: legacy.busy, live: legacy.live, streaming: "" };
  return { msgs: shared.msgs, busy: shared.agent.busy || shared.sending, live: shared.agent.label ?? "Pensando…", streaming: shared.streaming };
}

export async function sendToKio(message: string, route: string): Promise<boolean> {
  if (isMobile()) {
    const before = chat.getState().msgs.length;
    await chat.send(message);
    const last = chat.getState().msgs.at(-1);
    // Falló antes de que Kio hiciera nada (sin red, sin modelo): que quien llama lo guarde.
    return !(chat.getState().msgs.length > before && last?.error && !last.actions?.length);
  }
  await companion.send(message, { route });
  return !companion.getState().problem;
}

const SUGGESTIONS = ["¿Qué hago hoy?", "Ordena lo que tengo sin organizar", "Revisa mi espacio: lo sin organizar, proyectos parados, enlaces rotos y duplicados. Propón lo necesario."];

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
  const [legacy, setChat] = useState(chat.getState());
  useEffect(() => { setChat(chat.getState()); return chat.subscribe(setChat); }, []);
  const [text, setText] = useState("");
  const [acked, setAck] = useState(lsGet("assistant.privacy.v3") === "1");
  const mobile = isMobile();
  // Escritorio: la conversación vive en el daemon y es la misma que la del compañero (aquí y en el escritorio).
  // Móvil: sigue en memoria del cliente, con su privacidad propia.
  const shared = useCompanion(!mobile);
  const msgs: Msg[] = mobile ? legacy.msgs : shared.msgs;
  const busy = mobile ? legacy.busy : shared.agent.busy || shared.sending;
  const live = mobile ? legacy.live : shared.agent.label ?? "Pensando…";
  const streaming = mobile ? "" : shared.streaming;
  const online = useOffline().online;
  const offline = mobile && !online; // el asistente es solo en línea: sin conexión no se pregunta ni se encola nada
  const statusRequest = useApi<{ ok: boolean; reason?: string }>("/api/assistant/status", rev);
  const status = statusRequest.data;
  const engine = useApi<{ model: string | null; local: boolean; origin: string | null }>("/api/assistant/engine", 0).data;
  // Con el modelo en tu ordenador no hace falta aviso: las notas no salen de él. Si es remoto, se avisa una vez.
  const remote = engine ? !engine.local : true; // sin saber dónde corre, se trata como remoto: se avisa antes de enviar nada
  const ack = acked || remote === false;
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [msgs, live, streaming]);
  useEffect(() => { input.current?.focus(); }, [ack]);

  const send = (message: string) => {
    if (!message.trim() || busy || offline) return Promise.resolve();
    setText("");
    return mobile ? chat.send(message) : companion.send(message, { route: "/asistente" });
  };
  const reset = () => {
    if (busy) return;
    if (mobile) chat.reset(); else void companion.newConversation();
    setText("");
  };

  return (
    <div class="page narrow assistant-page">
      <header class="kio-head">
        {mobile ? <h1>Kio</h1> : <div class="assistant-kio"><KioFace state={faceState(shared.agent, false)} size={40} /><h1>Kio</h1></div>}
        <button class="ghost" onClick={reset} disabled={busy || !msgs.length}>Nueva conversación</button>
      </header>

      {status && !status.ok && <div class="notice bad">Kio no está disponible: {status.reason}. Puedes seguir escribiendo en Hoy: se guarda en «Sin organizar».</div>}
      {offline && <div class="notice bad" role="status">Sin conexión con tu ordenador. Lo que escribas en Hoy se guarda y se envía al volver la red.</div>}

      {!ack && (
        <div class="card notice-card">
          <p>Kio usa un modelo en <b>{engine?.origin?.replace(/^https?:\/\//, "") ?? "un servidor que Kioku no reconoce como tuyo"}</b>: para responder, el texto de las notas que lee <b>se envía a ese servidor</b>. Queda registrado qué notas lee en cada respuesta.</p>
          <button class="primary" onClick={() => { lsSet("assistant.privacy.v3", "1"); setAck(true); }}>Entendido</button>
        </div>
      )}

      <div class="chat" aria-live="polite">
        {msgs.length === 0 && ack && (
          <div class="chat-empty">
            <p class="muted">Pregúntame o cuéntame algo: lo guardo donde toca, organizo lo pendiente, planifico tu día o te ayudo a retomar un proyecto. Lo que hago se puede deshacer y lo importante te lo pregunto antes.</p>
            <div class="pills">{SUGGESTIONS.map((s) => <button key={s} class="pill" onClick={() => void send(s)}>{s.length > 40 ? "Revisar mi espacio" : s}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => <Bubble key={i} m={m} say={say} />)}
        {busy && (streaming
          ? <div class="bubble assistant"><div class="btext">{streaming}</div></div>
          : <div class="bubble assistant live"><span class="dots" aria-hidden="true" /> {live}</div>)}
        {!mobile && shared.problem && <div class="notice bad" role="alert">{shared.problem}</div>}
        <div ref={bottom} />
      </div>

      <div class="assistant-input-area">
      <AssistantProposals rev={rev} busy={busy} offline={offline} />
      <form class="composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea ref={input} rows={2} value={text} disabled={!ack || offline} aria-label="Mensaje para Kio" placeholder={!ack ? "Acepta el aviso para empezar" : offline ? "Sin conexión con tu ordenador" : mobile ? "Escribe a Kio…" : "Escribe a Kio…  (Enter envía · Shift+Enter nueva línea)"}
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
      <header class="page-head"><h1>Lo que ha hecho Kio</h1>{!isMobile() && <a class="pill" href="#/asistente/memoria">Qué recuerda</a>}</header>
      <p class="muted">Cada cambio que Kio hace por su cuenta queda aquí con Deshacer (también los cambios de estructura de una tabla, marcados «Desde la tabla»). Si editaste la nota después, Deshacer avisa del conflicto y no pisa nada.</p>
      {data && data.length === 0 && <div class="empty">Kio aún no ha hecho cambios por su cuenta.</div>}
      <ul class="cards">
        {(data ?? []).map((a) => (
          <li key={a.id} class="card activity">
            <div>
              <div class="ctitle">{a.summary}{activityOrigin(a) && <span class="chip origin">{activityOrigin(a)}</span>}</div>
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
      <header class="page-head"><h1>Qué recuerda Kio</h1><a class="pill" href="#/asistente/actividad">Volver</a></header>
      <p class="muted">Preferencias que le has pedido recordar. Son ficheros de texto dentro de tu espacio: puedes borrar lo que no quieras que recuerde.</p>
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
