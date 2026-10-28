export const READ_TIMEOUT_MS = 3000;
export const API_CACHE = "kioku-api";

// Lo que nunca se guarda: flujos en vivo, salud y todo lo del asistente, propuestas e IA (cambian o son sensibles).
const NEVER = /^\/api\/(?:events|health|assistant|proposals|ai)(?:\/|$)/;

/** Lecturas de datos cuya última respuesta puede servirse sin red. */
export function cacheableRead(method: string, pathname: string): boolean {
  return method === "GET" && pathname.startsWith("/api/") && !NEVER.test(pathname);
}

/** Estáticos de la aplicación (HTML, JS, CSS, fuentes, iconos). */
export function isShell(method: string, pathname: string): boolean {
  return method === "GET" && !pathname.startsWith("/api/");
}

export const shellCacheName = (buildId: string): string => `kioku-shell-${buildId}`;
