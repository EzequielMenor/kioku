export type PushState = "unsupported" | "denied" | "off" | "on";

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function pushState(supported: boolean, permission: NotificationPermission, subscribed: boolean): PushState {
  if (!supported) return "unsupported";
  if (permission === "denied") return "denied";
  return subscribed ? "on" : "off";
}
