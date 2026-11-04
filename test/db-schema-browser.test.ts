// Menú de cabecera de una base en un Chromium real (CDP con el WebSocket integrado de Node): renombrar con «Deshacer», ocultar en la vista,
// borrar una propiedad y rol móvil sin menú. Bóveda y servidor temporales; se omite sin Chromium o sin `npm run build:web`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { startServer } from "../src/server/server.ts";
import { tmpVault } from "./helpers.ts";

const CHROMIUM = process.env.KIOKU_CHROMIUM ?? "/usr/bin/chromium";
const WEB = path.join(import.meta.dirname, "..", "dist", "web");
const KEY = "e".repeat(64);
const skip = !existsSync(CHROMIUM) ? "no hay Chromium" : !existsSync(path.join(WEB, "app.js")) ? "falta npm run build:web" : false;
const FM = (extra: string) => `---\nid: 01HX${Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(22, "0")}\ncreated: 2026-10-27T00:00:00.000Z\n${extra}---\n`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => Promise<T> | T, what: string, ms = 8000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v as NonNullable<T>; } catch { /* aún no */ }
    if (Date.now() > end) throw new Error(`Tiempo agotado: ${what}`);
    await sleep(50);
  }
}

async function launch(profile: string) {
  const proc: ChildProcess = spawn(CHROMIUM, ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let ws: WebSocket;
  try {
    const port = await until(() => { const f = path.join(profile, "DevToolsActivePort"); return existsSync(f) ? readFileSync(f, "utf8").split("\n")[0] : null; }, "Chromium arrancó");
    const target = await until(async () => ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((x) => x.type === "page"), "hay una página");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  } catch (e) { proc.kill("SIGKILL"); throw e; } // un arranque fallido no deja Chromium vivo
  let id = 0;
  const pending = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>();
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); };
  const send = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const ev = async <T = unknown>(expression: string): Promise<T> => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "error en la página");
    return r.result.value as T;
  };
  await send("Page.enable");
  return { send, ev, close: async () => { ws.close(); proc.kill("SIGKILL"); await sleep(100); } };
}

