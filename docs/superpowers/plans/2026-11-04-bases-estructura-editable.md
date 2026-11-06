# Bases: estructura editable — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editar la estructura de una base (propiedades, tipos, opciones con color) desde la cabecera de la tabla; renombrar/borrar reescribe las notas-fila con confirmación y Deshacer.

**Architecture:** Un planificador puro (`src/core/database-schema.ts`) convierte una operación de esquema en un plan (nuevo `properties`, nuevas `views`, ediciones por fila). `Kioku.editDatabase` lo aplica de forma atómica y en serie, y el servidor envuelve la llamada con `UndoStore` (instantánea multi-fichero ya existente). La UI Preact añade un `Popover`, un menú de cabecera y un selector de opciones sobre `web/src/databases.tsx`, partido antes en ficheros.

**Tech Stack:** TypeScript (Node 24, sin build en servidor), Preact 10 + esbuild, `yaml` (ya usado en `src/core/markdown.ts`), `node:test`. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-04-bases-estructura-editable-design.md` · Issue ProjectOS: **JARV-35**

## Global Constraints

- Los datos del usuario (bóveda de Obsidian, `~/.hermes`, `~/.config`) no se tocan: toda prueba usa `tmpVault()` (`test/helpers.ts`) y `KIOKU_HOME` temporal.
- Sin dependencias nuevas ni instalaciones globales. Textos de UI y errores en español.
- Markdown es la fuente de verdad; `index.db` sigue derivado. No hay tabla nueva en el índice (D-17).
- `Column.options` pasa a `PropOption[]` = `{ name: string; color?: OptionColor }[]`; `OptionColor` = `gray | brown | orange | yellow | green | blue | purple | red`. Una opción sin color se escribe como string; con color, como `{ name, color }`.
- Columnas de sistema (`title`, `tags`, `path`, `type`, `mtime`): no se renombran, no cambian de tipo, no se borran. `tags` y `mtime` solo se ocultan en la vista.
- Nombres de propiedad reservados (rechazados, sin distinguir mayúsculas): `id, type, created, title, tags, parked, path, mtime, source, properties, views`. Tampoco pueden colisionar (sin distinguir mayúsculas, NFC) con otra propiedad del esquema ni con una clave presente en alguna fila.
- Móvil: sin edición de esquema; las rutas nuevas **no** entran en `WRITES` de `src/server/mobile.ts` (el rol `mobile` recibe 403).
- Verificación al cerrar cada tarea: `npm run typecheck` y los tests citados en verde. Antes del commit final de la rama: `npm test` y `npm run build:web`.
- Commits: mensaje con la clave `JARV-35`, **sin** trailer `Co-Authored-By` (regla del usuario: el historial va solo a su nombre). Añadir ficheros por nombre, nunca `git add -A`.
- **Entorno:** el árbol principal tiene cambios ajenos sin commitear en el asistente (`src/assistant/engine.ts`, `src/assistant/model-config.ts`, tests `assistant-*`/`mobile-role`) y `npm test` da 17 fallos allí. No son de este trabajo. Ejecutar el plan en un worktree desde `9894fbb` (skill `superpowers:using-git-worktrees`), anotar allí la línea base de `npm test` (último estado conocido: 459/459) y no tocar esos ficheros.

## Review Focus

1. **Fechas y comentarios al renombrar:** una fila con `Fecha: 2026-10-27` (sin comillas) y un comentario YAML debe quedar byte a byte igual salvo la clave. → test en Task 2 y Task 5.
2. **Colisión solo en algunas filas o por mayúsculas** (`autor` vs `Autor` presente en una fila): se rechaza y no se escribe nada. → Task 3 y Task 5.
3. **Edición externa entre la vista previa y la aplicación** (aparece una fila nueva o cambia una): el lote entero aborta sin escritura parcial. → Task 5.
4. **Una fila con YAML inválido** dentro de la base: la operación aborta nombrando la ruta, sin dejar la base a medias. → Task 5.
5. **Vistas escritas a mano y campos desconocidos en `properties`** se conservan; una vista que usaba la columna borrada no queda con referencias colgantes. → Task 3.

---

### Task 1: Opciones con color en el modelo (`PropOption`)

**Files:**
- Modify: `src/core/database.ts` (tipos, `parseDatabase`, `availableColumns`, `queryRows`)
- Modify: `src/assistant/tools.ts:104-125` (`query_database` sigue devolviendo solo nombres)
- Modify: `web/src/types.ts:29` (reexportar `PropOption`, `OptionColor`), `web/src/databases.tsx` (usos de `col.options`)
- Test: `test/database.test.ts`, `test/assistant-databases.test.ts`; revisar aserciones de `options` en `test/databases.test.ts` y `test/server.test.ts`

**Interfaces:**
- Produces (`src/core/database.ts`):
  `export type OptionColor`, `export const OPTION_COLORS: readonly OptionColor[]`,
  `export interface PropOption { name: string; color?: OptionColor }`,
  `PropSchema.options?: PropOption[]`, `Column.options?: PropOption[]`,
  `export function serializeOptions(options: PropOption[]): (string | { name: string; color: OptionColor })[]`.

- [ ] **Step 1: Tests en `test/database.test.ts`** (fallan antes de implementar):
  - `parseDatabase normaliza opciones de texto y {name,color}`: `options: ["A", {name:"B",color:"green"}, {name:"C"}]` → `[{name:"A"},{name:"B",color:"green"},{name:"C"}]`, `warnings` vacío.
  - `un color desconocido se descarta con aviso y la opción se conserva`: `{name:"B",color:"fucsia"}` → `[{name:"B"}]` y `warnings.length === 1` con `/color/`.
  - `las opciones duplicadas (sin distinguir mayúsculas) se descartan`.
  - `availableColumns y queryRows devuelven options como PropOption[]`; `agrupar sigue ordenando por el orden de las opciones del esquema`.
  - `serializeOptions: sin color → string, con color → objeto`.
- [ ] **Step 2:** `node --test test/database.test.ts` → FAIL.
- [ ] **Step 3:** Implementar en `database.ts`: parseo tolerante de cada entrada (string u objeto con `name` string; entradas inválidas se descartan en silencio como hace `strArr`; color desconocido → aviso `Propiedad «k»: color desconocido «x»`); `queryRows` usa `options.map(o => o.name)` para ordenar grupos.
- [ ] **Step 4:** Test en `test/assistant-databases.test.ts`: `query_database devuelve las opciones solo como nombres` (columna `Estado` → `options: ["Quiero leer","Leyendo","Leído"]`). Implementar el mapeo en `tools.ts` (las columnas devueltas llevan `options?: string[]`).
- [ ] **Step 5:** Adaptar `web/src/databases.tsx` (filtros, `Cell` select, `Board`) para leer `o.name`; ajustar las aserciones previas de `options` en los tests existentes.
- [ ] **Step 6:** `node --test test/database.test.ts test/databases.test.ts test/assistant-databases.test.ts test/server.test.ts` y `npm run typecheck` → PASS.
- [ ] **Step 7: Commit** `feat(bases): opciones con color en el modelo (JARV-35)`.

### Task 2: `renameFrontmatterKey` (YAML sin reformatear)

**Files:**
- Modify: `src/core/markdown.ts` (junto a `setFrontmatter`, línea ~146)
- Test: `test/markdown.test.ts`

**Interfaces:**
- Produces: `export function renameFrontmatterKey(text: string, from: string, to: string): string` — renombra la clave conservando valor, posición, comentarios y el resto del texto; si `from` no existe devuelve `text` idéntico; lanza `Error` si el YAML es inválido o si `to` ya existe.

- [ ] **Step 1: Tests** (`test/markdown.test.ts`): (a) `Fecha: 2026-10-27 # nota` → `Publicado: 2026-10-27 # nota` byte a byte, resto del fichero intacto; (b) valor entrecomillado y lista siguen igual; (c) clave ausente → texto idéntico; (d) `to` existente → lanza; (e) YAML inválido → lanza `/inválido/`.
- [ ] **Step 2:** `node --test test/markdown.test.ts` → FAIL.
- [ ] **Step 3:** Implementar con `YAML.parseDocument(fmText)`: localizar el `Pair` por clave y reasignar solo el nodo clave (los `Date` y escalares se conservan porque no se re-serializan los valores); reutilizar `splitFrontmatter`.
- [ ] **Step 4:** PASS + `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(markdown): renombrar claves de frontmatter sin reformatear (JARV-35)`.

