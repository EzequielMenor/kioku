import { test } from "node:test";
import assert from "node:assert/strict";
import { destination, recentKioActions, savedText } from "../web/src/kio-route.ts";

test("caja única: con Kio listo le llega a él; sin Kio se guarda en «Sin organizar»; sin red en el móvil, en la cola", () => {
  assert.equal(destination({ kioReady: true, mobile: false, online: true }), "kio");
  assert.equal(destination({ kioReady: false, mobile: false, online: true }), "capture", "sin modelo nada se pierde");
  assert.equal(destination({ kioReady: true, mobile: true, online: true }), "kio");
  assert.equal(destination({ kioReady: true, mobile: true, online: false }), "queue", "sin red el móvil lo guarda y lo envía al volver");
  assert.equal(destination({ kioReady: false, mobile: true, online: true }), "queue", "el móvil siempre usa su cola para capturar");
  assert.equal(destination({ kioReady: null, mobile: false, online: true }), "capture", "mientras se comprueba, mejor guardar que esperar");
  assert.match(savedText("queue"), /Sin organizar/);
  assert.match(savedText("capture"), /Kio lo ordenará/);
});

test("Hoy · lo último de Kio: solo lo suyo (no la tabla), sin deshacer, de las últimas 48 h, como mucho tres y lo más reciente arriba", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  const rec = (id: string, hoursAgo: number, extra: Record<string, unknown> = {}) => ({ id, ts: new Date(now - hoursAgo * 3_600_000).toISOString(), sessionId: "s", tool: "create_note", summary: id, files: [], ...extra });
  const list = [rec("a", 1), rec("b", 2, { undone: true }), rec("c", 3, { sessionId: "ui", tool: "database.rename-property" }), rec("d", 5), rec("e", 50), rec("f", 0.5), rec("g", 4)];
  assert.deepEqual(recentKioActions(list as never, now).map((r) => r.id), ["f", "a", "g"]);
});
