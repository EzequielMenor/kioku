import { useEffect, useState } from "preact/hooks";
import { onChange } from "./api.ts";
import { askConfirm } from "./dialogs.tsx";
import { deviceRequest } from "./device-access-model.ts";

export interface ClientUpdateStatus {
  installed: {
    version: string;
    commit: string | null;
    shortCommit: string | null;
    ref: string;
    repo: string;
    channel: "macos-app" | "linux-install" | "git" | "docker" | "source";
    installedAt: string | null;
  };
  latest: {
    commit: string;
    shortCommit: string;
    title: string;
    date: string;
    url: string;
  } | null;
  checkedAt: string | null;
  updateAvailable: boolean;
  unknownInstalledCommit: boolean;
  canAutoUpdate: boolean;
  manualCommand: string;
  cannotAutoUpdateReason: string | null;
  phase: "idle" | "checking" | "installing" | "restarting" | "error";
  message: string | null;
  error: string | null;
  localAdmin: boolean;
}

const CHANNEL_LABEL: Record<ClientUpdateStatus["installed"]["channel"], string> = {
  "macos-app": "App de Mac",
  "linux-install": "Instalación Linux",
  git: "Código fuente (git)",
  docker: "Docker",
  source: "Código fuente",
};

const DISMISS_KEY = "kioku.updateDismissed";
const getDismissed = () => { try { return sessionStorage.getItem(DISMISS_KEY); } catch { return null; } };
const setDismissedKey = (v: string | null) => {
  try { if (v) sessionStorage.setItem(DISMISS_KEY, v); else sessionStorage.removeItem(DISMISS_KEY); } catch { /* sin sesión */ }
};

let state: {
  data: ClientUpdateStatus | null;
  loaded: boolean;
  busy: boolean;
  actionError: string;
  dismissed: string | null;
  reloadTimedOut: boolean;
} = {
  data: null, loaded: false, busy: false, actionError: "", dismissed: getDismissed(), reloadTimedOut: false,
};

const listeners = new Set<() => void>();
let started = false;
let restartingPoll = false;
let reloadTimer = 0;

function notify() {
  for (const fn of listeners) fn();
}

function setData(next: ClientUpdateStatus, fromHttp = false) {
  const prev = state.data;
  // La respuesta 202 («installing») puede llegar después del SSE («restarting» / «error»); nunca retroceder.
  if (fromHttp && next.phase === "installing" && prev && (prev.phase === "restarting" || prev.phase === "error")) return;
  const localAdmin = typeof next.localAdmin === "boolean" ? next.localAdmin : (prev?.localAdmin ?? false);
  const merged: ClientUpdateStatus = { ...next, localAdmin };
  state = { ...state, data: merged, loaded: true };
  if (merged.phase === "restarting" && !restartingPoll) startRestartWatch();
  notify();
}

function startRestartWatch() {
  restartingPoll = true;
  state = { ...state, reloadTimedOut: false };
  notify();
  let tries = 0;
  const tick = async () => {
    tries++;
    try {
      const r = await fetch("/api/update/status", { cache: "no-store", credentials: "same-origin" });
      if (r.ok) {
        const s = (await r.json()) as ClientUpdateStatus;
        if (s.phase !== "restarting") {
          restartingPoll = false;
          location.reload();
          return;
        }
      }
    } catch {
      /* el daemon anterior está cerrándose antes de volver a arrancar */
    }
    if (tries >= 36) {
      restartingPoll = false;
      state = { ...state, reloadTimedOut: true };
      notify();
      return;
    }
    reloadTimer = window.setTimeout(() => { void tick(); }, 600);
  };
  reloadTimer = window.setTimeout(() => { void tick(); }, 900);
}

function ensureStarted() {
  if (started) return;
  started = true;
  void refreshUpdates();
  onChange((ev) => {
    if (ev.kind === "update" && "status" in ev && ev.status && typeof ev.status === "object") {
      setData(ev.status as ClientUpdateStatus);
    }
  });
}

