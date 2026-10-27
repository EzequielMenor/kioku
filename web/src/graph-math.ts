// Zoom por pellizco del grafo: pura para poder probarla sin lienzo.
export interface View { k: number; tx: number; ty: number }

const MIN_K = 0.2;
const MAX_K = 4;

/** Nueva vista tras separar/juntar dos dedos de `prev` a `next` píxeles; `mid` (coordenadas del lienzo) queda fijo. */
export function pinchZoom(v: View, prev: number, next: number, mid: { x: number; y: number }): View {
  if (!(prev > 0) || !(next > 0)) return v;
  const k = Math.min(MAX_K, Math.max(MIN_K, v.k * (next / prev)));
  const f = k / v.k;
  return { k, tx: mid.x - (mid.x - v.tx) * f, ty: mid.y - (mid.y - v.ty) * f };
}
