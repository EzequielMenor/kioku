// Chromium real por CDP (WebSocket integrado de Node) para pruebas de interfaz; sin dependencias nuevas.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const CHROMIUM = process.env.KIOKU_CHROMIUM ?? "/usr/bin/chromium";
export const WEB = path.join(import.meta.dirname, "..", "dist", "web");
export const browserSkip = !existsSync(CHROMIUM) ? "no hay Chromium" : !existsSync(path.join(WEB, "app.js")) ? "falta npm run build:web" : false;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until<T>(fn: () => Promise<T> | T, what: string, ms = 8000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v as NonNullable<T>; } catch { /* aún no */ }
    if (Date.now() > end) throw new Error(`Tiempo agotado: ${what}`);
    await sleep(50);
  }
}

export async function launch(profile: string) {
  const proc: ChildProcess = spawn(CHROMIUM, ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const port = await until(() => { const f = path.join(profile, "DevToolsActivePort"); return existsSync(f) ? readFileSync(f, "utf8").split("\n")[0] : null; }, "Chromium arrancó");
  const target = await until(async () => ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((x) => x.type === "page"), "hay una página");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>();
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); };
  const send = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const ev = async <T = unknown>(expression: string): Promise<T> => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "error en la página");
    return r.result.value as T;
  };
  await send("Page.enable");
  return { send, ev, close: async () => { ws.close(); proc.kill("SIGKILL"); await sleep(100); } };
}