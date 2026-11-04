import { test } from "node:test";
import assert from "node:assert/strict";
import { planSchemaOp, RESERVED_NAMES, SchemaError, type SchemaOp } from "../src/core/database-schema.ts";
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

// ---- operaciones de opción ----

const optRows = [
  row("Libros/Dune.md", { Estado: "Leyendo", Genero: ["scifi", "filosofía", "épica"] }),
  row("Libros/Ubik.md", { Estado: "Leído", Genero: ["scifi"] }),
  row("Libros/Solaris.md", { Estado: "leído", Genero: ["filosofía", "scifi"] }),
  row("Libros/Vacio.md", { Estado: "", Genero: [] }),
  row("Libros/Otro.md", { Autor: "x" }),
];
const optRaw = () => ({
  properties: {
    Autor: { type: "text" },
    Estado: { type: "select", options: ["Quiero leer", { name: "Leyendo", color: "blue" }, "Leído"], description: "d" },
    Genero: { type: "multi", options: ["scifi", { name: "filosofía", color: "purple" }, "épica"] },
  },
  views: [
    {
      name: "Tabla", kind: "table", columns: ["Estado"],
      filter: [
        { prop: "Estado", op: "is", value: "Leyendo" },
        { prop: "Estado", op: "is_not", value: "leyendo" },
        { prop: "Estado", op: "contains", value: "Leyendo" },
        { prop: "Estado", op: "is", value: "Leído" },
        { prop: "Estado", op: "empty" },
        { prop: "Autor", op: "is", value: "Leyendo" },
        { prop: "Genero", op: "contains", value: "Leyendo" },
      ],
      sort: [], group: "Estado",
    },
    { name: "Mano", kind: "board", columns: [], filter: [{ prop: "Estado", op: "is", value: "Leído" }], sort: [], group: null, foo: 1 },
  ],
});

test("add-option añade al final, con y sin color, sin tocar el resto de la entrada", () => {
  const input = optRaw();
  const snapshot = structuredClone(input);
  const plan = planSchemaOp(input, optRows, { op: "add-option", prop: "Estado", option: "  Abandonado ", color: "red" });
  assert.deepEqual(plan.properties.Estado, {
    type: "select", description: "d", options: ["Quiero leer", { name: "Leyendo", color: "blue" }, "Leído", { name: "Abandonado", color: "red" }],
  });
  assert.deepEqual(Object.keys(plan.properties), ["Autor", "Estado", "Genero"]);
  assert.deepEqual(plan.rowEdits, []);
  assert.equal(plan.views, undefined);
  assert.equal(plan.summary, "Añadida la opción «Abandonado» a «Estado»");
  const plain = planSchemaOp(input, optRows, { op: "add-option", prop: "Genero", option: "ensayo" });
  assert.deepEqual((plain.properties.Genero as { options: unknown[] }).options, ["scifi", { name: "filosofía", color: "purple" }, "épica", "ensayo"]);
  assert.deepEqual(input, snapshot);
});

test("add-option rechaza duplicadas (mayúsculas y NFC), vacías, colores desconocidos y tipos que no son select/multi", () => {
  const add = (prop: string, option: string, color?: string) => () =>
    planSchemaOp(optRaw(), optRows, { op: "add-option", prop, option, color: color as never });
  assert.throws(add("Estado", "leído"), SchemaError);
  assert.throws(add("Estado", "LEÍDO"), SchemaError);
  assert.throws(add("Estado", "Lei\u0301do"), SchemaError); // i + acento combinante
  assert.throws(add("Estado", "   "), SchemaError);
  assert.throws(add("Estado", "Nueva", "rosa"), SchemaError);
  assert.throws(add("Autor", "x"), SchemaError); // text
  assert.throws(add("Nada", "x"), SchemaError);
  assert.throws(add("title", "x"), SchemaError);
  assert.throws(add("tags", "x"), SchemaError);
});

test("add-option sobre una propiedad sin entrada crea la entrada con el tipo efectivo", () => {
  const plan = planSchemaOp({}, optRows, { op: "add-option", prop: "Genero", option: "scifi", color: "green" });
  assert.deepEqual(plan.properties, { Genero: { type: "multi", options: [{ name: "scifi", color: "green" }] } });
  // Inferido como texto: no admite opciones.
  assert.throws(() => planSchemaOp({}, optRows, { op: "add-option", prop: "Estado", option: "x" }), SchemaError);
});

