import { test } from "node:test";
import assert from "node:assert/strict";
import { areaTextColor, areaLabel, filterAreas, validateArea, occupancy } from "../web/src/calendar-model.ts";
import type { CalendarEntry } from "../web/src/types.ts";
import { readFileSync } from "node:fs";

test("el texto de una insignia contrasta con colores claros y oscuros", () => {
  assert.equal(areaTextColor("#ffffff"), "#000000");
  assert.equal(areaTextColor("#000000"), "#ffffff");
  assert.equal(areaTextColor("#ff0000"), "#000000");
  assert.equal(areaTextColor("#0000ff"), "#ffffff");
});

const item = (over: Partial<CalendarEntry> = {}): CalendarEntry => ({
  path: "Calendario/a.md", title: "Actividad", kind: "block", hash: "h", state: "pending",
  start: "2026-10-28T09:00", end: "2026-10-28T10:00", taskPath: null,
  projectPath: "Proyectos/p.md", projectTitle: "Proyecto", ...over,
});

test("etiquetas y filtro usan el área, nunca el proyecto", () => {
  const a = item({ areaPath: "Areas/a.md", areaTitle: "Estudio", areaColor: "#ff0000" });
  const b = item({ path: "Calendario/b.md", kind: "event" });
  assert.deepEqual(areaLabel(a), { key: "Areas/a.md", name: "Estudio", code: "E", color: "#ff0000" });
  assert.deepEqual(areaLabel(b), { key: "", name: "Sin área", code: "·", color: null });
  assert.deepEqual(filterAreas([a, b], null), [a, b]);
  assert.deepEqual(filterAreas([a, b], "Areas/a.md"), [a]);
  assert.deepEqual(filterAreas([a, b], ""), [b]);
  assert.deepEqual(filterAreas([a, b], "Proyectos/p.md"), []);
});

test("validación del nombre y color y normalización", () => {
  assert.equal(validateArea("  Estudio  ", "#AAbbCC"), true);
  for (const title of ["", " ", "a\nb", "a".repeat(61)]) assert.equal(validateArea(title, "#112233"), false);
  for (const color of ["#123", "#12345g", "112233", "#11223344"]) assert.equal(validateArea("Estudio", color), false);
  assert.equal(validateArea("a".repeat(60), "#000000"), true);
});

test("ocupación conserva posición y tipo, y transmite color también para eventos", () => {
  const block = item({ areaColor: "#123456" });
  const event = item({ path: "Calendario/b.md", kind: "event", areaColor: "#abcdef" });
  assert.deepEqual(occupancy([block, event], "2026-10-28").map((s) => [s.kind, s.color]), [["block", "#123456"], ["event", "#abcdef"]]);
});

test("la interfaz ofrece gestión y selección de áreas sin sustituir el proyecto", () => {
  const ui = readFileSync(new URL("../web/src/calendar.tsx", import.meta.url), "utf8");
  assert.match(ui, /Filtrar por área/);
  assert.match(ui, /\/api\/calendar\/areas\/create/);
  assert.match(ui, /\/api\/calendar\/areas\/update/);
  assert.match(ui, /\/api\/calendar\/area["']/);
  assert.match(ui, /type="color"/);
  assert.match(ui, /Sin área/);
  assert.match(ui, /Abrir proyecto/);
});
