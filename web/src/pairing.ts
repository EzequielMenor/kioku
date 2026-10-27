// Emparejar el móvil sin cookie: se pega la clave o la URL de `kioku pair` y se normaliza.
const KEY_RE = /^[0-9a-f]{64}$/;

/** Clave de 64 hex a partir de lo pegado (la clave sola o una URL con `?k=`); null si no hay una válida. */
export function extractKey(text: string): string | null {
  const t = text.trim();
  if (KEY_RE.test(t.toLowerCase())) return t.toLowerCase();
  const m = /[?&]k=([0-9a-fA-F]{64})(?![0-9a-fA-F])/.exec(t);
  return m ? m[1].toLowerCase() : null;
}
