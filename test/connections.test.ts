import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEMO_NOTICE, HEALTH_PATH, HEALTH_TIMEOUT_MS, connectionGuide, describeHealth, probeHealth, safeOrigin,
} from "../web/src/connections-model.ts";

const src = (name: string) => readFileSync(new URL(`../web/src/${name}`, import.meta.url), "utf8");
const text = (mobile: boolean) => connectionGuide(mobile).flatMap((s) => [s.title, ...s.items.flatMap((i) => [i.text, i.command ?? ""])]).join("\n");
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

test("safeOrigin: solo esquema y host; nunca ruta, consulta con clave ni credenciales", () => {
  assert.equal(safeOrigin({ protocol: "https:", host: "portatil.tail1234.ts.net" }), "https://portatil.tail1234.ts.net");
  assert.equal(safeOrigin({ protocol: "http:", host: "127.0.0.1:47800" }), "http://127.0.0.1:47800");
  assert.equal(safeOrigin({ protocol: "https:", host: "user:pw@x.ts.net" }), "https://x.ts.net", "se descarta la información de usuario");
  assert.equal(safeOrigin({ protocol: "file:", host: "" }), "");
  assert.equal(safeOrigin({ protocol: "javascript:", host: "x" }), "");
});

test("probeHealth: GET /api/health solo en red, sin caché ni clave, y mide la respuesta", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const clock = [1000, 1042];
  const r = await probeHealth(async (url, init) => { calls.push({ url: String(url), init: init ?? {} }); return res(200, { ok: true }); }, { now: () => clock.shift()! });
  assert.deepEqual(r, { state: "ok", ms: 42 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, HEALTH_PATH);
  assert.equal(HEALTH_PATH, "/api/health");
  assert.equal(calls[0].init.method ?? "GET", "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[0].init.body, undefined);
});

test("probeHealth: fallo de red, tiempo agotado y respuestas de error son resultados distintos y no lanzan", async () => {
  assert.deepEqual(await probeHealth(async () => { throw new TypeError("Failed to fetch"); }), { state: "unreachable", reason: "network" });
  const hang = (_u: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_ok, no) => init?.signal?.addEventListener("abort", () => no(new DOMException("aborted", "AbortError"))));
  assert.deepEqual(await probeHealth(hang, { timeoutMs: 15 }), { state: "unreachable", reason: "timeout" });
  assert.deepEqual(await probeHealth(async () => res(502, {})), { state: "error", status: 502 });
  assert.deepEqual(await probeHealth(async () => res(200, { ok: false })), { state: "error", status: 200 }, "200 sin {ok:true} no es salud");
  assert.deepEqual(await probeHealth(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("x"); } }) as unknown as Response), { state: "error", status: 200 });
  assert.ok(HEALTH_TIMEOUT_MS >= 2000 && HEALTH_TIMEOUT_MS <= 10000, "el tiempo máximo es acotado");
});

test("describeHealth: sin red no distingue ordenador dormido de falta de red, y siempre ofrece reintentar", () => {
  const ok = describeHealth({ state: "ok", ms: 42 });
  assert.equal(ok.tone, "ok");
  assert.match(ok.title, /Kioku responde/);
  assert.match(ok.detail, /42 ms/);
  for (const reason of ["network", "timeout"] as const) {
    const d = describeHealth({ state: "unreachable", reason });
    assert.equal(d.tone, "bad");
    assert.match(d.detail, /dormido|apagado/);
    assert.match(d.detail, /red|Tailscale/);
    assert.match(d.detail, /no (se )?puede(n)? distinguir/);
  }
  assert.match(describeHealth({ state: "unreachable", reason: "timeout" }).detail, /tard/);
  const e = describeHealth({ state: "error", status: 502 });
  assert.equal(e.tone, "bad");
  assert.match(e.detail, /502/);
  assert.equal(describeHealth({ state: "checking" }).tone, "wait");
  assert.equal(describeHealth({ state: "simulated" }).tone, "demo");
});

test("describeHealth: la simulación de la demo no afirma ninguna conexión real", () => {
  const d = describeHealth({ state: "simulated" });
  assert.match(d.title, /Simulación/);
  assert.doesNotMatch(`${d.title} ${d.detail}`, /Kioku responde|conectado|en línea/i);
  assert.match(DEMO_NOTICE, /Simulación/);
  assert.match(DEMO_NOTICE, /no hay (ningún )?ordenador|no es una conexión real|sin conexión real/i);
});

