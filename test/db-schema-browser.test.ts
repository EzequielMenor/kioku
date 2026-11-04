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

/* ───────────── «+ Propiedad», opciones con color y selector con «Crear» ───────────── */

/** Servidor + Chromium sobre la base «Libros» temporal; `fn` recibe la página y la raíz de la bóveda. */
async function withBase(opts: { mobile?: boolean }, fn: (p: Page, root: string) => Promise<void>) {
  const { root, cleanup } = vault();
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: WEB, key: KEY });
  const profile = mkdtempSync(path.join(tmpdir(), "kioku-chromium-"));
  let page: Page | null = null;
  try {
    page = await launch(profile);
    const p = page;
    await p.send("Emulation.setDeviceMetricsOverride", opts.mobile ? { width: 390, height: 780, deviceScaleFactor: 2, mobile: true } : { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
    await p.send("Page.navigate", { url: `${srv.url}/?k=${opts.mobile ? loadOrCreateMobileKey(root) : KEY}#/bases/Bases/Libros.md` });
    await until(async () => (await headers(p)).includes("Autor"), "tabla con la columna Autor");
    await fn(p, root);
  } finally {
    await page?.close();
    await srv.close();
    j.close();
    cleanup();
    rmSync(profile, { recursive: true, force: true });
  }
}

/** Como `clickText`, pero espera a que el elemento exista: toasts y diálogos llegan un instante después de que el fichero cambie. */
const clickWhen = async (p: Page, sel: string, text: string) => {
  await until(() => p.ev<boolean>(`[...document.querySelectorAll(${JSON.stringify(sel)})].some((e) => e.textContent.trim() === ${JSON.stringify(text)})`), `«${text}» en ${sel}`);
  await clickText(p, sel, text);
};

/** Escribe en un campo (enfocado) como lo haría el usuario y, si se pide, pulsa Enter. */
const typeInto = async (p: Page, sel: string, value: string, enter = false) => {
  await p.ev(`(() => { const i = ${q(sel)}; i.focus(); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  if (enter) await key(p, "Enter", 13, "\r");
};
const clickSel = (p: Page, sel: string) => p.ev(`(() => { const el = ${q(sel)}; el.focus(); el.click(); })()`);
const cellBtn = (title: string) => `button[aria-label^="Estado de «${title}»"]`;
const openCell = async (p: Page, title: string) => {
  await clickSel(p, cellBtn(title));
  await until(() => p.ev<boolean>(`!!${q(`[role=dialog][aria-label="Valor de Estado"]`)}`), `selector de «${title}»`);
};

test("«Añadir propiedad»: nombre y tipo crean la columna y la guardan en la base", { skip, timeout: 60_000 }, async () => {
  await withBase({}, async (p, root) => {
    await clickSel(p, `th button[aria-label="Añadir propiedad"]`);
    await until(() => p.ev<boolean>(`!!${q(`[role=dialog][aria-label="Nueva propiedad"]`)}`), "popover de nueva propiedad");
    assert.ok(await p.ev<boolean>(`${q("[role=dialog]")}.contains(document.activeElement)`), "el foco entra en el popover");
    assert.equal(await p.ev(`${q(`[role=dialog] select[aria-label="Tipo de la nueva propiedad"]`)}.value`), "text", "tipo por defecto: texto");
    await typeInto(p, `[role=dialog] input[aria-label="Nombre de la nueva propiedad"]`, "Editorial", true);
    await until(async () => (await headers(p)).includes("Editorial"), "columna Editorial");
    assert.match(read(root, "Bases/Libros.md"), /Editorial:\s*\n\s+type: text/);
    await until(() => p.ev<boolean>(`!${q("[role=dialog]")}`), "el popover se cierra");
    assert.match(await p.ev<string>(`${q(".toast")}.textContent`), /Deshacer/);
  });
});

test("opciones: añadir «Pausado» en verde da al chip de la celda la clase opt-green", { skip, timeout: 60_000 }, async () => {
  await withBase({}, async (p, root) => {
    await openMenu(p, "Estado");
    await typeInto(p, `[role=dialog] input[aria-label="Nueva opción"]`, "Pausado", true);
    await until(() => p.ev<boolean>(`!!${q(`[role=dialog] button[aria-label^="Color de Pausado"]`)}`), "la opción aparece en el editor");
    assert.match(read(root, "Bases/Libros.md"), /Pausado/);
    assert.ok(await p.ev<boolean>(`!!${q(`[role=dialog][aria-label="Propiedad Estado"]`)}`), "el menú sigue abierto para seguir editando");
    await clickSel(p, `[role=dialog] button[aria-label^="Color de Pausado"]`);
    await clickSel(p, `[role=dialog] [role=group][aria-label="Colores de Pausado"] button[aria-label="Verde"]`);
    await until(() => /name: Pausado\s*\n\s+color: green/.test(read(root, "Bases/Libros.md")), "color guardado en la base");
    await key(p, "Escape", 27);
    await until(() => p.ev<boolean>(`!${q("[role=dialog]")}`), "menú cerrado");

    await openCell(p, "Hyperion");
    await clickWhen(p, "[role=dialog] button", "Pausado");
    await until(() => /^Estado: Pausado$/m.test(read(root, "Libros/Hyperion.md")), "valor asignado");
    await until(() => p.ev<boolean>(`${q(cellBtn("Hyperion"))}.classList.contains("opt-green")`), "chip verde en la celda");
    assert.equal(await p.ev(`${q(cellBtn("Dune"))}.classList.contains("opt-none")`), true, "una opción sin color usa la clase neutra");
  });
});

test("selector de la celda: filtra, elige la coincidencia exacta y «Crear» añade la opción y la asigna", { skip, timeout: 60_000 }, async () => {
  await withBase({}, async (p, root) => {
    await openCell(p, "Dune");
    assert.ok(await p.ev<boolean>(`document.activeElement === ${q(`[role=dialog] input[aria-label="Filtrar opciones"]`)}`), "el filtro recibe el foco");
    const labels = () => p.ev<string[]>(`[...document.querySelectorAll("[role=dialog] button")].map((b) => b.textContent.trim())`);
    assert.ok((await labels()).includes("Vaciar") && (await labels()).includes("Leyendo"));
    // Texto sin coincidencia: se ofrece crear; con coincidencia exacta (sin mayúsculas ni tildes de más), no.
    await typeInto(p, `[role=dialog] input[aria-label="Filtrar opciones"]`, "Releyendo");
    await until(async () => (await labels()).includes("Crear «Releyendo»"), "se ofrece «Crear»");
    assert.ok(!(await labels()).includes("Leyendo"), "el filtro oculta lo que no coincide");
    await typeInto(p, `[role=dialog] input[aria-label="Filtrar opciones"]`, "leyendo");
    await until(async () => !(await labels()).some((l) => l.startsWith("Crear")), "con coincidencia exacta no se ofrece crear");
    // Enter con coincidencia exacta elige la opción existente.
    await key(p, "Enter", 13, "\r");
    await until(() => /^Estado: Leyendo$/m.test(read(root, "Libros/Dune.md")), "Enter elige la existente");
    await until(() => p.ev<boolean>(`!${q("[role=dialog]")}`), "el selector se cierra");
    assert.equal((read(root, "Bases/Libros.md").match(/Leyendo/g) ?? []).length, 1, "no se duplicó la opción");

    // Crear: primero el esquema, después la celda.
    await openCell(p, "Hyperion");
    await typeInto(p, `[role=dialog] input[aria-label="Filtrar opciones"]`, "Releyendo");
    await until(async () => (await labels()).includes("Crear «Releyendo»"), "se ofrece «Crear» (2)");
    await clickWhen(p, "[role=dialog] button", "Crear «Releyendo»");
    await until(() => /^Estado: Releyendo$/m.test(read(root, "Libros/Hyperion.md")), "celda asignada");
    assert.match(read(root, "Bases/Libros.md"), /Releyendo/);
    await until(() => p.ev<boolean>(`${q(cellBtn("Hyperion"))}.textContent.trim() === "Releyendo"`), "el chip muestra el valor");

    // Vaciar quita el valor.
    await openCell(p, "Hyperion");
    await clickWhen(p, "[role=dialog] button", "Vaciar");
    await until(() => !/^Estado:/m.test(read(root, "Libros/Hyperion.md")), "valor vaciado");
  });
});

test("opciones: renombrar con filas pide confirmación, actualiza las notas y Deshacer lo revierte; reordenar", { skip, timeout: 90_000 }, async () => {
  await withBase({}, async (p, root) => {
    await openMenu(p, "Estado");
    const rename = `[role=dialog] input[aria-label="Renombrar Leyendo"]`;
    await until(() => p.ev<boolean>(`!!${q(rename)}`), "campo para renombrar «Leyendo»");
    // Cancelar la confirmación deja el campo con el nombre real.
    await typeInto(p, rename, "Releyendo", true);
    await until(() => p.ev<boolean>(`!!${q("[role=alertdialog]")}`), "confirmación (cancelar)");
    await clickWhen(p, "[role=alertdialog] button", "Cancelar");
    await until(() => p.ev<boolean>(`${q(rename)}.value === "Leyendo"`), "el campo vuelve al nombre real");
    await typeInto(p, rename, "Releyendo", true);
    await until(() => p.ev<boolean>(`!!${q("[role=alertdialog]")}`), "confirmación de renombrado");
    assert.match(await p.ev<string>(`${q("[role=alertdialog]")}.textContent`), /Se reescribirán 1 nota\b/);
    await clickWhen(p, "[role=alertdialog] button", "Renombrar");
    await until(() => /^Estado: Releyendo$/m.test(read(root, "Libros/Hyperion.md")), "nota actualizada");
    assert.match(read(root, "Bases/Libros.md"), /Releyendo/);
    assert.doesNotMatch(read(root, "Bases/Libros.md"), /^\s*- Leyendo\s*$/m, "la opción vieja ya no está");
    await clickWhen(p, ".toast button", "Deshacer");
    await until(() => /^Estado: Leyendo$/m.test(read(root, "Libros/Hyperion.md")), "Deshacer restaura la nota");
    assert.doesNotMatch(read(root, "Bases/Libros.md"), /Releyendo/);

    // Reordenar con los botones accesibles.
    await p.ev(`document.querySelector('[role=dialog] button[aria-label="Bajar Leyendo"]').click()`);
    await until(() => /-\s+Leído\s*\n\s+-\s+Leyendo/.test(read(root, "Bases/Libros.md")), "orden invertido en la base");
  });
});

test("opciones: borrar una opción en uso ofrece Cancelar, conservar el valor o vaciarlo; sin uso se borra directo", { skip, timeout: 90_000 }, async () => {
  await withBase({}, async (p, root) => {
    const files = () => [read(root, "Bases/Libros.md"), read(root, "Libros/Dune.md"), read(root, "Libros/Hyperion.md")];
    const choiceDialog = () => until(() => p.ev<boolean>(`!!${q("[role=alertdialog]")}`), "pregunta de borrado");
    const listed = (name: string) => p.ev<boolean>(`!!${q(`[role=dialog] button[aria-label="Borrar ${name}"]`)}`);
    await openMenu(p, "Estado");
    const before = files();

    // Cancelar y Esc: no se toca nada y la opción sigue en la lista.
    await clickSel(p, `[role=dialog] button[aria-label="Borrar Leído"]`);
    await choiceDialog();
    const text = await p.ev<string>(`${q("[role=alertdialog]")}.textContent`);
    assert.match(text, /1 nota\b/);
    assert.deepEqual(await p.ev<string[]>(`[...document.querySelectorAll("[role=alertdialog] button")].map((b) => b.textContent.trim())`), ["Cancelar", "Borrar y conservar el valor", "Vaciar y borrar"]);
    await until(() => p.ev<boolean>(`document.activeElement.textContent.trim() === "Cancelar"`), "el foco empieza en Cancelar");
    await clickWhen(p, "[role=alertdialog] button", "Cancelar");
    await until(() => p.ev<boolean>(`!${q("[role=alertdialog]")}`), "diálogo cerrado (Cancelar)");
    await sleep(400);
    assert.deepEqual(files(), before, "Cancelar no escribe nada");
    assert.ok(await listed("Leído"), "la opción sigue listada");
    await clickSel(p, `[role=dialog] button[aria-label="Borrar Leído"]`);
    await choiceDialog();
    await key(p, "Escape", 27);
    await until(() => p.ev<boolean>(`!${q("[role=alertdialog]")}`), "diálogo cerrado (Esc)");
    await sleep(400);
    assert.deepEqual(files(), before, "Esc no escribe nada");
    assert.ok(await listed("Leído") && (await p.ev<boolean>(`!!${q(`[role=dialog][aria-label="Propiedad Estado"]`)}`)), "opción y menú siguen ahí");

    // Borrar y conservar el valor: la opción desaparece del esquema, la nota conserva su valor, y no hay una segunda pregunta.
    await clickSel(p, `[role=dialog] button[aria-label="Borrar Leído"]`);
    await choiceDialog();
    await clickWhen(p, "[role=alertdialog] button", "Borrar y conservar el valor");
    await until(() => !/Leído/.test(read(root, "Bases/Libros.md")), "opción borrada del esquema");
    assert.match(read(root, "Libros/Dune.md"), /^Estado: Leído$/m, "la nota conserva el valor");
    assert.equal(await p.ev(`!!${q("[role=alertdialog]")}`), false, "una sola pregunta, no dos");

    // Vaciar y borrar: también se quita el valor de las notas.
    await clickSel(p, `[role=dialog] button[aria-label="Borrar Leyendo"]`);
    await choiceDialog();
    await clickWhen(p, "[role=alertdialog] button", "Vaciar y borrar");
    await until(() => !/^Estado:/m.test(read(root, "Libros/Hyperion.md")), "valor vaciado en la nota");
    assert.doesNotMatch(read(root, "Bases/Libros.md"), /Leyendo/);
    assert.equal(await p.ev(`!!${q("[role=alertdialog]")}`), false, "una sola pregunta, no dos");

    // Sin notas que la usen: se borra directo, sin diálogo.
    await typeInto(p, `[role=dialog] input[aria-label="Nueva opción"]`, "Nunca", true);
    await until(() => listed("Nunca"), "opción nueva listada");
    await clickSel(p, `[role=dialog] button[aria-label="Borrar Nunca"]`);
    await until(async () => !(await listed("Nunca")), "borrada sin preguntar");
    assert.equal(await p.ev(`!!${q("[role=alertdialog]")}`), false);
  });
});

test("opciones de multiselección: sin color, con renombrar, reordenar y borrar", { skip, timeout: 60_000 }, async () => {
  await withBase({}, async (p, root) => {
    await openMenu(p, "Estado");
    assert.ok(await p.ev<boolean>(`!!${q(`[role=dialog] button[aria-label="Color de Leyendo: Sin color"]`)}`), "el punto de color nombra el color actual");
    await p.ev(`(() => { const s = ${q(`[role=dialog] select[aria-label="Tipo de la propiedad"]`)}; s.value = "multi"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await until(() => /type: multi/.test(read(root, "Bases/Libros.md")), "tipo cambiado a multi");
    await until(() => p.ev<boolean>(`!${q("[role=dialog]")}`), "el menú se cierra tras cambiar el tipo");
    await until(() => p.ev<boolean>(`${header("Estado")}.getAttribute("aria-expanded") === "false"`), "cabecera lista");
    await openMenu(p, "Estado");
    await until(() => p.ev<boolean>(`!!${q(`[role=dialog] input[aria-label="Renombrar Leyendo"]`)}`), "editor de opciones de la multiselección");
    await until(() => p.ev<boolean>(`!${q(`[role=dialog] button[aria-label^="Color de"]`)}`), "sin selector de color en multi");
    for (const sel of [`[role=dialog] input[aria-label="Renombrar Leyendo"]`, `[role=dialog] button[aria-label="Bajar Leyendo"]`, `[role=dialog] button[aria-label="Borrar Leyendo"]`]) {
      assert.ok(await p.ev<boolean>(`!!${q(sel)}`), `sigue ${sel}`);
    }
  });
});

test("rol móvil: el selector de la celda sigue siendo nativo y no hay «Añadir propiedad»", { skip, timeout: 60_000 }, async () => {
  await withBase({ mobile: true }, async (p) => {
    await until(() => p.ev<boolean>(`!${q(`input[aria-label="Título de la nueva fila"]`)}`), "rol móvil aplicado");
    assert.equal(await p.ev(`document.querySelectorAll('th button[aria-label="Añadir propiedad"]').length`), 0);
    assert.equal(await p.ev(`${q('[aria-label^="Estado de «Dune»"]')}.tagName`), "SELECT");
  });
});
