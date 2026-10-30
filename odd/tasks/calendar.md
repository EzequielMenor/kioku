# Calendar implementation
Implement the approved departures-board calendar; branch: `feature/calendar`.
Delivery: feature-branch-chain, local work-unit commits only; checks: `npm test`, `npm run typecheck`, `npm run build:web`, Chromium.

## Specs
S1. User request: "vale pues lo de dockerfile ya esta subido en main y todo habra q pillar los cambios, ahora cambiamos de rama y quiero hacer lo del calendario ya esta hecho el diseño tmb entonces ya solo quedaria implementarlo y probarlo a ver". Approved design: `docs/design/08-calendar.md`, proposal A in `docs/design/calendar/prototype.dc.html`; implement initial online calendar, not assistant/capture, integrations, recurrence or offline writes.
S2. User choice: "Worktree desde main (recomendado)" and "Un archivo por bloque/evento (recomendado)". Preserve original checkout; use Markdown source of truth, one file per block/event, validated writes; task and block completion remain independent.
S3. User choice: "Cadena sobre rama de funcionalidad (recomendado)". Work-unit commits on feature/calendar; no publishing.
S4. Latest scope: "de momento lo del calendario solo". Online calendar core, API, Day/Week and responsive mobile layout only; do not incorporate unrelated unfinished offline editing.

## Tasks
T1 | S1,S2,S4 | inline (dependent core unit) | done | Local-minute parsing, five states, merged/clipped gaps and estimate validation; RED module-not-found then 3/3 GREEN, typecheck GREEN; commit 65e1013; native assess medium, reviewDue false (under_budget).
T2 | S1,S2,S4 | inline (depends on T1) | done | Markdown create/move/finish, range and estimates; RED undefined calendar then 5/5 calendar tests GREEN and typecheck GREEN; Risk: item 3 (shared note-type recognition); commit 11b7013; suite 273/273 and typecheck GREEN. Native medium, escalated item 3, reviewDue false. Independent verification at T6.
T3 | S1,S2,S4 | delegated (context backstop at 76,822 tokens) | done | Authenticated API, privacy-safe DTOs and mobile reads/writes; Risk: item 2 (new routes preserve mobile privacy). RED 4/5 HTTP failures then 22/22 focused, 278/278 suite and typecheck GREEN; parent spot-check GREEN; commit recorded next.
T4 | S1,S4 | delegated (context backstop) | in_progress | Cohesive calendar UI: Day/Week, gap suggestions, filters, independent completion, accessible moves and responsive detail; commit pending.
T5 | S1,S4 | delegated | dropped | Merged into T4: Day/Week share one component and interaction model; not an independent delivery.
T6 | S1-S4 | inline + independent verify (Risk: item 2, API privacy) | pending | Suite/typecheck/build, isolated Chromium checks, documentation and final verification; commit pending.

## Log
L1. Original request: "vale pues lo de dockerfile ya esta subido en main y todo habra q pillar los cambios, ahora cambiamos de rama y quiero hacer lo del calendario ya esta hecho el diseño tmb entonces ya solo quedaria implementarlo y probarlo a ver".
L2. User selected a separate worktree, Markdown per block/event, feature/tracker delivery chain; origin/main fetched at 97dccb4. Worktree: .superpowers/worktrees/calendar. Existing staged/unstaged mobile changes preserved in original checkout.
L3. Read-only exploration mapped committed core/server/web and found offline mutations are not on main. User clarified: "de momento lo del calendario solo". Offline writes deferred; responsive layout remains in scope.
L4. Use existing bundled fonts (D-20); no new dependencies. Calendar type follows approved design. Prefer derived noteRows read model rather than unnecessary index-schema migration; document this implementation decision. Chromium is installed for browser checks. ProjectOS next_work unavailable (no projectos tools exposed); issue association unavailable.
L5. Forecast: approximately 1800-2600 authored lines across cohesive commits; delivery strategy auto-chain, chain_strategy feature-branch-chain, selected by user. Native review switch on; assess at work-unit boundaries and follow reviewDue. No push, PR or merge authorized.
L6. T3 delegated to gentle-ai-worker mvuuyufp-2-35oe after runtime context backstop. Current plan remains six tasks: T1/T2 verified, T3 active; T4/T5 await API, T6 final. First T2 scratch differential failed preparing base archive, before any behavioral probe; diagnosed a 1.38 MB archive exceeding spawnSync's default buffer. One corrected differential passed: old note/task/project creation, task status and search match exit/stdout/stderr. T3 agent added routes only; its first assessment was unassessable due to untracked files, final committed candidate assessed separately. T4/T5 consolidated into one UI unit; T5 dropped rather than falsely completed.
