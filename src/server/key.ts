// Claves del daemon: secretos persistentes (0600) que exige toda ruta /api salvo las del asistente (token de sesión).
// `secret` da el rol completo; `secret-mobile` (emparejar el móvil) da el rol limitado `mobile` y se puede revocar.
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";

const KEY_RE = /^[0-9a-f]{64}$/;
const keyFile = (home: string) => path.join(home, ".kioku", "secret");
const mobileKeyFile = (home: string) => path.join(home, ".kioku", "secret-mobile");

function readKeyFile(file: string): string | null {
  try {
    const v = readFileSync(file, "utf8").trim();
    return KEY_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

function loadOrCreate(file: string): string {
  const existing = readKeyFile(file);
  if (existing) return existing;
  const key = randomBytes(32).toString("hex");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, key + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  return key;
}

/** Clave guardada, o null si no existe o no tiene el formato esperado. */
export const readKey = (home: string): string | null => readKeyFile(keyFile(home));

/** Lee la clave o la genera (una vez; estable entre reinicios del daemon). */
export const loadOrCreateKey = (home: string): string => loadOrCreate(keyFile(home));

/** Clave del móvil emparejado, o null si no hay ninguno (el daemon la relee en cada petición: revocar es inmediato). */
export const readMobileKey = (home: string): string | null => readKeyFile(mobileKeyFile(home));

/** Crea la clave del móvil si no existe (idempotente; para rotarla, `revokeMobileKey` primero). */
export const loadOrCreateMobileKey = (home: string): string => loadOrCreate(mobileKeyFile(home));

/** Desempareja el móvil: borra su clave. Idempotente. */
export function revokeMobileKey(home: string): void {
  rmSync(mobileKeyFile(home), { force: true });
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
