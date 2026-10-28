import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../web/src/offline/store.ts";
import { CaptureQueue, SendError, backoffMs } from "../web/src/offline/queue.ts";
import { isRetryable, submitCapture } from "../web/src/offline/capture.ts";
import { ApiError } from "../web/src/api.ts";
import type { CaptureResult } from "../web/src/types.ts";

const RESULT = { kind: "inbox", path: "Bandeja/x.md", message: "ok", parked: false, warnings: [] } as unknown as CaptureResult;
let seq = 0;
const newId = () => `id-${String(++seq).padStart(8, "0")}`;

test("flush: envía en orden de creación y borra lo enviado", async () => {
  const q = new CaptureQueue(new MemoryStore(), newId);
  await q.add("uno"); await q.add("dos"); await q.add("tres");
  const sent: string[] = [];
  const r = await q.flush(async (c) => { sent.push(c.text); });
  assert.deepEqual(sent, ["uno", "dos", "tres"]);
  assert.deepEqual(r, { sent: 3, failed: 0, stopped: false });
  assert.deepEqual(await q.list(), []);
});

test("flush: un error reintentable detiene la cola y conserva el resto y el orden", async () => {
  const q = new CaptureQueue(new MemoryStore(), newId);
  await q.add("uno"); await q.add("dos"); await q.add("tres");
  const r = await q.flush(async (c) => { if (c.text === "dos") throw new SendError("sin red", true); });
  assert.deepEqual(r, { sent: 1, failed: 0, stopped: true });
  assert.deepEqual((await q.list()).map((c) => [c.text, c.state]), [["dos", "pending"], ["tres", "pending"]]);
});

test("flush: un error no reintentable marca la captura failed con su mensaje y sigue con las demás", async () => {
  const q = new CaptureQueue(new MemoryStore(), newId);
  await q.add("uno"); await q.add("mala"); await q.add("tres");
  const sent: string[] = [];
  const r = await q.flush(async (c) => { if (c.text === "mala") throw new SendError("Texto vacío", false); sent.push(c.text); });
  assert.deepEqual(r, { sent: 2, failed: 1, stopped: false });
  assert.deepEqual(sent, ["uno", "tres"]);
  const left = await q.list();
  assert.equal(left.length, 1);
  assert.deepEqual([left[0].text, left[0].state, left[0].error], ["mala", "failed", "Texto vacío"]);
});

test("flush ignora las failed; retry() la devuelve a pending; discard() la borra", async () => {
  const q = new CaptureQueue(new MemoryStore(), newId);
  const a = await q.add("mala");
  await q.flush(async () => { throw new SendError("no", false); });
  let calls = 0;
  await q.flush(async () => { calls++; });
  assert.equal(calls, 0);
  await q.retry(a.opId);
  assert.equal((await q.list())[0].state, "pending");
  assert.equal((await q.list())[0].error, undefined);
  await q.flush(async () => { calls++; });
  assert.equal(calls, 1);
  const b = await q.add("otra");
  await q.discard(b.opId);
  assert.deepEqual(await q.list(), []);
});

test("un error que no es SendError se trata como reintentable y no pierde la captura", async () => {
  const q = new CaptureQueue(new MemoryStore(), newId);
  await q.add("uno");
  const r = await q.flush(async () => { throw new TypeError("Failed to fetch"); });
  assert.equal(r.stopped, true);
  assert.equal((await q.list())[0].state, "pending");
});

test("dos flush a la vez no envían la misma captura dos veces", async () => {
  const q = new CaptureQueue(new MemoryStore(), newId);
  await q.add("uno");
  let calls = 0;
  const send = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); };
  await Promise.all([q.flush(send), q.flush(send)]);
  assert.equal(calls, 1);
});

test("add usa el opId dado o genera uno", async () => {
  const q = new CaptureQueue(new MemoryStore(), newId);
  assert.equal((await q.add("a", "mio-12345678")).opId, "mio-12345678");
  assert.match((await q.add("b")).opId, /^id-\d{8}$/);
});

test("backoffMs: 1000, 2000, 4000… con tope 30000", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 10].map(backoffMs), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test("isRetryable: red → true; 400 → false; 401, 408, 429, 503 → true", () => {
  assert.equal(isRetryable(new TypeError("Failed to fetch")), true);
  assert.equal(isRetryable(new ApiError(400, "mal")), false);
  assert.equal(isRetryable(new ApiError(404, "no")), false);
  for (const s of [401, 408, 429, 500, 503]) assert.equal(isRetryable(new ApiError(s, "x")), true, String(s));
});

test("submitCapture: éxito → sent y no encola", async () => {
  const q = new CaptureQueue(new MemoryStore(), newId);
  const r = await submitCapture({ post: async () => RESULT, queue: q, newId }, "hola");
  assert.deepEqual(r, { sent: true, result: RESULT });
  assert.deepEqual(await q.list(), []);
});

test("submitCapture: error de red → encola con el MISMO opId que se envió", async () => {
  const q = new CaptureQueue(new MemoryStore(), newId);
  let used = "";
  const r = await submitCapture({ post: async (_t, op) => { used = op; throw new TypeError("Failed to fetch"); }, queue: q, newId }, "hola");
  assert.equal(r.sent, false);
  if (!r.sent) assert.equal(r.queued.opId, used);
  assert.equal((await q.list())[0].opId, used);
});

test("submitCapture: ApiError 400 se relanza y no encola; 503 encola", async () => {
  const q = new CaptureQueue(new MemoryStore(), newId);
  await assert.rejects(submitCapture({ post: async () => { throw new ApiError(400, "mal"); }, queue: q, newId }, "x"), /mal/);
  assert.deepEqual(await q.list(), []);
  const r = await submitCapture({ post: async () => { throw new ApiError(503, "ocupado"); }, queue: q, newId }, "x");
  assert.equal(r.sent, false);
  assert.equal((await q.list()).length, 1);
});

test("respuesta perdida: el servidor aplica, el cliente no recibe respuesta; flush reenvía el mismo opId y queda una sola nota", async () => {
  const notes = new Map<string, string>(); // opId → texto (servidor que deduplica)
  let lose = true;
  const post = async (text: string, opId: string): Promise<CaptureResult> => {
    if (!notes.has(opId)) notes.set(opId, text);
    if (lose) { lose = false; throw new TypeError("Failed to fetch"); }
    return RESULT;
  };
  const q = new CaptureQueue(new MemoryStore(), newId);
  const r = await submitCapture({ post, queue: q, newId }, "no duplicar");
  assert.equal(r.sent, false);
  await q.flush(async (c) => { await post(c.text, c.opId); });
  assert.equal(notes.size, 1);
  assert.deepEqual(await q.list(), []);
});

test("isNetworkError: solo el fallo de red (TypeError), no ApiError ni errores de almacenamiento", async () => {
  const { isNetworkError } = await import("../web/src/offline/capture.ts");
  assert.equal(isNetworkError(new TypeError("Failed to fetch")), true);
  assert.equal(isNetworkError(new ApiError(503, "x")), false);
  assert.equal(isNetworkError(new DOMException("cuota", "QuotaExceededError")), false);
});
