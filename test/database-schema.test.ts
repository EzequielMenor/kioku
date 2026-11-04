import { test } from "node:test";
import assert from "node:assert/strict";
import { planSchemaOp, RESERVED_NAMES, SchemaError } from "../src/core/database-schema.ts";
import type { DbRow } from "../src/core/database.ts";

const row = (path: string, fm: Record<string, unknown> = {}): DbRow =>
  ({ path, title: path.replace(/^.*\//, "").replace(/\.md$/, ""), type: "note", tags: [], mtime: 0, fm });

const rows = [
  row("Libros/Dune.md", { Autor: "Herbert", Estado: "Leyendo", Nota: 9 }),
  row("Libros/Ubik.md", { Autor: "Dick", Estado: "Leído" }),
  row("Libros/Solaris.md", { Estado: "Leído", Genero: ["scifi", "filosofía"] }),
];

const raw = () => ({
  properties: {
    Autor: { type: "text", description: "x" },
    Estado: { type: "select", options: ["Quiero leer", { name: "Leyendo", color: "blue" }, "Leído"] },
  },
  views: [
    {
      name: "Tabla", kind: "table", columns: ["title", "Autor", "Estado"],
      filter: [{ prop: "Autor", op: "not_empty" }, { prop: "Estado", op: "is", value: "Leído" }],
      sort: [{ prop: "Autor", dir: "asc" }, { prop: "Estado", dir: "desc" }],
      group: "Autor",
    },
    // Vista escrita a mano con un campo que Kioku no conoce: tiene que sobrevivir.
    { name: "Mano", kind: "board", columns: ["Autor"], filter: [], sort: [], group: "Estado", foo: 1 },
  ],
});

test("add-property crea la entrada {type} sin ediciones de fila", () => {
  const plan = planSchemaOp(raw(), rows, { op: "add-property", name: "  Páginas ", type: "number" });
  assert.deepEqual(Object.keys(plan.properties), ["Autor", "Estado", "Páginas"]);
  assert.deepEqual(plan.properties["Páginas"], { type: "number" });
  assert.deepEqual(plan.rowEdits, []);
  assert.equal(plan.views, undefined);
  assert.match(plan.summary, /Páginas/);
});

test("add-property sobre una base sin properties ni views", () => {
  const plan = planSchemaOp({}, [], { op: "add-property", name: "Autor", type: "text" });
  assert.deepEqual(plan.properties, { Autor: { type: "text" } });
  assert.equal(plan.views, undefined);
});

test("add-property rechaza nombres vacíos, reservados y colisiones", () => {
  const add = (name: string) => () => planSchemaOp(raw(), rows, { op: "add-property", name, type: "text" });
  assert.throws(add("Title"), SchemaError);
  assert.throws(add("tags"), SchemaError);
  assert.throws(add("   "), SchemaError);
  assert.throws(add(""), SchemaError);
  assert.throws(add("autor"), SchemaError); // colisión con la entrada Autor del esquema
  assert.throws(add("genero"), SchemaError); // colisión con una clave presente en una fila
  for (const n of ["id", "type", "created", "title", "tags", "parked", "path", "mtime", "source", "properties", "views"]) {
    assert.ok(RESERVED_NAMES.has(n), n);
    assert.throws(add(n.toUpperCase()), SchemaError, n);
  }
});

test("la colisión usa plegado NFC además de mayúsculas", () => {
  const withAccent = [row("a.md", { "Qué": 1 })]; // «é» precompuesta (NFC)
  assert.throws(() => planSchemaOp({}, withAccent, { op: "add-property", name: "QUE\u0301", type: "text" }), SchemaError); // «QUÉ» con E + acento combinante
});

test("los nombres '---', '...' y con salto de línea se rechazan", () => {
  for (const name of ["---", "...", " --- ", "a\nb", "a\rb", "uno\u2028dos"]) {
    assert.throws(() => planSchemaOp(raw(), rows, { op: "add-property", name, type: "text" }), SchemaError, JSON.stringify(name));
    assert.throws(() => planSchemaOp(raw(), rows, { op: "rename-property", name: "Autor", to: name }), SchemaError, JSON.stringify(name));
  }
  assert.doesNotThrow(() => planSchemaOp(raw(), rows, { op: "add-property", name: "Ex\n", type: "text" }));
  assert.doesNotThrow(() => planSchemaOp(raw(), rows, { op: "add-property", name: "-- -", type: "text" }));
});

test("rename-property mueve la entrada conservando orden y campos desconocidos, y actualiza todas las vistas", () => {
  const input = raw();
  const snapshot = structuredClone(input);
  const rowsSnapshot = structuredClone(rows);
  const plan = planSchemaOp(input, rows, { op: "rename-property", name: "Autor", to: " Escritor " });

  assert.deepEqual(Object.keys(plan.properties), ["Escritor", "Estado"]);
  assert.deepEqual(plan.properties.Escritor, { type: "text", description: "x" });

  const views = plan.views as Record<string, unknown>[];
  assert.deepEqual(views[0].columns, ["title", "Escritor", "Estado"]);
  assert.deepEqual(views[0].filter, [{ prop: "Escritor", op: "not_empty" }, { prop: "Estado", op: "is", value: "Leído" }]);
  assert.deepEqual(views[0].sort, [{ prop: "Escritor", dir: "asc" }, { prop: "Estado", dir: "desc" }]);
  assert.equal(views[0].group, "Escritor");
  assert.deepEqual(views[1].columns, ["Escritor"]);
  assert.equal(views[1].group, "Estado");
  assert.equal(views[1].foo, 1);

  assert.deepEqual(plan.rowEdits, [
    { path: "Libros/Dune.md", kind: "rename-key", from: "Autor", to: "Escritor" },
    { path: "Libros/Ubik.md", kind: "rename-key", from: "Autor", to: "Escritor" },
  ]);
  assert.equal(plan.summary, "Renombrada «Autor» → «Escritor» (2 notas)");

  // Las entradas no se mutan.
  assert.deepEqual(input, snapshot);
  assert.deepEqual(rows, rowsSnapshot);
});

test("rename-property: una sola nota se resume en singular", () => {
  const plan = planSchemaOp(raw(), rows, { op: "rename-property", name: "Nota", to: "Puntuación" });
  assert.equal(plan.summary, "Renombrada «Nota» → «Puntuación» (1 nota)");
});

test("rename-property permite cambiar solo la capitalización de sí misma", () => {
  const plan = planSchemaOp(raw(), rows, { op: "rename-property", name: "Autor", to: "autor" });
  assert.deepEqual(Object.keys(plan.properties), ["autor", "Estado"]);
  assert.deepEqual(plan.rowEdits.map((e) => e.kind === "rename-key" && [e.from, e.to]), [["Autor", "autor"], ["Autor", "autor"]]);
});

test("rename-property rechaza colisiones con otra clave del esquema o de una fila, y el no-cambio", () => {
  assert.throws(() => planSchemaOp(raw(), rows, { op: "rename-property", name: "Autor", to: "estado" }), SchemaError);
  assert.throws(() => planSchemaOp(raw(), rows, { op: "rename-property", name: "Autor", to: "GENERO" }), SchemaError);
  assert.throws(() => planSchemaOp(raw(), rows, { op: "rename-property", name: "Autor", to: "Autor" }), SchemaError);
  assert.throws(() => planSchemaOp(raw(), rows, { op: "rename-property", name: "Autor", to: "Title" }), SchemaError);
});

test("set-type a select siembra las opciones con los valores distintos de las filas", () => {
  const input = raw();
  const plan = planSchemaOp(input, rows, { op: "set-type", name: "Genero", type: "select" });
  assert.deepEqual(plan.properties.Genero, { type: "select", options: ["scifi", "filosofía"] });
  assert.deepEqual(plan.rowEdits, []);
  assert.equal(plan.views, undefined);
  assert.deepEqual(Object.keys(plan.properties), ["Autor", "Estado", "Genero"]); // propiedad inferida: se crea la entrada
});

test("set-type: siembra sin repetir, ignora vacíos y limita a 50", () => {
  const many = Array.from({ length: 60 }, (_, i) => row(`n${i}.md`, { K: `v${i}` }));
  many.push(row("dup.md", { K: "V1" }), row("vacio.md", { K: "" }), row("nulo.md", { K: null }));
  const plan = planSchemaOp({}, many, { op: "set-type", name: "K", type: "select" });
  const opts = (plan.properties.K as { options: string[] }).options;
  assert.equal(opts.length, 50);
  assert.equal(opts[0], "v0");
  assert.equal(new Set(opts.map((o) => o.toLowerCase())).size, 50);
});

test("set-type de select a text descarta las opciones y conserva los demás campos", () => {
  const input = raw();
  input.properties.Estado = { type: "select", options: ["A"], description: "d" } as never;
  const plan = planSchemaOp(input, rows, { op: "set-type", name: "Estado", type: "text" });
  assert.deepEqual(plan.properties.Estado, { type: "text", description: "d" });
  assert.deepEqual(plan.rowEdits, []);
});

test("set-type a multi desde select conserva las opciones existentes (con color)", () => {
  const plan = planSchemaOp(raw(), rows, { op: "set-type", name: "Estado", type: "multi" });
  assert.deepEqual(plan.properties.Estado, { type: "multi", options: ["Quiero leer", { name: "Leyendo", color: "blue" }, "Leído"] });
});

test("set-type sobre una propiedad solo inferida crea la entrada; tipo inválido falla", () => {
  const plan = planSchemaOp({}, rows, { op: "set-type", name: "Nota", type: "number" });
  assert.deepEqual(plan.properties, { Nota: { type: "number" } });
  assert.throws(() => planSchemaOp({}, rows, { op: "set-type", name: "Nota", type: "inventado" as never }), SchemaError);
});

test("delete-property quita la entrada, sus referencias en las vistas y la clave de las filas", () => {
  const input = raw();
  const snapshot = structuredClone(input);
  const plan = planSchemaOp(input, rows, { op: "delete-property", name: "Autor" });
  assert.deepEqual(Object.keys(plan.properties), ["Estado"]);
  const views = plan.views as Record<string, unknown>[];
  assert.deepEqual(views[0].columns, ["title", "Estado"]);
  assert.deepEqual(views[0].filter, [{ prop: "Estado", op: "is", value: "Leído" }]);
  assert.deepEqual(views[0].sort, [{ prop: "Estado", dir: "desc" }]);
  assert.equal(views[0].group, null);
  assert.deepEqual(views[1].columns, []);
  assert.equal(views[1].group, "Estado");
  assert.equal(views[1].foo, 1);
  assert.deepEqual(plan.rowEdits, [
    { path: "Libros/Dune.md", kind: "delete-key", key: "Autor" },
    { path: "Libros/Ubik.md", kind: "delete-key", key: "Autor" },
  ]);
  assert.equal(plan.summary, "Eliminada «Autor» (2 notas)");
  assert.deepEqual(input, snapshot);
});

test("una propiedad solo inferida se puede renombrar y borrar", () => {
  const ren = planSchemaOp({}, rows, { op: "rename-property", name: "Nota", to: "Puntos" });
  assert.deepEqual(ren.properties, {});
  assert.deepEqual(ren.rowEdits, [{ path: "Libros/Dune.md", kind: "rename-key", from: "Nota", to: "Puntos" }]);
  const del = planSchemaOp({}, rows, { op: "delete-property", name: "Nota" });
  assert.deepEqual(del.rowEdits, [{ path: "Libros/Dune.md", kind: "delete-key", key: "Nota" }]);
});

test("una propiedad solo declarada en el esquema (sin filas) se renombra sin ediciones de fila", () => {
  const plan = planSchemaOp({ properties: { Vacía: { type: "text" } } }, [], { op: "rename-property", name: "Vacía", to: "Otra" });
  assert.deepEqual(plan.properties, { Otra: { type: "text" } });
  assert.deepEqual(plan.rowEdits, []);
  assert.equal(plan.summary, "Renombrada «Vacía» → «Otra»");
});

test("columnas de sistema y propiedades inexistentes fallan", () => {
  for (const name of ["title", "tags", "path", "type", "mtime"]) {
    assert.throws(() => planSchemaOp(raw(), rows, { op: "rename-property", name, to: "X" }), SchemaError, name);
    assert.throws(() => planSchemaOp(raw(), rows, { op: "set-type", name, type: "text" }), SchemaError, name);
    assert.throws(() => planSchemaOp(raw(), rows, { op: "delete-property", name }), SchemaError, name);
  }
  assert.throws(() => planSchemaOp(raw(), rows, { op: "rename-property", name: "Nada", to: "X" }), SchemaError);
  assert.throws(() => planSchemaOp(raw(), rows, { op: "set-type", name: "Nada", type: "text" }), SchemaError);
  assert.throws(() => planSchemaOp(raw(), rows, { op: "delete-property", name: "Nada" }), SchemaError);
});

test("las operaciones de opciones aún no están soportadas", () => {
  assert.throws(() => planSchemaOp(raw(), rows, { op: "add-option", prop: "Estado", option: "X" }), /Operación no soportada todavía: add-option/);
});

test("__proto__ como nombre no contamina el esquema", () => {
  const plan = planSchemaOp({}, [], { op: "add-property", name: "__proto__", type: "text" });
  assert.equal(Object.getPrototypeOf(plan.properties), Object.prototype);
  assert.deepEqual(Object.keys(plan.properties), ["__proto__"]);
});
