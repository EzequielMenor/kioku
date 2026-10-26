import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "./quick.css";
import { api } from "./api.ts";
import type { CaptureResult, SearchHit } from "./types.ts";

const HINTS: [string, string][] = [
  ["t", "tarea  !mañana  @proyecto  p1"], ["d", "decisión  @proyecto"], ["n", "nota"], ["/", "buscar"], ["a:", "preguntar al asistente"],
];

function Quick() {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ t: string; err?: boolean } | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const [asking, setAsking] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => { setText(""); setMsg(null); setHits([]); setSel(0); };

  /** Oculta la ventana: el daemon conmuta el workspace especial; si sigue visible, se cierra. */
  const hide = async () => {
    reset();
    try { await api("POST", "/api/desktop/quick/hide", {}); } catch { /* sin daemon de escritorio */ }
    setTimeout(() => { if (document.visibilityState === "visible" && document.hasFocus()) window.close(); }, 250);
  };

  // Cada vez que la ventana vuelve a mostrarse: limpia y enfoca.
  useEffect(() => {
    const refocus = () => { if (document.visibilityState === "visible") { reset(); input.current?.focus(); } };
    document.addEventListener("visibilitychange", refocus);
    addEventListener("focus", () => input.current?.focus());
    input.current?.focus();
    return () => document.removeEventListener("visibilitychange", refocus);
  }, []);

  const searching = text.startsWith("/");
  useEffect(() => {
    if (!searching) { setHits([]); return; }
    const q = text.slice(1).trim();
    if (q.length < 1) { setHits([]); return; }
    let dead = false;
    const id = setTimeout(() => {
      api<SearchHit[]>("GET", `/api/search?q=${encodeURIComponent(q)}&limit=6`).then((h) => { if (!dead) { setHits(h); setSel(0); } }, () => {});
    }, 80);
    return () => { dead = true; clearTimeout(id); };
  }, [text]);

  const openHit = async (h: SearchHit) => {
    const route = h.type === "project" ? `/proyecto/${h.path}` : `/nota/${h.path}`;
    await api("POST", "/api/desktop/open", { route }).catch(() => {});
    void hide();
  };

  /** `a: <pregunta>` (con dos puntos, para no confundirlo con capturas como «a las 5 llamar»): respuesta corta del asistente sin salir de la ventana rápida. */
  const ask = async (message: string) => {
    setAsking(true);
    setMsg({ t: "Pensando…" });
    try {
      const r = await api<{ answer: string }>("POST", "/api/assistant/ask", { message, conversation: "quick" });
      const a = r.answer.trim();
      setMsg({ t: a.length > 320 ? `${a.slice(0, 320)}… (sigue en el Asistente)` : a });
      setText("");
    } catch (e) {
      setMsg({ t: (e as Error).message, err: true });
    } finally {
      setAsking(false);
    }
  };

  const submit = async () => {
    if (asking) return;
    const q = /^a:\s*(.+)$/s.exec(text.trim());
    if (q) { await ask(q[1]); return; }
    if (searching) { if (hits[sel]) await openHit(hits[sel]); return; }
    if (!text.trim()) return;
    try {
      const r = await api<CaptureResult>("POST", "/api/capture", { text });
      setText("");
      setMsg({ t: r.message + (r.warnings.length ? ` · ${r.warnings.join("; ")}` : "") + (r.parked ? " · aparcado hasta terminar el foco" : "") });
      setTimeout(() => void hide(), r.warnings.length ? 1800 : 650);
    } catch (e) {
      setMsg({ t: (e as Error).message, err: true });
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); void hide(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void api("POST", "/api/desktop/open", { route: "/hoy" }).then(hide); }
    else if (e.key === "Enter") { e.preventDefault(); void submit(); }
    else if (searching && e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
    else if (searching && e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
  };

  const prefix = text.split(/\s/, 1)[0];
  const active = HINTS.find(([k]) => k === prefix || (k === "/" && searching));
  return (
    <div class="q">
      <input ref={input} class="qi" autofocus spellcheck={false} autocomplete="off"
        placeholder="Captura una idea…   t tarea · d decisión · n nota · / buscar"
        value={text} onInput={(e) => { setText(e.currentTarget.value); setMsg(null); }} onKeyDown={onKey} aria-label="Captura rápida" />
      {searching && (
        <ul class="qh">
          {hits.map((h, i) => (
            <li key={h.path} class={i === sel ? "sel" : ""} onMouseEnter={() => setSel(i)} onClick={() => void openHit(h)}>
              <span>{h.title}</span><span class="qt">{h.type}</span>
            </li>
          ))}
          {hits.length === 0 && text.length > 1 && <li class="none">Sin resultados</li>}
        </ul>
      )}
      <div class={`qf ${msg?.err ? "err" : ""}`}>
        {msg ? msg.t : active ? <><b>{active[0]}</b> {active[1]}</> : <span>Enter guarda en Bandeja · Esc cierra</span>}
      </div>
    </div>
  );
}

render(<Quick />, document.getElementById("root")!);