test("rename-option actualiza options, filtros de las vistas y las filas (escalares y arrays)", () => {
  const input = optRaw();
  const snapshot = structuredClone(input);
  const rowsSnapshot = structuredClone(optRows);
  const plan = planSchemaOp(input, optRows, { op: "rename-option", prop: "Estado", option: "Leyendo", to: " En curso " });
  assert.deepEqual((plan.properties.Estado as { options: unknown[] }).options, ["Quiero leer", { name: "En curso", color: "blue" }, "Leído"]);
  assert.equal((plan.properties.Estado as { description: string }).description, "d");
  assert.deepEqual(plan.rowEdits, [{ path: "Libros/Dune.md", kind: "set-value", key: "Estado", value: "En curso" }]);
  assert.equal(plan.summary, "Renombrada la opción «Leyendo» → «En curso» (1 nota)");

  const views = plan.views as Record<string, unknown>[];
  assert.deepEqual(views[0].filter, [
    { prop: "Estado", op: "is", value: "En curso" },
    { prop: "Estado", op: "is_not", value: "En curso" },
    { prop: "Estado", op: "contains", value: "En curso" },
    { prop: "Estado", op: "is", value: "Leído" },
    { prop: "Estado", op: "empty" },
    { prop: "Autor", op: "is", value: "Leyendo" },
    { prop: "Genero", op: "contains", value: "Leyendo" },
  ]);
  assert.equal(views[1].foo, 1);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(optRows, rowsSnapshot);
});

test("rename-option en multi conserva el orden del array y edita solo las filas que la contienen", () => {
  const plan = planSchemaOp(optRaw(), optRows, { op: "rename-option", prop: "Genero", option: "scifi", to: "ciencia ficción" });
  assert.deepEqual((plan.properties.Genero as { options: unknown[] }).options, ["ciencia ficción", { name: "filosofía", color: "purple" }, "épica"]);
  assert.deepEqual(plan.rowEdits, [
    { path: "Libros/Dune.md", kind: "set-value", key: "Genero", value: ["ciencia ficción", "filosofía", "épica"] },
    { path: "Libros/Ubik.md", kind: "set-value", key: "Genero", value: ["ciencia ficción"] },
    { path: "Libros/Solaris.md", kind: "set-value", key: "Genero", value: ["filosofía", "ciencia ficción"] },
  ]);
  assert.equal(plan.summary, "Renombrada la opción «scifi» → «ciencia ficción» (3 notas)");
  assert.equal(plan.views, undefined);
});

test("rename-option: el valor de una fila que difiere solo en mayúsculas también se renombra", () => {
  const plan = planSchemaOp(optRaw(), optRows, { op: "rename-option", prop: "Estado", option: "Leído", to: "Terminado" });
  assert.deepEqual(plan.rowEdits.map((e) => e.path), ["Libros/Ubik.md", "Libros/Solaris.md"]);
  assert.ok(plan.rowEdits.every((e) => e.kind === "set-value" && e.value === "Terminado"));
  const views = plan.views as Record<string, unknown>[];
  assert.deepEqual((views[0].filter as { value?: string }[]).map((f) => f.value), ["Leyendo", "leyendo", "Leyendo", "Terminado", undefined, "Leyendo", "Leyendo"]);
  assert.deepEqual((views[1].filter as { value: string }[])[0].value, "Terminado");
});

test("rename-option: cambiar solo la capitalización de sí misma es válido; chocar con otra opción no", () => {
  const plan = planSchemaOp(optRaw(), optRows, { op: "rename-option", prop: "Estado", option: "Leído", to: "leído" });
  assert.deepEqual((plan.properties.Estado as { options: unknown[] }).options, ["Quiero leer", { name: "Leyendo", color: "blue" }, "leído"]);
  // La fila que ya dice «leído» no necesita edición.
  assert.deepEqual(plan.rowEdits, [{ path: "Libros/Ubik.md", kind: "set-value", key: "Estado", value: "leído" }]);
  const ren = (option: string, to: string) => () => planSchemaOp(optRaw(), optRows, { op: "rename-option", prop: "Estado", option, to });
  assert.throws(ren("Leyendo", "leído"), SchemaError);
  assert.throws(ren("Leyendo", "QUIERO LEER"), SchemaError);
  assert.throws(ren("Leyendo", "  "), SchemaError);
  assert.throws(ren("Leyendo", "Leyendo"), SchemaError);
  assert.throws(ren("Nada", "X"), SchemaError);
});

test("rename-option sobre una propiedad que no es select/multi falla", () => {
  assert.throws(() => planSchemaOp(optRaw(), optRows, { op: "rename-option", prop: "Autor", option: "x", to: "y" }), SchemaError);
});

test("set-option-color pone, cambia y quita el color", () => {
  const input = optRaw();
  const set = planSchemaOp(input, optRows, { op: "set-option-color", prop: "Estado", option: "Leído", color: "green" });
  assert.deepEqual((set.properties.Estado as { options: unknown[] }).options, ["Quiero leer", { name: "Leyendo", color: "blue" }, { name: "Leído", color: "green" }]);
  assert.deepEqual(set.rowEdits, []);
  assert.equal(set.views, undefined);
  assert.equal(set.summary, "Color de la opción «Leído»: verde");
  const clear = planSchemaOp(input, optRows, { op: "set-option-color", prop: "Estado", option: "Leyendo", color: null });
  assert.deepEqual((clear.properties.Estado as { options: unknown[] }).options, ["Quiero leer", "Leyendo", "Leído"]);
  assert.equal(clear.summary, "Quitado el color de la opción «Leyendo»");
  assert.throws(() => planSchemaOp(input, optRows, { op: "set-option-color", prop: "Estado", option: "Leído", color: "rosa" as never }), SchemaError);
  assert.throws(() => planSchemaOp(input, optRows, { op: "set-option-color", prop: "Estado", option: "Nada", color: "red" }), SchemaError);
});

