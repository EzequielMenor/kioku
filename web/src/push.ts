import { api } from "./api.ts";
import { pushState, urlBase64ToUint8Array, type PushState } from "./push-state.ts";

export { urlBase64ToUint8Array } from "./push-state.ts";
export type { PushState } from "./push-state.ts";

export function pushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator &&
    typeof PushManager !== "undefined" && typeof Notification !== "undefined";
}

export async function currentState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.ready;
  return pushState(true, Notification.permission, !!(await registration.pushManager.getSubscription()));
}

/** Llamar directamente desde un gesto del usuario, antes de cualquier espera. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("No se ha concedido permiso para avisos.");
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>("GET", "/api/push/key");
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  try { await api("POST", "/api/push/subscribe", { subscription: subscription.toJSON() }); }
  catch (e) { if (!existing) await subscription.unsubscribe().catch(() => {}); throw e; }
}

export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  // Si falla la red, conservamos la suscripción local para poder reintentar la baja.
  await api("POST", "/api/push/unsubscribe", { endpoint: subscription.endpoint });
  if (!await subscription.unsubscribe()) throw new Error("No se pudo desactivar la suscripción de avisos.");
}
