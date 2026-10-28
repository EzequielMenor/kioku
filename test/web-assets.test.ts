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

test("móvil: la app está anclada al viewport y el documento no se desplaza (en iOS, un 100% de más deja un hueco bajo la barra y todo sube)", () => {
  const start = css.indexOf("@media (max-width: 720px) {");
  assert.ok(start > 0, "bloque móvil");
  const mobile = css.slice(start);
  assert.match(mobile, /html,\s*body\s*{[^}]*overscroll-behavior:\s*none/, "sin rebote del documento");
  assert.match(mobile, /\.shell\s*{[^}]*position:\s*fixed[^}]*inset:\s*0/, ".shell fijo a los cuatro bordes del viewport");
  assert.match(mobile, /main\s*{[^}]*overscroll-behavior:\s*contain/, "el scroll de main no se encadena al documento");
  assert.match(mobile, /html\s*{[^}]*background:\s*var\(--side\)/, "el fondo del documento es el de la barra: una franja bajo ella no se ve como una barra negra");
  assert.match(mobile, /#root\s*{[^}]*overflow-y:\s*auto/, "«Falta la clave» (fuera de .shell) sigue siendo alcanzable en horizontal");
});

test("PWA iOS: barra de estado translúcida con el área segura superior reservada en el CSS", () => {
  assert.match(read("index.html"), /name="apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  const mobile = css.slice(css.indexOf("@media (max-width: 720px) {"));
  assert.match(mobile, /main\s*{[^}]*padding-top:\s*env\(safe-area-inset-top\)/, "el contenido no queda bajo la hora");
});

test("PWA iOS 26 (WebKit 301108): en la app instalada el documento mide como la pantalla, o iOS da una ventana más corta y deja una franja bajo la barra", () => {
  assert.match(css, /@media \(display-mode: standalone\)\s*{\s*html\s*{[^}]*min-height:\s*min\(100lvh,\s*calc\(100%\s*\+\s*env\(safe-area-inset-top\)\)\)/);
  const mobile = css.slice(css.indexOf("@media (max-width: 720px) {"));
  assert.doesNotMatch(mobile.slice(0, mobile.indexOf("}") + 1), /overflow:\s*hidden/, "bloquear el desbordamiento del documento no debe aplicarse en la app instalada");
  assert.match(css, /@media \(max-width: 720px\) and \(not \(display-mode: standalone\)\)\s*{[^}]*html,\s*body\s*{[^}]*overflow:\s*hidden/, "el bloqueo se queda para el navegador");
});

test("móvil: la barra inferior mide como una barra de pestañas de iOS (≈83 pt con indicador) y el contenido y el FAB cuentan con esa misma medida", () => {
  const mobile = css.slice(css.indexOf("@media (max-width: 720px) {"));
  assert.match(mobile, /--nav-pad:\s*max\(calc\(env\(safe-area-inset-bottom\)\s*-\s*6px\),\s*0px\)/, "el área segura inferior se recorta 6 px: el indicador de inicio sigue libre");
  assert.match(mobile, /\.bottomnav\s*{[^}]*padding-bottom:\s*var\(--nav-pad\)/);
  assert.match(mobile, /\.bottomnav a,\s*\.bottomnav button\s*{[^}]*min-height:\s*54px/, "botones ≥ 44 px");
  assert.match(mobile, /\.content\s*{[^}]*padding-bottom:\s*calc\(54px\s*\+\s*var\(--nav-pad\)\)/, "el contenido no queda bajo la barra");
  assert.match(mobile, /\.fab\s*{[^}]*bottom:\s*calc\(70px\s*\+\s*var\(--nav-pad\)\)/, "el FAB sigue justo encima de la barra");
});

test("el build genera sw.js con el id del build y la lista de precarga", () => {
  const b = readFileSync(path.join(web, "..", "scripts", "build-web.mjs"), "utf8");
  assert.match(b, /sw\.ts/);
  assert.match(b, /sw\.js/);
  assert.match(b, /__BUILD_ID__/);
  assert.match(b, /__PRECACHE__/);
  assert.match(b, /"iife"/);
});

test("sw.ts limpia las cachés de shell antiguas y vacía la de la API ante un 401", () => {
  const sw = read("src/sw.ts");
  assert.match(sw, /kioku-shell-/);
  assert.match(sw, /caches\.delete/);
  assert.match(sw, /401/);
  assert.match(sw, /API_CACHE/);
});

test("la app arranca la capa offline y la captura móvil pasa por la cola", () => {
  const app = read("src/app.tsx");
  assert.match(app, /startOffline\(\)/);
  assert.match(app, /\bsubmit\(/);
  assert.match(app, /Guardada sin conexión; se enviará al abrir con red/);
  assert.match(app, /wipeOffline\(\)/);
  assert.match(app, /offline-bar/);
  assert.match(app, /Sincronizar ahora/);
  // sin cambios para el rol full: sigue enviando directo
  assert.match(app, /isMobile\(\)[^;]*submit\(/s);
});

test("el CSS móvil define la franja de sin conexión y la insignia de pendientes", () => {
  const mobile = css.slice(css.indexOf("@media (max-width: 720px)"));
  assert.match(mobile, /\.offline-bar/);
  assert.match(mobile, /\.nav-badge/);
});

test("la página escucha los avisos de red del service worker", () => {
  const rt = read("src/offline/runtime.ts");
  assert.match(rt, /startMessages/);
  assert.match(rt, /controllerchange/); // el precalentado espera a que el worker controle la página
  assert.match(rt, /kioku: "net"|\.kioku === "net"/);
});

test("al retirarse notas de la réplica se purga la caché de lecturas, y wipeOffline conserva la cola", () => {
  const rt = read("src/offline/runtime.ts");
  assert.match(rt, /r\.removed[\s\S]{0,80}caches\.delete\("kioku-api"\)/);
  assert.match(rt, /clearReplica\(\)/);
  assert.ok(!/store\.clear\(\)/.test(rt));
});
