import test from "node:test";
import assert from "node:assert/strict";
import { enrollmentLink, enrollmentToken, localQrSvg, deviceRequest } from "../web/src/device-access-model.ts";

const token = "b".repeat(64);
test("device UI uses private HTTPS links with one-use code only in fragment and generates QR locally", () => {
  const link = enrollmentLink("https://mac.example.ts.net", token);
  assert.equal(link, "https://mac.example.ts.net/#/vincular/" + token);
  assert.equal(new URL(link).search, "");
  assert.equal(enrollmentToken(new URL(link).hash), token);
  for (const hash of ["#/vincular/bad", "#/hoy", "#/vincular/" + token + "?x=1"]) assert.equal(enrollmentToken(hash), null);
  for (const origin of ["http://mac.example.ts.net", "https://evil.invalid", "https://mac.example.ts.net/path", "https://user@mac.example.ts.net", "https://mac.example.ts.net:444"]) assert.throws(() => enrollmentLink(origin, token));
  const svg = localQrSvg(link);
  assert.match(svg, /<svg/);
  assert.match(svg, /<path/);
  assert.doesNotMatch(svg, /<image|<script|href=|url\(/);
});

test("device management requests never fall back to offline/demo state or persist credentials", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ revoked: true }), { status: 200 }); }) as typeof fetch;
  assert.deepEqual(await deviceRequest("DELETE", "/api/devices/abc", {}, fetcher), { revoked: true });
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].init.body, "{}");
  await assert.rejects(deviceRequest("POST", "/api/devices/redeem", {}, (async () => new Response(JSON.stringify({ error: "El enlace ya se usó" }), { status: 401 })) as typeof fetch), /ya se usó/);
});
