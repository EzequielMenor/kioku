import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";
import { PushStore, encryptPayload, isPushEndpoint, pushChannel, vapidAuthorization } from "../src/server/webpush.ts";
import { Kioku } from "../src/core/kioku.ts";
import { tmpVault } from "./helpers.ts";

const b64 = (s: string) => Buffer.from(s, "base64url");

test("cifrado: reproduce el vector de prueba del RFC 8291 (apéndice A)", () => {
  const body = encryptPayload(Buffer.from("When I grow up, I want to be a watermelon"), {
    uaPublic: b64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
    authSecret: b64("BTBZMqHH6r4Tts7J_aSIgg"),
    asPrivate: b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
    salt: b64("DGv6ra1nlYgDCS1FRnbzlw"),
  });
  assert.equal(body.toString("base64url"), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("VAPID: el JWT lleva audiencia, caducidad corta y asunto, y se verifica con la clave pública", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const store = await PushStore.open(root);
    const now = new Date("2026-11-05T10:00:00Z");
    const h = vapidAuthorization("https://web.push.apple.com/abc", store.vapid, "mailto:kioku@example.com", now);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h)!;
    assert.ok(m);
    assert.equal(m[4], store.vapid.publicKey);
    const claims = JSON.parse(b64(m[2]).toString());
    assert.equal(claims.aud, "https://web.push.apple.com");
    assert.equal(claims.sub, "mailto:kioku@example.com");
    assert.ok(claims.exp > now.getTime() / 1000 && claims.exp <= now.getTime() / 1000 + 12 * 3600);
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64(store.vapid.publicKey).subarray(1, 33).toString("base64url"), y: b64(store.vapid.publicKey).subarray(33).toString("base64url") }, format: "jwk" });
    assert.ok(verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: "ieee-p1363" }, b64(m[3])));
  } finally { cleanup(); }
});

test("endpoints: solo servicios push conocidos por https (no se contacta cualquier URL)", () => {
  for (const ok of ["https://web.push.apple.com/x", "https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w"]) assert.ok(isPushEndpoint(ok), ok);
  for (const bad of ["http://web.push.apple.com/x", "https://web.push.apple.com.evil.example/x", "https://evil.example/web.push.apple.com", "https://127.0.0.1:47800/x", "no es url", "https://user@web.push.apple.com/x"]) assert.equal(isPushEndpoint(bad), false, bad);
});

test("almacén: las claves VAPID son estables y 0600; suscripciones se guardan, reemplazan y borran", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const a = await PushStore.open(root);
    const b = await PushStore.open(root);
    assert.equal(a.vapid.publicKey, b.vapid.publicKey);
    assert.equal(statSync(path.join(root, ".kioku", "vapid.json")).mode & 0o777, 0o600);
    const ua = createECDH("prime256v1"); ua.generateKeys();
    const sub = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") } };
    await a.add(sub); await a.add(sub);
    assert.equal((await PushStore.open(root)).list().length, 1);
    await assert.rejects(a.add({ endpoint: "https://evil.example/x", keys: sub.keys }));
    await assert.rejects(a.add({ endpoint: sub.endpoint, keys: { p256dh: "corta", auth: sub.keys.auth } }));
    await a.remove(sub.endpoint);
    assert.equal((await PushStore.open(root)).list().length, 0);
  } finally { cleanup(); }
});

test("canal push: envía cifrado (el móvil lo descifra), reintenta sin duplicar y borra la suscripción si el servicio responde 410", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const j = await Kioku.open({ root });
    const store = await PushStore.open(root);
    const ua = createECDH("prime256v1"); ua.generateKeys();
    const auth = Buffer.alloc(16, 7);
    await store.add({ endpoint: "https://web.push.apple.com/ok", keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } });
    await store.add({ endpoint: "https://web.push.apple.com/gone", keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } });
    const calls: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
    const fetcher = (async (url: string, init: { headers: Record<string, string>; body: Buffer }) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { status: url.endsWith("gone") ? 410 : 201 };
    }) as unknown as typeof fetch;
    const ch = pushChannel(j, store, { fetch: fetcher, exclude: async () => ["Privado/"] });
    await ch.prepare?.();
    assert.ok(ch.enabled({ desktop: true, eventLeadMinutes: 10, digestHour: 9 }));
    assert.equal(ch.visible("Privado/x.md"), false);
    await ch.send({ id: "x", kind: "event", title: "Dentista", body: "Evento a las 17:00", paths: [] });
    assert.equal(calls.length, 2);
    const call = calls.find((c) => c.url.endsWith("ok"))!;
    assert.equal(call.headers["content-encoding"], "aes128gcm");
    assert.match(call.headers.authorization, /^vapid t=.+, k=.+$/);
    assert.ok(Number(call.headers.ttl) > 0);
    // el móvil descifra con su clave privada (RFC 8291, lado receptor)
    const salt = call.body.subarray(0, 16), idlen = call.body[20], asPub = call.body.subarray(21, 21 + idlen), ct = call.body.subarray(21 + idlen);
    const ikm = Buffer.from(hkdfSync("sha256", ua.computeSecret(asPub), auth, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPub]), 32));
    const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const d = createDecipheriv("aes-128-gcm", cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    assert.deepEqual(JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString()), { title: "Dentista", body: "Evento a las 17:00", tag: "x" });
    assert.deepEqual(store.list().map((s) => s.endpoint), ["https://web.push.apple.com/ok"]);
    j.close();
  } finally { cleanup(); }
});