### Task 3: Planificador puro — operaciones de propiedad

**Files:**
- Create: `src/core/database-schema.ts`
- Test: `test/database-schema.test.ts` (nuevo)

**Interfaces:**
- Consumes: `parseDatabase`, `propType`, `cellValue`, `DbRow`, `OptionColor`, `PropType` (Task 1).
- Produces:
  ```ts
  export type SchemaOp =
    | { op: "add-property"; name: string; type: PropType }
    | { op: "rename-property"; name: string; to: string }
    | { op: "set-type"; name: string; type: PropType }
    | { op: "delete-property"; name: string }
    | { op: "add-option"; prop: string; option: string; color?: OptionColor }
    | { op: "rename-option"; prop: string; option: string; to: string }
    | { op: "set-option-color"; prop: string; option: string; color: OptionColor | null }
    | { op: "reorder-options"; prop: string; options: string[] }
    | { op: "delete-option"; prop: string; option: string; clear?: boolean };
  export type RowEdit =
    | { path: string; kind: "rename-key"; from: string; to: string }
    | { path: string; kind: "delete-key"; key: string }
    | { path: string; kind: "set-value"; key: string; value: unknown }; // null = quitar la clave
  export interface SchemaPlan { properties: Record<string, unknown>; views: unknown[] | undefined; rowEdits: RowEdit[]; summary: string }
  export class SchemaError extends Error {}
  export const RESERVED_NAMES: ReadonlySet<string>;
  export function planSchemaOp(raw: { properties?: unknown; views?: unknown }, rows: DbRow[], op: SchemaOp): SchemaPlan;
  ```
  `raw` es el frontmatter de la base tal cual; `rows` ya son las filas de esa base. `views: undefined` = sin cambios. `summary` en español, p. ej. `Renombrada «Autor» → «Escritor» (2 notas)`.

