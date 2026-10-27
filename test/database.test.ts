import { test } from "node:test";
import assert from "node:assert/strict";
import { inferType, matchesSource, parseDatabase, queryRows, type DbRow } from "../src/core/database.ts";

const row = (path: string, title: string, fm: Record<string, unknown> = {}, extra: Partial<DbRow> = {}): DbRow =>
  ({ path, title, type: "note", tags: [], mtime: 0, fm, ...extra });

const def = (fm: Record<string, unknown>) => parseDatabase({ path: "Bases/Libros.md", title: "Libros", fm: { type: "database", ...fm } });

const libros = [
  row("Libros/Dune.md", "Dune", { Estado: "Leyendo", Nota: 9, Autor: "Herbert", Fin: "2026-11-01", Leido: false }),
  row("Libros/Ubik.md", "Ubik", { Estado: "Leído", Nota: 7, Autor: "Dick", Fin: "2026-09-10", Leido: true, tags: ["scifi"] }),
  row("Libros/Neuromante.md", "Neuromante", { Estado: "Quiero leer", Autor: "Gibson" }),
  row("Libros/Solaris.md", "Solaris", { Estado: "Leído", Nota: 8, Autor: "Lem", Fin: "2026-10-05", Leido: true }),
];

test("inferType: deduce el tipo del valor", () => {
  assert.equal(inferType(true), "checkbox");
  assert.equal(inferType(3), "number");
  assert.equal(inferType("2026-10-27"), "date");
  assert.equal(inferType(new Date("2026-10-27T00:00:00Z")), "date");
  assert.equal(inferType("https://ejemplo.org/x"), "url");
  assert.equal(inferType("[[Jarvis]]"), "relation");
  assert.equal(inferType(["[[A]]", "[[B]]"]), "relation");
  assert.equal(inferType(["a", "b"]), "multi");
  assert.equal(inferType("hola"), "text");
  assert.equal(inferType(null), "text");
});

test("parseDatabase: lee origen, esquema y vistas", () => {
  const d = def({
    source: { folder: "Libros/", tags: ["scifi"] },
    properties: { Estado: { type: "select", options: ["Quiero leer", "Leyendo", "Leído"] } },
    views: [{ name: "Tabla", kind: "table", columns: ["title", "Estado"], filter: [{ prop: "Estado", op: "is", value: "Leído" }], sort: [{ prop: "Nota", dir: "desc" }], group: null }],
  });
  assert.equal(d.title, "Libros");
  assert.deepEqual(d.source, { folder: "Libros/", type: null, tags: ["scifi"] });
  assert.deepEqual(d.properties.Estado, { type: "select", options: ["Quiero leer", "Leyendo", "Leído"] });
  assert.equal(d.views.length, 1);
  assert.deepEqual(d.views[0].sort, [{ prop: "Nota", dir: "desc" }]);
  assert.deepEqual(d.warnings, []);
});

test("parseDatabase: es tolerante — lo inválido se descarta con aviso y nunca lanza", () => {
  const d = def({
    source: "Libros/", properties: { X: { type: "inventado" }, Y: 7 },
    views: [{ name: "Mala", kind: "galaxia" }, { kind: "table" }, { name: "Buena", kind: "board", group: "Estado", filter: [{ prop: "A", op: "raro" }, { prop: "B", op: "is", value: 1 }], sort: [{ prop: "C", dir: "sideways" }] }, "texto"],
  });
  assert.deepEqual(d.source, { folder: null, type: null, tags: [] });
  assert.equal(d.views.length, 1);
  assert.equal(d.views[0].name, "Buena");
  assert.deepEqual(d.views[0].filter, [{ prop: "B", op: "is", value: 1 }]);
  assert.deepEqual(d.views[0].sort, []);
  assert.ok(d.warnings.length >= 4, d.warnings.join(" | "));
  assert.doesNotThrow(() => parseDatabase({ path: "Bases/X.md", title: "X", fm: { type: "database", views: 5, properties: [] } }));
});

test("parseDatabase: sin vistas crea una tabla por defecto", () => {
  const d = def({ properties: { Estado: { type: "select" } } });
  assert.equal(d.views.length, 1);
  assert.equal(d.views[0].kind, "table");
});

test("matchesSource: carpeta, tipo y etiquetas (y nunca la propia base)", () => {
  const d = def({ source: { folder: "Libros/", tags: ["scifi"] } });
  assert.equal(matchesSource(d, libros[1]), true);
  assert.equal(matchesSource(d, libros[0]), false, "falta la etiqueta");
  assert.equal(matchesSource(def({ source: { folder: "libros" } }), libros[0]), true, "sin distinguir mayúsculas ni barra final");
  assert.equal(matchesSource(def({ source: { type: "task" } }), libros[0]), false);
  assert.equal(matchesSource(def({}), row("Bases/Libros.md", "Libros", {}, { type: "note" })), false, "la base no es fila de sí misma");
});

