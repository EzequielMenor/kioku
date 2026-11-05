import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { startServer } from "../src/server/server.ts";
import { WEB, browserSkip, launch, until } from "./cdp.ts";
import { tmpVault } from "./helpers.ts";

test("lanzador: gestión de Hermes accesible en escritorio y oculta para el móvil", { skip: browserSkip, timeout: 60_000 }, async () => {
  const v = tmpVault();
  const j = await Kioku.open({ root: v.root });
  const srv = await startServer(j, { port: 0, webDir: WEB, key: "b".repeat(64) });
  const profile = mkdtempSync(path.join(tmpdir(), "kioku-management-launcher-"));
  let page: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    page = await launch(profile);
    await page.send("Page.navigate", { url: `${srv.url}/?k=${"b".repeat(64)}#/asistente` });
    await until(() => page!.ev<boolean>(`!!document.querySelector('.sidebar .side-btn')`), "escritorio");
    await page.ev(`[...document.querySelectorAll('.side-btn')].find(x => x.textContent.includes('Buscar')).click()`);
    await until(() => page!.ev<boolean>(`!!document.querySelector('.palette')`), "lanzador");
    assert.equal(await page.ev<boolean>(`[...document.querySelectorAll('.plist li')].some(x => x.textContent === 'Nueva nota')`), true);
    assert.equal(await page.ev<boolean>(`[...document.querySelectorAll('.plist li')].some(x => x.textContent === 'Modelo de Hermes')`), true);
    await page.ev(`[...document.querySelectorAll('.plist li')].find(x => x.textContent === 'Modelo de Hermes').click()`);
    await until(() => page!.ev<boolean>(`!!document.querySelector('[aria-labelledby="am-title"]')`), "gestión");
    assert.equal(await page.ev<string>(`document.querySelector('#am-title').textContent`), "Gestión del asistente");
    assert.equal(await page.ev<boolean>(`!!document.querySelector('.palette')`), false);
    await until(() => page!.ev<boolean>(`!!document.querySelector('.am [role=alert]')`), "error honesto sin motor");
    assert.match(await page.ev<string>(`document.querySelector('.am [role=alert]').textContent`), /no está configurado/);
    await page.ev(`document.querySelector('[aria-label="Cerrar la gestión del asistente"]').click()`);
    await page.send("Page.navigate", { url: `${srv.url}/?k=${loadOrCreateMobileKey(v.root)}#/asistente` });
    await until(() => page!.ev<boolean>(`localStorage.getItem('role') === 'mobile'`), "rol móvil");
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "k", code: "KeyK", modifiers: 2 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "k", code: "KeyK", modifiers: 2 });
    await until(() => page!.ev<boolean>(`!!document.querySelector('.palette')`), "lanzador móvil");
    assert.equal(await page.ev<boolean>(`[...document.querySelectorAll('.plist li')].some(x => x.textContent === 'Modelo de Hermes')`), false);
  } finally {
    await page?.close(); await srv.close(); j.close(); v.cleanup(); rmSync(profile, { recursive: true, force: true });
  }
});

test("conversación en capas: menú y cabecera en móvil", { skip: browserSkip, timeout: 60_000 }, async () => {
  const v = tmpVault();
  const j = await Kioku.open({ root: v.root });
  const srv = await startServer(j, { port: 0, webDir: WEB, key: "b".repeat(64), assistant: { engine: { isolatesMobile: true, available: async () => ({ ok: true }), ask: async () => ({ answer: "Respuesta" }) } } });
  const profile = mkdtempSync(path.join(tmpdir(), "kioku-layered-browser-"));
  let page: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    page = await launch(profile);
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
    await page.send("Page.navigate", { url: `${srv.url}/?k=${loadOrCreateMobileKey(v.root)}#/asistente` });
    await until(() => page!.ev<boolean>(`!!document.querySelector('.assistant-page')`), "asistente");
    assert.equal(await page.ev<string>(`document.querySelector('.assistant-page h1')?.textContent`), "Kioku");
    assert.equal(await page.ev<boolean>(`!!document.querySelector('[aria-label="Conversaciones"]')`), true);
    await page.ev(`document.querySelector('[aria-label="Conversaciones"]').click()`);
    assert.match(await page.ev<string>(`document.querySelector('.assistant-menu').textContent`), /Nueva conversación/);
    assert.match(await page.ev<string>(`document.querySelector('.assistant-menu').textContent`), /Actividad/);
    assert.equal(await page.ev<boolean>(`document.documentElement.scrollWidth <= innerWidth`), true);
  } finally {
    await page?.close(); await srv.close(); j.close(); v.cleanup(); rmSync(profile, { recursive: true, force: true });
  }
});

