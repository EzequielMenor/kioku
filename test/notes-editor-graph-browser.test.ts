// Flujos E2E en Chromium real para personalización/renombrado de notas, menú `/` en editor, /notas separado y /grafo de conocimiento.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { WEB, browserSkip, launch, until } from "./cdp.ts";
import { tmpVault } from "./helpers.ts";

const KEY = "e".repeat(64);

async function openDesktop(route: string) {
  const { root, cleanup } = tmpVault();
  const j = await Kioku.open({ root });
  const today = new Date().toISOString().slice(0, 10);
  await j.createNote({ title: "Nota Origen", type: "note", body: "Ver [[Recurso Enlazado]]\n" });
  await j.createNote({ title: "Recurso Enlazado", type: "resource", body: "Refiere a [[Nota Origen]]\n" });
  await j.createNote({ title: "Subnota", type: "note", folder: "Notas/Temas", fm: { tags: ["arquitectura"] }, body: "En subcarpeta\n" });
  const proj = await j.createProject("Proyecto oculto en notas");
  await j.createTask({ title: "Tarea oculta en notas", due: today, projectPath: proj.path });
  await j.capture("Captura oculta en notas");
  await j.calendar.create({ id: "evento-neg-0001", title: "Evento oculto en notas", kind: "event", start: `${today}T09:00`, end: `${today}T10:00` });

  const srv = await startServer(j, { port: 0, webDir: WEB, key: KEY });
  const p = await launch(mkdtempSync(path.join(tmpdir(), "kioku-neg-")));
  await p.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 840, deviceScaleFactor: 1, mobile: false });
  await p.send("Page.navigate", { url: `${srv.url}/?k=${KEY}#${route}` });
  return { root, p, j, done: async () => { await p.close(); await srv.close(); j.close(); cleanup(); } };
}

test("navegador · /notas separa notas de conocimiento, filtra por carpeta y agrupa Sin organizar y Grafo", { skip: browserSkip, timeout: 60_000 }, async () => {
  const t = await openDesktop("/notas");
  try {
    await until(() => t.p.ev<boolean>(`document.querySelectorAll(".rows li").length >= 3`), "lista de notas");
    const titles = await t.p.ev<string[]>(`[...document.querySelectorAll(".rows a")].map((a) => a.textContent ?? "")`);
    assert.ok(titles.includes("Nota Origen"));
    assert.ok(titles.includes("Recurso Enlazado"));
    assert.ok(titles.includes("Subnota"));
    assert.ok(!titles.some((s) => /oculta|oculto/.test(s)), `no debe listar tareas/proyectos/capturas/eventos: ${titles.join(", ")}`);

    // Filtra por subcarpeta
    await t.p.ev(`(() => { const b = [...document.querySelectorAll(".folder-chip")].find((x) => x.textContent.includes("Notas/Temas")); b.click(); })()`);
    await until(() => t.p.ev<boolean>(`document.querySelectorAll(".rows li").length === 1`), "filtro por subcarpeta");
    assert.equal(await t.p.ev<string>(`document.querySelector(".rows a")?.textContent`), "Subnota");

    // Vuelve a todas: sin filtro de subtipo (simplificación), el recurso se distingue por su etiqueta
    await t.p.ev(`(() => { const b = [...document.querySelectorAll(".notes-filters button")].find((x) => x.textContent.startsWith("Todas las carpetas")); b.click(); })()`);
    await until(() => t.p.ev<boolean>(`document.querySelectorAll(".rows li").length >= 3`), "todas las carpetas");
    const chips = await t.p.ev<string[]>(`[...document.querySelectorAll(".rows li")].filter((li) => li.querySelector("a")?.textContent === "Recurso Enlazado").map((li) => li.textContent ?? "")`);
    assert.match(chips[0] ?? "", /Recursos/);
    assert.ok(await t.p.ev<boolean>(`[...document.querySelectorAll(".page-head button")].some((b) => b.textContent === "Diario de hoy")`), "el diario vive en Notas");
    assert.ok(await t.p.ev<boolean>(`[...document.querySelectorAll(".section-tabs a")].map((a) => a.textContent).join("|").match(/^Notas\|Sin organizar( · \d+)?\|Grafo$/) !== null`), "Notas · Sin organizar · Grafo");
    const bounds = (selector: string) => t.p.ev<number[]>(`(() => {
      const { left, width } = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return [left, width];
    })()`);
    const notes = await bounds("main > .page");
    const tabs = await bounds(".section-tabs");
    for (const [route, selector] of [["bandeja", "main > .page"], ["grafo", ".graph-page"]]) {
      await t.p.ev(`document.querySelector('.section-tabs a[href="#/${route}"]').click()`);
      await until(() => t.p.ev(`document.querySelector('.section-tabs a[href="#/${route}"]').getAttribute('aria-current') === 'page'`), route);
      assert.deepEqual(await bounds(selector), notes);
      assert.deepEqual(await bounds(".section-tabs"), tabs);
    }

    await t.p.ev(`document.querySelector('.sidebar a[href="#/proyectos"]').click()`);
    await until(() => t.p.ev(`document.querySelector("main h1")?.textContent === "Proyectos"`), "acceso directo a Proyectos");
    assert.equal(await t.p.ev(`document.querySelector(".sidebar a.active")?.getAttribute("href")`), "#/proyectos");

    await t.p.ev(`document.querySelector('.sidebar a[href="#/tareas"]').click()`);
    await until(() => t.p.ev(`document.querySelector("main h1")?.textContent === "Tareas"`), "vista Tareas");
    const tasks = await bounds("main > .page");
    for (const mode of ["Tabla", "Tablero", "Lista"]) {
      await t.p.ev(`[...document.querySelectorAll('main [role=tab]')].find(b => b.textContent === "${mode}").click()`);
      await until(() => t.p.ev(`document.querySelector('main [aria-selected=true]')?.textContent === "${mode}"`), mode);
      assert.deepEqual(await bounds("main > .page"), tasks);
    }
  } finally { await t.done(); }
});

