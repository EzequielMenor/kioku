import { test } from "node:test";
import assert from "node:assert/strict";
import { filterSlashCommands, matchSlashTrigger, SLASH_COMMANDS, toggleInlineWrap } from "../web/src/editor-commands.ts";

test("matchSlashTrigger: activa tras inicio de línea o espacio e ignora URLs, código y [[enlaces]]", () => {
  assert.deepEqual(matchSlashTrigger("/", 10), { from: 10, query: "", linePrefix: "" });
  assert.deepEqual(matchSlashTrigger("Hola /neg", 0), { from: 5, query: "neg", linePrefix: "Hola " });
  assert.deepEqual(matchSlashTrigger("- /tar", 20), { from: 22, query: "tar", linePrefix: "- " });
  assert.deepEqual(matchSlashTrigger("> /cit", 0), { from: 2, query: "cit", linePrefix: "> " });

  // No debe dispararse en rutas, URLs, código en línea, ni dentro de [[...]] ni tras espacio
  assert.equal(matchSlashTrigger("https://kioku.app", 0), null);
  assert.equal(matchSlashTrigger("ruta/sub", 0), null);
  assert.equal(matchSlashTrigger("`/neg", 0), null);
  assert.equal(matchSlashTrigger("[[Notas/neg", 0), null);
  assert.equal(matchSlashTrigger("[[ /neg", 0), null);
  assert.equal(matchSlashTrigger("[[Ok]] /h1", 0)?.query, "h1");
  assert.equal(matchSlashTrigger("sí / no", 0), null);
});

test("filterSlashCommands: busca por etiqueta, markdown y sin tildes", () => {
  assert.equal(filterSlashCommands("").length, SLASH_COMMANDS.length);
  assert.equal(filterSlashCommands("titulo")[0]?.id, "h1");
  assert.equal(filterSlashCommands("h2")[0]?.id, "h2");
  assert.equal(filterSlashCommands("bold")[0]?.id, "bold");
  assert.equal(filterSlashCommands("neg")[0]?.id, "bold");
  assert.equal(filterSlashCommands("tar")[0]?.id, "todo");
  assert.equal(filterSlashCommands("enlace")[0]?.id, "link");
  assert.equal(filterSlashCommands("zzzzz").length, 0);
});

test("SLASH_COMMANDS: produce inserciones y posiciones de cursor correctas", () => {
  const byId = Object.fromEntries(SLASH_COMMANDS.map((c) => [c.id, c]));
  assert.deepEqual(byId.h1.applyText({ linePrefix: "" }), { insert: "# ", cursorOffset: 2 });
  assert.deepEqual(byId.bold.applyText({ linePrefix: "Hola " }), { insert: "****", cursorOffset: 2 });
  assert.deepEqual(byId.italic.applyText({ linePrefix: "" }), { insert: "**", cursorOffset: 1 });
  assert.deepEqual(byId.codeblock.applyText({ linePrefix: "" }), { insert: "```\n\n```", cursorOffset: 4 });
  assert.deepEqual(byId.link.applyText({ linePrefix: "" }), { insert: "[[", cursorOffset: 2, reopenLinks: true });
  assert.equal(byId.divider.applyText({ linePrefix: "" }).insert, "---\n");
  assert.equal(byId.divider.applyText({ linePrefix: "Texto " }).insert, "\n---\n");
});

test("toggleInlineWrap: envuelve y desenvuelve negrita (**) y cursiva (*) sin confundirse", () => {
  // Sin selección: inserta pares y sitúa el cursor en medio; segunda vez los quita
  const r1 = toggleInlineWrap("Hola ", 5, 5, "**");
  assert.equal(r1.insert, "****");
  assert.equal(r1.anchor, 7);
  const r1Undo = toggleInlineWrap("Hola ****", 7, 7, "**");
  assert.deepEqual(r1Undo, { from: 5, to: 9, insert: "", anchor: 5, head: 5 });

  // Con selección: envuelve texto
  const r2 = toggleInlineWrap("Hola mundo", 5, 10, "**");
  assert.deepEqual(r2, { from: 5, to: 10, insert: "**mundo**", anchor: 7, head: 12 });

  // Con selección ya envuelta fuera: desenvuelve
  const r3 = toggleInlineWrap("Hola **mundo**", 7, 12, "**");
  assert.deepEqual(r3, { from: 5, to: 14, insert: "mundo", anchor: 5, head: 10 });

  // Cursiva dentro de negrita (**mundo**): aplicar * no rompe ni desenvuelve **
  const r4 = toggleInlineWrap("Hola **mundo**", 7, 12, "*");
  assert.deepEqual(r4, { from: 7, to: 12, insert: "*mundo*", anchor: 8, head: 13 });
});
