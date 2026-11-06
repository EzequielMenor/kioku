import { test } from "node:test";
import assert from "node:assert/strict";
import { activityOrigin, ASSISTANT_OFFLINE, askErrorText, createChat } from "../web/src/assistant-chat.ts";

const deferred = <T>() => {
  let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const mk = (ask: () => Promise<{ answer: string; reads: string[]; actions: never[] }>) =>
  createChat({ ask, pendingProposals: async () => [], actionsSince: async () => [] });

test("chat: una vista que se suscribe tras enviar ve el estado ocupado y recibe la respuesta", async () => {
  const d = deferred<{ answer: string; reads: string[]; actions: never[] }>();
  const chat = mk(() => d.promise);
  const first: unknown[] = [];
  const unsubFirst = chat.subscribe((s) => first.push(s));
  const sending = chat.send("hola");
  unsubFirst(); // el usuario cambia de pestaña: la vista se desmonta
  const late: ReturnType<typeof chat.getState>[] = [];
  chat.subscribe((s) => late.push(s)); // y vuelve: vista nueva
  assert.equal(chat.getState().busy, true, "la vista nueva ve que sigue respondiendo");
  d.resolve({ answer: "Tienes 2 capturas", reads: [], actions: [] });
  await sending;
  const last = late.at(-1)!;
  assert.equal(last.busy, false);
  assert.equal(last.live, null);
  assert.deepEqual(last.msgs.map((m) => m.role + ":" + m.text), ["user:hola", "assistant:Tienes 2 capturas"]);
});

test("chat: un fallo del motor se muestra como mensaje de error y libera el estado", async () => {
  const d = deferred<{ answer: string; reads: string[]; actions: never[] }>();
  const chat = mk(() => d.promise);
  const sending = chat.send("hola");
  d.reject(new Error("sin conexión"));
  await sending;
  const s = chat.getState();
  assert.equal(s.busy, false);
  assert.equal(s.msgs.at(-1)?.error, true);
  assert.equal(s.msgs.at(-1)?.text, "sin conexión");
});

test("chat: no envía vacío ni mientras responde; reset empieza una conversación nueva", async () => {
  const d = deferred<{ answer: string; reads: string[]; actions: never[] }>();
  let calls = 0;
  const chat = mk(() => { calls++; return d.promise; });
  await chat.send("   ");
  const p = chat.send("uno");
  await chat.send("dos"); // ignorado: ya está respondiendo
  d.resolve({ answer: "ok", reads: [], actions: [] });
  await p;
  assert.equal(calls, 1);
  const conv = chat.conversation();
  chat.reset();
  assert.deepEqual(chat.getState().msgs, []);
  assert.notEqual(chat.conversation(), conv);
});

test("chat: el indicador en vivo lo fija el motor mientras responde y se apaga al terminar", async () => {
  const d = deferred<{ answer: string; reads: string[]; actions: never[] }>();
  const chat = mk(() => d.promise);
  const p = chat.send("hola");
  assert.equal(chat.getState().live, "Pensando…");
  chat.setLive("Revisando tu Bandeja…");
  assert.equal(chat.getState().live, "Revisando tu Bandeja…");
  d.resolve({ answer: "ok", reads: [], actions: [] });
  await p;
  assert.equal(chat.getState().live, null);
  chat.setLive("ignorado fuera de una consulta");
  assert.equal(chat.getState().live, null);
});

test("activityOrigin: los cambios hechos desde la tabla (sesión «ui») se distinguen de los del asistente", () => {
  const rec = (sessionId: string, tool: string) => ({ id: "x", ts: "", sessionId, tool, summary: "", files: [] });
  assert.equal(activityOrigin(rec("ui", "database.rename-property")), "Desde la tabla");
  assert.equal(activityOrigin(rec("s-123", "database.rename-property")), null, "una sesión del asistente no lleva etiqueta");
  assert.equal(activityOrigin(rec("s-123", "move_note")), null);
});

test("chat: sin red el móvil explica que el asistente es solo en línea; el escritorio y los errores del daemon se muestran como antes", async () => {
  const offline = new TypeError("Failed to fetch");
  assert.equal(askErrorText(offline, true), ASSISTANT_OFFLINE);
  assert.equal(askErrorText(offline, false), "Failed to fetch");
  assert.equal(askErrorText(new Error("503 sin motor"), true), "503 sin motor", "un error del daemon no se disfraza de falta de red");
  assert.match(ASSISTANT_OFFLINE, /no se ha guardado/);
  const d = deferred<{ answer: string; reads: string[]; actions: never[] }>();
  const chat = createChat({ ask: () => d.promise, pendingProposals: async () => [], actionsSince: async () => [], describeError: (e) => askErrorText(e, true) });
  const sending = chat.send("hola");
  d.reject(offline);
  await sending;
  assert.deepEqual(chat.getState().msgs.map((m) => [m.role, m.error ?? false, m.text]), [["user", false, "hola"], ["assistant", true, ASSISTANT_OFFLINE]]);
  assert.equal(chat.getState().busy, false);
});
