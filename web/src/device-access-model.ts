import qrcode from "qrcode-generator";

export const enrollmentToken = (hash: string): string | null => /^#\/vincular\/([0-9a-f]{64})$/.exec(hash)?.[1] ?? null;
export function enrollmentLink(origin: string, token: string): string {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.port !== "" || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/.test(url.hostname) || origin !== url.origin || !/^[0-9a-f]{64}$/.test(token)) throw new Error("Hace falta una dirección privada HTTPS de Tailscale y un código válido");
  return origin + "/#/vincular/" + token;
}
export function localQrSvg(link: string): string {
  const code = qrcode(0, "M");
  code.addData(link);
  code.make();
  return code.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
}

/** Administración siempre en vivo: no usar réplicas offline ni transporte de demo. */
export async function deviceRequest<T>(method: "GET" | "POST" | "DELETE", route: string, body?: unknown, fetcher: typeof fetch = fetch): Promise<T> {
  const r = await fetcher(route, {
    method, cache: "no-store", credentials: "same-origin", redirect: "error",
    headers: method === "GET" ? undefined : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "No se pudo completar la conexión");
  return data as T;
}
