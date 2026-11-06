// Verificación funcional de la interfaz móvil con Chromium y un motor de herramientas simulado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { startServer } from "../src/server/server.ts";
import type { AssistantEngine } from "../src/assistant/engine.ts";
import { WEB, browserSkip, launch, until } from "./cdp.ts";
import { tmpVault } from "./helpers.ts";

test("asistente móvil: conversar, revisar, cancelar y aprobar un cambio crítico; sin chat offline", { skip: browserSkip, timeout: 60_000 }, async () => {
  const v = tmpVault();
  const j = await Kioku.open({ root: v.root });
  const note = await j.createNote({ title: "Nota para organizar", body: "Texto original que no se reescribe." });
  let asks = 0;
  const engine: AssistantEngine = {
    isolatesMobile: true,
    available: async () => ({ ok: true }),
    ask: async (i) => {
      asks++;
      const r = await fetch(`${i.daemonUrl}/api/assistant/tools/call`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${i.session.token}` },
        body: JSON.stringify({ name: "propose", args: { title: "Descartar la nota", rationale: "Pedido de prueba", ops: [{ op: "trash", path: note.path }] } }),
      });
      assert.equal(r.status, 200);
      const result = await r.json() as { isError?: boolean };
      assert.ok(!result.isError);
      return { answer: "Propuesta lista. Todavía no cambié tu nota." };
    },
  };
  const srv = await startServer(j, { port: 0, webDir: WEB, key: "b".repeat(64), assistant: { engine } });
  const profile = mkdtempSync(path.join(tmpdir(), "kioku-assistant-browser-"));
  let p: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    p = await launch(profile);
    const page = p;
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
    await page.send("Page.navigate", { url: `${srv.url}/?k=${loadOrCreateMobileKey(v.root)}#/asistente` });
    await until(() => page.ev<boolean>(`!!document.querySelector('.notice-card button')`), "aviso de privacidad");
    assert.match(await page.ev<string>(`document.querySelector('.notice-card').textContent`), /proveedor que configuraste en Hermes/);
    await page.ev(`document.querySelector('.notice-card button').click()`);
    await until(() => page.ev<boolean>(`!document.querySelector('.composer textarea').disabled`), "chat habilitado");
    const fit = await page.ev<boolean>(`(() => { const c = document.querySelector('.composer').getBoundingClientRect(); const n = document.querySelector('.bottomnav').getBoundingClientRect(); return c.bottom <= n.top + 2 && c.left >= 0 && c.right <= innerWidth; })()`);
    assert.ok(fit, "el compositor cabe y no queda debajo de la navegación móvil");
    await page.ev(`(() => { const el = document.querySelector('.composer textarea'); el.value = 'Proponé descartar esta nota'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await until(() => page.ev<boolean>(`!document.querySelector('.composer button').disabled`), "enviar habilitado");
    await page.ev(`document.querySelector('.composer button').click()`);
    await until(() => page.ev<boolean>(`document.body.textContent.includes('Propuesta lista. Todavía no cambié tu nota.')`), "respuesta");
    assert.equal(asks, 1);
    assert.match((await j.vault.read(note.path)).text, /Texto original/);
    assert.equal(await page.ev<boolean>(`!!document.querySelector('a[href="#/asistente/memoria"]')`), false);
    await page.ev(`location.hash = '/propuestas'`);
    await until(() => page.ev<boolean>(`!!document.querySelector('.proposal-actions .primary')`), "propuesta pendiente");
    await page.ev(`document.querySelector('.proposal-actions .primary').click()`);
    await until(() => page.ev<boolean>(`!!document.querySelector('[role=alertdialog]')`), "confirmación crítica");
    await page.ev(`[...document.querySelectorAll('[role=alertdialog] button')].find(b => b.textContent === 'Cancelar').click()`);
    await until(() => page.ev<boolean>(`!document.querySelector('[role=alertdialog]')`), "cancelación");
    assert.match((await j.vault.read(note.path)).text, /Texto original/);
    await page.ev(`document.querySelector('.proposal-actions .primary').click()`);
    await until(() => page.ev<boolean>(`!!document.querySelector('[role=alertdialog] .danger-solid')`), "confirmar de nuevo");
    await page.ev(`document.querySelector('[role=alertdialog] .danger-solid').click()`);
    await until(() => page.ev<boolean>(`!document.querySelector('.proposal-actions')`), "propuesta aplicada");
    await assert.rejects(j.vault.read(note.path));
    await page.ev(`location.hash = '/asistente'`);
    await until(() => page.ev<boolean>(`!!document.querySelector('.composer')`), "volver al chat");
    await page.send("Network.enable");
    await page.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await until(() => page.ev<boolean>(`document.querySelector('.composer textarea').disabled && document.body.textContent.includes('Sin conexión con tu portátil')`), "chat bloqueado sin conexión");
    assert.equal(asks, 1, "no se reenvía ni se encola la pregunta");
  } finally {
    await p?.close();
    await srv.close(); j.close(); v.cleanup(); rmSync(profile, { recursive: true, force: true });
  }
});
