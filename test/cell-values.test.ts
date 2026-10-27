import { test } from "node:test";
import assert from "node:assert/strict";
import { laneValue, parseValue, relationValue, safeHref } from "../web/src/cell-values.ts";

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
