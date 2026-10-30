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
T3 | S1,S4,S6 | inline | done | web/src/calendar-grid.ts pure model (window, overlap columns, midnight clipping, 15-min snapping, create/move/resize ranges). RED module-not-found then 8/8 GREEN, typecheck GREEN. Risk: none.
T4 | S1,S2,S6 | delegated (context backstop) + parent Chromium check | done | DayGrid + QuickAdd wired in Day scope with Cuadrícula/Lista toggle. Chromium (playwright, temp vault) 15/15: drag creates snapped event file, click = 60 min draft, Esc cancels, quick add «gym mañana 18-19» interprets and creates, invalid line creates nothing, list/week unchanged, 390px no overflow, zero console errors. Parent fixed draft focus (autoFocus does not fire on late mount). Suite 354/354, typecheck, build GREEN. Risk: none.
T5 | S3,S4 | inline (worker returned no changes twice) | done | Edit panel (title/kind/start/end/area), Duplicar, Borrar+Deshacer (commit 27c87e3; Chromium 16/16 incl. byte-identical restore) and pointer move/resize with Esc cancel (Chromium 9/9: move, bottom/top resize 15-min snapped, Esc leaves file unchanged, click opens panel); docs/CHANGELOG/validation updated. Suite 356/356, typecheck, build GREEN. Risk: none (area assignment now goes through the edit form; /api/calendar/area unchanged but its form path not covered by a browser check).

## Log
L1. Original request: "no, ahora el 26" (JARV-26, ProjectOS).
L2. Surface decision: "Cuadrícula horaria en Día (Recomendado)".
L3. Slice boundary: commits for T1+T2 (backend + parser, ~460 lines) form slice 1; T3-T5 (grid model + UI) form slice 2.
L4. New routes /api/calendar/update|delete|restore are desktop-only: the mobile allowlist is unchanged (mobile gets 403; mobile editing belongs to JARV-22). Native assess returned unassessable (untracked node_modules symlink in the worktree) with no reviewDue.
L5. Slice boundary: T3+T4 (grid model, grid UI, quick add) are slice 2; T5 (edit, duplicate, delete/undo, pointer move/resize, docs) is slice 3. Delegated T5 to gentle-ai-worker returned without changes; parent continues inline.
L6. Unexplained one-off failure of 1 test in one full run (355/356); not reproduced in 5 later full runs (356/356). Not investigated further.
