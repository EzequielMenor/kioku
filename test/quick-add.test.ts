import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuickAdd } from "../src/core/quick-add.ts";

const NOW = new Date("2026-10-28T10:20:00"); // miércoles
const ok = (text: string) => {
  const r = parseQuickAdd(text, NOW);
  assert.ok(r.ok, `${text}: ${r.ok ? "" : r.error}`);
  return r.ok ? [r.title, r.start, r.end] : [];
};
const fail = (text: string) => { const r = parseQuickAdd(text, NOW); assert.equal(r.ok, false, text); return r.ok ? "" : r.error; };

test("texto natural: día relativo y rango de horas", () => {
  assert.deepEqual(ok("gym mañana 18-19"), ["gym", "2026-10-29T18:00", "2026-10-29T19:00"]);
  assert.deepEqual(ok("Gym hoy 18:30-19:45"), ["Gym", "2026-10-28T18:30", "2026-10-28T19:45"]);
  assert.deepEqual(ok("revisión pasado mañana de 9 a 10"), ["revisión", "2026-10-30T09:00", "2026-10-30T10:00"]);
  assert.deepEqual(ok("yoga 7h-8h30 mañana"), ["yoga", "2026-10-29T07:00", "2026-10-29T08:30"]);
});

test("texto natural: día de la semana (siempre el próximo, nunca hoy) y fechas", () => {
  assert.deepEqual(ok("dentista lunes 10:30-11:15"), ["dentista", "2026-11-02T10:30", "2026-11-02T11:15"]);
  assert.deepEqual(ok("reunión el viernes de 9 a 10"), ["reunión", "2026-10-30T09:00", "2026-10-30T10:00"]);
  assert.equal(ok("clase miércoles 10-11")[1], "2026-11-04T10:00", "mismo día de la semana = la semana que viene");
  assert.deepEqual(ok("estudiar 2026-11-05 20:00 90min"), ["estudiar", "2026-11-05T20:00", "2026-11-05T21:30"]);
  assert.equal(ok("gym 3/11 18-19")[1], "2026-11-03T18:00");
  assert.equal(ok("cena 5 de noviembre 21:00")[1], "2026-11-05T21:00");
  assert.equal(ok("fiesta 2/10 20-22")[1], "2027-10-02T20:00", "una fecha ya pasada este año es la del año que viene");
});

test("texto natural: hora suelta con duración (por defecto 1 h) y sin día = hoy", () => {
  assert.deepEqual(ok("comida hoy a las 14 1h30"), ["comida", "2026-10-28T14:00", "2026-10-28T15:30"]);
  assert.deepEqual(ok("llamar a Ana pasado mañana 17h"), ["llamar a Ana", "2026-10-30T17:00", "2026-10-30T18:00"]);
  assert.deepEqual(ok("leer 21:00 30 min"), ["leer", "2026-10-28T21:00", "2026-10-28T21:30"]);
  assert.deepEqual(ok("Entrega 2 informes mañana 18-19"), ["Entrega 2 informes", "2026-10-29T18:00", "2026-10-29T19:00"]);
});

test("texto natural: errores claros, sin adivinar", () => {
  assert.match(fail("gym mañana"), /hora/);
  assert.match(fail("mañana 18-19"), /título/);
  assert.match(fail(""), /título|hora/);
  assert.match(fail("gym mañana 25-26"), /hora/);
  assert.match(fail("gym mañana 19-18"), /fin/);
  assert.match(fail("gym mañana 90min"), /hora/);
});
