# Personalización de notas, menú `/` en editor, separación de `/notas` y grafo de conocimiento

## Objetivo

Mejorar la experiencia nativa de escritura y navegación del conocimiento en Kioku manteniendo Markdown local-first + índice SQLite derivable y compatibilidad con el modo Demo y rol móvil:

1. **Renombrado real y personalización de notas**: permitir cambiar título, nombre del archivo `.md` y carpeta/subcarpeta desde la vista de nota (preservando enlaces entrantes y comprobando `baseHash`), más edición directa de etiquetas (`tags`), alias (`aliases`) e icono opcional (`icon`).
2. **Atajos `/` y formato en el editor**: menú contextual al escribir `/` en CodeMirror 6 (encabezados H1–H3, negrita, cursiva, tachado, código en línea, lista de tareas, lista con viñetas, lista numerada, cita, bloque de código, separador, enlace `[[`) y atajos `Mod-b` / `Mod-i`.
3. **Separar `/notas` de tareas, calendario, bandeja y bases**: `NotesView` muestra únicamente notas de conocimiento (`note`, `resource`), con filtro por subtipo y carpeta/subcarpeta.
4. **Grafo solo de conocimiento y más claro visualmente**: `GET /api/graph` (y demo) filtra por defecto a notas de conocimiento (`note`, `resource`), con diferenciación visual por colección/carpeta usando variables CSS del tema, jerarquía por grado/nodos puente, toggle de notas sueltas y etiquetas legibles.

## Problema y por qué

- No existía forma en la UI ni en el servidor de renombrar una nota ni su fichero `.md` sin perder enlaces, ni de editar etiquetas/alias cómodamente sin escribir YAML manual.
- El editor CM6 solo ofrecía autocompletado para `[[`; faltaba un menú `/` rápido para dar formato Markdown.
- `/notas` mezclaba en `"Todas"` tareas, proyectos, capturas, bases de datos y diario aunque ya tienen secciones propias, haciendo fácil perderse.
- El grafo incluía bloques de calendario, tareas, áreas y capturas que metían ruido y visualmente casi todos los nodos parecían iguales.

## Alcance y restricciones

- Fuente de verdad: archivos Markdown; el índice SQLite es derivado/reconstruible.
- Control de concurrencia por `baseHash` (`409` si cambia en disco o colisiona el destino); rechazar operaciones destructivas sobre `block`/`area`/rutas reservadas (`.kioku`, `.obsidian`, `Calendario`, `Areas`).
- Al renombrar una nota, actualizar enlaces `[[...]]` entrantes en notas referenciantes (cuerpo y propiedades YAML) cuando apunten al nombre/ruta anterior.
- Respetar privacidad móvil (`.kioku/mobile.json`): el rol móvil no puede renombrar notas privadas ni mover notas hacia carpetas privadas.
- Paridad completa con `web/src/demo/engine.ts`.
- Colores del grafo exclusivamente mediante variables CSS en `web/src/app.css` (temas oscuro, claro y auto). Sin assets externos.
- **Fuera de alcance**: refactorizar arquitectura del asistente o modificar el worktree raíz sucio.

## Tareas

