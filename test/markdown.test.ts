import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseNote, extractLinks, extractTags, setFrontmatter, sectionItems, appendToSection, slugify, splitFrontmatter,
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
