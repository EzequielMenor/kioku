// Gestión del asistente (solo escritorio): modelo de Hermes, estado honesto y guía para instalar Kioku en el iPhone.
// Es un panel de gestión web, no una app nativa. Nunca pide ni muestra claves: solo dice dónde se definen.
import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { ModelState } from "../../src/assistant/model-management.ts";
import { api } from "./api.ts";
import { isMobile } from "./role.ts";
import "./assistant-management.css";

export type ManagementSection = "model" | "status" | "iphone";

export interface AssistantManagementProps {
  onClose(): void;
  /** Navegación del cliente (p. ej. «/asistente»); sin ella no se ofrece el atajo. */
  go?(route: string): void;
  initial?: ManagementSection;
}

type ModelResponse = ModelState & { readiness: { ok: boolean; reason?: string } };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const PROVIDER_LABEL: Record<string, string> = {
  "openai-codex": "Codex (tu suscripción)", openrouter: "OpenRouter", anthropic: "Anthropic", gemini: "Google Gemini", deepseek: "DeepSeek",
  zai: "Z.AI (GLM)", "kimi-coding": "Kimi", minimax: "MiniMax", custom: "Personalizado · endpoint compatible",
};
const SOURCE_LABEL: Record<string, string> = {
  ui: "Elegido aquí, en Kioku", "assistant.json": "Fichero .kioku/assistant.json", hermes: "Tu configuración de Hermes (~/.hermes/config.yaml)", default: "Valor por defecto (Codex)",
};
const SECTIONS: [ManagementSection, string][] = [["model", "Modelo"], ["status", "Estado"], ["iphone", "iPhone"]];

/** Diálogo accesible: Esc cierra, el foco queda atrapado dentro y vuelve a donde estaba al cerrar. */
function Dialog({ onClose, children }: { onClose(): void; children: ComponentChildren }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => before?.focus?.();
  }, []);
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation(); // los atajos globales no deben dispararse detrás del panel
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key !== "Tab" || !box.current) return;
    const els = [...box.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")].filter((x) => !x.hasAttribute("disabled"));
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div class="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={onKey}>
      <div class="modal wide am" role="dialog" aria-modal="true" aria-labelledby="am-title" ref={box}>{children}</div>
    </div>
  );
}

export function AssistantManagement(props: AssistantManagementProps) {
  // El rol móvil no tiene formulario ni hace ninguna petición de configuración, aunque el componente se invoque por error.
  if (isMobile()) {
    return (
      <Dialog onClose={props.onClose}>
        <h2 id="am-title">Gestión del asistente</h2>
        <p class="notice">El modelo y la conexión del asistente se gestionan solo desde el portátil, con la clave completa de Kioku.</p>
        <div class="row end"><button data-autofocus onClick={props.onClose}>Cerrar</button></div>
      </Dialog>
    );
  }
  return <Panel {...props} />;
}

function Panel({ onClose, go, initial }: AssistantManagementProps) {
  const [section, setSection] = useState<ManagementSection>(initial ?? "model");
  const [data, setData] = useState<ModelResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    return api<ModelResponse>("GET", "/api/assistant/model").then(setData, (e) => setError(errText(e)));
  };
  useEffect(() => { void load(); }, []);

  return (
    <Dialog onClose={onClose}>
      <div class="am-head">
        <div>
          <p class="eyebrow">Asistente</p>
          <h2 id="am-title">Gestión del asistente</h2>
        </div>
        <button class="subtle" data-autofocus onClick={onClose} aria-label="Cerrar la gestión del asistente">Cerrar</button>
      </div>
      <nav class="am-tabs" aria-label="Secciones de la gestión">
        {SECTIONS.map(([id, label]) => (
          <button key={id} class={section === id ? "on" : ""} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>{label}</button>
        ))}
      </nav>
      {error && <p class="notice bad" role="alert">{error}</p>}
      {section === "model" && (data ? <ModelSection data={data} onData={setData} /> : !error && <p class="muted" role="status">Leyendo la configuración…</p>)}
      {section === "status" && <StatusSection data={data} reload={load} />}
      {section === "iphone" && <IphoneSection go={go ? (r) => { go(r); onClose(); } : undefined} />}
    </Dialog>
  );
}

const originOf = (v: string): { origin: string; remote: boolean } | null => {
  try {
    const u = new URL(v.trim());
    return { origin: u.origin, remote: u.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) };
  } catch { return null; }
};

/** Valores iniciales del formulario: lo elegido en la interfaz y, si no hay nada, lo que está en uso. */
function fieldsOf(d: ModelResponse) {
  const ov = d.override.state === "ui" ? d.override : null;
  const eff = d.effective;
  return {
    provider: ov?.provider ?? eff?.provider ?? "openai-codex", model: ov?.model ?? eff?.model ?? "", baseUrl: ov?.baseUrl ?? "",
    apiMode: ov?.apiMode ?? eff?.apiMode ?? "", confirm: ov?.acknowledgedOrigin ?? "",
  };
}

