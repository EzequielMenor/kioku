// Web Push (RFC 8030 + VAPID RFC 8292 + cifrado aes128gcm RFC 8291) con node:crypto, sin dependencias.
// El aviso viaja cifrado de extremo a extremo hasta el móvil: el servicio push (Apple, Google…) solo ve bytes.
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Kioku } from "../core/kioku.ts";
import type { Notification } from "../core/notifications.ts";
import type { Channel } from "./notifier.ts";
import { VaultError } from "../core/vault.ts";
import { Devices } from "./devices.ts";

export interface PushSubscription { endpoint: string; keys: { p256dh: string; auth: string }; owner?: string }
export interface Vapid { publicKey: string; privateKey: string }

const b64u = (b: Buffer | Uint8Array | string) => Buffer.from(b as Buffer).toString("base64url");

/** Solo se contactan servicios push reales por https: la URL la manda el cliente y sin esto sería una vía de SSRF. */
const PUSH_HOSTS = [/^([a-z0-9-]+\.)*push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
export function isPushEndpoint(value: unknown): boolean {
  if (typeof value !== "string") return false;
  let u: URL;
  try { u = new URL(value); } catch { return false; }
  return u.protocol === "https:" && !u.username && !u.password && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

/** Cuerpo aes128gcm de un único registro (RFC 8291 §4). `asPrivate` y `salt` solo se fijan en las pruebas con el vector del RFC. */
export function encryptPayload(plain: Buffer, o: { uaPublic: Buffer; authSecret: Buffer; asPrivate?: Buffer; salt?: Buffer }): Buffer {
  const ecdh = createECDH("prime256v1");
  if (o.asPrivate) ecdh.setPrivateKey(o.asPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const salt = o.salt ?? randomBytes(16);
  const ikm = Buffer.from(hkdfSync("sha256", ecdh.computeSecret(o.uaPublic), o.authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), o.uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const c = createCipheriv("aes-128-gcm", cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([plain, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct]);
}

/** Cabecera `Authorization` VAPID: JWT ES256 con audiencia = origen del servicio push. */
export function vapidAuthorization(endpoint: string, vapid: Vapid, subject: string, now: Date = new Date()): string {
  const pub = Buffer.from(vapid.publicKey, "base64url");
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: vapid.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: "jwk" });
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: subject }));
  const sig = sign("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

const SUBS_FILE = "push-subscriptions.json";

/** Claves VAPID (0600, estables) y suscripciones de los móviles; viven en `.kioku/`. */
export class PushStore {
  readonly vapid: Vapid;
  private file: string;
  private active(owner: string): boolean { return new Devices(path.dirname(path.dirname(this.file))).hasDigest(owner); }
  private constructor(file: string, vapid: Vapid) { this.file = file; this.vapid = vapid; }

  static async open(root: string): Promise<PushStore> {
    const dir = path.join(root, ".kioku");
    mkdirSync(dir, { recursive: true });
    const vf = path.join(dir, "vapid.json");
    let vapid: Vapid | null = null;
    if (existsSync(vf)) { try { const v = JSON.parse(readFileSync(vf, "utf8")); if (typeof v.publicKey === "string" && typeof v.privateKey === "string") vapid = v; } catch { /* se regenera */ } }
    if (!vapid) {
      const e = createECDH("prime256v1"); e.generateKeys();
      vapid = { publicKey: b64u(e.getPublicKey()), privateKey: b64u(e.getPrivateKey()) };
      writeFileSync(vf, JSON.stringify(vapid), { mode: 0o600 });
      chmodSync(vf, 0o600);
    }
    return new PushStore(path.join(dir, SUBS_FILE), vapid);
  }

  /** Se lee del disco cada vez: `kioku pair --revoke` borra el fichero y el daemon deja de avisar al instante. */
  list(): PushSubscription[] {
    try { const v = JSON.parse(readFileSync(this.file, "utf8")); return Array.isArray(v) ? v.filter(validSub).filter((s) => s.owner === undefined || (/^[0-9a-f]{64}$/.test(s.owner) && this.active(s.owner))) : []; } catch { return []; }
  }

  async add(sub: unknown, owner?: string): Promise<void> {
    if (!validSub(sub)) throw new VaultError("invalid", "Suscripción push inválida");
    this.save([...this.list().filter((s) => s.endpoint !== sub.endpoint), { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, ...(owner ? { owner } : {}) }]);
  }

  async removeOwner(owner: string): Promise<void> { this.save(this.list().filter((s) => s.owner !== owner)); }

  async remove(endpoint: string): Promise<void> {
    this.save(this.list().filter((s) => s.endpoint !== endpoint));
  }

  private save(subs: PushSubscription[]): void { writeFileSync(this.file, JSON.stringify(subs), { mode: 0o600 }); }
}

/** Borra todas las suscripciones (al desemparejar el móvil). */
export function clearPushSubscriptions(home: string): void { rmSync(path.join(home, ".kioku", SUBS_FILE), { force: true }); }

function validSub(s: unknown): s is PushSubscription {
  if (!s || typeof s !== "object") return false;
  const o = s as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (!isPushEndpoint(o.endpoint) || !o.keys || typeof o.keys.p256dh !== "string" || typeof o.keys.auth !== "string") return false;
  return Buffer.from(o.keys.p256dh, "base64url").length === 65 && Buffer.from(o.keys.auth, "base64url").length === 16;
}

/** Canal de aviso al móvil. `exclude` devuelve las carpetas/rutas privadas del móvil: nunca salen en un push. */
export function pushChannel(j: Kioku, store: PushStore, o: { fetch?: typeof fetch; exclude: () => Promise<string[]>; subject?: string } ): Channel & { prepare(): Promise<void> } {
  let hidden: string[] = [];
  const doFetch = o.fetch ?? fetch;
  return {
    name: "push",
    async prepare() { hidden = await o.exclude(); },
    enabled: () => store.list().length > 0,
    visible: (p) => !hidden.some((x) => isHidden(p, x)),
    async send(n: Notification) {
      const payload = Buffer.from(JSON.stringify({ title: n.title, body: n.body, tag: n.id }));
      let failed = 0;
      await Promise.all(store.list().map(async (sub) => {
        const body = encryptPayload(payload, { uaPublic: Buffer.from(sub.keys.p256dh, "base64url"), authSecret: Buffer.from(sub.keys.auth, "base64url") });
        const res = await doFetch(sub.endpoint, {
          method: "POST",
          headers: { authorization: vapidAuthorization(sub.endpoint, store.vapid, o.subject ?? "mailto:kioku@example.com"), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "3600", urgency: "normal" },
          body: new Uint8Array(body),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 404 || res.status === 410) await store.remove(sub.endpoint);
        else if (res.status >= 400) failed++;
      }));
      if (failed) throw new Error(`el servicio push rechazó ${failed} envío(s)`);
    },
  };
}

const isHidden = (p: string, x: string) => { const k = x.normalize("NFC").toLowerCase().replace(/^\.?\//, ""), v = p.normalize("NFC").toLowerCase(); return k !== "" && v.startsWith(k); };
