import { useEffect, useState } from "preact/hooks";
import { askConfirm } from "./dialogs.tsx";
import { deviceRequest, enrollmentLink, enrollmentToken, localQrSvg } from "./device-access-model.ts";
import "./device-access.css";

interface Device { id: string; name: string; createdAt: string }
interface Connection { connected: boolean; ready: boolean; canConfigure: boolean; localAdmin: boolean; publicOrigin: string | null; problem: string | null }
const message = (e: unknown) => e instanceof Error ? e.message : "No se pudo completar la operación";

export function PrivateDevicesPanel() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [legacy, setLegacy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrollment, setEnrollment] = useState<{ link: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    const [inventory, state] = await Promise.all([
      deviceRequest<{ devices: Device[]; legacyPaired: boolean }>("GET", "/api/devices"),
      deviceRequest<Connection>("GET", "/api/connections/status"),
    ]);
    setDevices(inventory.devices); setLegacy(inventory.legacyPaired); setConnection(state); setLoaded(true);
    if (!state.ready) setEnrollment(null);
  };
  useEffect(() => { void refresh().catch((e) => setError(message(e))); }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const configure = async () => {
    if (!await askConfirm({ title: "Activar acceso privado", body: "Kioku configurará Tailscale Serve para este servidor y guardará su nombre permitido. Solo será accesible dentro de tu red Tailscale: sin abrir el router ni usar Funnel. No se sobrescribirá otro servicio.", confirm: "Activar acceso privado" })) return;
    await run(async () => { await deviceRequest("POST", "/api/connections/configure", { confirm: true }); await refresh(); });
  };
  const enroll = () => run(async () => {
    if (!connection?.publicOrigin) throw new Error("Primero comprueba el acceso privado con Tailscale");
    const result = await deviceRequest<{ token: string; expiresAt: string }>("POST", "/api/devices/enrollments", {});
    setEnrollment({ link: enrollmentLink(connection.publicOrigin, result.token), expiresAt: result.expiresAt }); setCopied(false);
  });
  const revoke = async (device: Device) => {
    if (!await askConfirm({ title: "Desconectar " + device.name, body: "Se retirará solo su acceso al servidor. Los datos que ya descargó pueden seguir en el dispositivo; no es un borrado remoto.", confirm: "Desconectar dispositivo", danger: true })) return;
    await run(async () => { await deviceRequest("DELETE", "/api/devices/" + device.id, {}); await refresh(); });
  };

  return <div data-private-setup>
    <section class="card">
      <div class="eyebrow">1 · Acceso privado</div>
      <h2>{connection?.ready ? "Tailscale preparado" : "Conectar mediante Tailscale"}</h2>
      <p>Instala Tailscale en este ordenador y en tus dispositivos e inicia sesión con la misma cuenta. Kioku te guía; no instala software ni inicia sesión por ti.</p>
      <p><a href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer">Descargar Tailscale</a></p>
      {connection?.problem && <p role="status">{connection.problem}</p>}
      {connection?.ready && <p>Proxy privado detectado: <code>{connection.publicOrigin}</code>. Comprueba el enlace desde tu otro dispositivo.</p>}
      {connection && !connection.localAdmin && <p>Para cambiar la conexión del servidor, abre Kioku en el propio ordenador.</p>}
      <div class="row">
        <button disabled={busy} onClick={() => void run(refresh)}>Comprobar Tailscale</button>
        {!connection?.ready && <button data-configure-private class="primary" disabled={busy || !connection?.localAdmin || !connection.canConfigure} onClick={() => void configure()}>Activar acceso privado</button>}
      </div>
      <p class="muted small">El ordenador debe estar encendido y sin suspensión, con Kioku y Tailscale activos. Esto no garantiza conexión desde otro dispositivo ni sincronización en segundo plano.</p>
    </section>
    <section class="card">
      <div class="eyebrow">2 · Tus dispositivos</div>
      <h2>Dispositivos conectados</h2>
      {error && <p role="alert" class="bad-text">{error}</p>}
      <div data-device-list>
        {!loaded ? <p>Cargando accesos…</p> : devices.length === 0 ? <p>Todavía no hay dispositivos con acceso individual.</p> : <ul>{devices.map((device) => <li key={device.id} class="private-device-row"><span><b>{device.name}</b><br /><small>Vinculado: {new Date(device.createdAt).toLocaleDateString()}</small></span><button disabled={busy} onClick={() => void revoke(device)}>Desconectar</button></li>)}</ul>}
      </div>
      {legacy && <p class="muted small">También hay un acceso antiguo con clave compartida, que no identifica cada teléfono. Los nuevos enlaces de este panel sí crean accesos individuales. No se migra ni revoca el acceso antiguo automáticamente.</p>}
      <button data-enroll-device class="primary" disabled={busy || !connection?.ready} onClick={() => void enroll()}>Añadir dispositivo</button>
      {enrollment && <div class="private-enrollment">
        <h3>Escanea desde el otro dispositivo</h3>
        <div class="private-qr" role="img" aria-label="Código QR de conexión" dangerouslySetInnerHTML={{ __html: localQrSvg(enrollment.link) }} />
        <p>Vence a las {new Date(enrollment.expiresAt).toLocaleTimeString()}. Solo se puede usar una vez. No lo compartas ni lo publiques.</p>
        <input class="wide-input" aria-label="Enlace de conexión" value={enrollment.link} readOnly onFocus={(e) => e.currentTarget.select()} />
        <div class="row"><button disabled={busy} onClick={() => void run(async () => { await navigator.clipboard.writeText(enrollment.link); setCopied(true); })}>Copiar enlace</button><button onClick={() => setEnrollment(null)}>Ocultar código</button></div>
        {copied && <p role="status">Enlace copiado.</p>}
        <p class="muted small">Si no puedes copiarlo, selecciona el campo del enlace. Ocultarlo no lo cancela: sigue caducando a la hora indicada.</p>
      </div>}
    </section>
  </div>;
}