test("reorder-options solo acepta una permutación exacta de los nombres actuales", () => {
  const input = optRaw();
  const plan = planSchemaOp(input, optRows, { op: "reorder-options", prop: "Estado", options: ["Leído", "Quiero leer", "Leyendo"] });
  assert.deepEqual((plan.properties.Estado as { options: unknown[] }).options, ["Leído", "Quiero leer", { name: "Leyendo", color: "blue" }]);
  assert.deepEqual(plan.rowEdits, []);
  assert.equal(plan.summary, "Reordenadas las opciones de «Estado»");
  const bad = (options: string[]) => () => planSchemaOp(input, optRows, { op: "reorder-options", prop: "Estado", options });
  assert.throws(bad(["Leído", "Quiero leer"]), SchemaError); // falta una
  assert.throws(bad(["Leído", "Quiero leer", "Leyendo", "Extra"]), SchemaError); // sobra una
  assert.throws(bad(["Leído", "Leído", "Leyendo"]), SchemaError); // repetida
  assert.throws(bad(["Leído", "Quiero leer", "Otra"]), SchemaError); // desconocida
  assert.throws(bad([]), SchemaError);
});

test("delete-option sin clear no toca las filas ni los filtros", () => {
  const input = optRaw();
  const snapshot = structuredClone(input);
  const plan = planSchemaOp(input, optRows, { op: "delete-option", prop: "Estado", option: "Leyendo" });
  assert.deepEqual((plan.properties.Estado as { options: unknown[] }).options, ["Quiero leer", "Leído"]);
  assert.deepEqual(plan.rowEdits, []);
  assert.equal(plan.views, undefined);
  assert.equal(plan.summary, "Eliminada la opción «Leyendo» de «Estado»");
  assert.deepEqual(input, snapshot);
});

test("delete-option con clear vacía las filas: null en escalares, array sin el elemento (null si queda vacío)", () => {
  const sc = planSchemaOp(optRaw(), optRows, { op: "delete-option", prop: "Estado", option: "Leído", clear: true });
  assert.deepEqual(sc.rowEdits, [
    { path: "Libros/Ubik.md", kind: "set-value", key: "Estado", value: null },
    { path: "Libros/Solaris.md", kind: "set-value", key: "Estado", value: null },
  ]);
  assert.equal(sc.summary, "Eliminada la opción «Leído» de «Estado» (2 notas)");
  assert.equal(sc.views, undefined);

  const multi = planSchemaOp(optRaw(), optRows, { op: "delete-option", prop: "Genero", option: "scifi", clear: true });
  assert.deepEqual(multi.rowEdits, [
    { path: "Libros/Dune.md", kind: "set-value", key: "Genero", value: ["filosofía", "épica"] },
    { path: "Libros/Ubik.md", kind: "set-value", key: "Genero", value: null },
    { path: "Libros/Solaris.md", kind: "set-value", key: "Genero", value: ["filosofía"] },
  ]);
});

test("delete-option de la última opción quita la clave options de la entrada", () => {
  const plan = planSchemaOp({ properties: { E: { type: "select", options: ["A"] } } }, [], { op: "delete-option", prop: "E", option: "A" });
  assert.deepEqual(plan.properties, { E: { type: "select" } });
});

test("las operaciones de opciones no mutan las entradas y los errores son SchemaError", () => {
  const input = optRaw();
  const snapshot = structuredClone(input);
  const rowsSnapshot = structuredClone(optRows);
  const ops: SchemaOp[] = [
    { op: "add-option", prop: "Estado", option: "Z" },
    { op: "rename-option", prop: "Genero", option: "épica", to: "saga" },
    { op: "set-option-color", prop: "Genero", option: "scifi", color: "red" },
    { op: "reorder-options", prop: "Genero", options: ["épica", "filosofía", "scifi"] },
    { op: "delete-option", prop: "Genero", option: "épica", clear: true },
  ];
  for (const op of ops) planSchemaOp(input, optRows, op);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(optRows, rowsSnapshot);
});

test("__proto__ como nombre no contamina el esquema", () => {
  const plan = planSchemaOp({}, [], { op: "add-property", name: "__proto__", type: "text" });
  assert.equal(Object.getPrototypeOf(plan.properties), Object.prototype);
  assert.deepEqual(Object.keys(plan.properties), ["__proto__"]);
});
