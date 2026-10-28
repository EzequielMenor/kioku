import { ApiError } from "../api.ts";
import type { CaptureResult } from "../types.ts";
import type { CaptureQueue } from "./queue.ts";
import type { QueuedCapture } from "./store.ts";

/** Sin respuesta del servidor (red) o un estado que se arregla solo al reintentar. */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.status === 401 || e.status === 408 || e.status === 429 || e.status >= 500;
}

/** Fallo de red de `fetch` (no hubo respuesta): distinto de un rechazo HTTP o de un error local de almacenamiento. */
export const isNetworkError = (e: unknown): boolean => e instanceof TypeError;

export interface SubmitDeps {
  post(text: string, opId: string): Promise<CaptureResult>;
  queue: CaptureQueue;
  newId(): string;
}

/**
 * Envía una captura con un `opId` nuevo. Si falla por red o 5xx la deja en la cola con ese mismo `opId`
 * (así un reenvío tras una respuesta perdida no la duplica); un rechazo definitivo se relanza.
 */
export async function submitCapture(deps: SubmitDeps, text: string): Promise<{ sent: true; result: CaptureResult } | { sent: false; queued: QueuedCapture }> {
  const opId = deps.newId();
  try {
    return { sent: true, result: await deps.post(text, opId) };
  } catch (e) {
    if (!isRetryable(e)) throw e;
    return { sent: false, queued: await deps.queue.add(text, opId) };
  }
}
