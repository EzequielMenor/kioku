import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { isPublicWebHost } from "../web/src/hooks.ts";
import { handleDemoApi, isDemoMode, resetDemoState } from "../web/src/demo/engine.ts";
import { buildSeedState } from "../web/src/demo/seed.ts";

const root = path.join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** Simula la página abierta en `url` (con o sin almacenamiento disponible) mientras dura `fn`. */
function atPage<T>(url: string, fn: () => T, opts: { stored?: string } = {}): T {
  const u = new URL(url);
  const g = globalThis as Record<string, unknown>;
  const prev = { window: g.window, location: g.location, localStorage: g.localStorage };
  g.window = globalThis;
  g.location = { hostname: u.hostname, search: u.search, hash: u.hash };
  if (opts.stored !== undefined) g.localStorage = { getItem: () => opts.stored, setItem() {}, removeItem() {} };
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete g[k]; else g[k] = v; }
  }
}

test("enrutado: un alojamiento estático reconocido (*.vercel.app) arranca la demo y la portada", () => {
  atPage("https://kioku-demo.vercel.app/", () => {
    assert.equal(isPublicWebHost(), true);
    assert.equal(isDemoMode(), true);
  });
  // la clave de emparejamiento sigue significando «esto es un espacio real»
  atPage("https://kioku-demo.vercel.app/?k=abc", () => assert.equal(isPublicWebHost(), false));
});

test("enrutado: un nombre de host propio o privado con sesión real NO se convierte en demo", () => {
  for (const url of [
    "https://notas.midominio.com/",
    "https://kioku.casa.lan/#/hoy",
    "https://evil-vercel.app/",
    "https://vercel.app.evil.example/",
    "http://192.168.1.20:4180/",
    "https://mac.tail1234.ts.net/",
    "http://127.0.0.1:4180/",
    "http://localhost:4180/",
  ]) {
    atPage(url, () => {
      assert.equal(isPublicWebHost(), false, `${url}: no es host de demo`);
      assert.equal(isDemoMode(), false, `${url}: no activa la demo sola`);
    });
  }
});

test("enrutado: la demo en un host propio solo con aceptación expresa del usuario", () => {
  atPage("https://notas.midominio.com/?demo=1", () => {
    assert.equal(isDemoMode(), true);
    assert.equal(isPublicWebHost(), false, "ni siquiera con ?demo=1 se trata como host de demo");
  });
  atPage("https://notas.midominio.com/#/demo", () => assert.equal(isDemoMode(), true));
  atPage("https://notas.midominio.com/", () => assert.equal(isDemoMode(), true), { stored: "1" });
  atPage("https://notas.midominio.com/", () => assert.equal(isDemoMode(), false), { stored: "0" });
});

test("app: no activa la demo por un 404 del daemon y pasa el estado real de la demo al panel de conexiones", () => {
  const app = read("web/src/app.tsx");
  assert.doesNotMatch(app, /status === 404/);
  assert.doesNotMatch(app, /lsGet\("kioku\.demo\.active"\)/);
  assert.match(app, /<ConnectionsView [^>]*demo=\{demo\}/);
  // la sesión real sigue pidiéndose con el api() existente y sigue bloqueando ante un 401
  assert.match(app, /api<\{ role: "full" \| "mobile" \}>\("GET", "\/api\/session"\)/);
  assert.match(app, /UNAUTHORIZED_EVENT/);
});

test("portada: Kioku Cloud figura como planificado, sin precios, sin recogida de correos y con la URL de clonado canónica", () => {
  const landing = read("web/src/landing.tsx");
  assert.doesNotMatch(landing, /€/);
  assert.doesNotMatch(landing, /type="email"/);
  assert.doesNotMatch(landing, /waitlist|setItem|localStorage/i);
  assert.doesNotMatch(landing, /Solicitar|Apuntado|Hemos guardado|activar tu instancia|Servidor gestionado|copias de seguridad automáticas/i);
  assert.doesNotMatch(landing, /ezebellino/i);
  assert.match(landing, /git clone https:\/\/github\.com\/EzequielMenor\/kioku\.git\\ncd kioku\\n/);
  assert.match(landing, /planificad/i);
  assert.match(landing, /no (existe|hay) (ningún )?servicio alojado/i);
  assert.match(landing, /no (se )?(recoge|guarda|envía)[^.]*(correo|email)/i);
});

