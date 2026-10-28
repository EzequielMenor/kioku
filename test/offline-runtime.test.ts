import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAgo } from "../web/src/offline/runtime.ts";

const T = 1_700_000_000_000;
const MIN = 60_000, H = 60 * MIN, D = 24 * H;

test("formatAgo: ahora, minutos, horas y días", () => {
  assert.equal(formatAgo(T - 30_000, T), "ahora");
  assert.equal(formatAgo(T - 5 * MIN, T), "hace 5 min");
  assert.equal(formatAgo(T - 2 * H, T), "hace 2 h");
  assert.equal(formatAgo(T - 3 * D, T), "hace 3 d");
});

test("formatAgo: un valor futuro (reloj desajustado) se lee «ahora»", () => {
  assert.equal(formatAgo(T + 10 * MIN, T), "ahora");
});

test("formatAgo: en los límites pasa a la unidad siguiente", () => {
  assert.equal(formatAgo(T - 59_999, T), "ahora");
  assert.equal(formatAgo(T - MIN, T), "hace 1 min");
  assert.equal(formatAgo(T - 59 * MIN, T), "hace 59 min");
  assert.equal(formatAgo(T - H, T), "hace 1 h");
  assert.equal(formatAgo(T - D, T), "hace 1 d");
});
