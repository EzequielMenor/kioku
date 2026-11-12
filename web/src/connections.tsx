// Pantalla «Conexión»: estado real del ordenador-centro, ayuda para conectar y, en el móvil, la cola de sincronización.
// La cola y sus conflictos los pinta quien la integra (children, p. ej. OfflineSection): aquí no se duplica su lógica.
import { useEffect, useState } from "preact/hooks";
import { DEMO_NOTICE, connectionGuide, describeHealth, probeHealth, safeOrigin, type HealthState } from "./connections-model.ts";
import { formatAgo, useOffline } from "./offline/runtime.ts";
import { isMobile } from "./role.ts";
import { PrivateDevicesPanel } from "./device-access.tsx";

export interface ConnectionsViewProps {
  /** Demostración en el navegador: se muestra como simulación y no se sondea ninguna red. */
  demo?: boolean;
  /** Fuerza la ayuda de móvil o de escritorio; por omisión, la del rol detectado. */
  mobile?: boolean;
  /** Controles de cola y conflictos (OfflineSection); solo se muestran en el móvil real. */
  children?: preact.ComponentChildren;
}

export function ConnectionsView({ demo = false, mobile = isMobile(), children }: ConnectionsViewProps) {
  const off = useOffline();
  const [probe, setProbe] = useState<HealthState>({ state: "checking" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (demo) return;
    let live = true;
    setProbe({ state: "checking" });
    void probeHealth((input, init) => fetch(input, init)).then((r) => { if (live) setProbe(r); });
    return () => { live = false; };
  }, [demo, attempt]);

  const health: HealthState = demo ? { state: "simulated" } : probe;
  const view = describeHealth(health);
  const origin = safeOrigin(location);
  return (
    <div class="connections">
      <h1>Conexiones y sincronización</h1>
      {demo && <p class="card" role="note"><b>{DEMO_NOTICE}</b></p>}
      <section class="card" aria-live="polite">
        <div class="eyebrow">{demo ? "Estado (simulado)" : "Estado"}</div>
        <h2 class={view.tone === "bad" ? "bad-text" : ""}>{view.tone === "ok" ? "✓ " : view.tone === "bad" ? "✕ " : ""}{view.title}</h2>
        <p class="muted">{view.detail}</p>
        {!demo && origin && <p class="small">Dirección de esta página: <code>{origin}</code></p>}
        {!demo && <button disabled={health.state === "checking"} onClick={() => setAttempt((n) => n + 1)}>{health.state === "checking" ? "Comprobando…" : "Reintentar"}</button>}
      </section>
      {mobile && !demo && (
        <section class="card">
          <div class="eyebrow">Sincronización</div>
          <p>{off.online ? "Último estado observado por Kioku: conexión disponible." : "Último estado observado por Kioku: sin conexión."} Para comprobar el acceso ahora, usa la comprobación de arriba.</p>
          <p class="muted small">Última sincronización: {off.lastSync ? formatAgo(off.lastSync, Date.now()) : "todavía ninguna"}</p>
          {children}
        </section>
      )}
      {mobile && demo && <p class="muted small">La cola de sincronización no se muestra en la simulación: no hay ordenador al que enviar nada.</p>}
      {!demo && !mobile && <PrivateDevicesPanel />}
      <details><summary>Ayuda avanzada y acceso antiguo</summary>
      {connectionGuide(mobile).map((s) => (
        <section class="card" key={s.title}>
          <div class="eyebrow">{s.title}</div>
          <ul>
            {s.items.map((i) => <li key={i.text}>{i.text}{i.command && <> <code>{i.command}</code></>}</li>)}
          </ul>
        </section>
      ))}
      </details>
    </div>
  );
}