test("guía: explica el ordenador como centro, Tailscale en ambos, sin sincronización en segundo plano", () => {
  for (const mobile of [false, true]) {
    const t = text(mobile);
    assert.match(t, /ordenador.*encendido/is);
    assert.match(t, /Tailscale.*(ambos|los dos)/is);
    assert.match(t, /segundo plano/);
    assert.match(t, /no (hay|se garantiza)/i);
    assert.match(t, /clave compartida|única clave/i);
    assert.match(t, /todos los dispositivos/i);
  }
});

test("guía de escritorio: setup, doctor, pair y revocar, Mac y servicio Linux opcional, sin secretos", () => {
  const g = connectionGuide(false);
  const cmds = g.flatMap((s) => s.items.map((i) => i.command ?? "")).filter(Boolean);
  for (const c of ["kioku setup", "kioku doctor", "kioku pair", "kioku pair --revoke", "kioku service install", "./scripts/kioku-local.sh open"]) assert.ok(cmds.includes(c), c);
  const t = text(false);
  assert.match(t, /Mac/);
  assert.match(t, /Linux.*opcional/is);
  assert.doesNotMatch(t, /Añadir a pantalla de inicio/, "los pasos de instalación de la PWA son del móvil");
  assert.doesNotMatch(t, /[0-9a-f]{64}|\?k=[0-9a-f]/i, "ninguna clave ni URL con clave");
});

test("guía de móvil: instalar la PWA en Safari y Android, y volver a emparejar desde el ordenador", () => {
  const t = text(true);
  assert.match(t, /Safari/);
  assert.match(t, /Compartir/);
  assert.match(t, /Android/);
  assert.match(t, /Instalar aplicación|Añadir a pantalla de inicio/);
  assert.match(t, /kioku pair/);
  assert.doesNotMatch(connectionGuide(true).flatMap((s) => s.items.map((i) => i.command ?? "")).join("\n"), /kioku service install/, "el servicio es cosa del ordenador");
});

test("guía: ninguna orden configura la red, genera claves ni escribe ajustes por el usuario", () => {
  for (const mobile of [false, true]) {
    const cmds = connectionGuide(mobile).flatMap((s) => s.items.map((i) => i.command ?? "")).filter(Boolean);
    for (const c of cmds) assert.doesNotMatch(c, /tailscale (up|serve|funnel|set)|openssl|ssh-keygen|sudo|rm /, c);
  }
});

test("ConnectionsView: usa useOffline/formatAgo existentes, sondea /api/health sin api() ni caché y no expone la URL completa", () => {
  const view = src("connections.tsx");
  assert.match(view, /export function ConnectionsView\(/);
  assert.match(view, /demo\?: boolean/);
  assert.match(view, /children\?: /);
  assert.match(view, /useOffline\(\)/);
  assert.match(view, /formatAgo\(/);
  assert.match(view, /probeHealth\(/);
  assert.match(view, /safeOrigin\(location\)/);
  assert.doesNotMatch(view, /location\.(href|search|hash|pathname)|document\.URL|\?k=\$|document\.cookie|localStorage/, "nunca la URL completa, la consulta ni secretos");
  assert.doesNotMatch(view, /from "\.\/api\.ts"/, "la sonda no pasa por api(): no hay respaldo offline ni demo");
  assert.match(view, /Reintentar/);
  assert.match(view, /DEMO_NOTICE/);
  assert.match(view, /props\.children|\{children\}/);
  assert.doesNotMatch(src("connections-model.ts"), /location\.(href|search)|localStorage|document\.cookie/);
});

test("navigation exposes connections on desktop and More while retaining existing destinations", () => {
  const app = src("app.tsx");
  assert.match(app, /route: "\/conexiones", label: "Conexiones y sincronización"/);
  assert.match(app, /case "conexiones": view = <ConnectionsView/);
  assert.match(app, /mobile && <OfflineSection off=\{off\}/);
  for (const route of ["hoy", "bandeja", "proyectos", "tareas", "calendario", "notas", "bases", "grafo", "asistente", "propuestas"]) assert.ok(app.includes(`route: "/${route}"`), route);
  assert.match(app, /const rest = visibleNav\(\)\.filter/);
  assert.ok(/const MORE_ROUTES = \[[^\n]*"\/conexiones"/.test(app), "connections marks More active");
  assert.ok(app.includes("g h · b · p · t · c · n · d · g · a · r · s"), "help includes the new shortcut");
});

test("ConnectionsView: la demo no sondea la red y el panel de cola solo aparece en el móvil real", () => {
  const view = src("connections.tsx");
  assert.match(view, /demo \? .*simulated|simulated.*demo/s);
  assert.match(view, /if \(demo\)/);
  assert.match(view, /mobile && !demo && \(/);
  assert.match(view, /\{children\}/);
});
