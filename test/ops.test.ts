import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault } from "../src/core/vault.ts";
import { OpsLedger, validOp } from "../src/server/ops.ts";
import { tmpVault } from "./helpers.ts";

const DAY = 86_400_000;
const UUID = "3f2a9c1e-5b7d-4e8a-9c01-0a1b2c3d4e5f";

function withLedger(run: (v: Vault, mk: (o?: ConstructorParameters<typeof OpsLedger>[1]) => OpsLedger) => Promise<void>) {
  const { root, cleanup } = tmpVault();
  const v = new Vault(root);
  return run(v, (o) => new OpsLedger(v, o)).finally(cleanup);
}

test("ops: el mismo opId dos veces ejecuta fn una vez y devuelve el mismo resultado", () => withLedger(async (_v, mk) => {
  const l = mk();
  let n = 0;
  const fn = async () => ({ path: `Bandeja/${++n}.md` });
  const a = await l.run(UUID, fn), b = await l.run(UUID, fn);
  assert.equal(n, 1);
  assert.deepEqual(a, b);
}));

test("ops: en paralelo, dos llamadas con el mismo opId ejecutan fn una sola vez", () => withLedger(async (_v, mk) => {
  const l = mk();
  let n = 0;
  const fn = async () => { n++; await new Promise((r) => setTimeout(r, 20)); return n; };
  const [a, b] = await Promise.all([l.run(UUID, fn), l.run(UUID, fn)]);
  assert.equal(n, 1);
  assert.equal(a, b);
}));

test("ops: opIds distintos ejecutan fn cada uno", () => withLedger(async (_v, mk) => {
  const l = mk();
  let n = 0;
  await l.run("aaaaaaaa-1", async () => ++n);
  await l.run("aaaaaaaa-2", async () => ++n);
  assert.equal(n, 2);
}));

test("ops: si fn lanza no se registra y el reintento vuelve a ejecutarla", () => withLedger(async (_v, mk) => {
  const l = mk();
  let n = 0;
  await assert.rejects(l.run(UUID, async () => { n++; throw new Error("boom"); }), /boom/);
  assert.equal(await l.run(UUID, async () => { n++; return "ok"; }), "ok");
  assert.equal(n, 2);
}));

test("ops: caduca a los 30 días (now inyectado)", () => withLedger(async (_v, mk) => {
  let now = 1_000_000;
  const l = mk({ now: () => now });
  let n = 0;
  await l.run(UUID, async () => ++n);
  now += 29 * DAY; await l.run(UUID, async () => ++n);
  assert.equal(n, 1, "a los 29 días sigue recordándola");
  now += 2 * DAY; await l.run(UUID, async () => ++n);
  assert.equal(n, 2, "a los 31 días ya no");
}));

test("ops: con tope 3 y cuatro operaciones, la más antigua se olvida y las tres últimas siguen deduplicando", () => withLedger(async (_v, mk) => {
  let now = 1;
  const l = mk({ now: () => now++, max: 3 });
  const ids = ["aaaaaaaa-1", "aaaaaaaa-2", "aaaaaaaa-3", "aaaaaaaa-4"];
  let n = 0;
  for (const id of ids) await l.run(id, async () => ++n);
  assert.equal(n, 4);
  for (const id of ids.slice(1)) await l.run(id, async () => ++n);
  assert.equal(n, 4, "las tres recientes no se repiten");
  await l.run(ids[0], async () => ++n);
  assert.equal(n, 5, "la más antigua se había olvidado");
}));

test("ops: persiste, otro OpsLedger sobre el mismo vault reconoce un opId ya aplicado", () => withLedger(async (v, mk) => {
  let n = 0;
  await mk().run(UUID, async () => ++n);
  await new OpsLedger(v).run(UUID, async () => ++n);
  assert.equal(n, 1);
}));

test("validOp rechaza rutas, vacío y más de 64 caracteres; acepta un UUID", () => {
  for (const bad of ["../x", "", "a".repeat(65), "abc", "gggggggg"]) assert.throws(() => validOp(bad), (e: Error & { status?: number }) => e.status === 400, bad);
  assert.equal(validOp(UUID), UUID);
});

test("ops: .kioku/ops.json queda con permisos 0600", () => withLedger(async (v, mk) => {
  await mk().run(UUID, async () => 1);
  const { statSync } = await import("node:fs");
  assert.equal(statSync(`${v.root}/.kioku/ops.json`).mode & 0o777, 0o600);
}));