test("la franja revisa una propuesta real y cancelar no toca la nota", { skip: browserSkip, timeout: 60_000 }, async () => {
  const v = tmpVault();
  const j = await Kioku.open({ root: v.root });
  const note = await j.createNote({ title: "Nota de prueba", body: "Contenido intacto" });
  const srv = await startServer(j, { port: 0, webDir: WEB, key: "b".repeat(64), assistant: { engine: {
    isolatesMobile: true, available: async () => ({ ok: true }), ask: async (i) => {
      const result = await fetch(`${i.daemonUrl}/api/assistant/tools/call`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${i.session.token}` }, body: JSON.stringify({ name: "propose", args: { title: "Descartar nota", rationale: "Prueba", ops: [{ op: "trash", path: note.path }] } }) });
      assert.equal(result.status, 200);
      return { answer: "Propuesta preparada" };
    },
  } } });
  const profile = mkdtempSync(path.join(tmpdir(), "kioku-layered-proposal-"));
  let page: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    page = await launch(profile);
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
    await page.send("Page.navigate", { url: `${srv.url}/?k=${loadOrCreateMobileKey(v.root)}#/asistente` });
    await until(() => page!.ev<boolean>(`!!document.querySelector('.notice-card button')`), "aviso");
    await page.ev(`document.querySelector('.notice-card button').click()`);
    await page.ev(`(() => { const el = document.querySelector('.composer textarea'); el.value = 'Proponer'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await until(() => page!.ev<boolean>(`!document.querySelector('.composer button').disabled`), "enviar");
    await page.ev(`document.querySelector('.composer button').click()`);
    await until(() => page!.ev<boolean>(`!!document.querySelector('.assistant-dock button')`), "franja de propuesta");
    assert.equal(await page.ev<boolean>(`(() => {const d = document.querySelector('.assistant-dock').getBoundingClientRect(); const c = document.querySelector('.composer').getBoundingClientRect(); const n = document.querySelector('.bottomnav').getBoundingClientRect(); return d.bottom <= c.top + 2 && c.bottom <= n.top + 2 && d.left >= 0 && d.right <= innerWidth})()`), true);
    assert.equal(await page.ev<boolean>(`(() => { const c = document.querySelector('.composer').getBoundingClientRect(); const n = document.querySelector('.bottomnav').getBoundingClientRect(); return Math.abs(c.bottom - n.top) <= 18; })()`), true, "el compositor debe quedar junto a la navegación, sin un hueco vacío");
    await page.ev(`document.querySelector('.assistant-dock button').click()`);
    await until(() => page!.ev<boolean>(`!!document.querySelector('.assistant-review [role=dialog]')`), "revisión");
    assert.match(await page.ev<string>(`document.querySelector('.assistant-review').textContent`), /Descartar nota/);
    await page.ev(`document.querySelector('.assistant-review .primary').click()`);
    await until(() => page!.ev<boolean>(`!!document.querySelector('[role=alertdialog]')`), "confirmación");
    await page.ev(`[...document.querySelectorAll('[role=alertdialog] button')].find(x => x.textContent === 'Cancelar').click()`);
    assert.match((await j.vault.read(note.path)).text, /Contenido intacto/);
    await page.ev(`document.querySelector('.assistant-review .primary').click()`);
    await until(() => page!.ev<boolean>(`!!document.querySelector('[role=alertdialog] .danger-solid')`), "confirmación otra vez");
    await page.ev(`document.querySelector('[role=alertdialog] .danger-solid').click()`);
    await until(async () => !(await page!.ev<boolean>(`!!document.querySelector('.assistant-review .primary')`)), "aplicada");
    await assert.rejects(j.vault.read(note.path));
  } finally {
    await page?.close(); await srv.close(); j.close(); v.cleanup(); rmSync(profile, { recursive: true, force: true });
  }
});

test("ruta de propuestas de escritorio conserva la vista de operaciones y aplicar", { skip: browserSkip, timeout: 60_000 }, async () => {
  const v = tmpVault();
  const j = await Kioku.open({ root: v.root });
  await j.createProposal({ source: "rules", title: "Crear nota", rationale: "Prueba", ops: [{ op: "create", path: "Notas/Capa.md", text: "Contenido de prueba" }] });
  const srv = await startServer(j, { port: 0, webDir: WEB, key: "b".repeat(64) });
  const profile = mkdtempSync(path.join(tmpdir(), "kioku-layered-desktop-"));
  let page: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    page = await launch(profile);
    await page.send("Page.navigate", { url: `${srv.url}/?k=${"b".repeat(64)}#/propuestas` });
    await until(() => page!.ev<boolean>(`!!document.querySelector('.proposal-actions .primary')`), "propuesta de escritorio");
    assert.match(await page.ev<string>(`document.querySelector('.op').textContent`), /Notas\/Capa.md/);
    await page.ev(`document.querySelector('.proposal-actions .primary').click()`);
    await until(() => page!.ev<boolean>(`!document.querySelector('.proposal-actions')`), "aplicada en escritorio");
    assert.match((await j.vault.read("Notas/Capa.md")).text, /Contenido de prueba/);
  } finally {
    await page?.close(); await srv.close(); j.close(); v.cleanup(); rmSync(profile, { recursive: true, force: true });
  }
});