test("demo: los datos y las respuestas de ejemplo no prometen un servicio alojado ni precios", async () => {
  const seed = JSON.stringify(buildSeedState(new Date("2026-11-06T10:00:00")));
  assert.doesNotMatch(seed, /€|\/mes|\/año|Stripe|LemonSqueezy|prueba gratuita/);
  assert.doesNotMatch(seed, /\/data\/users/);
  resetDemoState(new Date("2026-11-06T10:00:00"));
  const ask = await handleDemoApi<{ answer: string }>("POST", "/api/assistant/ask", { message: "Cuéntame algo cualquiera" });
  assert.match(ask.answer, /Cloud[^.]*(planificad|idea)/i);
});

test("demo: editar el esquema de una base se rechaza de forma explícita en vez de fingir un éxito", async () => {
  resetDemoState(new Date("2026-11-06T10:00:00"));
  for (const route of ["/api/database/schema", "/api/database/schema/preview"]) {
    await assert.rejects(
      handleDemoApi("POST", route, { path: "Bases/Biblioteca técnica.md", op: { op: "add-property", name: "Prueba", type: "text" } }),
      (e: Error & { status?: number }) => e.status === 400 && /demo/i.test(e.message),
    );
  }
  // el resto de la base sigue consultable
  const dbs = await handleDemoApi<{ title: string }[]>("GET", "/api/databases");
  assert.ok(dbs.some((d) => d.title === "Biblioteca técnica"));
});

test("paquete: Node >=24 y el comando de vista previa de la demo se conservan", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.engines.node, ">=24");
  assert.equal(pkg.scripts["preview:demo"], "node scripts/build-web.mjs && node scripts/preview-demo.mjs");
  assert.equal(pkg.scripts["build:web"], "node scripts/build-web.mjs");
});

// ── Servidor de vista previa: copia del script en un directorio temporal, nunca el dist/ real ──

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); });
  });
}

function get(port: number, rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: rawPath, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("vista previa: sirve dist/web, responde 404 a /api y no sale de su raíz ni hacia carpetas hermanas con el mismo prefijo", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kioku-preview-"));
  let child: ChildProcess | undefined;
  try {
    mkdirSync(path.join(dir, "scripts"));
    mkdirSync(path.join(dir, "dist", "web", "sub"), { recursive: true });
    mkdirSync(path.join(dir, "dist", "web-privado"));
    copyFileSync(path.join(root, "scripts", "preview-demo.mjs"), path.join(dir, "scripts", "preview-demo.mjs"));
    writeFileSync(path.join(dir, "dist", "web", "index.html"), "<h1>portada</h1>");
    writeFileSync(path.join(dir, "dist", "web", "sub", "a.js"), "console.log(1)");
    writeFileSync(path.join(dir, "dist", "web-privado", "secreto.txt"), "SECRETO");
    writeFileSync(path.join(dir, "dist", "secreto-raiz.txt"), "SECRETO");
    const port = await freePort();
    child = spawn(process.execPath, [path.join(dir, "scripts", "preview-demo.mjs")], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      child!.once("error", reject);
      child!.once("exit", (code) => reject(new Error(`el servidor terminó antes de arrancar (${code})`)));
      child!.stdout!.on("data", (d) => { if (String(d).includes("Vista previa")) resolve(); });
    });

    assert.deepEqual(await get(port, "/"), { status: 200, body: "<h1>portada</h1>" });
    assert.equal((await get(port, "/sub/a.js")).status, 200);
    const api = await get(port, "/api/session");
    assert.equal(api.status, 404);
    assert.match(api.body, /Static preview/);
    assert.equal((await get(port, "/sub")).status, 404, "un directorio no se lista");
    for (const raw of ["/../web-privado/secreto.txt", "/..%2fweb-privado%2fsecreto.txt", "/%2e%2e/web-privado/secreto.txt", "/../secreto-raiz.txt", "//web-privado/secreto.txt", "/sub/../../web-privado/secreto.txt"]) {
      const r = await get(port, raw);
      assert.notEqual(r.status, 200, raw);
      assert.doesNotMatch(r.body, /SECRETO/, raw);
    }
    // solo escucha en loopback
    const srcText = readFileSync(path.join(dir, "scripts", "preview-demo.mjs"), "utf8");
    assert.match(srcText, /listen\(port, "127\.0\.0\.1"/);
    assert.doesNotMatch(srcText, /\.startsWith\(root\)/, "la contención no compara prefijos de texto");
  } finally {
    child?.removeAllListeners("exit");
    child?.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
