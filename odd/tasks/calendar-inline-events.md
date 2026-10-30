# Calendar: create and edit events in place (JARV-26)
Branch `feat/JARV-26-calendar-inline-events` (from `feat/JARV-25-calendar-24h-week`); local work-unit commits only, no push. Checks: `npm test`, `npm run typecheck`, `npm run build:web`.

## Specs
S1. Create: "clic/arrastre en un hueco, solo título + Enter".
S2. Create: "campo de una línea con texto natural (\"gym mañana 18-19\"). Ambas vías."
S3. Edit: "clic en un evento abre panel con todos los campos editables en el sitio".
S4. Edit: "mover arrastrando, redimensionar por el borde, duplicar, borrar con deshacer".
S5. "Todo lo demás (tarea, proyecto, notas) es opcional y se añade después."
S6. User decision on surface: "Cuadrícula horaria en Día" (time grid in the Day view; the current list stays as an alternative view).

## Tasks
T1 | S3,S4 | inline | done | Core + API: update (title, kind, start, end), delete to trash, restore from trash; new routes stay desktop-only (mobile 403, JARV-22). RED 2+1 failing then GREEN; suite 342/342, typecheck GREEN. Risk: item 1 (deleting stored data; recoverable via trash+restore).
T2 | S2 | inline | done | Pure parser src/core/quick-add.ts (hoy/mañana/weekday/ISO/d/m/«5 de noviembre», ranges, single time + duration, clear errors). RED module-not-found then 4/4 GREEN, typecheck GREEN. Risk: none.
T3 | S1,S4,S6 | inline | pending | Grid layout model (overlap columns, 15-min snapping, pointer↔time) with tests.
T4 | S1,S2,S6 | inline | pending | Day time grid UI + create by click/drag with title+Enter + one-line quick add.
T5 | S3,S4 | inline | pending | Edit panel in place, move/resize by pointer, duplicate, delete with undo; docs/changelog/08-calendar.md; Chromium check.

## Log
L1. Original request: "no, ahora el 26" (JARV-26, ProjectOS).
L2. Surface decision: "Cuadrícula horaria en Día (Recomendado)".