- [ ] **Step 1: Tests** (`test/database-schema.test.ts`, filas con un helper `row(path, fm)`):
  - `add-property crea la entrada {type}, sin ediciones de fila`; rechaza `Title`, `tags`, vacío, y `autor` si una fila ya tiene `Autor`.
  - `rename-property` mueve la entrada conservando orden y campos desconocidos (`{type:"text", description:"x"}`), actualiza `columns`, `filter[].prop`, `sort[].prop` y `group` de **todas** las vistas (incluida una vista escrita a mano con campo extra `foo: 1`, que se conserva) y genera `rename-key` solo para filas que tienen la clave; `autor`→`Autor` (mismo nombre, otra caja) se permite; colisión con otra clave lanza `SchemaError`.
  - `set-type` a `select`: siembra `options` con los valores distintos de las filas (arrays aplanados, máx. 50, sin color); de `select` a `text` descarta `options`; sin `rowEdits`.
  - `delete-property`: quita entrada, la quita de `columns`/`filter`/`sort` y pone `group` a null si era ella; `delete-key` en las filas que la tienen.
  - Propiedad solo inferida (sin entrada en `properties`): `rename-property` funciona; `set-type` crea la entrada.
  - Columnas de sistema (`title, tags, path, type, mtime`) y propiedad inexistente → `SchemaError`.