function ModelSection({ data, onData }: { data: ModelResponse; onData(d: ModelResponse): void }) {
  const ov = data.override.state === "ui" ? data.override : null;
  const eff = data.effective;
  const init = fieldsOf(data);
  const [provider, setProvider] = useState(init.provider);
  const [model, setModel] = useState(init.model);
  const [baseUrl, setBaseUrl] = useState(init.baseUrl);
  const [apiMode, setApiMode] = useState(init.apiMode);
  const [confirm, setConfirm] = useState(init.confirm);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; bad?: boolean } | null>(null);

  const info = data.providers.find((p) => p.id === provider);
  const target = info?.ownBaseUrl ? originOf(baseUrl) : null;
  const remote = !!target?.remote;
  const confirmed = !remote || confirm === target?.origin;

  const send = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setResult(null);
    try {
      const d = await api<ModelResponse>("PUT", "/api/assistant/model", body);
      // El formulario pasa a mostrar lo que quedó guardado de verdad (tras «heredar», la configuración anterior).
      const f = fieldsOf(d);
      setProvider(f.provider); setModel(f.model); setBaseUrl(f.baseUrl); setApiMode(f.apiMode); setConfirm(f.confirm);
      onData(d);
      setResult({ text: ok });
    } catch (e) { setResult({ text: errText(e), bad: true }); }
    setBusy(false);
  };
  const save = () => send(
    { provider, model, api_mode: apiMode, ...(info?.ownBaseUrl ? { base_url: baseUrl.trim(), confirm_origin: remote ? confirm : "" } : {}) },
    "Guardado. La próxima pregunta al asistente usará esta selección.",
  );

  return (
    <div>
      <section class="am-now" aria-label="Selección en uso">
        <h3>En uso ahora</h3>
        {eff ? (
          <dl class="am-facts">
            <dt>Proveedor</dt><dd>{PROVIDER_LABEL[eff.provider] ?? eff.provider}</dd>
            <dt>Modelo</dt><dd>{eff.model ?? "El que Hermes use por defecto"}</dd>
            <dt>Destino</dt><dd>{eff.baseOrigin ?? "El propio del proveedor"}</dd>
            <dt>Origen</dt><dd>{SOURCE_LABEL[eff.source]}</dd>
            <dt>Clave</dt><dd><CredentialLine data={data} /></dd>
          </dl>
        ) : <p class="notice bad" role="alert">{data.error ?? "La configuración actual no es válida."} El asistente no se lanzará hasta corregirlo (no se usa otro proveedor en silencio).</p>}
        {data.override.state === "invalid" && <p class="notice bad" role="alert">{data.override.error}</p>}
      </section>

      <form class="am-form" onSubmit={(e) => { e.preventDefault(); if (!busy && confirmed) void save(); }}>
        <h3>Elegir proveedor y modelo</h3>
        <label>Proveedor
          <select value={provider} onChange={(e) => { setProvider(e.currentTarget.value); setResult(null); }}>
            {data.providers.map((p) => <option key={p.id} value={p.id}>{PROVIDER_LABEL[p.id] ?? p.id}</option>)}
          </select>
        </label>
        <label>Modelo
          <input value={model} maxLength={200} spellcheck={false} autocomplete="off" placeholder="Vacío = el modelo por defecto de Hermes" onInput={(e) => setModel(e.currentTarget.value)} />
        </label>
        {info?.ownBaseUrl && (
          <label>Dirección del endpoint
            <input value={baseUrl} maxLength={300} spellcheck={false} autocomplete="off" inputMode="url" placeholder="http://localhost:11434/v1 o https://…" onInput={(e) => setBaseUrl(e.currentTarget.value)} />
            <span class="muted small">https:// (http:// solo hacia localhost), sin usuario, contraseña ni parámetros.</span>
          </label>
        )}
        {remote && target && (
          <div class="notice" role="group" aria-label="Destino remoto">
            <strong>Destino remoto: {target.origin}</strong>
            <p>Cada pregunta enviará a ese servidor tu consulta y la clave <code>{info?.keys[0]}</code>. Kioku no verifica quién es. Confirma solo si lo controlas o confías en él.</p>
            <label>Para confirmar, escribe exactamente ese origen
              <input value={confirm} spellcheck={false} autocomplete="off" placeholder={target.origin} aria-invalid={confirm !== "" && !confirmed} onInput={(e) => setConfirm(e.currentTarget.value)} />
            </label>
          </div>
        )}
        <label>Modo de API
          <select value={apiMode} onChange={(e) => setApiMode(e.currentTarget.value)}>
            <option value="">Predeterminado</option>
            {data.apiModes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <p class="am-keys muted small">
          {info && info.keys.length > 0
            ? <>Kioku no pide ni guarda la clave. Define <code>{info.keys[0]}</code> en <code>~/.hermes/.env</code> o en el entorno con el que arranca Kioku{info.keylessLocal ? " (con un endpoint local es opcional)" : ""}.</>
            : <>Codex usa tu suscripción de Hermes (<code>~/.hermes/auth.json</code>); no necesita clave de API.</>}
        </p>
        <div class="row">
          <button type="submit" class="primary" disabled={busy || !confirmed}>{busy ? "Guardando…" : "Guardar"}</button>
          {ov && <button type="button" disabled={busy} onClick={() => void send({ inherit: true }, "Restablecido: vuelve la configuración anterior (assistant.json, Hermes o Codex).")}>Heredar la configuración anterior</button>}
          {data.override.state === "invalid" && <button type="button" disabled={busy} onClick={() => void send({ inherit: true }, "Fichero restablecido.")}>Restablecer el fichero</button>}
        </div>
        {result && <p class={`notice ${result.bad ? "bad" : ""}`} role={result.bad ? "alert" : "status"}>{result.text}</p>}
        <p class="muted small">Cambiar de modelo no cambia los permisos del asistente: lo destructivo sigue pasando por propuestas que apruebas tú.</p>
      </form>
    </div>
  );
}

