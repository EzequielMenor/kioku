// Colores de las opciones de selección: clase CSS, nombres en español y contraste legible de cada par en los dos temas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { OPTION_COLORS } from "../src/core/database.ts";
import { OPTION_LABELS, optionClass } from "../web/src/option-colors.ts";

const CSS = readFileSync(path.join(import.meta.dirname, "..", "web", "src", "app.css"), "utf8");

test("optionClass: color conocido, sin color y color desconocido", () => {
  assert.equal(optionClass("green"), "opt-green");
  assert.equal(optionClass(undefined), "opt-none");
  assert.equal(optionClass("magenta" as never), "opt-none");
  for (const c of OPTION_COLORS) assert.equal(optionClass(c), `opt-${c}`);
});

test("OPTION_LABELS cubre toda la paleta con nombres en español", () => {
  assert.deepEqual(Object.keys(OPTION_LABELS).sort(), [...OPTION_COLORS].sort());
  for (const c of OPTION_COLORS) assert.match(OPTION_LABELS[c], /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/);
  assert.equal(OPTION_LABELS.green, "Verde");
});

/** Cuerpo de la regla cuyo selector (hasta `{`) contiene `head`; para el tema automático, el bloque dentro de su `@media`. */
function block(start: string): string {
  const i = CSS.indexOf(start);
  assert.ok(i >= 0, `falta ${start} en app.css`);
  const open = CSS.indexOf("{", i + start.length - 1);
  let depth = 0;
  for (let k = open; k < CSS.length; k++) {
    if (CSS[k] === "{") depth++;
    else if (CSS[k] === "}" && --depth === 0) return CSS.slice(open + 1, k);
  }
  throw new Error(`sin cierre: ${start}`);
}

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test("cada color tiene fondo y texto sólidos en tema oscuro, claro y automático-claro, con contraste de al menos 4.5", () => {
  const themes: Record<string, string> = {
    oscuro: block(":root {"),
    claro: block(':root[data-theme="light"] {'),
    "automático-claro": block(':root[data-theme="auto"] {'),
  };
  for (const [theme, css] of Object.entries(themes)) {
    for (const c of OPTION_COLORS) {
      const bg = css.match(new RegExp(`--opt-${c}-bg:\\s*(#[0-9a-f]{6})\\b`, "i"))?.[1];
      const fg = css.match(new RegExp(`--opt-${c}-fg:\\s*(#[0-9a-f]{6})\\b`, "i"))?.[1];
      assert.ok(bg && fg, `${theme}: faltan --opt-${c}-bg/fg`);
      assert.ok(contrast(bg, fg) >= 4.5, `${theme}/${c}: contraste ${contrast(bg, fg).toFixed(2)}`);
    }
  }
});

test("app.css define una clase por color y la neutra, apoyadas en esas variables", () => {
  for (const c of OPTION_COLORS) assert.match(CSS, new RegExp(`\\.opt-${c}\\b[^{]*\\{[^}]*var\\(--opt-${c}-bg\\)[^}]*var\\(--opt-${c}-fg\\)`));
  assert.match(CSS, /\.opt-none\s*\{/);
});
