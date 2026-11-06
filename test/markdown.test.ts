import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseNote, extractLinks, extractTags, setFrontmatter, renameFrontmatterKey, sectionItems, appendToSection, slugify, splitFrontmatter,
} from "../src/core/markdown.ts";

test("extractLinks: alias, ancla, bloque, embed y código ignorado", () => {
  const body = "Ver [[Nota A]] y [[Nota B|texto]] y [[Nota C#Sec]] y [[D#^abc]] ![[img.png]]\n`[[no]]`\n```\n[[tampoco]]\n```\n[[#Local]]";
  const l = extractLinks(body);
  assert.deepEqual(l.map((x) => x.target), ["Nota A", "Nota B", "Nota C", "D", "img.png", ""]);
  assert.equal(l[1].alias, "texto");
  assert.equal(l[2].anchor, "Sec");
  assert.equal(l[3].anchor, "^abc");
  assert.equal(l[4].embed, true);
  assert.equal(l[5].anchor, "Local");
});

test("extractTags: soporta acentos y anidadas; ignora #123, encabezados y código", () => {
  const t = extractTags("# Título\nIdea #diseño y #proy/kioku, no #123 ni `#code`\n```\n#fenced\n```\nurl.com/#frag");
  assert.deepEqual(t.sort(), ["diseño", "proy/kioku"]);
});

test("parseNote: título por frontmatter > H1 > nombre; relaciones en frontmatter cuentan como enlaces", () => {
  const n = parseNote('---\ntype: task\nproject: "[[Kioku]]"\ntags: [a, b]\n---\n# Hola\n[[X]] #c', "Tareas/foo.md");
  assert.equal(n.title, "Hola");
  assert.equal(n.frontmatter.type, "task");
  assert.deepEqual(n.links.map((l) => l.target).sort(), ["Kioku", "X"]);
  assert.deepEqual(n.tags.sort(), ["a", "b", "c"]);
  assert.equal(parseNote("sin nada", "Notas/mi-nota.md").title, "mi-nota");
});

test("parseNote: YAML inválido no rompe y se marca", () => {
  const n = parseNote("---\na: [unclosed\n---\ncuerpo [[X]]", "x.md");
  assert.equal(n.frontmatterError, true);
  assert.equal(n.links.length, 1);
});

test("setFrontmatter conserva comentarios y propiedades desconocidas", () => {
  const src = "---\n# comentario\ntype: task\ncustom: 42\n---\ncuerpo\n";
  const out = setFrontmatter(src, { status: "done" });
  assert.match(out, /# comentario/);
  assert.match(out, /custom: 42/);
  assert.match(out, /status: done/);
  assert.equal(splitFrontmatter(out).body, "cuerpo\n");
});

test("setFrontmatter lanza con YAML inválido (no pisa lo que no entiende)", () => {
  assert.throws(() => setFrontmatter("---\na: [x\n---\nb", { s: 1 }));
});

test("secciones: leer y añadir sin tocar el resto", () => {
  let b = "# P\n\ntexto\n\n## Decisiones\n\n- uno\n- dos\n\n## Otra\n\n- x\n";
  assert.deepEqual(sectionItems(b, "decisiones"), ["uno", "dos"]);
  b = appendToSection(b, "Decisiones", "tres");
  assert.deepEqual(sectionItems(b, "Decisiones"), ["uno", "dos", "tres"]);
  assert.deepEqual(sectionItems(b, "Otra"), ["x"]);
  const c = appendToSection("# P\n", "Bitácora", "a");
  assert.deepEqual(sectionItems(c, "Bitácora"), ["a"]);
});

test("slugify", () => {
  assert.equal(slugify("¿Qué hacer? Canción"), "que-hacer-cancion");
  assert.equal(slugify("***"), "sin-titulo");
});

test("renameFrontmatterKey: fecha sin comillas, comentario inline y resto del fichero byte a byte", () => {
  const src = "---\ntitulo:   Mi nota\nFecha: 2026-10-27 # nota\ntags: [a,  b]\n---\n# Cuerpo\n\nTexto [[Nota]]\n";
  const out = renameFrontmatterKey(src, "Fecha", "Publicado");
  assert.equal(out, "---\ntitulo:   Mi nota\nPublicado: 2026-10-27 # nota\ntags: [a,  b]\n---\n# Cuerpo\n\nTexto [[Nota]]\n");
});

test("renameFrontmatterKey: valor entrecomillado y lista siguen igual", () => {
  const src = "---\nFecha: \"2026-10-27\"\ntags:\n  - a\n  - 'b'\n---\ncuerpo\n";
  const out = renameFrontmatterKey(src, "Fecha", "Publicado");
  assert.equal(out, "---\nPublicado: \"2026-10-27\"\ntags:\n  - a\n  - 'b'\n---\ncuerpo\n");
  assert.deepEqual(parseNote(out, "x.md").frontmatter, { Publicado: "2026-10-27", tags: ["a", "b"] });
});

test("renameFrontmatterKey: clave ausente o sin frontmatter devuelve el texto idéntico", () => {
  const src = "---\ntype: task\n---\ncuerpo\n";
  assert.equal(renameFrontmatterKey(src, "Nope", "X"), src);
  assert.equal(renameFrontmatterKey("sin frontmatter", "Fecha", "X"), "sin frontmatter");
});

test("renameFrontmatterKey: lanza si la clave destino ya existe", () => {
  assert.throws(() => renameFrontmatterKey("---\nFecha: 1\nPublicado: 2\n---\n", "Fecha", "Publicado"), /ya existe/);
});

test("renameFrontmatterKey: lanza con YAML inválido", () => {
  assert.throws(() => renameFrontmatterKey("---\na: [unclosed\nFecha: 1\n---\nb", "Fecha", "X"), /inválido/);
});

test("renameFrontmatterKey: conserva comillas de la clave, escapa nombres no válidos y respeta CRLF/BOM", () => {
  assert.equal(renameFrontmatterKey("---\n\"Fecha\": 1\n---\n", "Fecha", "Pub"), "---\n\"Pub\": 1\n---\n");
  assert.equal(renameFrontmatterKey("---\nFecha: 1\n---\n", "Fecha", "Pub: x"), "---\n\"Pub: x\": 1\n---\n");
  assert.equal(renameFrontmatterKey("---\nFecha: 1\n---\n", "Fecha", "Fecha"), "---\nFecha: 1\n---\n");
  assert.equal(renameFrontmatterKey("﻿---\r\nFecha: 1 # c\r\n---\r\nx", "Fecha", "P"), "﻿---\r\nP: 1 # c\r\n---\r\nx");
});
