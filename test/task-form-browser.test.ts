// Formulario de tareas en un Chromium real (CDP con el WebSocket integrado de Node) sobre una bóveda y un servidor temporales.
// Se omite si no hay Chromium o `npm run build:web` no se ha ejecutado: no hay dependencias nuevas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { tmpVault } from "./helpers.ts";

const CHROMIUM = process.env.KIOKU_CHROMIUM ?? "/usr/bin/chromium";
const WEB = path.join(import.meta.dirname, "..", "dist", "web");
const KEY = "c".repeat(64);
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
  const port = await until(() => { const f = path.join(profile, "DevToolsActivePort"); return existsSync(f) ? readFileSync(f, "utf8").split("\n")[0] : null; }, "Chromium arrancó");
  const target = await until(async () => ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((x) => x.type === "page"), "hay una página");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
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
const click = (p: Page, sel: string) => p.ev(`${q(sel)}.click()`);
/** Enfoca y pulsa el elemento cuyo texto coincide (un `click()` suelto no mueve el foco, como sí hace un usuario). */
const clickText = (p: Page, sel: string, text: string) => p.ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); el.focus(); el.click(); })()`);
const setField = (p: Page, label: string, value: string, event: "input" | "change") => p.ev(`(() => {
  const el = [...document.querySelectorAll("dialog label")].find((l) => l.firstChild.textContent === ${JSON.stringify(label)}).querySelector("input,select");
  el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
})()`);
const field = (p: Page, label: string) => p.ev<string>(`[...document.querySelectorAll("dialog label")].find((l) => l.firstChild.textContent === ${JSON.stringify(label)}).querySelector("input,select").value`);
const isOpen = (p: Page) => p.ev<boolean>(`!!document.querySelector("dialog.task-dialog[open]")`);
/** Abierto y con los datos cargados (hasta entonces solo hay «Cerrar»). */
const ready = (p: Page) => until(() => p.ev<boolean>(`!!document.querySelector("dialog.task-dialog[open] form")`), "formulario cargado");
const key = (p: Page, k: string) => Promise.all(["keyDown", "keyUp"].map((type) => p.send("Input.dispatchKeyEvent", { type, key: k, code: k, windowsVirtualKeyCode: 27 })));
test("formulario de tareas en un navegador real: crear, editar en lista, tabla y tablero, Abrir nota, Escape y móvil", { skip, timeout: 120_000 }, async () => {
  const { root, cleanup } = tmpVault({
    "Proyectos/Casa.md": FM("type: project\nstatus: active\n") + "Casa\n",
    "Tareas/Existente.md": FM("type: task\nstatus: todo\ndue: 2026-11-05\npriority: 2\ncustom: preservar\n") + "Cuerpo que no se toca\n\n- [ ] punto\n",
    "Tareas/Otra.md": FM("type: task\nstatus: todo\n") + "Otra\n",
  });
  const j = await Kioku.open({ root });
  const area = await j.areas.create({ id: "area-prueba-01", title: "Hogar", color: "#334455" });
  const srv = await startServer(j, { port: 0, webDir: WEB, key: KEY });
  const profile = mkdtempSync(path.join(tmpdir(), "kioku-chromium-"));
  let page: Page | null = null;
  try {
    page = await launch(profile);
    const p = page;
    await p.send("Page.navigate", { url: `${srv.url}/?k=${KEY}#/tareas` });
    await until(() => p.ev<boolean>(`[...document.querySelectorAll("button")].some((b) => b.textContent === "Añadir tarea")`), "botón Añadir tarea");

    // Crear: el diálogo es modal, el foco entra en el título y solo este es obligatorio.
    await clickText(p, "button", "Añadir tarea");
    await ready(p);
    await until(() => p.ev<boolean>(`document.activeElement === ${q("dialog input")}`), "foco en el título");
    assert.equal(await p.ev(`${q("dialog")}.matches(":modal")`), true, "showModal atrapa el foco");
    assert.equal(await p.ev<boolean>(`${q("dialog button.primary")}.disabled`), true, "sin título no se puede crear");
    await setField(p, "Título", "Literal mañana p1 #x", "input");
    await setField(p, "Fecha límite", "2026-12-01", "input");
    await setField(p, "Estado", "doing", "change");
    await setField(p, "Prioridad", "1", "change");
    await setField(p, "Estimación (minutos)", "45", "input");
    await setField(p, "Área", area.path, "change");
    await setField(p, "Proyecto", "Proyectos/Casa.md", "change");
    await click(p, "dialog button.primary");
    await until(async () => !(await isOpen(p)), "diálogo cerrado tras crear");
    await until(() => p.ev<boolean>(`document.body.innerText.includes("Literal mañana p1 #x")`), "la lista muestra la tarea sin recargar la página");
    const created = j.index.tasks().find((t) => t.title === "Literal mañana p1 #x")!;
    assert.ok(created, "la tarea existe con el título literal");
    const fm = j.index.getNote(created.path)!.fm;
    assert.deepEqual([fm.status, fm.priority, fm.due, fm.estimate, fm.area, fm.project], ["doing", 1, "2026-12-01", 45, "[[Areas/area-prueba-01]]", "[[Proyectos/Casa]]"]);
    assert.equal(await p.ev(`document.activeElement.textContent`), "Añadir tarea", "al cerrar el foco vuelve a quien lo abrió");

    // Cancelar y Escape no escriben nada.
    const countBefore = j.index.count();
    await clickText(p, "button", "Añadir tarea");
    await ready(p);
    await setField(p, "Título", "No se guarda", "input");
    await key(p, "Escape");
    await until(async () => !(await isOpen(p)), "Escape cierra el diálogo");
    await clickText(p, "button", "Añadir tarea");
    await ready(p);
    await clickText(p, "dialog button", "Cancelar");
    await until(async () => !(await isOpen(p)), "Cancelar cierra el diálogo");
    assert.equal(j.index.count(), countBefore);

    // Editar y cancelar (botón o Escape) devuelve el foco al título de esa misma tarea, no al cuerpo del documento.
    const focused = () => p.ev<string>(`document.activeElement.tagName + ":" + document.activeElement.textContent`);
    for (const how of ["Cancelar", "Escape"]) {
      await clickText(p, "a.ttitle", "Existente");
      await ready(p);
      await setField(p, "Título", "Existente editado sin guardar", "input");
      if (how === "Escape") await key(p, "Escape"); else await clickText(p, "dialog button", "Cancelar");
      await until(async () => !(await isOpen(p)), `${how} cierra la edición`);
      assert.equal(await focused(), "A:Existente", `${how}: el foco vuelve al título de la tarea`);
    }

    // Editar desde la lista: valores cargados, solo se escribe lo cambiado y el resto (cuerpo, propiedades ajenas) queda igual.
    await clickText(p, "a.ttitle", "Existente");
    await until(() => isOpen(p), "formulario de edición");
    await until(async () => (await field(p, "Título")) === "Existente", "valores cargados");
    assert.deepEqual([await field(p, "Fecha límite"), await field(p, "Estado"), await field(p, "Prioridad")], ["2026-11-05", "todo", "2"]);
    const raw = readFileSync(path.join(root, "Tareas", "Existente.md"), "utf8");
    await setField(p, "Estado", "done", "change");
    await setField(p, "Área", area.path, "change");
    await click(p, "dialog button.primary");
    await until(async () => !(await isOpen(p)), "diálogo cerrado tras editar");
    const edited = readFileSync(path.join(root, "Tareas", "Existente.md"), "utf8");
    assert.match(edited, /status: done/);
    assert.match(edited, /done_at: /);
    assert.match(edited, /area: "?\[\[Areas\/area-prueba-01\]\]"?/);
    assert.match(edited, /custom: preservar/);
    assert.match(edited, /due: 2026-11-05/);
    assert.ok(edited.endsWith("Cuerpo que no se toca\n\n- [ ] punto\n"), "el cuerpo no cambia");
    assert.notEqual(edited, raw);

    // Conflicto: el error se ve, el diálogo sigue abierto y lo escrito se conserva.
    await clickText(p, "a.ttitle", "Otra");
    await until(async () => (await isOpen(p)) && (await field(p, "Título")) === "Otra", "formulario de Otra");
    writeFileSync(path.join(root, "Tareas", "Otra.md"), FM("type: task\nstatus: todo\n") + "Cambiada fuera\n");
    await sleep(400);
    await setField(p, "Título", "Otra renombrada", "input");
    await click(p, "dialog button.primary");
    await until(() => p.ev<boolean>(`!!document.querySelector("dialog [role=alert]")`), "error visible");
    assert.equal(await isOpen(p), true);
    assert.equal(await field(p, "Título"), "Otra renombrada", "se conserva lo escrito");
    await clickText(p, "dialog button", "Cancelar");

    // Guardado en curso: Escape y Cancelar no cierran ni envían dos veces; si la red falla, el diálogo conserva lo escrito.
    await clickText(p, "a.ttitle", "Otra");
    await until(async () => (await isOpen(p)) && (await field(p, "Título")) === "Otra", "formulario de Otra");
    await p.ev(`(() => {
      window.__saves = 0; window.__fail = null;
      const real = window.fetch.bind(window);
      window.fetch = (url, init) => String(url).includes("/api/task/update")
        ? (window.__saves++, new Promise((_, reject) => { window.__fail = () => reject(new TypeError("Failed to fetch")); }))
        : real(url, init);
    })()`);
    await setField(p, "Título", "Sin red", "input");
    await p.ev(`${q("dialog form")}.requestSubmit()`);
    await until(() => p.ev<boolean>(`${q("dialog fieldset")}.disabled`), "guardando");
    await key(p, "Escape");
    await p.ev(`${q("dialog form")}.requestSubmit()`);
    await sleep(300);
    assert.equal(await isOpen(p), true, "un guardado en curso no se cierra con Escape");
    assert.equal(await p.ev<number>("window.__saves"), 1, "no se envía dos veces");
    await p.ev("window.__fail()");
    await until(() => p.ev<boolean>(`!!document.querySelector("dialog [role=alert]") && !${q("dialog fieldset")}.disabled`), "error visible y formulario habilitado");
    assert.equal(await isOpen(p), true);
    assert.equal(await field(p, "Título"), "Sin red", "el fallo de red conserva lo escrito");
    assert.match(readFileSync(path.join(root, "Tareas", "Otra.md"), "utf8"), /Cambiada fuera/, "nada se escribió");
    await clickText(p, "dialog button", "Cancelar");
    await until(async () => !(await isOpen(p)), "Cancelar cierra tras el error");
    await p.ev("location.reload()");
    await until(() => p.ev<boolean>(`[...document.querySelectorAll("button")].some((b) => b.textContent === "Añadir tarea")`), "app recargada");

    // Tabla y tablero: el título abre el mismo formulario; «Abrir nota» lleva al Markdown.
    for (const mode of ["Tabla", "Tablero"]) {
      await clickText(p, "button[role=tab]", mode);
      await until(() => p.ev<boolean>(`!!document.querySelector(${JSON.stringify(mode === "Tabla" ? ".dbtable td a" : ".kcard a")})`), `vista ${mode}`);
      await p.ev(`${q(mode === "Tabla" ? ".dbtable td a" : ".kcard a")}.click()`);
      await ready(p);
      await clickText(p, "dialog button", "Cancelar");
      await until(async () => !(await isOpen(p)), `cerrado en ${mode}`);
    }
    await p.ev(`${q(".kcard a")}.click()`);
    await ready(p);
    await clickText(p, "dialog a", "Abrir nota");
    await until(async () => !(await isOpen(p)) && (await p.ev<string>("location.hash")).startsWith("#/nota/"), "Abrir nota navega al Markdown");

    // Estrecho: el diálogo cabe en un móvil y los campos no desbordan.
    await p.ev(`location.hash = "#/tareas"`);
    await p.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 700, deviceScaleFactor: 2, mobile: true });
    await until(() => p.ev<boolean>(`[...document.querySelectorAll("button")].some((b) => b.textContent === "Añadir tarea")`), "botón en móvil");
    await clickText(p, "button", "Añadir tarea");
    await ready(p);
    const fits = await p.ev<{ left: number; right: number; scroll: number; width: number }>(`(() => { const r = ${q("dialog")}.getBoundingClientRect(); return { left: r.left, right: r.right, scroll: ${q("dialog")}.scrollWidth, width: ${q("dialog")}.clientWidth }; })()`);
    assert.ok(fits.left >= 0 && fits.right <= 375, JSON.stringify(fits));
    assert.ok(fits.scroll <= fits.width + 1, `sin desbordamiento horizontal: ${JSON.stringify(fits)}`);
  } finally {
    await page?.close();
    await srv.close();
    j.close();
    cleanup();
    rmSync(profile, { recursive: true, force: true });
  }
});
