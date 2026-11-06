import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Las reglas se limitan a la conversación y la hoja, no cambian las páginas vecinas.
test("estilos de conversación usan los tokens existentes y respetan movimiento reducido", () => {
  const css = readFileSync(new URL("../web/src/assistant-layered.css", import.meta.url), "utf8");
  assert.match(css, /var\(--line2\)/);
  assert.match(css, /var\(--serif\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.assistant-page \.bubble\.user/);
});
