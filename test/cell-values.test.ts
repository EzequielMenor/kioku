import { test } from "node:test";
import assert from "node:assert/strict";
import { laneValue, misfit, parseValue, relationValue, safeHref } from "../web/src/cell-values.ts";

test("parseValue: conserva ceros a la izquierda y decimales finales como texto", () => {
  assert.equal(parseValue("007"), "007");
  assert.equal(parseValue("1.10"), "1.10");
  assert.equal(parseValue("9788"), 9788);
  assert.equal(parseValue("-3.5"), -3.5);
  assert.equal(parseValue("true"), true);
  assert.equal(parseValue("  "), null);
});

test("laneValue: mover una tarjeta a «true» o «8» escribe casilla y número, no texto", () => {
  assert.equal(laneValue("checkbox", "true"), true);
  assert.equal(laneValue("checkbox", "false"), false);
  assert.equal(laneValue("number", "8"), 8);
  assert.equal(laneValue("select", "Leyendo"), "Leyendo");
  assert.equal(laneValue("select", ""), "");
});

test("relationValue: una lista de enlaces sigue siendo lista tras editarla", () => {
  assert.deepEqual(relationValue("[[A]], [[B]], [[C]]", ["[[A]]", "[[B]]"]), ["[[A]]", "[[B]]", "[[C]]"]);
  assert.equal(relationValue("[[A]]", "[[B]]"), "[[A]]");
  assert.equal(relationValue("", ["[[A]]"]), "");
});

test("safeHref: solo http y https", () => {
  assert.equal(safeHref("https://ejemplo.org/x"), "https://ejemplo.org/x");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,<script>1</script>"), null);
  assert.equal(safeHref("no es una url"), null);
});

test("misfit: un valor que no encaja con el tipo de la columna se detecta; vacío y válidos no", () => {
  assert.equal(misfit("number", "300 aprox."), "No es un número");
  assert.equal(misfit("number", 300), null);
  assert.equal(misfit("number", "300"), null);
  assert.equal(misfit("number", Number.NaN), "No es un número");
  assert.equal(misfit("number", true), "No es un número");
  assert.equal(misfit("number", ""), null);
  assert.equal(misfit("number", null), null);
  assert.equal(misfit("date", "2026-10-27"), null);
  assert.equal(misfit("date", "2026-10-27T10:30"), null);
  assert.equal(misfit("date", "mañana"), "No es una fecha");
  assert.equal(misfit("date", "2026-13-40"), "No es una fecha");
  assert.equal(misfit("date", 20261027), "No es una fecha");
  assert.equal(misfit("checkbox", true), null);
  assert.equal(misfit("checkbox", false), null);
  assert.equal(misfit("checkbox", "sí"), "No es un valor sí/no");
  assert.equal(misfit("checkbox", undefined), null);
  assert.equal(misfit("text", 5), null);
  assert.equal(misfit("select", "otra"), null);
  assert.equal(misfit("multi", ["a"]), null);
});
