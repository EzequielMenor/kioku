import { test } from "node:test";
import assert from "node:assert/strict";
import { pushState, urlBase64ToUint8Array } from "../web/src/push-state.ts";

test("decodifica claves base64url con y sin relleno", () => {
  assert.deepEqual([...urlBase64ToUint8Array("BP_-AA")], [4, 255, 254, 0]);
  assert.deepEqual([...urlBase64ToUint8Array("BP_-AA==")], [4, 255, 254, 0]);
  assert.deepEqual([...urlBase64ToUint8Array("")], []);
});

test("estado: soporte y permiso preceden a la suscripción", () => {
  assert.equal(pushState(false, "denied", true), "unsupported");
  assert.equal(pushState(true, "denied", true), "denied");
  assert.equal(pushState(true, "default", false), "off");
  assert.equal(pushState(true, "granted", false), "off");
  assert.equal(pushState(true, "granted", true), "on");
});
