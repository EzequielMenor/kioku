// Rol de quien usa la interfaz (lo dice el daemon en /api/session). Solo adapta controles: el servidor es quien lo impone.
import { lsGet, lsSet } from "./api.ts";

export type Role = "full" | "mobile";

let role: Role = lsGet("role") === "mobile" ? "mobile" : "full"; // último rol visto: evita el parpadeo de controles al abrir

export const getRole = (): Role => role;
export const isMobile = (): boolean => role === "mobile";

export function setRole(r: Role): void {
  role = r;
  lsSet("role", r);
}

/** Pantallas que el rol móvil no tiene: el asistente y las propuestas se usan en el portátil. */
export const MOBILE_HIDDEN = new Set(["/asistente", "/propuestas"]);
