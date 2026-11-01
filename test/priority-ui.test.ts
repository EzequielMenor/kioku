import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (name: string) => readFileSync(new URL(`../web/src/${name}`, import.meta.url), "utf8");

test("prioridades existentes se muestran con nombres en lista, tabla y tablero", async () => {
  const { priorityLabel } = await import("../web/src/priority.ts");
  assert.deepEqual([1, 2, 3, null].map(priorityLabel), ["Alta", "Media", "Baja", ""]);
  for (const file of ["app.tsx", "task-views.tsx"]) {
    const text = src(file);
    assert.match(text, /priorityLabel\(t\.priority\)/);
    assert.doesNotMatch(text, /p\{t\.priority\}|`p\$\{t\.priority\}`/);
  }
});

test("nota: selector de un toque con nombres y opción sin prioridad, guardado numérico existente", () => {
  const component = src("priority.tsx");
  assert.match(component, /aria-pressed/);
  assert.match(component, /Sin prioridad/);
  assert.match(component, /onClick/);
  const note = src("note-view.tsx");
  assert.match(note, /<PrioritySelector/);
  assert.match(note, /setProp\(\{ priority:/);
  assert.doesNotMatch(note, /<option value="[123]">p[123]/);
});

test("captura rápida conserva el atajo y orden de tareas conserva prioridad numérica", () => {
  assert.match(src("quick.tsx"), /@proyecto  p1/);
  assert.match(src("app.tsx"), /\(a\.priority \?\? 9\) - \(b\.priority \?\? 9\)/);
  assert.match(src("task-views.tsx"), /\(a\.priority \?\? 9\) - \(b\.priority \?\? 9\)/);
});
