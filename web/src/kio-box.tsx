// La caja única de Hoy: escribe una idea, una tarea o una pregunta. Con Kio disponible, él decide qué hacer (y todo
// se puede deshacer); sin Kio, lo escrito se guarda al instante en «Sin organizar» y él lo ordena después.
import { useRef, useState } from "preact/hooks";
import { api } from "./api.ts";
import { useApi } from "./hooks.ts";
import { isMobile } from "./role.ts";
import { submit, useOffline } from "./offline/runtime.ts";
import { sendToKio, useKioThread } from "./assistant.tsx";
import { destination, recentKioActions, savedText } from "./kio-route.ts";
import type { CaptureResult, UndoRecord } from "./types.ts";

type Say = (text: string, error?: boolean) => void;

export function KioBox({ rev, say }: { rev: number; say: Say }) {
  const mobile = isMobile();
  const online = useOffline().online;
  const status = useApi<{ ok: boolean; reason?: string }>("/api/assistant/status", rev);
  const thread = useKioThread();
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<number | null>(null); // nº de mensajes al preguntar desde aquí: la respuesta es lo que venga detrás
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const kioReady = status.data ? status.data.ok : status.error ? false : null;

  const save = async (message: string, where: "capture" | "queue") => {
    if (where === "queue") { const r = await submit(message); say(savedText("queue", r.sent)); return; }
    await api<CaptureResult>("POST", "/api/capture", { text: message });
    say(savedText("capture"));
  };
  const send = async () => {
    const message = text.trim();
    if (!message || saving || thread.busy) return;
    setText("");
    setSaving(true);
    try {
      const where = destination({ kioReady, mobile, online });
      if (where === "kio") {
        setAsked(thread.msgs.length);
        if (!(await sendToKio(message, "/hoy"))) { setAsked(null); await save(message, mobile ? "queue" : "capture"); }
      } else {
        await save(message, where);
      }
    } catch (e) {
      setText(message); // no se pierde: vuelve a la caja
      say(e instanceof Error ? e.message : String(e), true);
    } finally {
      setSaving(false);
      input.current?.focus();
    }
  };

  const reply = asked !== null ? thread.msgs.slice(asked).filter((m) => m.role === "assistant").at(-1) : undefined;
  return (
    <section class="kio-box">
      <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea ref={input} rows={2} value={text} aria-label="Escribe a Kio"
          placeholder={kioReady === false ? "Escribe una idea o una tarea: se guarda en «Sin organizar»…" : "Escribe una idea, una tarea o pregúntale a Kio…"}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send(); } }} />
        <button class="primary" type="submit" disabled={!text.trim() || saving || thread.busy}>{kioReady === false ? "Guardar" : "Enviar"}</button>
      </form>
      {asked !== null && (thread.busy && !reply
        ? <p class="kio-live" role="status"><span class="dots" aria-hidden="true" /> {thread.streaming || thread.live || "Pensando…"}</p>
        : reply && <div class={`kio-reply ${reply.error ? "bad" : ""}`} role="status">
            <p>{reply.text.length > 700 ? reply.text.slice(0, 700) + "…" : reply.text}</p>
            {reply.actions?.map((a) => <UndoLine key={a.id} a={a} say={say} />)}
            <div class="row small"><a href="#/asistente">Seguir en Kio →</a><button class="ghost mini" onClick={() => setAsked(null)}>Cerrar</button></div>
          </div>)}
      {kioReady === false && <p class="muted small">Kio no está disponible ahora{status.data?.reason ? ` (${status.data.reason})` : ""}. Lo que escribas queda guardado y él lo ordenará después.</p>}
    </section>
  );
}

function UndoLine({ a, say, onDone }: { a: UndoRecord; say: Say; onDone?(): void }) {
  const [undone, setUndone] = useState(!!a.undone);
  const [busy, setBusy] = useState(false);
  return (
    <div class={`undo-line ${undone ? "undone" : ""}`}>
      <span>{a.summary}</span>
      <button class="mini" disabled={undone || busy} onClick={async () => {
        setBusy(true);
        try { await api("POST", "/api/assistant/undo", { id: a.id }); setUndone(true); say("Deshecho."); onDone?.(); }
        catch (e) { say((e as Error).message, true); }
        finally { setBusy(false); }
      }}>{undone ? "Deshecho" : "Deshacer"}</button>
    </div>
  );
}

/** Hoy: lo último que ha hecho Kio por su cuenta, para verlo de un vistazo y deshacerlo si no era lo que querías. */
export function KioRecent({ rev, say }: { rev: number; say: Say }) {
  const { data, reload } = useApi<UndoRecord[]>("/api/assistant/actions", rev);
  const recent = recentKioActions(data ?? []);
  if (!recent.length) return null;
  return (
    <section>
      <h2 class="sec">Lo último que ha hecho Kio <a class="muted small" href="#/asistente/actividad">ver todo</a></h2>
      <div class="kio-recent">{recent.map((a) => <UndoLine key={a.id} a={a} say={say} onDone={reload} />)}</div>
    </section>
  );
}
