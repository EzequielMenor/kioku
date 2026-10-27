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

test("formatScreen: resume ventana, pantalla, área segura y modo en una línea que se pueda leer de un vistazo", async () => {
  const { formatScreen } = await import("../web/src/screen-info.ts");
  const snap = { inner: [390, 750] as [number, number], screen: [390, 844] as [number, number], visual: [390, 750] as [number, number] | null, safeTop: 47, safeBottom: 34, standalone: true };
  assert.equal(formatScreen(snap), "ventana 390×750 · pantalla 390×844 · visual 390×750 · área segura ↑47 ↓34 · app instalada");
  assert.match(formatScreen({ ...snap, standalone: false, visual: null }), /· navegador$/);
  assert.doesNotMatch(formatScreen({ ...snap, visual: null }), /visual/, "sin visualViewport no se inventa el dato");
  assert.match(formatScreen({ ...snap, inner: [390.4, 750.6] as [number, number] }), /ventana 390×751/, "redondea las medidas fraccionarias");
});

test("appHeight: en la app instalada usa la altura completa que iOS declara (lvh/vh) cuando la ventana se queda corta; en el navegador o sin evidencia no toca nada", async () => {
  const { appHeight } = await import("../web/src/screen-info.ts");
  // Medidas reales de un iPhone en PWA instalada: la ventana es 62 px más corta que la pantalla.
  const iphone = { standalone: true, inner: 812, screen: 874, lvh: 874, vh: 874 };
  assert.equal(appHeight(iphone), 874);
  assert.equal(appHeight({ ...iphone, lvh: 0, vh: 874 }), 874, "sin soporte de lvh vale vh");
  assert.equal(appHeight({ ...iphone, standalone: false }), null, "en Safari lvh incluye la barra del navegador: no se usa");
  assert.equal(appHeight({ ...iphone, lvh: 812, vh: 812 }), null, "si iOS no declara más altura, no hay nada que corregir");
  assert.equal(appHeight({ ...iphone, inner: 874 }), null, "ventana ya completa");
  assert.equal(appHeight({ ...iphone, lvh: 2000, vh: 2000 }), 874, "nunca por encima de la pantalla");
});