type Page = Awaited<ReturnType<typeof launch>>;
const q = (sel: string) => `document.querySelector(${JSON.stringify(sel)})`;
/** Enfoca y pulsa el elemento cuyo texto (sin espacios sobrantes) coincide: un `click()` suelto no mueve el foco, como sí hace un usuario. */
const clickText = (p: Page, sel: string, text: string) => p.ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); el.focus(); el.click(); })()`);
const headers = (p: Page) => p.ev<string[]>(`[...document.querySelectorAll(".dbtable th button")].map((b) => b.textContent.replace(/\\s*[↑↓]$/, "").trim())`);
const header = (name: string) => `[...document.querySelectorAll(".dbtable th button")].find((b) => b.textContent.replace(/\\s*[↑↓]$/, "").trim() === ${JSON.stringify(name)})`;
const openMenu = async (p: Page, name: string) => {
  await p.ev(`(() => { const b = ${header(name)}; b.focus(); b.click(); })()`);
  await until(() => p.ev<boolean>(`!!${q(`[role=dialog][aria-label="Propiedad ${name}"]`)}`), `menú de «${name}»`);
};
const key = (p: Page, k: string, code: number, text?: string) => Promise.all(["keyDown", "keyUp"].map((type) => p.send("Input.dispatchKeyEvent", { type, key: k, code: k, windowsVirtualKeyCode: code, ...(type === "keyDown" && text ? { text } : {}) })));
const read = (root: string, rel: string) => readFileSync(path.join(root, rel), "utf8");

const DB = "---\ntype: database\nsource:\n  folder: Libros/\nproperties:\n  Autor:\n    type: text\n  Estado:\n    type: select\n    options:\n      - Leyendo\n      - Leído\nviews:\n  - name: Tabla\n    kind: table\n---\n\n# Libros\n";
const vault = () => tmpVault({
  "Bases/Libros.md": DB,
  "Libros/Dune.md": FM("Autor: Herbert\nEstado: Leído\n") + "Dune\n",
  "Libros/Hyperion.md": FM("Autor: Simmons\nEstado: Leyendo\n") + "Hyperion\n",
});

test("menú de cabecera: renombrar con Deshacer, ocultar en la vista y borrar una propiedad", { skip, timeout: 120_000 }, async () => {
  const { root, cleanup } = vault();
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: WEB, key: KEY });
  const profile = mkdtempSync(path.join(tmpdir(), "kioku-chromium-"));
  let page: Page | null = null;
  try {
    page = await launch(profile);
    const p = page;
    await p.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
    await p.send("Page.navigate", { url: `${srv.url}/?k=${KEY}#/bases/Bases/Libros.md` });
    await until(async () => (await headers(p)).includes("Autor"), "tabla con la columna Autor");

    // (a) Renombrar: la cabecera es un botón con el nombre de la columna; Enter en el campo de nombre pide confirmación (afecta a 2 notas).
    assert.equal(await p.ev(`${header("Autor")}.getAttribute("aria-haspopup")`), "dialog");
    assert.equal(await p.ev(`${header("Autor")}.getAttribute("aria-expanded")`), "false");
    await openMenu(p, "Autor");
    assert.equal(await p.ev(`${header("Autor")}.getAttribute("aria-expanded")`), "true");
    const focusInside = await p.ev<boolean>(`${q("[role=dialog]")}.contains(document.activeElement)`);
    assert.ok(focusInside, "el foco entra en el menú");
    await p.ev(`(() => { const i = ${q(`[role=dialog] input[aria-label="Nombre de la propiedad"]`)}; i.focus(); i.value = "Escritor"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    const files = () => [read(root, "Bases/Libros.md"), read(root, "Libros/Dune.md"), read(root, "Libros/Hyperion.md")];
    const untouched = files();
    await key(p, "Enter", 13, "\r");
    await until(() => p.ev<boolean>(`!!${q("[role=alertdialog]")}`), "confirmación de reescritura");
    assert.match(await p.ev<string>(`${q("[role=alertdialog]")}.textContent`), /Se reescribirán 2 notas/);
    // El diálogo queda por encima del menú: se acierta el botón de confirmar y, donde el menú asoma por fuera del diálogo, lo que se toca es el velo.
    const hit = await p.ev<{ button: boolean; scrim: boolean; point: boolean }>(`(() => {
      const ok = [...document.querySelectorAll("[role=alertdialog] button")].find((b) => b.textContent.trim() === "Renombrar").getBoundingClientRect();
      const top = document.elementFromPoint(ok.left + ok.width / 2, ok.top + ok.height / 2);
      const pop = ${q("[role=dialog]")}.getBoundingClientRect(), dlg = ${q("[role=alertdialog]")}.getBoundingClientRect();
      for (let x = pop.left + 3; x < pop.right; x += 6) for (let y = pop.top + 3; y < pop.bottom; y += 6) {
        if (x >= dlg.left && x <= dlg.right && y >= dlg.top && y <= dlg.bottom) continue;
        const el = document.elementFromPoint(x, y);
        return { button: !!top?.closest("[role=alertdialog] button"), scrim: !!el?.closest(".scrim") && !el.closest(".popover"), point: true };
      }
      return { button: !!top?.closest("[role=alertdialog] button"), scrim: false, point: false };
    })()`);
    assert.ok(hit.button, "el botón de confirmar recibe el clic");
    assert.ok(hit.point, "el menú asoma por fuera del diálogo");
    assert.ok(hit.scrim, "fuera del diálogo se toca el velo, no el menú");

    // Cancelar no escribe nada, deja la cabecera como estaba y el menú abierto con lo escrito.
    await clickText(p, "[role=alertdialog] button", "Cancelar");
    await until(() => p.ev<boolean>(`!${q("[role=alertdialog]")}`), "confirmación cerrada");
    await sleep(400);
    assert.deepEqual(files(), untouched, "cancelar no escribe ficheros");
    assert.ok((await headers(p)).includes("Autor") && !(await headers(p)).includes("Escritor"), "la cabecera no cambia");
    assert.equal(await p.ev(`!!${q("[role=dialog]")}`), true, "el menú sigue abierto");
    assert.equal(await p.ev(`${q(`[role=dialog] input[aria-label="Nombre de la propiedad"]`)}.value`), "Escritor");

    // Confirmar de verdad.
    await key(p, "Enter", 13, "\r");
    await until(() => p.ev<boolean>(`!!${q("[role=alertdialog]")}`), "confirmación de reescritura (2)");
    await clickText(p, "[role=alertdialog] button", "Renombrar");
    await until(async () => (await headers(p)).includes("Escritor") && !(await headers(p)).includes("Autor"), "cabecera renombrada");
    assert.match(read(root, "Libros/Dune.md"), /^Escritor: Herbert$/m);
    assert.doesNotMatch(read(root, "Libros/Dune.md"), /^Autor:/m);
    assert.match(read(root, "Libros/Hyperion.md"), /^Escritor: Simmons$/m);
    await until(() => p.ev<boolean>(`!${q("[role=dialog]")}`), "el menú se cierra tras renombrar");
    const toast = await p.ev<string>(`${q(".toast")}.textContent`);
    assert.match(toast, /Deshacer/);

    // (b) Deshacer: vuelve «Autor» en la cabecera y en los ficheros.
    await clickText(p, ".toast button", "Deshacer");
    await until(async () => (await headers(p)).includes("Autor") && !(await headers(p)).includes("Escritor"), "cabecera restaurada");
    assert.match(read(root, "Libros/Dune.md"), /^Autor: Herbert$/m);
    assert.match(read(root, "Libros/Hyperion.md"), /^Autor: Simmons$/m);
    assert.doesNotMatch(read(root, "Libros/Hyperion.md"), /^Escritor:/m);

    // Esc y clic fuera cierran el menú y devuelven el foco a la cabecera; Tab queda atrapado dentro.
    await openMenu(p, "Autor");
    await key(p, "Tab", 9);
    assert.ok(await p.ev<boolean>(`${q("[role=dialog]")}.contains(document.activeElement)`), "Tab no sale del menú");
    await key(p, "Escape", 27);
    await until(() => p.ev<boolean>(`!${q("[role=dialog]")}`), "Esc cierra el menú");
    assert.ok(await p.ev<boolean>(`document.activeElement === ${header("Autor")}`), "el foco vuelve a la cabecera");
    await openMenu(p, "Autor");
    await p.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 5, y: 5, button: "left", clickCount: 1 });
    await p.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 5, button: "left", clickCount: 1 });
    await until(() => p.ev<boolean>(`!${q("[role=dialog]")}`), "un clic fuera cierra el menú");

    // (c) Ocultar en esta vista: no escribe nada, deja un borrador.
    const before = [read(root, "Bases/Libros.md"), read(root, "Libros/Dune.md"), read(root, "Libros/Hyperion.md")];
    await openMenu(p, "Autor");
    await clickText(p, "[role=dialog] button", "Ocultar en esta vista");
    await until(async () => !(await headers(p)).includes("Autor"), "columna oculta");
    assert.ok(await p.ev<boolean>(`document.body.textContent.includes("Cambios sin guardar")`), "aparece «Cambios sin guardar»");
    await sleep(400);
    assert.deepEqual([read(root, "Bases/Libros.md"), read(root, "Libros/Dune.md"), read(root, "Libros/Hyperion.md")], before, "ocultar no escribe ficheros");

    // (d) Borrar propiedad (con un borrador activo): confirma, la columna desaparece y la clave se quita de las notas.
    await openMenu(p, "Estado");
    await clickText(p, "[role=dialog] button", "Borrar propiedad");
    await until(() => p.ev<boolean>(`!!${q("[role=alertdialog]")}`), "confirmación de borrado");
    assert.match(await p.ev<string>(`${q("[role=alertdialog]")}.textContent`), /Se reescribirán 2 notas/);
    await clickText(p, "[role=alertdialog] button", "Borrar");
    await until(async () => !(await headers(p)).includes("Estado"), "columna borrada");
    assert.doesNotMatch(read(root, "Libros/Dune.md"), /^Estado:/m);
    assert.doesNotMatch(read(root, "Libros/Hyperion.md"), /^Estado:/m);
    assert.doesNotMatch(read(root, "Bases/Libros.md"), /Estado/);
    assert.match(read(root, "Libros/Dune.md"), /^Autor: Herbert$/m, "las demás claves siguen");
  } finally {
    await page?.close();
    await srv.close();
    j.close();
    cleanup();
    rmSync(profile, { recursive: true, force: true });
  }
});

test("menú de cabecera: las columnas de sistema solo ordenan y ocultan", { skip, timeout: 60_000 }, async () => {
  const { root, cleanup } = vault();
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: WEB, key: KEY });
  const profile = mkdtempSync(path.join(tmpdir(), "kioku-chromium-"));
  let page: Page | null = null;
  try {
    page = await launch(profile);
    const p = page;
    await p.send("Page.navigate", { url: `${srv.url}/?k=${KEY}#/bases/Bases/Libros.md` });
    await until(async () => (await headers(p)).includes("Nombre"), "tabla con la columna Nombre");
    // «title» no es una propiedad: el menú existe pero solo ofrece el orden.
    await openMenu(p, "Nombre");
    assert.equal(await p.ev(`!!${q(`[role=dialog] input[aria-label="Nombre de la propiedad"]`)}`), false, "sin campo de nombre");
    const buttons = await p.ev<string[]>(`[...document.querySelectorAll("[role=dialog] button")].map((b) => b.textContent.trim())`);
    assert.ok(buttons.every((b) => !/Borrar|Ocultar/.test(b)), `solo orden: ${buttons.join(" | ")}`);
    assert.ok(buttons.some((b) => /Orden/.test(b)));

    // El menú de la última columna no se sale de una ventana estrecha.
    await key(p, "Escape", 27);
    await until(() => p.ev<boolean>(`!${q("[role=dialog]")}`), "menú cerrado");
    await p.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 600, deviceScaleFactor: 1, mobile: false });
    await sleep(200);
    await openMenu(p, "Estado");
    const r = await p.ev<{ left: number; right: number; top: number; bottom: number }>(`(() => { const r = ${q("[role=dialog]")}.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })()`);
    assert.ok(r.left >= 0 && r.right <= 320 && r.top >= 0 && r.bottom <= 600, `dentro de la ventana: ${JSON.stringify(r)}`);
  } finally {
    await page?.close();
    await srv.close();
    j.close();
    cleanup();
    rmSync(profile, { recursive: true, force: true });
  }
});