test("navegador · nota: renombrar título, .md y carpeta, personalizar propiedades y usar menú / en CM6", { skip: browserSkip, timeout: 60_000 }, async () => {
  const t = await openDesktop("/nota/Notas/Nota%20Origen.md");
  try {
    await until(() => t.p.ev<boolean>(`!!document.querySelector(".rename-btn") && !!document.querySelector(".cm-content")`), "editor de nota");

    // Agrega un icono y una etiqueta desde el panel lateral de la nota
    await t.p.ev(`(() => { const b = [...document.querySelectorAll(".icon-opt")].find((x) => x.textContent.trim() === "🧠"); if (b) b.click(); })()`);
    await until(() => t.p.ev<boolean>(`document.querySelector(".note-head-icon")?.textContent.trim() === "🧠"`), "icono aplicado");

    // Escribe /h1 en el editor CM6 y acepta con Enter
    await t.p.ev(`(() => { const c = document.querySelector(".cm-content"); c.focus(); })()`);
    await t.p.send("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End", windowsVirtualKeyCode: 35, modifiers: 2 });
    await t.p.send("Input.dispatchKeyEvent", { type: "keyUp", key: "End", code: "End", windowsVirtualKeyCode: 35, modifiers: 2 });
    await t.p.send("Input.insertText", { text: "\n" });
    await t.p.send("Input.insertText", { text: "/h1" });
    await until(() => t.p.ev<boolean>(`!!document.querySelector(".cm-tooltip-autocomplete")`), "menú slash visible");
    const tipText = await t.p.ev<string>(`document.querySelector(".cm-tooltip-autocomplete")?.textContent ?? ""`);
    assert.match(tipText, /Título 1/);
    await t.p.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await t.p.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await t.p.send("Input.insertText", { text: "Sección" });
    const bodyNow = await t.p.ev<string>(`document.querySelector(".cm-content")?.textContent ?? ""`);
    assert.match(bodyNow, /# Sección/, `contenido real en CM6 (tip="${tipText}"): ${JSON.stringify(bodyNow)}`);

    // Espera autoguardado para tener hash limpio antes de renombrar
    await until(() => t.p.ev<boolean>(`!/Guardando|Sin guardar/.test(document.body.textContent ?? "")`), "guardado inicial");

    // Renombra título, nombre de archivo .md y carpeta
    await t.p.ev(`document.querySelector(".rename-btn").click()`);
    await until(() => t.p.ev<boolean>(`!!document.querySelector('form[aria-label="Renombrar o mover nota"]')`), "diálogo renombrar");
    await t.p.ev(`(() => {
      const dlg = document.querySelector('form[aria-label="Renombrar o mover nota"]');
      const inputs = [...dlg.querySelectorAll("input")];
      const set = (el, val) => { el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); };
      set(inputs[0], "Nota Maestra");
      const sync = inputs.find((i) => i.type === "checkbox");
      if (sync && sync.checked) sync.click();
      set(inputs[1], "nota-maestra");
      set(inputs[3], "Notas/Guias");
    })()`);
    await t.p.ev(`document.querySelector('form[aria-label="Renombrar o mover nota"] button[type="submit"]').click()`);

    await until(() => t.p.ev<boolean>(`decodeURIComponent(location.hash).includes("Notas/Guias/nota-maestra.md")`), "navegación tras renombrar");
    assert.equal(existsSync(path.join(t.root, "Notas/Guias/nota-maestra.md")), true);

    // Verifica que la nota que enlazaba recibió el wikilink actualizado en disco
    const refAfter = readFileSync(path.join(t.root, "Recursos/Recurso Enlazado.md"), "utf8");
    assert.match(refAfter, /\[\[nota-maestra\]\]|\[\[Notas\/Guias\/nota-maestra\]\]/);
  } finally { await t.done(); }
});

test("navegador · /grafo muestra solo notas de conocimiento y controles visuales", { skip: browserSkip, timeout: 60_000 }, async () => {
  const t = await openDesktop("/grafo");
  try {
    await until(() => t.p.ev<boolean>(`!!document.querySelector(".graph-wrap canvas")`), "canvas del grafo");
    const chips = await t.p.ev<string[]>(`[...document.querySelectorAll(".graph-types button")].map((b) => b.textContent ?? "")`);
    assert.ok(chips.some((c) => /Notas/.test(c)));
    assert.ok(chips.some((c) => /Recursos/.test(c)));
    assert.ok(!chips.some((c) => /Tareas|Proyectos|Capturas|Diario/.test(c)), `solo tipos de conocimiento: ${chips.join(", ")}`);
    assert.equal(await t.p.ev<boolean>(`!!document.querySelector(".graph-legend")`), true);
    assert.equal(await t.p.ev<boolean>(`!!document.querySelector(".graph-check input[type=checkbox]")`), true);
  } finally { await t.done(); }
});
