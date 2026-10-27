import { test } from "node:test";
import assert from "node:assert/strict";
import { AssistantError, checkAssistantPath, filterProps, isProtectedPath, MAX_NOTES_PER_QUERY } from "../src/assistant/policy.ts";
import { SessionRegistry } from "../src/assistant/session.ts";

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as AssistantError).code; } return null; };

test("política: rechaza rutas con .., absolutas, ocultas, sin .md y excluidas", () => {
  assert.equal(code(() => checkAssistantPath("../x.md", [])), "path");
  assert.equal(code(() => checkAssistantPath("Notas/../../x.md", [])), "path");
  assert.equal(code(() => checkAssistantPath("/etc/passwd.md", [])), "path");
  assert.equal(code(() => checkAssistantPath(".jarvis/log/a.md", [])), "path");
  assert.equal(code(() => checkAssistantPath("Notas/.oculta/a.md", [])), "path");
  assert.equal(code(() => checkAssistantPath("Notas/a.txt", [])), "path");
  assert.equal(code(() => checkAssistantPath(42, [])), "path");
  assert.equal(code(() => checkAssistantPath("Privado/a.md", ["Privado/"])), "excluded");
});

test("política: acepta rutas normales y marca Notas/Importado/ como protegida", () => {
  assert.equal(checkAssistantPath("Notas/Cocina.md", ["Privado/"]), "Notas/Cocina.md");
  assert.equal(isProtectedPath("Notas/Importado/a.md"), true);
  assert.equal(isProtectedPath("Notas/a.md"), false);
  assert.equal(MAX_NOTES_PER_QUERY, 5);
});

test("política: filterProps admite cualquier propiedad de usuario, pero solo valores simples y nunca las del sistema", () => {
  assert.deepEqual(filterProps({ Estado: "Leyendo", Nota: 9, Leído: true, Etiquetas: ["a", "b"], Autor: null }), { Estado: "Leyendo", Nota: 9, Leído: true, Etiquetas: ["a", "b"], Autor: null });
  for (const bad of [{ views: { a: 1 } }, { x: [{ a: 1 }] }, { x: [["a"]] }, { x: { y: 1 } }, { x: () => 1 }, { x: "a".repeat(2001) }, { x: Array(51).fill("a") }]) assert.equal(code(() => filterProps(bad)), "props", JSON.stringify(bad).slice(0, 40));
  for (const k of ["id", "created", "type", "parked"]) assert.equal(code(() => filterProps({ [k]: "x" })), "props", k);
  for (const k of ["", "a\nb: c", "x".repeat(61), "__proto__"]) assert.equal(code(() => filterProps({ [k]: "x" })), "props", JSON.stringify(k));
  assert.equal(code(() => filterProps({ views: "x" }, { database: true })), "props", "la definición de una base no se toca");
  assert.equal(code(() => filterProps({ source: "x" }, { database: true })), "props");
  assert.deepEqual(filterProps({ views: "x" }), { views: "x" }, "en una nota normal «views» es una propiedad más");
});

test("política: filterProps solo admite claves permitidas", () => {
  assert.deepEqual(filterProps({ status: "done", due: "2026-10-27" }), { status: "done", due: "2026-10-27" });
  assert.equal(code(() => filterProps({ id: "x" })), "props");
  assert.equal(code(() => filterProps({ status: "done", created: "x" })), "props");
  assert.equal(code(() => filterProps([1])), "props");
  assert.equal(code(() => filterProps(null)), "props");
});

test("sesiones: byToken devuelve la sesión abierta y null tras close o sin token", () => {
  const r = new SessionRegistry();
  const s = r.open();
  assert.match(s.token, /^[0-9a-f]{64}$/);
  assert.notEqual(r.open().token, s.token);
  assert.equal(r.byToken(s.token)?.id, s.id);
  assert.equal(r.byToken(undefined), null);
  assert.equal(r.byToken("otro"), null);
  r.close(s.id);
  assert.equal(r.byToken(s.token), null);
});

test("política: assistant.json se parsea con tolerancia", async () => {
  const { parseAssistantConfig } = await import("../src/assistant/policy.ts");
  assert.deepEqual(parseAssistantConfig('{"exclude":["Privado/"," ", 3]}').exclude, ["Privado/"]);
  assert.deepEqual(parseAssistantConfig(null).exclude, []);
});

test("política: assistant.json roto falla cerrado (no equivale a «sin exclusiones»)", async () => {
  const { parseAssistantConfig } = await import("../src/assistant/policy.ts");
  assert.throws(() => parseAssistantConfig('{"exclude":["Privado/"],}'), /assistant\.json/);
});

test("política: las exclusiones se normalizan (NFC/NFD, mayúsculas, ./ y barra final)", async () => {
  const { checkAssistantPath, parseAssistantConfig } = await import("../src/assistant/policy.ts");
  const nfc = "Diseño/x.md", nfd = "Diseño/x.md".normalize("NFD");
  const ex = parseAssistantConfig(JSON.stringify({ exclude: ["./Diseño", "/privado"] })).exclude;
  for (const p of [nfc, nfd, "PRIVADO/a.md", "privado/b/c.md"]) assert.throws(() => checkAssistantPath(p, ex), /excluida/, p);
  assert.equal(checkAssistantPath("PrivadoX/a.md", ex), "PrivadoX/a.md", "«privado» no excluye «PrivadoX»");
});
