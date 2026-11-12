// Credenciales móviles independientes. Los códigos de alta viven solo en memoria y caducan al reiniciar.
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

interface Device { id: string; name: string; createdAt: string; digest: string }
export class DeviceError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const validKey = (key: unknown): key is string => typeof key === "string" && /^[0-9a-f]{64}$/.test(key);
export const credentialDigest = (key: string) => createHash("sha256").update(key).digest("hex");

export class Devices {
  private file: string;
  private pending = new Map<string, number>();
  private now: () => number;
  constructor(home: string, now: () => number = Date.now) {
    this.now = now;
    this.file = path.join(home, ".kioku", "device-credentials.json");
  }
  private read(): Device[] {
    let text: string;
    try { text = readFileSync(this.file, "utf8"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw new DeviceError(503, "No se puede leer el registro de dispositivos"); }
    try {
      const value = JSON.parse(text);
      if (!Array.isArray(value) || value.length > 100 || !value.every((d) => d && /^[0-9a-f]{32}$/.test(d.id) && typeof d.name === "string" && d.name.length <= 80 && typeof d.createdAt === "string" && validKey(d.digest))) throw new Error();
      return value;
    } catch { throw new DeviceError(503, "El registro de dispositivos no es válido; no se modifica"); }
  }
  private save(devices: Device[]) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + "." + randomBytes(8).toString("hex") + ".tmp";
    writeFileSync(temp, JSON.stringify(devices), { mode: 0o600, flag: "wx" });
    chmodSync(temp, 0o600);
    renameSync(temp, this.file);
  }
  list() { return this.read().map(({ digest: _, ...publicDevice }) => publicDevice); }
  accepts(key: string | undefined): boolean {
    if (!validKey(key)) return false;
    return this.read().some((d) => d.digest === credentialDigest(key));
  }
  hasDigest(digest: string): boolean { return this.read().some((d) => d.digest === digest); }
  enrollment() {
    for (const [token, expires] of this.pending) if (expires <= this.now()) this.pending.delete(token);
    if (this.pending.size >= 20 || this.read().length >= 100) throw new DeviceError(409, "Cancela o espera a que caduquen los enlaces pendientes; máximo 100 dispositivos");
    const token = randomBytes(32).toString("hex");
    const expires = this.now() + 5 * 60_000;
    this.pending.set(credentialDigest(token), expires);
    return { token, expiresAt: new Date(expires).toISOString() };
  }
  redeem(token: unknown, name: unknown) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new DeviceError(400, "El nombre debe tener entre 1 y 80 caracteres, sin controles");
    const digest = validKey(token) ? credentialDigest(token) : "";
    const expires = this.pending.get(digest);
    if (!expires || expires <= this.now()) throw new DeviceError(401, "El enlace ha caducado o ya se usó; genera otro en el ordenador");
    const devices = this.read();
    if (devices.length >= 100) throw new DeviceError(409, "Máximo 100 dispositivos");
    const key = randomBytes(32).toString("hex");
    const device: Device = { id: randomBytes(16).toString("hex"), name: name.trim(), createdAt: new Date(this.now()).toISOString(), digest: credentialDigest(key) };
    // No hay await entre consumir y guardar: una sola petición gana en este daemon.
    this.save([...devices, device]);
    this.pending.delete(digest);
    return { key, device: { id: device.id, name: device.name, createdAt: device.createdAt } };
  }
  revoke(id: string) {
    if (!/^[0-9a-f]{32}$/.test(id)) throw new DeviceError(400, "Identificador de dispositivo inválido");
    const devices = this.read();
    const device = devices.find((d) => d.id === id);
    if (!device) throw new DeviceError(404, "Ese dispositivo no existe");
    this.save(devices.filter((d) => d.id !== id));
    return device.digest;
  }
}