- [ ] **Step 2:** `node --test test/database-schema.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `planSchemaOp` para las cuatro operaciones de propiedad. Trabaja sobre copias profundas de `raw.properties`/`raw.views` (nunca muta la entrada). Comparación de nombres con `normalize("NFC").toLowerCase()`.
- [ ] **Step 4:** PASS + `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(bases): planificador de esquema — operaciones de propiedad (JARV-35)`.

### Task 4: Planificador puro — operaciones de opción

**Files:**
- Modify: `src/core/database-schema.ts`
- Test: `test/database-schema.test.ts`

**Interfaces:**
- Consumes: `planSchemaOp`, `SchemaOp`, `RowEdit` (Task 3), `serializeOptions` (Task 1).
- Produces: `planSchemaOp` soporta `add-option`, `rename-option`, `set-option-color`, `reorder-options`, `delete-option`. Requiere que el tipo efectivo (`propType`) de `prop` sea `select` o `multi`; si la propiedad no tiene entrada, se crea con ese tipo.

- [ ] **Step 1: Tests:**
  - `add-option` añade al final (con/sin color); duplicada sin distinguir mayúsculas/acentos de caja (`leído` vs `Leído`) → `SchemaError`; sobre propiedad `text` → `SchemaError`.
  - `rename-option`: actualiza `options`, filtros `is|is_not|contains` de las vistas con ese valor y genera `set-value` para filas con valor escalar igual **y** para arrays que lo contienen (orden conservado); `to` existente → `SchemaError`.
  - `set-option-color`: pone/quita color (`null`); color fuera de `OPTION_COLORS` → `SchemaError`.
  - `reorder-options`: solo acepta una permutación exacta de los nombres actuales.
  - `delete-option` sin `clear`: sin `rowEdits`; con `clear: true`: `set-value` con `null` (escalar) o el array sin ese elemento (`null` si queda vacío).
  - Las opciones se escriben con `serializeOptions` (string vs objeto).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS + typecheck.
- [ ] **Step 5: Commit** `feat(bases): planificador de esquema — operaciones de opción (JARV-35)`.

### Task 5: `Kioku.planDatabaseEdit` y `Kioku.editDatabase` (atómico y en serie)

**Files:**
- Modify: `src/core/kioku.ts` (junto a `saveView`/`mutateViews`, ~línea 427-466)
- Test: `test/databases.test.ts`

**Interfaces:**
- Consumes: `planSchemaOp`, `SchemaOp`, `SchemaError`, `RowEdit` (Tasks 3-4); `renameFrontmatterKey` (Task 2); `setFrontmatter`; `matchesSource`; `this.viewsQueue` (reutilizar la misma cola serie de `mutateViews`).
- Produces:
  ```ts
  planDatabaseEdit(rel: string, op: SchemaOp, opts?: { skip?: (path: string) => boolean }): { paths: string[]; summary: string; affected: number }
  async editDatabase(rel: string, op: SchemaOp, opts?: { skip?: (path: string) => boolean; expect?: string[] }): Promise<{ note: NoteRow; paths: string[]; summary: string; affected: number }>
  ```
  `paths` = la base primero y luego las filas editadas; `affected` = nº de filas editadas. Cualquier `SchemaError` sale como `VaultError("invalid", mensaje)`.

- [ ] **Step 1: Tests** (`test/databases.test.ts`, base «Libros» con 3 filas vía `createRow`):
  - `editDatabase rename-property reescribe base y filas`: `Autor`→`Escritor`; las filas con la clave la renombran, la fila sin ella no cambia (mismo texto); `queryDatabase` expone `Escritor`; `affected === 2`.
  - `renombrar conserva fechas sin comillas y comentarios` (fila con `Fecha: 2026-10-27 # x`).
  - `colisión: lanza invalid y no cambia ningún fichero` (comparar texto de todos los ficheros antes/después), también con `autor` vs `Autor` solo en una fila.
  - `expect: si tras planificar aparece otra fila afectada, lanza conflict y no escribe nada`.
  - `fallo a mitad de lote: se restauran los ficheros ya escritos` (sustituir `j.vault.write` por una función que lance en la 3.ª llamada; comprobar textos originales).
  - `una fila con YAML inválido aborta nombrando su ruta, sin escribir nada`.
  - `skip: las filas excluidas no se tocan ni aparecen en paths`; `filas de otra base con la misma clave no se tocan`.
  - `dos ediciones simultáneas se aplican las dos` (`Promise.all` de dos `add-property`).
  - `planDatabaseEdit` no escribe y devuelve los mismos `paths/affected` que luego aplica `editDatabase`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. Dentro de la cola: leer la base desde el **texto** (como `mutateViews`) → `parseDatabase` con ese frontmatter → filas = `index.noteRows()` filtradas por `skip` y `matchesSource` → `planSchemaOp` → comprobar que `paths ⊆ expect` (si hay) → leer texto+hash de cada fila y calcular **todos** los textos nuevos antes de escribir (la base con `setFrontmatter(text, { properties, ...(views ? { views } : {}) })`) → escribir en serie con `vault.write(rel, text, hash)` → si algo falla, `restoreSnapshot` con los textos previos de lo ya escrito y relanzar → `reindexPath` + `changed("note", p)` de cada ruta. `planDatabaseEdit` usa el frontmatter del índice y no escribe.
