import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheableRead, isShell, shellCacheName, API_CACHE, READ_TIMEOUT_MS } from "../web/src/sw-rules.ts";

test("cacheableRead: lecturas de datos sí; eventos, salud, asistente, propuestas, IA y escrituras no", () => {
  for (const p of ["/api/today", "/api/note", "/api/sync/manifest", "/api/sync/notes", "/api/tasks"]) assert.equal(cacheableRead("GET", p), true, p);
  for (const p of ["/api/events", "/api/health", "/api/assistant/status", "/api/assistant", "/api/proposals", "/api/proposals/ABC/apply", "/api/ai", "/api/ai/models"]) assert.equal(cacheableRead("GET", p), false, p);
  assert.equal(cacheableRead("POST", "/api/capture"), false);
  assert.equal(cacheableRead("PUT", "/api/note"), false);
  assert.equal(cacheableRead("GET", "/app.js"), false);
  assert.equal(cacheableRead("GET", "/apix"), false);
});

test("isShell: estáticos GET sí; la API y las escrituras no", () => {
  assert.equal(isShell("GET", "/app.js"), true);
  assert.equal(isShell("GET", "/"), true);
  assert.equal(isShell("GET", "/api/x"), false);
  assert.equal(isShell("POST", "/"), false);
});

test("constantes y nombre de la caché del shell", () => {
  assert.equal(shellCacheName("abc"), "kioku-shell-abc");
  assert.equal(API_CACHE, "kioku-api");
  assert.equal(READ_TIMEOUT_MS, 3000);
});