const q = (filter: object[], extra: object = {}) =>
  queryRows(def({}), { name: "v", kind: "table", columns: ["title", "Estado"], filter: filter as never, sort: [], group: null, ...extra }, libros).rows.map((r) => r.title);

test("filtros: is / is_not / contains / empty / not_empty", () => {
  assert.deepEqual(q([{ prop: "Estado", op: "is", value: "leído" }]), ["Ubik", "Solaris"], "is no distingue mayúsculas");
  assert.deepEqual(q([{ prop: "Estado", op: "is_not", value: "Leído" }]), ["Dune", "Neuromante"]);
  assert.deepEqual(q([{ prop: "Autor", op: "contains", value: "er" }]), ["Dune"]);
  assert.deepEqual(q([{ prop: "Nota", op: "empty" }]), ["Neuromante"]);
  assert.deepEqual(q([{ prop: "Nota", op: "not_empty" }]), ["Dune", "Ubik", "Solaris"]);
  assert.deepEqual(q([{ prop: "tags", op: "is", value: "scifi" }]), ["Ubik"], "tags es una propiedad más");
});

test("filtros: gt / lt numéricos, before / after de fechas, checked", () => {
  assert.deepEqual(q([{ prop: "Nota", op: "gt", value: 7 }]), ["Dune", "Solaris"]);
  assert.deepEqual(q([{ prop: "Nota", op: "lt", value: 8 }]), ["Ubik"]);
  assert.deepEqual(q([{ prop: "Fin", op: "before", value: "2026-10-06" }]), ["Ubik", "Solaris"]);
  assert.deepEqual(q([{ prop: "Fin", op: "after", value: "2026-10-06" }]), ["Dune"]);
  assert.deepEqual(q([{ prop: "Leido", op: "checked" }]), ["Ubik", "Solaris"]);
});

test("filtros: varios se combinan con Y", () => {
  assert.deepEqual(q([{ prop: "Estado", op: "is", value: "Leído" }, { prop: "Nota", op: "gt", value: 7 }]), ["Solaris"]);
});

test("orden: multi-clave, números como números, vacíos siempre al final y estable", () => {
  const sorted = (sort: object[]) => queryRows(def({}), { name: "v", kind: "table", columns: [], filter: [], sort: sort as never, group: null }, libros).rows.map((r) => r.title);
  assert.deepEqual(sorted([{ prop: "Nota", dir: "desc" }]), ["Dune", "Solaris", "Ubik", "Neuromante"]);
  assert.deepEqual(sorted([{ prop: "Nota", dir: "asc" }]), ["Ubik", "Solaris", "Dune", "Neuromante"], "el vacío sigue al final en asc");
  assert.deepEqual(sorted([{ prop: "Estado", dir: "asc" }, { prop: "Nota", dir: "desc" }]), ["Solaris", "Ubik", "Dune", "Neuromante"]);
  assert.deepEqual(sorted([]), ["Dune", "Ubik", "Neuromante", "Solaris"], "sin orden: el de entrada");
  assert.deepEqual(sorted([{ prop: "title", dir: "asc" }]), ["Dune", "Neuromante", "Solaris", "Ubik"]);
});

test("agrupación: orden de opciones del esquema, sin valor al final", () => {
  const d = def({ properties: { Estado: { type: "select", options: ["Quiero leer", "Leyendo", "Leído"] } } });
  const r = queryRows(d, { name: "b", kind: "board", columns: ["title"], filter: [], sort: [], group: "Estado" }, [...libros, row("Libros/Sin.md", "Sin estado", {})]);
  assert.deepEqual(r.groups!.map((g) => [g.key, g.rows.map((x) => x.title)]), [
    ["Quiero leer", ["Neuromante"]], ["Leyendo", ["Dune"]], ["Leído", ["Ubik", "Solaris"]], ["", ["Sin estado"]],
  ]);
  assert.equal(queryRows(d, { name: "t", kind: "table", columns: [], filter: [], sort: [], group: null }, libros).groups, null);
});

test("columnas: por defecto título + propiedades declaradas; cada columna lleva su tipo", () => {
  const d = def({ properties: { Estado: { type: "select", options: ["a"] }, Nota: { type: "number" } } });
  const r = queryRows(d, d.views[0], libros);
  assert.deepEqual(r.columns.map((c) => [c.key, c.type]), [["title", "text"], ["Estado", "select"], ["Nota", "number"]]);
  const inferred = queryRows(def({}), { name: "v", kind: "table", columns: ["title", "Nota", "Fin", "Leido"], filter: [], sort: [], group: null }, libros);
  assert.deepEqual(inferred.columns.map((c) => c.type), ["text", "number", "date", "checkbox"]);
  assert.equal(r.total, 4);
  assert.deepEqual(r.rows[0].cells, { title: "Dune", Estado: "Leyendo", Nota: 9 });
});