- [ ] **Step 4:** PASS + typecheck + `node --test test/databases.test.ts test/database.test.ts`.
- [ ] **Step 5: Commit** `feat(bases): editDatabase atómico con rollback (JARV-35)`.

### Task 6: Rutas HTTP con Deshacer + documentación de diseño

**Files:**
- Modify: `src/server/server.ts` (junto a `/api/database/row`, ~línea 470)
- Modify: `test/server.test.ts`, `test/mobile-role.test.ts` (añadir las dos rutas nuevas a la lista `forbidden`)
- Modify: `docs/design/02-TRD-architecture.md` (D-17), `docs/design/07-assistant-spec.md` (formato de `options` en `query_database`), el spec de esta fase (una sola ruta, ver abajo)

**Interfaces:**
- Consumes: `j.planDatabaseEdit`, `j.editDatabase` (Task 5); `UndoStore.capture/commit` (`src/assistant/undo.ts`, instancia `undo` del servidor).
- Produces:
  - `POST /api/database/schema/preview` body `{ path, op }` → `{ affected: number; summary: string }` (no escribe).
  - `POST /api/database/schema` body `{ path, op }` → `{ undoId: string; summary: string; affected: number }`.
  - Desviación del spec (más simple): **una** ruta con `op` etiquetado en lugar de `/property/*` y `/option/*`; actualizar la sección 2 del spec.
  - El Deshacer se hace con el `POST /api/assistant/undo { id }` existente; el registro lleva `sessionId: "ui"`, `tool: "database.<op.op>"`.

- [ ] **Step 1: Tests** (`test/server.test.ts`, helper `setup()` existente):
  - `schema/preview` devuelve `affected` y no cambia ficheros.
  - `schema` renombra y devuelve `undoId`; `POST /api/assistant/undo` restaura base y filas (texto idéntico al original).
  - Tras editar una fila a mano, el undo devuelve 409 y no pisa nada.
  - `op` ausente/desconocida o nombre reservado → 400; ruta a una nota que no es base → 400; base inexistente → 404.
  - En `test/mobile-role.test.ts`: ambas rutas → 403 para el rol `mobile`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar: validar que `body.op` es un objeto con `op` string (si no, `HttpError(400)`); `plan = j.planDatabaseEdit(...)`; `snap = await undo.capture(plan.paths)`; `res = await j.editDatabase(path, op, { skip, expect: plan.paths })`; `rec = await undo.commit(snap, { sessionId: "ui", tool: \`database.${op.op}\`, summary: res.summary })`; responder `{ undoId: rec.id, ... }`.
- [ ] **Step 4:** Actualizar D-17 (esquema editable desde la UI, `options` con color, reescritura atómica con Deshacer) y la frase de `07-assistant-spec.md` (el asistente ve solo nombres de opción).
- [ ] **Step 5:** `node --test test/server.test.ts test/mobile-role.test.ts` y `npm run typecheck` → PASS.
- [ ] **Step 6: Commit** `feat(bases): rutas de esquema con Deshacer (JARV-35)`.

### Task 7: Partir `databases.tsx` sin cambiar comportamiento

**Files:**
- Create: `web/src/db-common.ts` (`enc`, `LABEL`, `label`, `READONLY`, `text`), `web/src/db-cells.tsx` (`Cell`), `web/src/db-views.tsx` (`Table`, `List`, `Board`), `web/src/db-panel.tsx` (`OPS`, `ViewPanel`)
- Modify: `web/src/databases.tsx` (queda `DatabasesList` y `DatabaseView`; mismas exportaciones)

**Interfaces:**
- Produces: mismas firmas que hoy (`Cell({ col, row, setCell })`, `Table({ res, view, sortBy, setCell })`, `List({ res })`, `Board({ res, view, available, edit, setCell })`, `ViewPanel({ view, available, edit })`). `App` sigue importando solo `DatabasesList` y `DatabaseView` de `./databases.tsx`.

