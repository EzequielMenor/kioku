// Diálogos propios: sustituyen a confirm()/prompt() del navegador. Esc cancela, Enter acepta, el foco queda atrapado.
import { render, type ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

function mount<T>(view: (done: (v: T) => void) => ComponentChildren): Promise<T> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const before = document.activeElement as HTMLElement | null;
    const done = (v: T) => { render(null, host); host.remove(); before?.focus?.(); resolve(v); };
    render(<>{view(done)}</>, host);
  });
}

function Shell({ title, onCancel, children }: { title: string; onCancel(): void; children: ComponentChildren }) {
  const box = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation(); // los atajos globales de la app no deben dispararse detrás del diálogo
    if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
    if (e.key !== "Tab" || !box.current) return;
    const els = [...box.current.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href]")].filter((x) => !x.hasAttribute("disabled"));
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div class="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }} onKeyDown={onKey}>
      <div class="modal dialog" role="alertdialog" aria-modal="true" aria-label={title} ref={box}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function askConfirm(o: { title: string; body?: string; confirm: string; danger?: boolean }): Promise<boolean> {
  return mount<boolean>((done) => <ConfirmDialog {...o} done={done} />);
}

function ConfirmDialog({ title, body, confirm, danger, done }: { title: string; body?: string; confirm: string; danger?: boolean; done(v: boolean): void }) {
  const ok = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  // En acciones peligrosas el foco empieza en «Cancelar»: un Enter distraído no destruye nada.
  useEffect(() => { (danger ? cancel : ok).current?.focus(); }, []);
  return (
    <Shell title={title} onCancel={() => done(false)}>
      {body && <p class="muted">{body}</p>}
      <div class="row end">
        <button ref={cancel} onClick={() => done(false)}>Cancelar</button>
        <button ref={ok} class={danger ? "danger-solid" : "primary"} onClick={() => done(true)}>{confirm}</button>
      </div>
    </Shell>
  );
}

/** Elección entre varias salidas: «Cancelar» (también Esc y el velo) devuelve null y aborta; el foco empieza en «Cancelar». */
export function askChoice<T extends string>(o: { title: string; body?: string; choices: { value: T; label: string; danger?: boolean }[] }): Promise<T | null> {
  return mount<T | null>((done) => <ChoiceDialog {...o} done={done} />);
}

function ChoiceDialog<T extends string>({ title, body, choices, done }: { title: string; body?: string; choices: { value: T; label: string; danger?: boolean }[]; done(v: T | null): void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <Shell title={title} onCancel={() => done(null)}>
      {body && <p class="muted">{body}</p>}
      <div class="row end">
        <button ref={cancel} onClick={() => done(null)}>Cancelar</button>
        {choices.map((c) => <button key={c.value} class={c.danger ? "danger-solid" : "primary"} onClick={() => done(c.value)}>{c.label}</button>)}
      </div>
    </Shell>
  );
}

export function askText(o: { title: string; placeholder?: string; confirm: string }): Promise<string | null> {
  return mount<string | null>((done) => <TextDialog {...o} done={done} />);
}

function TextDialog({ title, placeholder, confirm, done }: { title: string; placeholder?: string; confirm: string; done(v: string | null): void }) {
  const [v, setV] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = () => { if (v.trim()) done(v.trim()); };
  return (
    <Shell title={title} onCancel={() => done(null)}>
      <input ref={input} class="wide-input" value={v} placeholder={placeholder} onInput={(e) => setV((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} />
      <div class="row end">
        <button onClick={() => done(null)}>Cancelar</button>
        <button class="primary" disabled={!v.trim()} onClick={submit}>{confirm}</button>
      </div>
    </Shell>
  );
}