/** Pantalla independiente: canjear un enlace no ejecuta la app ni borra réplicas por un 401 esperado. */
export function DeviceEnrollment() {
  const token = enrollmentToken(location.hash);
  const [name, setName] = useState("Mi teléfono");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: Event) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (!token) throw new Error("El enlace no es válido. Genera otro desde el ordenador.");
      await deviceRequest("POST", "/api/devices/redeem", { token, name });
      history.replaceState(null, "", "/#/hoy");
      location.reload();
    } catch (e) { setError(message(e)); setBusy(false); }
  };
  return <main class="private-welcome" data-device-enrollment>
    <section class="card">
      <div class="eyebrow">Conectar con tu Kioku</div>
      <h1>¿Cómo llamamos a este dispositivo?</h1>
      <p>Usará un acceso propio que podrás retirar desde el ordenador. Tailscale debe estar conectado en ambos equipos.</p>
      <form onSubmit={(e) => void submit(e)}>
        <label>Nombre del dispositivo<input class="wide-input" aria-label="Nombre del dispositivo" value={name} maxLength={80} required autoComplete="off" onInput={(e) => setName(e.currentTarget.value)} /></label>
        <button type="submit" class="primary" disabled={busy || !name.trim()}>{busy ? "Conectando…" : "Conectar este dispositivo"}</button>
      </form>
      {error && <p role="alert" class="bad-text">{error}</p>}
      <p class="muted small">Si el enlace caducó o ya se usó, genera otro en Conexiones y sincronización. Para instalar Kioku: Safari → Compartir → Añadir a pantalla de inicio, o el menú de instalación de Chrome. Si el icono pide acceso de nuevo, abre allí un enlace nuevo del ordenador.</p>
    </section>
  </main>;
}