function CredentialLine({ data }: { data: ModelResponse }) {
  const c = data.credentials;
  if (!c) return <>No se puede comprobar hasta corregir la configuración</>;
  const where = c.source === "hermes-env" ? "~/.hermes/.env" : "el entorno de Kioku";
  switch (c.state) {
    case "not-needed": return <>No necesita clave (suscripción de Hermes)</>;
    case "found": return <><code>{c.name}</code> encontrada en {where}</>;
    case "invalid": return <><code>{c.name}</code> no es válida (vacía, con saltos de línea o demasiado larga)</>;
    case "local-keyless": return <>Endpoint local: la clave es opcional</>;
    default: return <>Falta <code>{c.names[0]}</code>: defínela en <code>~/.hermes/.env</code></>;
  }
}

function StatusSection({ data, reload }: { data: ModelResponse | null; reload(): Promise<void> }) {
  const [daemon, setDaemon] = useState<"checking" | "up" | "down">("checking");
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    setDaemon("checking");
    await api("GET", "/api/health").then(() => setDaemon("up"), () => setDaemon("down"));
    await reload();
    setBusy(false);
  };
  useEffect(() => { void check(); }, []);
  const ready = data?.readiness;
  return (
    <div>
      <ul class="am-rows">
        <li>
          <strong>Kioku en este equipo</strong>
          <span>{daemon === "checking" ? "Comprobando…" : daemon === "up" ? "Responde" : "No responde"}</span>
        </li>
        <li>
          <strong>Requisitos del asistente</strong>
          <span>{!ready ? "Sin datos" : ready.ok ? "Detectados" : "Falta algo"}</span>
          {ready && !ready.ok && <p class="muted small">{ready.reason}</p>}
        </li>
      </ul>
      <p class="notice" role="note">
        Esto <strong>no es una prueba de ejecución</strong>: comprueba que Kioku responde y que los programas y credenciales necesarios están presentes, pero no lanza Hermes ni Docker ni envía nada a un modelo. Solo una pregunta real al asistente confirma que todo funciona.
      </p>
      <div class="row"><button disabled={busy} onClick={() => void check()}>{busy ? "Comprobando…" : "Comprobar de nuevo"}</button></div>
    </div>
  );
}

function IphoneSection({ go }: { go?(route: string): void }) {
  return (
    <div>
      <p>Kioku se instala en el iPhone como un icono más; el asistente sigue trabajando en este equipo, que debe estar encendido y con Kioku en marcha.</p>
      <ol class="am-steps">
        <li>En la terminal de este equipo ejecuta <code>kioku pair</code>. Imprime una dirección con la clave del móvil: ábrela solo en tu iPhone y no la compartas. Este panel nunca la muestra.</li>
        <li>Si dice que no conoce el nombre del equipo: con Tailscale, <code>tailscale serve --bg 47800</code> y vuelve a lanzar <code>kioku pair</code>, o indícalo con <code>KIOKU_PUBLIC_HOST</code>. El daemon debe aceptar ese nombre con <code>KIOKU_ALLOWED_HOSTS</code> (<code>kioku service install</code> lo conserva).</li>
        <li>En Safari, en el iPhone: <strong>Compartir → Añadir a pantalla de inicio</strong>.</li>
        <li>Abre Kioku desde su icono, sin buscar el enlace otra vez.</li>
      </ol>
      <p class="muted small">Para desemparejarlo: <code>kioku pair --revoke</code>. Esta guía no genera enlaces ni códigos QR ni comprueba tu iPhone: el emparejamiento real lo hace el comando.</p>
      {go && <div class="row"><button onClick={() => go("/asistente")}>Volver al asistente</button></div>}
    </div>
  );
}
