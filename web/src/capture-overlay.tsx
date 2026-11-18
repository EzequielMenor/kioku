import { useRef, useState } from "preact/hooks";
import { splitCapturePrefix, type CaptureKind } from "../../src/core/capture.ts";
import { WorkspaceDialog } from "./workspace-dialog.tsx";
import { api } from "./api.ts";
import { submit } from "./offline/runtime.ts";
import { isMobile } from "./role.ts";
import type { CaptureResult } from "./types.ts";

const types = [
  { kind: "capture", label: "Idea", prefix: "", hint: "La encontrarás en Sin organizar." },
  { kind: "task", label: "Tarea", prefix: "t ", hint: "Puedes añadir una fecha con !mañana y una prioridad con p1, p2 o p3." },
  { kind: "note", label: "Nota", prefix: "n ", hint: "Se guardará en tus notas." },
  { kind: "decision", label: "Decisión", prefix: "d ", hint: "Puedes vincularla a un proyecto con @proyecto." },
] as const;

export function CaptureOverlay({ initialKind, onClose, say }: {
  initialKind: CaptureKind; onClose(): void; say(message: string): void;
}) {
  const [kind, setKind] = useState(initialKind);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // En modo libre también se aceptan los atajos de Quick. Un tipo elegido permite títulos literales.
  const parsed = kind === "capture" ? splitCapturePrefix(text) : { kind, text };
  const type = types.find(t => t.kind === parsed.kind)!;
  const save = async (e: Event) => {
    e.preventDefault();
    if (!parsed.text.trim() || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    const message = type.prefix + parsed.text.trim();
    try {
      const r = isMobile() ? await submit(message) : { sent: true as const, result: await api<CaptureResult>("POST", "/api/capture", { text: message }) };
      say(r.sent ? [r.result.message, ...r.result.warnings].join(" · ") : "Guardada sin conexión. Se enviará al volver la red.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const close = () => { if (!saving.current) onClose(); };
  return (
    <WorkspaceDialog className="capture-dialog" label="Captura rápida" onClose={close}>
      <h2>Captura rápida</h2>
      <form onSubmit={save}>
        <div class="capture-types" role="group" aria-label="Guardar como">
          {types.map(t => <button key={t.kind} type="button" aria-pressed={type.kind === t.kind} disabled={busy}
            onClick={() => { setKind(t.kind); setText(parsed.text); input.current?.focus(); }}>{t.label}</button>)}
        </div>
        <input autofocus ref={input} class="big-input" aria-label="Texto de la captura" aria-describedby="capture-hint"
          placeholder={type.kind === "task" ? "¿Qué tienes que hacer?" : "Escribe lo que quieres guardar…"}
          value={text} readOnly={busy} onInput={e => setText(e.currentTarget.value)}
          onKeyDown={e => { if (e.key === "Enter" && e.isComposing) e.preventDefault(); }} />
        <p id="capture-hint" class="muted small">{type.hint}</p>
        {error && <p role="alert" class="bad-text">{error}</p>}
        <div class="row end"><button type="button" disabled={busy} onClick={close}>Cancelar</button>
          <button type="submit" class="primary" disabled={busy || !parsed.text.trim()}>{busy ? "Guardando…" : "Guardar"}</button></div>
      </form>
    </WorkspaceDialog>
  );
}