- [ ] **Step 1:** Línea base: `npm run build:web` y `node --test test/cell-values.test.ts test/task-form-browser.test.ts test/mobile-ux-browser.test.ts` en verde (anotar resultado).
- [ ] **Step 2:** Mover el código tal cual a los ficheros nuevos; ajustar solo imports/exports. Ningún cambio de lógica ni de CSS.
- [ ] **Step 3:** `npm run typecheck`, `npm run build:web` y repetir los tests de Step 1 → mismo resultado.
- [ ] **Step 4: Commit** `refactor(bases): partir databases.tsx en módulos (JARV-35)`.

### Task 8: `Popover`, cliente de esquema y menú de cabecera

**Files:**
- Create: `web/src/popover.tsx`, `web/src/db-schema.ts`, `web/src/db-header-menu.tsx`, `test/db-schema-browser.test.ts` (copiar los helpers `launch/until/click…` de `test/task-form-browser.test.ts:20-60`)
- Modify: `web/src/db-views.tsx` (cabecera de `Table`), `web/src/databases.tsx`, `web/src/app.tsx:130` (`say` admite acción), `web/src/types.ts` (reexportar `SchemaOp`), `web/src/app.css`

**Interfaces:**
- Produces:
  - `Popover({ anchor: HTMLElement | null; label: string; onClose(): void; children })`: `role="dialog"` con `aria-label={label}`, posición fija bajo `anchor`, cierra con Esc y clic fuera, devuelve el foco al `anchor`, atrapa Tab.
  - `editSchema(op: SchemaOp, ctx: { path: string; guard: Guard; say: Say }): Promise<boolean>`: llama a `/api/database/schema/preview`; si `affected > 0` y la operación es `rename-property`, `delete-property`, `rename-option` o `delete-option` con `clear`, pide `askConfirm` indicando «Se reescribirán N notas»; aplica con `/api/database/schema`; muestra toast con acción **Deshacer** que llama a `/api/assistant/undo`. Devuelve `false` si se cancela o falla.
  - `say` pasa a `say(text: string, error?: boolean, action?: { label: string; run(): void })` (en `app.tsx` y en el tipo de la prop de `DatabaseView`); los llamadores actuales no cambian.
  - `HeaderMenu`: botón en cada `<th>` (desktop) que abre el popover `aria-label="Propiedad <nombre>"` con: campo de nombre (Enter renombra), selector de tipo, Orden ↑/↓ (la misma lógica que `sortBy`), «Ocultar en esta vista» (`edit({ columns })`, no escribe) y «Borrar propiedad» (danger). Columnas de sistema: solo orden y ocultar (`title`: solo orden; `tags`/`mtime`: orden y ocultar). En móvil el `<th>` conserva el botón de orden de hoy y no hay menú.

