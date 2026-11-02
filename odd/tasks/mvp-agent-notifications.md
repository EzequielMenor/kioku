# MVP: complete agent + notifications for tasks and events
Branch `feat/mvp-notifications` (from `mvp`); local work-unit commits only, no push. Checks: `npm test`, `npm run typecheck`, `npm run build:web`.

## Specs
S1. "100% lo del agente tiene q estar dentro" → decision: "Solo portátil, pero completo" (assistant stays desktop-only; verified end to end, no gaps).
S2. "notificaciones para las tareas y eventos" → decision: "Ambas" (desktop notification and iPhone push; desktop first, push second).
S3. Events notify a configurable lead time before `start` (default 10 min); tasks with `due` notify in a daily digest at a configurable hour (default 09:00) and when overdue. Each notification fires once (ledger), survives restarts.
S4. Private folders (`.kioku/mobile.json` exclude) never appear in a push payload or subscription-visible data.
S5. Push is opt-in from the installed PWA ("Más"); VAPID keys generated locally; payload encrypted (RFC 8291) with node:crypto, no new dependencies.

## Tasks
T1 | S1 | inline | pending | Verify assistant end to end (status, read, propose, undo, mobile 403) and close gaps found.
T2 | S3 | inline | pending | Pure scheduler: given vault state + now + ledger, returns notifications due; config `.kioku/notifications.json`; tests.
T3 | S2,S3 | inline | pending | Daemon timer + desktop delivery (notify-send) + ledger; docs.
T4 | S2,S4,S5 | inline | pending | Web Push: VAPID, subscribe endpoint (mobile allowlist), encrypted send, SW push/click handlers, opt-in UI. Risk: items 2, 3.
T5 | S1-S5 | inline | pending | Docs, CHANGELOG, validation, iPhone checklist.

## Log
L1. "vale q entra en el mvp, 100% lo del agente tiene q eestar dentro, y me gustaria añadir notificaciones para las tareas y eventos sbs"
L2. Decisions: agent scope = "Solo portátil, pero completo"; notifications = "Ambas".
