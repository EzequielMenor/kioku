import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractKey } from "../web/src/pairing.ts";
import { pinchZoom } from "../web/src/graph-math.ts";
import { MOBILE_HIDDEN } from "../web/src/role.ts";
import { cacheableRead } from "../web/src/sw-rules.ts";
import { makeOfflineReader } from "../web/src/offline/reader.ts";

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

// ───────── Navegación: el calendario entra sin romper lo que había (atajos, barra inferior, «Más») ─────────

const app = readFileSync(path.join(import.meta.dirname, "..", "web", "src", "app.tsx"), "utf8");
const appCss = readFileSync(path.join(import.meta.dirname, "..", "web", "src", "app.css"), "utf8");
const nav = [...app.matchAll(/{ route: "(\/[a-z]+)", label: "([^"]+)", key: "(.)", icon: "([a-z]+)" }/g)].map((m) => ({ route: m[1], label: m[2], key: m[3], icon: m[4] }));

test("navegación: las pantallas de antes siguen en su orden con sus atajos y el calendario tiene el suyo, único", () => {
  const before = ["/hoy:h", "/bandeja:b", "/proyectos:p", "/tareas:t", "/notas:n", "/bases:d", "/grafo:g", "/asistente:a", "/propuestas:r", "/conexiones:s"];
  assert.deepEqual(nav.filter((n) => n.route !== "/calendario").map((n) => `${n.route}:${n.key}`), before);
  const cal = nav.find((n) => n.route === "/calendario");
  assert.deepEqual(cal && [cal.label, cal.key, cal.icon], ["Calendario", "c", "calendario"]);
  assert.equal(new Set(nav.map((n) => n.key)).size, nav.length, "ningún atajo «g …» se repite");
  assert.ok(!MOBILE_HIDDEN.has("/calendario"), "el móvil sí tiene calendario");
  assert.deepEqual([...MOBILE_HIDDEN], [], "el asistente y las propuestas ya no se esconden en el móvil: el daemon impone su privacidad");
  assert.match(app, /case "calendario": view = <CalendarView/);
  assert.match(app, /\["g h · b · p · t · c · n · d · g · a · r · s"/, "la ayuda mantiene «g c» y añade «g s»");
});

test("móvil: la barra inferior es Hoy · Tareas · «+» central · Calendario · Más (sin duplicarse en «Más») y sus etiquetas no desbordan", () => {
  const bottom = app.match(/const items: \[string, string, string\]\[\] = \[(.*)\];/)?.[1] ?? "";
  assert.deepEqual([...bottom.matchAll(/\["(\/[a-z]+)"/g)].map((m) => m[1]), ["/hoy", "/tareas", "/calendario"]);
  assert.match(app, /class="nav-add" aria-label="Capturar"/, "la captura es el botón central de la barra, ya no un FAB aparte");
  assert.doesNotMatch(app, /class="fab"/);
  assert.match(app, /\["\/hoy", "\/calendario", "\/tareas"\]\.includes\(n\.route\)/, "«Más» no repite lo que ya está abajo");
  assert.match(appCss, /\.bottomnav span\s*{[^}]*text-overflow:\s*ellipsis/, "con seis botones, «Calendario» se recorta en lugar de ensanchar la barra");
});

// ───────── Asistente y propuestas en el móvil: la vista de siempre, solo en línea y sin atajos peligrosos ─────────

const assistantSrc = readFileSync(path.join(import.meta.dirname, "..", "web", "src", "assistant.tsx"), "utf8");

test("móvil: asistente y propuestas entran en «Más» y en «Hoy»; la bandeja y el triaje con IA siguen siendo del portátil", () => {
  assert.doesNotMatch(app, /t\.proposals > 0 && !mobile/, "«Hoy» avisa de propuestas también en el móvil");
  assert.match(app, /{!mobile && <AiPanel/, "el panel de IA (ruta que el móvil no tiene) se esconde");
  assert.match(app, /{!mobile && <button onClick={\(\) => void guard\(async \(\) => { const r = await api<Proposal\[\]>\("POST", "\/api\/triage"\)/, "«Revisar bandeja» tampoco");
});

test("móvil: aplicar una propuesta pide confirmación y sin conexión no se puede aplicar ni descartar", () => {
  assert.match(app, /if \(mobile && what === "apply" && !\(await askConfirm\(/, "un toque suelto no aplica nada");
  assert.match(app, /disabled={mobile && !online} onClick={\(\) => void act\(p, "apply"\)}/);
  assert.match(app, /disabled={mobile && !online} onClick={\(\) => void act\(p, "reject"\)}/);
  assert.match(app, /Sin conexión: las propuestas solo se aprueban con el portátil encendido/);
});

test("móvil: el asistente es solo en línea (no pregunta sin red), sin memoria y con su compositor sobre la barra inferior", () => {
  assert.match(assistantSrc, /const online = useOffline\(\)\.online;\s*const offline = mobile && !online;/, "el hook se llama siempre, no en cortocircuito");
  assert.match(assistantSrc, /offline\) return Promise\.resolve\(\)/, "sin conexión no se envía ni se encola");
  assert.match(assistantSrc, /disabled={!ack \|\| offline \|\| busy \|\| !text\.trim\(\)}/);
  assert.match(assistantSrc, /{!mobile && <a class="pill" href="#\/asistente\/memoria">/, "la memoria no es accesible desde el móvil");
  assert.match(appCss, /@media \(max-width: 720px\) {\s*\.assistant-page[^}]*}[\s\S]*\.composer { bottom: calc\(54px \+ var\(--nav-pad\)\); }/);
  assert.match(appCss, /\.composer textarea { font-size: 16px; }/, "iOS no amplía al enfocar");
});

test("móvil: ni la caché del service worker ni la réplica sin conexión guardan o sirven el asistente y las propuestas", async () => {
  for (const p of ["/api/assistant/status", "/api/assistant/actions", "/api/assistant/ask", "/api/proposals", "/api/proposals?status=pending"]) assert.equal(cacheableRead("GET", p.split("?")[0]), false, p);
  const reader = makeOfflineReader({ getNote: async () => ({ path: "x", text: "t", hash: "h" }), allNotes: async () => [] } as never);
  for (const p of ["/api/assistant/status", "/api/assistant/actions", "/api/proposals?status=pending"]) assert.equal(await reader(p), undefined, p);
});