test("menú de cabecera: con el rol móvil no existe el menú y la cabecera sigue ordenando", { skip, timeout: 60_000 }, async () => {
  const { root, cleanup } = vault();
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: WEB, key: KEY });
  const profile = mkdtempSync(path.join(tmpdir(), "kioku-chromium-"));
  let page: Page | null = null;
  try {
    page = await launch(profile);
    const p = page;
    await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
    await p.send("Page.navigate", { url: `${srv.url}/?k=${loadOrCreateMobileKey(root)}#/bases/Bases/Libros.md` });
    await until(async () => (await headers(p)).includes("Autor"), "tabla en móvil");
    await until(() => p.ev<boolean>(`!${q(`input[aria-label="Título de la nueva fila"]`)}`), "rol móvil aplicado");
    assert.equal(await p.ev(`document.querySelectorAll(".dbtable th [aria-haspopup]").length`), 0, "sin botón de menú");
    await p.ev(`(() => { const b = ${header("Autor")}; b.focus(); b.click(); })()`);
    await until(() => p.ev<boolean>(`${q(".dbtable th")}.parentElement.querySelector("th[aria-sort=ascending]") !== null`), "el botón de la cabecera ordena");
    assert.equal(await p.ev(`!!${q("[role=dialog]")}`), false, "no se abre ningún menú");
  } finally {
    await page?.close();
    await srv.close();
    j.close();
    cleanup();
    rmSync(profile, { recursive: true, force: true });
  }
});
