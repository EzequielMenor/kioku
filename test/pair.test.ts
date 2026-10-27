import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { allowedHostsFrom, pairReport, tailscaleHost } from "../src/cli/pair.ts";
import { readMobileKey } from "../src/server/key.ts";
import { tmpVault } from "./helpers.ts";

test("tailscaleHost: toma el nombre DNS del equipo (sin el punto final) y es null si no hay", () => {
  assert.equal(tailscaleHost(JSON.stringify({ Self: { DNSName: "portatil.tail1234.ts.net." } })), "portatil.tail1234.ts.net");
  assert.equal(tailscaleHost(JSON.stringify({ Self: {} })), null);
  assert.equal(tailscaleHost("no es json"), null);
});

test("allowedHostsFrom: lista separada por comas, en minúsculas, sin vacíos ni protocolo", () => {
  assert.deepEqual(allowedHostsFrom(" A.ts.net, https://b.ts.net/ ,,"), ["a.ts.net", "b.ts.net"]);
  assert.deepEqual(allowedHostsFrom(undefined), []);
});

test("pair: crea la clave del móvil (0600), da la URL de emparejamiento y es idempotente", () => {
  const { root, cleanup } = tmpVault();
  try {
    const a = pairReport({ home: root, host: "portatil.tail1234.ts.net" });
    const key = readMobileKey(root)!;
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.equal(a.url, `https://portatil.tail1234.ts.net/?k=${key}`);
    assert.equal(statSync(path.join(root, ".kioku", "secret-mobile")).mode & 0o777, 0o600);
    assert.equal(pairReport({ home: root, host: "portatil.tail1234.ts.net" }).url, a.url, "volver a ejecutarlo no invalida el móvil ya emparejado");
    assert.match(a.lines.join("\n"), /KIOKU_ALLOWED_HOSTS=portatil\.tail1234\.ts\.net/);
  } finally { cleanup(); }
});

test("pair: avisa si no hay carpetas privadas definidas, y no si las hay", () => {
  const { root, cleanup } = tmpVault();
  try {
    assert.match(pairReport({ home: root, host: "x.ts.net" }).lines.join("\n"), /mobile\.json/);
    mkdirSync(path.join(root, ".kioku"), { recursive: true });
    writeFileSync(path.join(root, ".kioku", "mobile.json"), JSON.stringify({ exclude: ["Privado/"] }));
    assert.doesNotMatch(pairReport({ home: root, host: "x.ts.net" }).lines.join("\n"), /no has marcado carpetas privadas/);
  } finally { cleanup(); }
});

test("pair: sin host no inventa nada (explica cómo indicarlo) y sin clave no deja ninguna", () => {
  const { root, cleanup } = tmpVault();
  try {
    const r = pairReport({ home: root, host: null });
    assert.equal(r.url, undefined);
    assert.match(r.lines.join("\n"), /KIOKU_PUBLIC_HOST|tailscale/i);
    assert.equal(readMobileKey(root), null);
  } finally { cleanup(); }
});

test("pair --revoke: desempareja y la próxima clave es otra", () => {
  const { root, cleanup } = tmpVault();
  try {
    pairReport({ home: root, host: "x.ts.net" });
    const old = readMobileKey(root);
    const r = pairReport({ home: root, host: "x.ts.net", revoke: true });
    assert.equal(readMobileKey(root), null);
    assert.match(r.lines.join("\n"), /revocad|desemparejad/i);
    pairReport({ home: root, host: "x.ts.net" });
    assert.notEqual(readMobileKey(root), old);
  } finally { cleanup(); }
});

test("service: el unit conserva KIOKU_ALLOWED_HOSTS si estaba definido al instalarlo, y no lo inventa si no", async () => {
  const { unitText } = await import("../src/cli/service.ts");
  delete process.env.KIOKU_ALLOWED_HOSTS;
  assert.match(unitText("/tmp/k", "a.ts.net"), /^Environment=KIOKU_ALLOWED_HOSTS=a\.ts\.net$/m);
  assert.doesNotMatch(unitText("/tmp/k"), /KIOKU_ALLOWED_HOSTS/);
  assert.doesNotMatch(unitText("/tmp/k", "a.ts.net\nExecStart=/bin/evil"), /evil/, "no se cuela nada en el unit");
});
