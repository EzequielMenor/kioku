// Clave del daemon: secreto persistente (0600) que exige toda ruta /api salvo las del asistente (token de sesión).
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";

const KEY_RE = /^[0-9a-f]{64}$/;
const keyFile = (home: string) => path.join(home, ".kioku", "secret");

/** Clave guardada, o null si no existe o no tiene el formato esperado. */
export function readKey(home: string): string | null {
  try {
    const v = readFileSync(keyFile(home), "utf8").trim();
    return KEY_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Lee la clave o la genera (una vez; estable entre reinicios del daemon). */
export function loadOrCreateKey(home: string): string {
  const existing = readKey(home);
  if (existing) return existing;
  const key = randomBytes(32).toString("hex");
  mkdirSync(path.dirname(keyFile(home)), { recursive: true });
  writeFileSync(keyFile(home), key + "\n", { mode: 0o600 });
  chmodSync(keyFile(home), 0o600);
  return key;
}

export function newKey(): string {
  return randomBytes(32).toString("hex");
}

/** Comparación en tiempo constante; cualquier valor que no sea una clave bien formada se rechaza. */
export function keyMatches(expected: string, given: string | undefined): boolean {
  if (!given || !KEY_RE.test(given)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

/** Clave presentada en la petición: cabecera `x-kioku-key` o cookie `kioku_key`. */
export function presentedKey(headers: { cookie?: string; "x-kioku-key"?: string | string[] }): string | undefined {
  const h = headers["x-kioku-key"];
  if (typeof h === "string" && h) return h;
  const m = /(?:^|;\s*)kioku_key=([^;\s]*)/.exec(headers.cookie ?? "");
  return m?.[1];
}
