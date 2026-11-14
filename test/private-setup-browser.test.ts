import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { tmpVault } from "./helpers.ts";
import { WEB, browserSkip, launch, until } from "./cdp.ts";

test("private setup UI: confirm Tailscale, create local QR, enroll by name and revoke individually", { skip: browserSkip, timeout: 60_000 }, async () => {
  const v = tmpVault();
  const j = await Kioku.open({ root: v.root });
  const host = "mac.example.ts.net";
  let port = 0;
  let serve = {};
  const connectionRunner = async (args: string[]) => {
    if (args[0] === "status") return JSON.stringify({ BackendState: "Running", Self: { DNSName: host + "." } });
    if (args[1] === "status") return JSON.stringify(serve);
    serve = { TCP: { "443": { HTTPS: true } }, Web: { [host + ":443"]: { Handlers: { "/": { Proxy: `http://127.0.0.1:${port}` } } } } };
    return "";
  };
  const srv = await startServer(j, { port: 0, webDir: WEB, key: "a".repeat(64), connectionRunner });
  port = srv.port;
  const profile = mkdtempSync(path.join(os.tmpdir(), "kioku-private-ui-"));
  let page: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    page = await launch(profile);
    await page.send("Page.navigate", { url: `${srv.url}/?k=${srv.key}#/conexiones` });
    await until(() => page!.ev<boolean>(`!!document.querySelector('[data-private-setup]')`), "panel privado");
    await until(() => page!.ev<boolean>(`!!document.querySelector('[data-configure-private]:not(:disabled)')`), "configuración disponible");
    await page.ev(`document.querySelector('[data-configure-private]').click()`);
    await until(() => page!.ev<boolean>(`!!document.querySelector('[role=alertdialog]')`), "confirmación de red");
    await page.ev(`document.querySelector('[role=alertdialog] .primary').click()`);
    await until(() => page!.ev<boolean>(`!!document.querySelector('[data-enroll-device]:not(:disabled)')`), "añadir dispositivo");
    await page.ev(`document.querySelector('[data-enroll-device]').click()`);
    await until(() => page!.ev<boolean>(`!!document.querySelector('[aria-label="Código QR de conexión"] svg')`), "QR local");
    const link = await page.ev<string>(`document.querySelector('[aria-label="Enlace de conexión"]').value`);
    assert.match(link, /^https:\/\/mac\.example\.ts\.net\/#\/vincular\/[0-9a-f]{64}$/);
    assert.equal(await page.ev<boolean>(`!!document.querySelector('[aria-label="Código QR de conexión"] image')`), false);
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
    await page.send("Page.navigate", { url: srv.url + "/" + new URL(link).hash });
    await until(() => page!.ev<boolean>(`!!document.querySelector('[data-device-enrollment]')`), "confirmar nombre");
    await page.ev(`(() => { const input = document.querySelector('[aria-label="Nombre del dispositivo"]'); input.value = 'iPhone de prueba'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert.equal(await page.ev<boolean>(`document.documentElement.scrollWidth <= innerWidth`), true);
    await page.ev(`document.querySelector('[data-device-enrollment] button[type=submit]').click()`);
    await until(() => page!.ev<boolean>(`localStorage.getItem('role') === 'mobile'`), "credencial móvil");
    await page.send("Page.navigate", { url: `${srv.url}/?k=${srv.key}#/conexiones` });
    await until(() => page!.ev<boolean>(`document.querySelector('[data-device-list]')?.textContent.includes('iPhone de prueba')`), "inventario");
    await page.ev(`document.querySelector('[data-device-list] button').click()`);
    await until(() => page!.ev<boolean>(`!!document.querySelector('[role=alertdialog] .danger-solid')`), "confirmación de revocación");
    await page.ev(`document.querySelector('[role=alertdialog] .danger-solid').click()`);
    await until(() => page!.ev<boolean>(`document.querySelector('[data-device-list]')?.textContent.includes('Todavía no hay dispositivos')`), "revocado");
    await page.send("Page.navigate", { url: srv.url + "/" + new URL(link).hash });
    await until(() => page!.ev<boolean>(`!!document.querySelector('[data-device-enrollment]')`), "enlace usado");
    await page.ev(`document.querySelector('[data-device-enrollment] button[type=submit]').click()`);
    await until(() => page!.ev<boolean>(`!!document.querySelector('[data-device-enrollment] [role=alert]')`), "error de un uso");
    assert.match(await page.ev<string>(`document.querySelector('[data-device-enrollment] [role=alert]').textContent`), /caducado|usó/);
    // Carga en frío del mismo enlace (sin app previa) sigue mostrando la pantalla de vinculación, y salir del enlace devuelve a la app.
    await page.send("Page.navigate", { url: "about:blank" });
    await page.send("Page.navigate", { url: srv.url + "/" + new URL(link).hash });
    await until(() => page!.ev<boolean>(`!!document.querySelector('[data-device-enrollment]')`), "enlace en carga fría");
    await page.ev(`location.hash = '#/conexiones'`);
    await until(() => page!.ev<boolean>(`!document.querySelector('[data-device-enrollment]') && !!document.querySelector('[data-private-setup]')`), "salida del enlace");
  } finally { await page?.close(); await srv.close(); j.close(); v.cleanup(); rmSync(profile, { recursive: true, force: true }); }
});
