// Formulario de tareas: Tareas crea y edita con un diálogo; Hoy y Proyecto siguen con el enlace a la nota.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = (f: string) => readFileSync(path.join(import.meta.dirname, "..", "web", "src", f), "utf8");
const between = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

test("Tareas: «Añadir tarea» abre el formulario y sustituye a la barra de captura", () => {
  const app = src("app.tsx");
  const view = between(app, "function TasksView(", "// ───────────────────────────── Notas");
  assert.match(app, /import \{ TaskForm \} from "\.\/task-form\.tsx"/);
  assert.match(view, /Añadir tarea/);
  assert.match(view, /<TaskForm path=\{form\.path\} onClose=\{[^}]+\} onSaved=\{[^}]+\}/);
  assert.doesNotMatch(view, /<form|\/api\/capture/, "ya no se crea tarea con la sintaxis de captura desde Tareas");
  assert.match(view, /reload\(\)/, "tras guardar se recarga la lista de forma explícita");
});

test("Tareas: el título abre el formulario en lista, tabla y tablero; Hoy y Proyecto conservan el enlace", () => {
  const app = src("app.tsx");
  const views = src("task-views.tsx");
  const line = between(app, "function TaskLine(", "function TodayScreen(");
  assert.match(line, /onEdit/);
  assert.match(line, /href=\{`#\/nota\/\$\{enc\(t\.path\)\}`\}/, "el enlace a la nota sigue siendo el destino sin JavaScript");
  const tasks = between(app, "function TasksView(", "// ───────────────────────────── Notas");
  assert.match(tasks, /<TaskLine[^>]*onEdit=/);
  assert.match(tasks, /<TaskTable[^>]*onEdit=/);
  assert.match(tasks, /<TaskBoard[^>]*onEdit=/);
  assert.equal((views.match(/editClick\(onEdit, t\.path\)/g) ?? []).length, 2, "tabla y tablero");
  const rest = app.replace(tasks, "");
  assert.doesNotMatch(rest, /<TaskLine[^>]*onEdit=/, "Hoy y Proyecto no cambian");
});

test("formulario: diálogo nativo modal, solo lo cambiado, sin cola sin conexión", () => {
  const form = src("task-form.tsx");
  assert.match(form, /showModal\(\)/);
  assert.match(form, /onCancel=/);
  assert.match(form, /\/api\/task\/create/);
  assert.match(form, /\/api\/task\/update/);
  assert.doesNotMatch(form, /offline|setTaskStatus|\/api\/capture/);
  assert.match(form, /import "\.\/task-form\.css"/);
});