async function refreshUpdates() {
  try {
    const s = await deviceRequest<ClientUpdateStatus>("GET", "/api/update/status");
    setData(s, true);
  } catch {
    state = { ...state, loaded: true };
    notify();
  }
}

async function checkUpdates() {
  state = { ...state, busy: true, actionError: "" };
  notify();
  try {
    const s = await deviceRequest<ClientUpdateStatus>("POST", "/api/update/check", {});
    setDismissedKey(null);
    state = { ...state, dismissed: null };
    setData(s, true);
  } catch (e) {
    state = { ...state, actionError: e instanceof Error ? e.message : "No se pudo comprobar si hay actualizaciones" };
  } finally {
    state = { ...state, busy: false };
    notify();
  }
}

async function installUpdate() {
  const s = state.data;
  if (!s) return;
  const target = s.latest ? ` (${s.latest.shortCommit})` : "";
  const ok = await askConfirm({
    title: `Actualizar Kioku${target}`,
    body: "Se descargará e instalará la última versión manteniendo tus notas, claves y dispositivos intactos, con copia de respaldo .anterior-. Al terminar se reiniciará Kioku automáticamente.",
    confirm: "Actualizar ahora",
  });
  if (!ok) return;
  state = { ...state, busy: true, actionError: "" };
  notify();
  try {
    const next = await deviceRequest<ClientUpdateStatus>("POST", "/api/update/install", { confirm: true });
    setData(next, true);
  } catch (e) {
    state = { ...state, actionError: e instanceof Error ? e.message : "No se pudo iniciar la actualización" };
  } finally {
    state = { ...state, busy: false };
    notify();
  }
}

function dismissBanner() {
  const key = state.data?.latest?.commit ?? "unknown";
  setDismissedKey(key);
  state = { ...state, dismissed: key };
  notify();
}

export function useUpdates() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    ensureStarted();
    return () => {
      listeners.delete(fn);
      if (listeners.size === 0 && reloadTimer) { clearTimeout(reloadTimer); reloadTimer = 0; }
    };
  }, []);
  return state;
}

export function UpdateBanner({ go }: { go: (route: string) => void }) {
  const u = useUpdates();
  const s = u.data;
  if (!s) return null;
  const activeOp = s.phase === "installing" || s.phase === "restarting";
  const currentKey = s.latest?.commit ?? "unknown";
  if (!activeOp && (!s.updateAvailable || u.dismissed === currentKey)) return null;

  return (
    <div class="updatebar" role="status" aria-live="polite">
      <div class="utxt">
        {s.phase === "installing" && <>Actualizando Kioku… {s.message ?? "preparando la nueva versión (tus datos no se tocan)."}</>}
        {s.phase === "restarting" && (
          u.reloadTimedOut
            ? <>Actualización instalada. Si ya se abrió la nueva ventana de Kioku, cierra esta o recarga.</>
            : <>Actualización instalada. Reiniciando Kioku… esta pestaña se recargará sola.</>
        )}
        {!activeOp && s.updateAvailable && (
          <>
            <b>Actualización disponible</b>
            {s.latest && <> · <code>{s.latest.shortCommit}</code>{s.latest.title ? ` · ${s.latest.title}` : ""}</>}
          </>
        )}
      </div>
      {s.phase === "restarting" && u.reloadTimedOut && (
        <button class="primary" onClick={() => location.reload()}>Recargar ahora</button>
      )}
      {!activeOp && s.canAutoUpdate && s.localAdmin && (
        <button class="primary" disabled={u.busy} onClick={() => void installUpdate()}>Actualizar ahora</button>
      )}
      {!activeOp && <button onClick={() => go("/conexiones")}>Detalles</button>}
      {!activeOp && <button onClick={dismissBanner}>Más tarde</button>}
    </div>
  );
}

