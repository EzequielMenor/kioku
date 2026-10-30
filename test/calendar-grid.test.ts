import { test } from "node:test";
import assert from "node:assert/strict";
import { SNAP, createRange, gridWindow, layoutDay, minuteToY, resizeRange, moveRange, yToMinute, type GridItem } from "../web/src/calendar-grid.ts";

const DAY = "2026-10-28";
const it = (path: string, from: string, to: string, over: Partial<GridItem> = {}): GridItem => ({ path, start: `${DAY}T${from}`, end: `${DAY}T${to}`, ...over });
const WIN = { from: 7 * 60, to: 22 * 60 };

test("ventana de la cuadrícula: 07–22 por defecto y se ensancha por horas enteras si hay actividades fuera", () => {
  assert.deepEqual(gridWindow([], DAY), WIN);
  assert.deepEqual(gridWindow([it("a", "09:00", "10:00")], DAY), WIN);
  assert.deepEqual(gridWindow([it("a", "05:30", "06:10"), it("b", "22:15", "23:20")], DAY), { from: 5 * 60, to: 24 * 60 });
  assert.deepEqual(gridWindow([{ path: "c", start: "2026-10-27T20:00", end: `${DAY}T01:30` }], DAY), { from: 0, to: 22 * 60 }, "una que viene del día anterior llega hasta las 00:00");
});

test("disposición: posición, altura y columnas de las que se solapan", () => {
  const rows = layoutDay([it("a", "09:00", "10:30"), it("b", "10:00", "11:00"), it("c", "10:30", "11:30"), it("d", "13:00", "13:30")], DAY, WIN);
  const by = Object.fromEntries(rows.map((r) => [r.path, r]));
  assert.deepEqual([by.a.top, by.a.height], [120, 90]);
  assert.deepEqual([by.a.col, by.a.cols, by.b.col, by.b.cols], [0, 2, 1, 2]);
  assert.deepEqual([by.c.col, by.c.cols], [0, 2], "c cabe en la columna de a, que ya terminó");
  assert.deepEqual([by.d.col, by.d.cols], [0, 1], "las que no se solapan ocupan todo el ancho");
});

test("disposición: recorta lo que cruza medianoche y marca la continuación", () => {
  const rows = layoutDay([{ path: "n", start: "2026-10-27T23:00", end: `${DAY}T08:00` }, { path: "m", start: `${DAY}T23:00`, end: "2026-10-29T01:00" }, { path: "x", start: "2026-10-29T09:00", end: "2026-10-29T10:00" }], DAY, { from: 0, to: 24 * 60 });
  assert.equal(rows.length, 2, "lo de otro día no aparece");
  const n = rows.find((r) => r.path === "n")!, m = rows.find((r) => r.path === "m")!;
  assert.deepEqual([n.top, n.height, n.continued, n.continues], [0, 480, true, false]);
  assert.deepEqual([m.top, m.height, m.continued, m.continues], [1380, 60, false, true]);
});

test("las pequeñas conservan una altura mínima visible", () => {
  assert.equal(layoutDay([it("a", "09:00", "09:05")], DAY, WIN)[0].height, 15);
});

test("píxeles ↔ minutos con ajuste a 15 min y límites", () => {
  assert.equal(SNAP, 15);
  assert.equal(yToMinute(0, 1, WIN), 7 * 60);
  assert.equal(yToMinute(127, 1, WIN), 9 * 60, "127 min desde las 7:00 = 9:07 → 9:00 ajustado a 15");
  assert.equal(yToMinute(128, 1, WIN), 9 * 60 + 15);
  assert.equal(yToMinute(-50, 1, WIN), 7 * 60, "no sale por arriba");
  assert.equal(yToMinute(5000, 1, WIN), 22 * 60, "ni por abajo");
  assert.equal(yToMinute(60, 2, WIN), 7 * 60 + 30, "escala de 2 px por minuto");
  assert.equal(minuteToY(9 * 60, 2, WIN), 240);
});

test("crear arrastrando en un hueco; un clic sin arrastre crea una hora", () => {
  assert.deepEqual(createRange(DAY, 10 * 60, 11 * 60 + 30), { start: `${DAY}T10:00`, end: `${DAY}T11:30` });
  assert.deepEqual(createRange(DAY, 11 * 60 + 30, 10 * 60), { start: `${DAY}T10:00`, end: `${DAY}T11:30` }, "al revés da lo mismo");
  assert.deepEqual(createRange(DAY, 10 * 60, 10 * 60), { start: `${DAY}T10:00`, end: `${DAY}T11:00` });
  assert.deepEqual(createRange(DAY, 10 * 60, 10 * 60 + 15), { start: `${DAY}T10:00`, end: `${DAY}T10:30` }, "mínimo 30 min");
  assert.deepEqual(createRange(DAY, 23 * 60 + 30, 23 * 60 + 30), { start: `${DAY}T23:30`, end: `2026-10-29T00:00` }, "al final del día se corta en medianoche");
});

test("mover: desplaza inicio y fin juntos, ajustado y dentro del día", () => {
  const a = it("a", "10:00", "11:00");
  assert.deepEqual(moveRange(a, 37), { start: `${DAY}T10:30`, end: `${DAY}T11:30` });
  assert.deepEqual(moveRange(a, -12 * 60), { start: `${DAY}T00:00`, end: `${DAY}T01:00` }, "no pasa del principio del día");
  assert.deepEqual(moveRange(a, 20 * 60), { start: `${DAY}T23:00`, end: "2026-10-29T00:00" }, "ni del final");
  assert.deepEqual(moveRange(a, 0), { start: a.start, end: a.end });
});

test("redimensionar: borde inferior o superior, mínimo 15 min, sin cruzar el otro borde", () => {
  const a = it("a", "10:00", "11:00");
  assert.deepEqual(resizeRange(a, "end", 40), { start: a.start, end: `${DAY}T11:45` });
  assert.deepEqual(resizeRange(a, "end", -120), { start: a.start, end: `${DAY}T10:15` });
  assert.deepEqual(resizeRange(a, "start", -30), { start: `${DAY}T09:30`, end: a.end });
  assert.deepEqual(resizeRange(a, "start", 120), { start: `${DAY}T10:45`, end: a.end });
  assert.deepEqual(resizeRange(a, "end", 24 * 60), { start: a.start, end: "2026-10-29T00:00" });
});