- [ ] **Step 1: Test de navegador** (`test/db-schema-browser.test.ts`, se omite sin Chromium o sin `dist/web`; base «Libros» con 2 filas en vault temporal y `startServer`): (a) abrir `#/bases/Bases/Libros.md`, pulsar la cabecera «Autor», escribir «Escritor», Enter, confirmar → la cabecera muestra «Escritor», el fichero de la fila tiene `Escritor:` y aparece un toast con «Deshacer»; (b) pulsar «Deshacer» → vuelve «Autor» y el fichero recupera `Autor:`; (c) «Ocultar en esta vista» quita la columna, aparece «Cambios sin guardar» y los ficheros no cambian; (d) «Borrar propiedad» + confirmar → la columna desaparece y la clave se quita de las notas; (e) con el rol móvil no existe el menú.
- [ ] **Step 2:** `npm run build:web && node --test test/db-schema-browser.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `Popover`, `db-schema.ts`, `HeaderMenu`; CSS siguiendo los tokens existentes de `app.css`.
- [ ] **Step 4:** `npm run typecheck`, `npm run build:web`, `node --test test/db-schema-browser.test.ts test/mobile-ux-browser.test.ts test/task-form-browser.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(bases): menú de cabecera para editar propiedades (JARV-35)`.

### Task 9: «+ Propiedad», opciones con color y selector con «Crear»

**Files:**
- Create: `web/src/db-add-property.tsx`, `web/src/db-options-editor.tsx`, `web/src/option-colors.ts` (+ `test/option-colors.test.ts`)
- Modify: `web/src/db-header-menu.tsx` (sección Opciones), `web/src/db-cells.tsx` (celda `select`), `web/src/db-views.tsx` (columna final «+»), `web/src/app.css` (clases `opt-gray` … `opt-red` en tema claro y oscuro, siguiendo cómo `app.css` define los otros tokens), `test/db-schema-browser.test.ts`
- Docs: `README.md` (sección «Bases de datos»: propiedades editables desde la tabla, opciones con color), `CHANGELOG.md` (entrada bajo la sección sin publicar; crearla si falta)

**Interfaces:**
- Consumes: `editSchema`, `Popover`, `HeaderMenu` (Task 8); `SchemaOp` (Task 3).
- Produces:
  - `optionClass(color: OptionColor | undefined): string` en `option-colors.ts` (`"opt-green"`, `"opt-none"` si no hay color o es desconocido) y `OPTION_LABELS: Record<OptionColor, string>` (nombres en español).
  - `AddPropertyButton` (desktop): `<th>` final con botón `aria-label="Añadir propiedad"`; popover con nombre + tipo → `editSchema({ op: "add-property", ... })`.
  - `OptionsEditor({ prop, options, apply })`: lista con punto de color (selector de la paleta), renombrar, borrar (pregunta si vaciar el valor en las notas), subir/bajar para reordenar (`reorder-options`) y campo «Nueva opción».
  - Celda `select` en desktop: botón-chip que abre un popover con filtro, las opciones como chips de color, «Vaciar» y **«Crear «X»»** cuando el texto no coincide con ninguna opción (`add-option` y después `setCell`). En móvil se conserva el `<select>` nativo.

- [ ] **Step 1: Tests:** `option-colors.test.ts`: `optionClass("green") === "opt-green"`, `optionClass(undefined) === "opt-none"`, color desconocido → `"opt-none"`, `OPTION_LABELS` cubre `OPTION_COLORS`. Navegador (`db-schema-browser.test.ts`): (a) «Añadir propiedad» con nombre «Editorial» y tipo texto → aparece la columna y `properties` del fichero de la base la contiene; (b) en la columna «Estado»: añadir la opción «Pausado» color verde → el chip de la celda al elegirla tiene clase `opt-green`; (c) escribir «Releyendo» en el selector de una celda → «Crear «Releyendo»» la añade al esquema y la asigna a la fila; (d) renombrar una opción con filas que la usan pide confirmación y actualiza las notas; Deshacer lo revierte.
- [ ] **Step 2:** `npm run build:web && node --test test/option-colors.test.ts test/db-schema-browser.test.ts` → FAIL.
- [ ] **Step 3:** Implementar los componentes y el CSS (contraste legible en ambos temas); documentar README y CHANGELOG.
- [ ] **Step 4:** Verificación completa en el worktree: `npm run typecheck`, `npm run build:web`, `npm test` → sin fallos nuevos respecto a la línea base anotada.
- [ ] **Step 5: Commit** `feat(bases): «+ Propiedad», opciones con color y selector con «Crear» (JARV-35)`.

---

## Self-review

- **Spec coverage:** modelo y compatibilidad (T1) · nombres/validaciones/columnas de sistema/inferidas (T3) · tabla de operaciones propiedad y opción (T3, T4) · atomicidad, serie, `exclude`/`skip`, filas de otra base (T5) · instantánea y Deshacer (T6) · menú de cabecera, «+ Propiedad», opciones con color, «Crear», confirmaciones y toast (T8, T9) · móvil solo lectura (T6 403 + T8 e) · pruebas y docs (T1–T9; D-17, 07-assistant-spec, README, CHANGELOG) · `npm test`/`typecheck`/`build:web` (T9). Desviación declarada: una ruta `/api/database/schema` en vez de `/property/*` y `/option/*`.
- **Consistencia de tipos:** `SchemaOp`, `RowEdit`, `SchemaPlan` definidos en T3 y usados igual en T4–T6 y en la web; `PropOption`/`OptionColor`/`serializeOptions` en T1.
- **Proporción:** el plan es unas 3 veces el spec, con cuerpos de código solo donde el algoritmo no lo fijan las firmas y los tests.