export function UpdateSection() {
  const u = useUpdates();
  const s = u.data;
  const [copied, setCopied] = useState(false);

  if (!u.loaded && !s) {
    return (
      <section class="card">
        <div class="eyebrow">Actualizaciones</div>
        <p class="muted">Comprobando versión instalada…</p>
      </section>
    );
  }
  if (!s) return null;

  const activeOp = s.phase === "installing" || s.phase === "restarting";
  const copyCmd = async () => {
    try { await navigator.clipboard.writeText(s.manualCommand); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { /* portapapeles no disponible */ }
  };

  return (
    <section class="card" aria-live="polite" data-updates-panel>
      <div class="eyebrow">Actualizaciones</div>
      <h2>
        {s.phase === "installing"
          ? "Actualizando Kioku…"
          : s.phase === "restarting"
            ? "Reiniciando Kioku…"
            : s.updateAvailable
              ? "Hay una actualización disponible"
              : s.latest
                ? "✓ Kioku está al día"
                : `Kioku ${s.installed.version}`}
      </h2>
      <p>
        Instalado: <code>v{s.installed.version}</code>
        {s.installed.shortCommit ? <> · <code>{s.installed.shortCommit}</code></> : <> · sin marca de commit</>}
        {" · "}{CHANNEL_LABEL[s.installed.channel]} (<code>{s.installed.repo}@{s.installed.ref}</code>)
      </p>
      {s.latest && (
        <p class="muted small">
          Último en <code>{s.installed.ref}</code>: <code>{s.latest.shortCommit}</code> — {s.latest.title}
          {s.latest.url && <> (<a href={s.latest.url} target="_blank" rel="noopener noreferrer">ver commit</a>)</>}
          {s.checkedAt && <> · comprobado: {new Date(s.checkedAt).toLocaleString()}</>}
        </p>
      )}
      {!s.latest && s.checkedAt && (
        <p class="muted small">Última comprobación: {new Date(s.checkedAt).toLocaleString()}</p>
      )}
      {s.message && <p role="status">{s.message}</p>}
      {(s.error || u.actionError) && <p role="alert" class="bad-text">{u.actionError || s.error}</p>}
      {!s.canAutoUpdate && s.cannotAutoUpdateReason && <p class="muted small">{s.cannotAutoUpdateReason}</p>}
      {s.canAutoUpdate && !s.localAdmin && (
        <p class="muted small">Abre Kioku en el propio ordenador (<code>127.0.0.1</code>) para instalar la actualización desde aquí.</p>
      )}

      <div class="row">
        <button disabled={u.busy || activeOp} onClick={() => void checkUpdates()}>
          {s.phase === "checking" || (u.busy && !activeOp) ? "Buscando…" : "Buscar actualizaciones"}
        </button>
        {s.canAutoUpdate && s.localAdmin && (s.updateAvailable || s.unknownInstalledCommit) && (
          <button class="primary" disabled={u.busy || activeOp} onClick={() => void installUpdate()}>
            {s.phase === "installing" ? "Instalando…" : s.phase === "restarting" ? "Reiniciando…" : "Actualizar ahora"}
          </button>
        )}
        {s.phase === "restarting" && u.reloadTimedOut && (
          <button class="primary" onClick={() => location.reload()}>Recargar ahora</button>
        )}
      </div>

      <details open={!s.canAutoUpdate && s.updateAvailable}>
        <summary>Actualizar manualmente desde terminal</summary>
        <p class="muted small">Conserva tus notas, claves y dispositivos; guarda copia <code>.anterior-...</code> antes de reemplazar.</p>
        <div class="row">
          <input class="wide-input" aria-label="Comando de actualización" value={s.manualCommand} readOnly onFocus={(e) => e.currentTarget.select()} />
          <button onClick={() => void copyCmd()}>{copied ? "Copiado" : "Copiar"}</button>
        </div>
      </details>
    </section>
  );
}
