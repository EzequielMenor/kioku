import { test } from "node:test";
import assert from "node:assert/strict";
import { extractKey } from "../web/src/pairing.ts";
import { pinchZoom } from "../web/src/graph-math.ts";

const K = "0123456789abcdef".repeat(4);

test("extractKey: acepta la clave sola o la URL de emparejamiento completa, con espacios de más", () => {
  assert.equal(extractKey(K), K);
  assert.equal(extractKey(`  ${K}\n`), K);
  assert.equal(extractKey(`https://portatil.tail1234.ts.net/?k=${K}`), K);
  assert.equal(extractKey(`https://portatil.tail1234.ts.net/?k=${K}#/hoy`), K);
  assert.equal(extractKey(K.toUpperCase()), K, "las mayúsculas se normalizan");
});

test("extractKey: lo que no es una clave se rechaza (null)", () => {
  for (const bad of ["", "hola", K.slice(1), K + "0", `https://x.ts.net/?k=${K.slice(2)}`, `https://x.ts.net/?otra=${K}`]) assert.equal(extractKey(bad), null, bad);
});

test("pinchZoom: separar los dedos acerca, juntarlos aleja, y el punto entre ellos no se mueve", () => {
  const v = { k: 1, tx: 10, ty: 20 };
  const mid = { x: 100, y: 80 };
  const world = (s: typeof v, p: typeof mid) => ({ x: (p.x - s.tx) / s.k, y: (p.y - s.ty) / s.k });
  const out = pinchZoom(v, 50, 100, mid);
  assert.equal(out.k, 2);
  assert.deepEqual(world(out, mid), world(v, mid), "el punto del mundo bajo los dedos es el mismo");
  assert.ok(pinchZoom(v, 100, 50, mid).k < 1);
});

test("pinchZoom: respeta los límites de zoom y no divide por cero", () => {
  const v = { k: 3.9, tx: 0, ty: 0 };
  assert.equal(pinchZoom(v, 10, 1000, { x: 0, y: 0 }).k, 4);
  assert.equal(pinchZoom({ k: 0.21, tx: 0, ty: 0 }, 1000, 10, { x: 0, y: 0 }).k, 0.2);
  assert.deepEqual(pinchZoom(v, 0, 50, { x: 5, y: 5 }), v, "distancia previa 0: sin cambios");
});
