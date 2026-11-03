// La hoja de un evento en un Chromium real: la hora cabe en su campo y, en el móvil, la hoja se desplaza sin arrastrar lo de detrás.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { WEB, browserSkip, launch, sleep, until } from "./cdp.ts";
import { tmpVault } from "./helpers.ts";

const KEY = "d".repeat(64);

async function openEditSheet(device: "mobile" | "desktop") {
  const { root, cleanup } = tmpVault();
  const j = await Kioku.open({ root });
  const today = new Date().toISOString().slice(0, 10);
  await j.calendar.create({ id: "evento-hoja-001", title: "Evento de prueba", kind: "event", start: `${today}T10:00`, end: `${today}T11:00` });
  const srv = await startServer(j, { port: 0, webDir: WEB, key: KEY });
  const p = await launch(mkdtempSync(path.join(tmpdir(), "kioku-sheet-")));
  const size = device === "mobile" ? { width: 390, height: 664, deviceScaleFactor: 3, mobile: true } : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };
  await p.send("Emulation.setDeviceMetricsOverride", size);
  if (device === "mobile") await p.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await p.send("Page.navigate", { url: `${srv.url}/?k=${KEY}#/calendario` });
  await until(() => p.ev<boolean>(`!!document.querySelector(".cal")`), "calendario");
  await until(() => p.ev<boolean>(`(() => { const b = [...document.querySelectorAll("button, a, [role=button]")].find((e) => /Evento de prueba/.test(e.textContent)); if (b) b.click(); return !!document.querySelector(".cal-sheet"); })()`), "hoja del evento");
  await until(() => p.ev<boolean>(`(() => { const b = [...document.querySelectorAll(".cal-sheet button")].find((e) => e.textContent.trim() === "Editar"); if (b) b.click(); return !!document.querySelector(".cal-sheet .cal-dt input[type=text]"); })()`), "formulario de edición");
  await sleep(200);
  return { p, done: async () => { await p.close(); await srv.close(); j.close(); cleanup(); } };
}

for (const device of ["desktop", "mobile"] as const) {
  test(`hoja del evento (${device}): la hora de 24 h se ve entera en su campo`, { skip: browserSkip, timeout: 60_000 }, async () => {
    const t = await openEditSheet(device);
    try {
      const m = await t.p.ev<{ clientW: number; scrollW: number }[]>(`[...document.querySelectorAll(".cal-sheet .cal-dt input[type=text]")].map((i) => ({ clientW: i.clientWidth, scrollW: i.scrollWidth }))`);
      assert.ok(m.length >= 2, "inicio y fin");
      for (const x of m) assert.ok(x.scrollW <= x.clientW, `el texto (${x.scrollW}px) cabe en el campo (${x.clientW}px)`);
    } finally { await t.done(); }
  });
}

test("hoja del evento (móvil): se desplaza sin arrastrar lo de detrás y llega hasta el final", { skip: browserSkip, timeout: 60_000 }, async () => {
  const t = await openEditSheet("mobile");
  try {
    const s = await t.p.ev<{ overscroll: string; main: string; root: string; scrollable: boolean; reaches: boolean }>(`(() => {
      const m = document.querySelector(".cal-sheet");
      const last = [...m.querySelectorAll("button")].pop();
      m.scrollTop = m.scrollHeight;
      return { overscroll: getComputedStyle(m).overscrollBehaviorY, main: getComputedStyle(document.querySelector("main")).overflowY, root: getComputedStyle(document.querySelector("#root")).overflowY,
        scrollable: m.scrollHeight > m.clientHeight, reaches: last.getBoundingClientRect().bottom <= innerHeight };
    })()`);
    assert.equal(s.overscroll, "contain", "el scroll no se encadena al fondo");
    assert.equal(s.main, "hidden", "main no se mueve con la hoja abierta");
    assert.equal(s.root, "hidden", "#root no se mueve con la hoja abierta");
    assert.ok(s.scrollable && s.reaches, "se puede bajar hasta el último botón");
  } finally { await t.done(); }
});
