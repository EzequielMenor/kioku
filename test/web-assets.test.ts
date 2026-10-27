import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const web = path.join(import.meta.dirname, "..", "web");
const read = (f: string) => readFileSync(path.join(web, f), "utf8");
const css = read("src/app.css");

test("la UI no carga recursos externos: ni @import, ni url() remotas, ni <script>/<link> a otros dominios", () => {
  assert.ok(!/@import/.test(css), "app.css sin @import");
  for (const u of css.matchAll(/url\(\s*["']?([^)"']+)/g)) assert.match(u[1], /^(\/|data:)/, `url() local en app.css: ${u[1]}`);
  for (const f of ["index.html", "quick.html"]) for (const m of read(f).matchAll(/\b(?:src|href)="([^"]+)"/g)) assert.ok(!/^(https?:)?\/\//.test(m[1]), `${f}: recurso externo ${m[1]}`);
});

test("la tipografía serif de los títulos va empaquetada (Shippori Mincho, ruta local) y el build la copia", () => {
  const faces = [...css.matchAll(/@font-face\s*{[^}]*}/g)].map((m) => m[0]).filter((b) => /Shippori Mincho/.test(b));
  assert.ok(faces.length >= 2, "al menos dos pesos declarados");
  for (const b of faces) {
    assert.match(b, /url\(\s*["']?\/fonts\/shippori-mincho-latin-\d+-normal\.woff2/, "ruta local /fonts/…");
    assert.match(b, /font-display:\s*swap/);
  }
  assert.match(css, /--serif:[^;]*"Shippori Mincho"/);
  assert.match(readFileSync(path.join(import.meta.dirname, "..", "scripts", "build-web.mjs"), "utf8"), /fonts/);
});

test("el sello (icono) lleva el kanji como trazos y no depende de ninguna fuente instalada", () => {
  const svg = read("icons/icon.svg");
  assert.ok(!/<text/i.test(svg), "sin <text>: el 記 está convertido a path");
  assert.ok(existsSync(path.join(web, "icons", "apple-touch-icon.png")));
});

test("manifest, meta theme-color y fondo del tema oscuro son el mismo color (la PWA no parpadea al abrir)", () => {
  const bg = /:root\s*{[^}]*--bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1].toLowerCase();
  assert.ok(bg, "--bg del tema oscuro");
  const man = JSON.parse(read("manifest.webmanifest"));
  assert.equal(man.theme_color.toLowerCase(), bg);
  assert.equal(man.background_color.toLowerCase(), bg);
  assert.equal(/name="theme-color" content="(#[0-9a-f]{6})"/i.exec(read("index.html"))?.[1].toLowerCase(), bg);
});

test("los colores por tipo del grafo salen de variables del tema (también legibles en papel), no de constantes", () => {
  const g = read("src/graph.tsx");
  assert.ok(!/#[0-9a-f]{6}/i.test(g.replace(/cssVar\([^)]*\)/g, "")), "graph.tsx sin hex fijos fuera de los fallbacks de cssVar");
  for (const ty of ["project", "task", "note", "capture", "journal", "resource"]) {
    assert.match(css, new RegExp(`--t-${ty}:`), `--t-${ty} definido`);
  }
  assert.ok(css.split("--t-project:").length >= 3, "definido en oscuro y en claro");
});
