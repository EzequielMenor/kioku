import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../web/src/api.ts";

async function captured(call: () => Promise<unknown>): Promise<RequestInit & { url: string }> {
  const real = globalThis.fetch;
  let seen: (RequestInit & { url: string }) | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen = { ...init, url };
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try { await call(); } finally { globalThis.fetch = real; }
  return seen!;
}

test("api web: un POST sin cuerpo (aplicar/descartar propuesta, revisar bandeja) igualmente envía JSON", async () => {
  const r = await captured(() => api("POST", "/api/proposals/abc/apply"));
  assert.equal(new Headers(r.headers).get("content-type"), "application/json");
  assert.equal(r.body, "{}");
});

test("api web: un POST con cuerpo lo serializa tal cual y un GET no manda cuerpo ni content-type", async () => {
  const post = await captured(() => api("POST", "/api/capture", { text: "hola" }));
  assert.equal(post.body, JSON.stringify({ text: "hola" }));
  const get = await captured(() => api("GET", "/api/today"));
  assert.equal(get.body, undefined);
  assert.equal(new Headers(get.headers).get("content-type"), null);
});
