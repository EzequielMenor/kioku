// Recorre la interfaz contra el servidor real, sin motor de IA ni datos del usuario.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { browserSkip, launch, until, WEB } from "./cdp.ts";
import { tmpVault } from "./helpers.ts";

async function fixture(mobile = false) {
  const vault = tmpVault(), profile = tmpVault();
  const j = await Kioku.open({ root: vault.root });
  const key = "c".repeat(64);
  const srv = await startServer(j, { port: 0, webDir: WEB, key });
  const p = await launch(profile.root);
  if (mobile) await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await p.send("Page.navigate", { url: srv.url + "/?k=" + (mobile ? loadOrCreateMobileKey(vault.root) : key) + "#/hoy" });
  await until(() => p.ev<boolean>(`document.querySelector(".kio-box button")?.textContent === "Guardar"`), "Hoy sin Kio");
  const click = (selector: string, label: string) => p.ev(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim() === ${JSON.stringify(label)}).click()`);
  const fill = (selector: string, text: string) => p.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const done = async () => { await p.close(); await srv.close(); j.close(); vault.cleanup(); profile.cleanup(); };
  return { p, j, click, fill, done };
}

test("Hoy vacío permite crear una tarea sin modelo ni sintaxis", { skip: browserSkip }, async () => {
  const f = await fixture();
  try {
    await f.click("main button", "Crear una tarea");
    await until(() => f.p.ev<boolean>(`!!document.querySelector(".capture-dialog[open]")`), "captura");
    assert.equal(await f.p.ev(`document.querySelector(".capture-dialog [aria-pressed=true]").textContent`), "Tarea");
    await f.fill(".capture-dialog input", "Preparar el semillero");
    await f.click(".capture-dialog button", "Guardar");
    await until(() => f.j.index.tasks().some(t => t.title === "Preparar el semillero"), "tarea persistida");
  } finally { await f.done(); }
});

test("Más permite cambiar el destino y guardar una nota sin red que se sincroniza una sola vez", { skip: browserSkip }, async () => {
  const f = await fixture(true);
  try {
    await f.click(".bottomnav button", "Más");
    await f.click(".sheet-list button", "Capturar");
    await until(() => f.p.ev<boolean>(`!!document.querySelector(".capture-dialog[open]")`), "captura móvil");
    assert.equal(await f.p.ev(`document.querySelector(".capture-dialog [type=submit]").disabled`), true);
    await f.fill(".capture-dialog input", "Huerto de invierno");
    await f.click(".capture-dialog button", "Tarea");
    await f.click(".capture-dialog button", "Nota");
    const network = (offline: boolean) => f.p.send("Network.emulateNetworkConditions", {
      offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    await f.p.send("Network.enable");
    // La emulación de red por CDP afecta a la página, no al proceso del service worker.
    await f.p.send("Network.setBypassServiceWorker", { bypass: true });
    await until(() => f.p.ev<boolean>(`localStorage.getItem("role") === "mobile"`), "sesión móvil");
    await network(true);
    await f.click(".capture-dialog button", "Guardar");
    await until(() => f.p.ev<boolean>(`document.querySelector(".toast")?.textContent.includes("Guardada sin conexión")`), "aviso de cola");
    assert.equal(f.j.index.search("Huerto").length, 0);
    await network(false);
    await until(() => f.j.index.search("Huerto").length, "sincronización de la nota");
    assert.deepEqual(f.j.index.search("Huerto").map(n => [n.type, n.title]), [["note", "Huerto de invierno"]]);
  } finally { await f.done(); }
});

test("buscar descarta resultados anteriores durante la consulta y permite reintentar un fallo", { skip: browserSkip }, async () => {
  const f = await fixture();
  try {
    await f.j.createNote({ title: "Huerto de invierno", type: "note" });
    await f.p.ev(`document.querySelectorAll(".side-btn")[1].click()`);
    await f.fill(".palette input", "Huerto");
    await until(() => f.p.ev<boolean>(`document.querySelector(".plist")?.textContent.includes("Huerto de invierno")`), "resultado");
    await f.p.ev(`(() => { const orig = window.fetch; window.fetch = (...args) => {
      if (String(args[0]).includes("/api/search?")) { window.fetch = orig; return Promise.resolve(new Response("{}", {status:503})); }
      return orig(...args); }; })()`);
    await f.fill(".palette input", "mandarina");
    assert.equal(await f.p.ev(`document.querySelector(".plist").textContent.includes("Huerto de invierno")`), false);
    await until(() => f.p.ev<boolean>(`document.querySelector(".palette")?.textContent.includes("Reintentar")`), "opción de reintento");
    await f.click(".palette button", "Reintentar");
    await until(() => f.p.ev<boolean>(`document.querySelector(".palette")?.textContent.includes("Sin resultados")`), "resultado vacío");
  } finally { await f.done(); }
});