| ID | Especificación | Ejecutor | Estado | Evidencia |
| --- | --- | --- | --- | --- |
| T1 | `Kioku.renameNote` + `POST /api/note/rename` + actualización de enlaces entrantes + privacidad móvil + demo `/api/note/rename` + tests RED→GREEN | parent | done | `src/core/markdown.ts`, `src/core/kioku.ts`, `src/server/server.ts`, `src/server/mobile.ts`, `web/src/demo/engine.ts`; tests verdes en `test/kioku.test.ts`, `test/server.test.ts`, `test/mobile-role.test.ts`, `test/demo.test.ts` |
| T2 | Personalización y renombrado en `web/src/note-view.tsx` (título, `.md`, carpeta, tags, aliases, icono) + CSS + tests | parent | done | `web/src/note-view.tsx` (`RenameModal`, `ChipListEditor`, selector `Tipo`, selector `NOTE_ICONS`) y `web/src/app.css`; compila con `npm run typecheck` y `npm run build:web` |
| T3 | Menú `/` (`slashCompletions`) y comandos/atajos `Mod-b`/`Mod-i` en `web/src/editor.ts` + helpers puros testeables | parent | done | `web/src/editor-commands.ts`, `web/src/editor.ts` (`interactionDelay: 0`, `Tab` acepta completado), `web/src/app.css`, `web/src/app.tsx`; 4/4 verdes en `test/editor-commands.test.ts` + E2E CM6 en `test/notes-editor-graph-browser.test.ts` |
| T4 | Separación de `/notas` (`NotesView`) solo para `note`/`resource` + carpetas/subcarpetas + búsqueda/etiquetas + tests | parent | done | `web/src/notes-model.ts`, `web/src/app.tsx`, `web/src/app.css`, `src/core/index.ts`, `web/src/types.ts`; verdes `test/notes-model.test.ts` (2/2) + `test/mobile-ux-browser.test.ts` y `test/notes-editor-graph-browser.test.ts` |
| T5 | Grafo solo de conocimiento (`KNOWLEDGE_TYPES`) en `Index.graph`/`GET /api/graph`/demo + diferenciación visual en `web/src/graph.tsx` y `web/src/app.css` + tests | parent | done | `src/core/index.ts`, `src/server/server.ts`, `web/src/demo/engine.ts`, `web/src/graph.tsx`, `web/src/app.css` (`--g-0`..`--g-5`); verdes `test/index.test.ts`, `test/server.test.ts`, `test/mobile-role.test.ts`, `test/demo.test.ts`, `test/web-assets.test.ts` (16/16) + E2E en `test/notes-editor-graph-browser.test.ts` |
| T6 | Verificación completa (`npm run build:web`, `npm run typecheck`, `npm test` + E2E Chromium) tras edición final | parent | done | `npm run typecheck` OK; `npm run build:web` OK (`app.js 996.0kb`, `app.css 67.8kb`); `KIOKU_CHROMIUM=/nonexistent npm test` → 774 pass, 0 fail, 36 skipped; `node --test test/desktop-startup.test.ts` → 4 pass, 0 fail; `node --test test/*-browser.test.ts` → 34 pass, 0 fail |
| T7 | Esquema `add-property` con opciones iniciales opcionales (`options?: PropOption[]`), `updateDatabaseMeta` (`POST /api/database/meta`: título, icono y `source`) y soporte completo de `/api/database/schema*` + `meta` en modo Demo + tests RED→GREEN | parent | done | `src/core/database.ts`, `src/core/database-schema.ts`, `src/core/kioku.ts`, `src/server/server.ts`, `web/src/demo/engine.ts`; verificados en `test/database-schema.test.ts`, `test/databases.test.ts`, `test/demo.test.ts`, `test/demo-publication.test.ts`, `test/server.test.ts`, `test/mobile-role.test.ts` |
| T8 | `AddPropertyButton` tipo Notion (`+ Columna` también fuera de Tabla, presets rápidos como Prioridad Alta/Media/Baja con colores, y chips de opciones iniciales en `select`/`multi`) | parent | done | `web/src/db-add-property.tsx`, `web/src/db-common.ts`, `web/src/app.css`; verificado en `test/db-schema-browser.test.ts` (`+ Columna` → `+ Prioridad` / `+ Etiquetas`) |
| T9 | Bases interactivas tipo Notion: añadir fila al pie de Tabla, al pie de cada carril del Tablero (`+ Añadir` + `+ Nuevo grupo`) y en Lista; `MultiCell` con chips; edición inline de propiedades en tarjetas del Tablero y filas de Lista sin abrir la nota | parent | done | `web/src/db-cells.tsx` (`OptionPickerPopover`, `SelectCell`, `MultiCell`), `web/src/db-views.tsx` (`InlineAddRow`, `CompactPropCell`, `AddLaneColumn`), `web/src/databases.tsx`, `web/src/app.css`; 15/15 verdes en `test/db-schema-browser.test.ts` |
| T10 | Panel `Personalizar` de la base sin entrar en `Definición` (título, icono, origen de filas `source`, visibilidad/gestión de propiedades desde cualquier vista) + CSS + tests E2E Chromium | parent | done | `web/src/db-customize.tsx` (`CustomizePanel`), `web/src/databases.tsx`, `web/src/app.css`; verificado E2E en `test/db-schema-browser.test.ts`; suite completa: `npm run typecheck`, `npm run build:web` (`app.js 1020.5kb`, `app.css 70.4kb`), `KIOKU_CHROMIUM=/nonexistent npm test` (776 pass, 0 fail, 38 skipped), `test/desktop-startup.test.ts` (4/4), `test/*-browser.test.ts` (36/36) |

## Progreso y siguiente paso

- T1–T10 completadas y verificadas al 100 % en servidor, modo Demo (`http://127.0.0.1:4173`) y Chromium E2E.
- Listo para que el usuario lo pruebe y apruebe commitear en `feat/notes-editor-graph`.
