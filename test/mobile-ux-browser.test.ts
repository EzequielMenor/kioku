// Experiencia móvil en un Chromium real (390 px, rol móvil): lo que un usuario nota al usar la app con el pulgar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { startServer } from "../src/server/server.ts";
import { WEB, browserSkip, launch, sleep, until } from "./cdp.ts";
import { tmpVault } from "./helpers.ts";

const KEY = "d".repeat(64);

async function openMobile(route: string) {
  const { root, cleanup } = tmpVault();
  const j = await Kioku.open({ root });
  const today = new Date().toISOString().slice(0, 10);
  const proj = await j.createProject("Reforma del piso");
  await j.createTask({ title: "Llamar al fontanero", due: today, projectPath: proj.path });
  await j.calendar.create({ id: "evento-ux-0001", title: "Tutoría con Marta", kind: "event", start: `${today}T10:00`, end: `${today}T11:00` });
  const srv = await startServer(j, { port: 0, webDir: WEB, key: KEY });
  const p = await launch(mkdtempSync(path.join(tmpdir(), "kioku-ux-")));
  await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
  await p.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await p.send("Page.navigate", { url: `${srv.url}/?k=${loadOrCreateMobileKey(root)}#${route}` });
  return { p, done: async () => { await p.close(); await srv.close(); j.close(); cleanup(); } };
}

test("móvil · calendario: la cabecera es compacta y no tapa el contenido al desplazarse", { skip: browserSkip, timeout: 60_000 }, async () => {
  const t = await openMobile("/calendario");
  try {
    await until(() => t.p.ev<boolean>(`!!document.querySelector(".cal-gbody")`), "cuadrícula");
    const r = await t.p.ev<{ position: string; headH: number }>(`(() => { const h = document.querySelector(".cal .page-head"); return { position: getComputedStyle(h).position, headH: Math.round(h.getBoundingClientRect().height) }; })()`);
    assert.ok(r.position !== "sticky" && r.position !== "fixed", `la cabecera no se queda pegada (${r.position})`);
    assert.ok(r.headH <= 110, `cabecera compacta (${r.headH}px)`);
  } finally { await t.done(); }
});

test("móvil · formulario de tarea: Guardar queda a la vista sin desplazarse y los campos cortos van en dos columnas", { skip: browserSkip, timeout: 60_000 }, async () => {
  const t = await openMobile("/tareas");
  try {
    await until(() => t.p.ev<boolean>(`(() => { const a = document.querySelector(".ttitle"); if (a) a.click(); return !!document.querySelector(".task-dialog[open] .task-form-grid"); })()`), "formulario");
    await sleep(150);
    const r = await t.p.ev<{ saveBottom: number; inner: number; cols: number; sheet: boolean }>(`(() => { const d = document.querySelector(".task-dialog"); const s = d.querySelector("button.primary").getBoundingClientRect(); const g = d.querySelectorAll(".task-form-grid label"); return { saveBottom: Math.round(s.bottom), inner: innerHeight, cols: new Set([...g].map((l) => Math.round(l.getBoundingClientRect().left))).size, sheet: Math.round(d.getBoundingClientRect().bottom) === innerHeight }; })()`);
    assert.ok(r.saveBottom <= r.inner, "el botón principal cabe en la pantalla");
    assert.equal(r.cols, 2, "dos columnas");
    assert.ok(r.sheet, "hoja anclada abajo");
  } finally { await t.done(); }
});

test("móvil · Notas no lista las actividades del calendario como si fueran notas", { skip: browserSkip, timeout: 60_000 }, async () => {
  const t = await openMobile("/notas");
  try {
    await until(() => t.p.ev<boolean>(`!![...document.querySelectorAll(".rows a")].find((a) => /fontanero/.test(a.textContent))`), "lista de notas");
    assert.equal(await t.p.ev<boolean>(`[...document.querySelectorAll(".rows a")].some((a) => /Tutoría/.test(a.textContent))`), false);
  } finally { await t.done(); }
});

test("móvil · Hoy muestra la agenda y completar una tarea ofrece deshacer", { skip: browserSkip, timeout: 60_000 }, async () => {
  const t = await openMobile("/hoy");
  try {
    await until(() => t.p.ev<boolean>(`!![...document.querySelectorAll(".agenda a")].find((a) => /Tutoría/.test(a.textContent))`), "agenda de hoy");
    await t.p.ev(`location.hash = "/tareas"`);
    await until(() => t.p.ev<boolean>(`!!document.querySelector(".task input[type=checkbox]")`), "tareas");
    await t.p.ev(`document.querySelector(".task input[type=checkbox]").click()`);
    const toast = await until(() => t.p.ev<string>(`document.querySelector(".toast")?.textContent ?? ""`), "aviso");
    assert.match(toast, /Hecha: Llamar al fontanero/);
    assert.match(toast, /Deshacer/);
    await t.p.ev(`document.querySelector(".toast button").click()`);
    await until(() => t.p.ev<boolean>(`!!document.querySelector(".task input[type=checkbox]:not(:checked)") && !document.querySelector(".toast")`), "tarea de nuevo pendiente");
  } finally { await t.done(); }
});

test("móvil · proyecto: la nota embebida no trae «Atrás» y las fechas de sus tareas son relativas", { skip: browserSkip, timeout: 60_000 }, async () => {
  const t = await openMobile("/proyectos");
  try {
    await until(() => t.p.ev<boolean>(`(() => { const b = [...document.querySelectorAll("a,button")].find((x) => /Reforma del piso/.test(x.textContent)); if (b) b.click(); return !!document.querySelector(".embedded .note-layout"); })()`), "proyecto");
    await until(() => t.p.ev<boolean>(`!!document.querySelector(".tasks .task")`), "tareas del proyecto");
    assert.equal(await t.p.ev<boolean>(`!!document.querySelector(".embedded .back")`), false, "sin «Atrás» dentro de la página del proyecto");
    assert.equal(await t.p.ev<boolean>(`!/\\d{4}-\\d{2}-\\d{2}/.test(document.querySelector(".tasks .task").textContent)`), true, "sin fecha ISO cruda");
  } finally { await t.done(); }
});

test("móvil · Buscar no muestra atajos de teclado", { skip: browserSkip, timeout: 60_000 }, async () => {
  const t = await openMobile("/hoy");
  try {
    await until(() => t.p.ev<boolean>(`!!document.querySelector(".bottomnav")`), "barra");
    await t.p.ev(`[...document.querySelectorAll(".bottomnav button")].pop().click()`);
    await until(() => t.p.ev<boolean>(`(() => { const b = document.querySelector(".sheet-list button"); if (b) b.click(); return !!document.querySelector(".palette"); })()`), "paleta");
    assert.equal(await t.p.ev<boolean>(`/\\bg [a-z]\\b/.test(document.querySelector(".palette").textContent)`), false);
  } finally { await t.done(); }
});
