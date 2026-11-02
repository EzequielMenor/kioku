# MVP: complete agent + notifications for tasks and events
Branch `feat/mvp-notifications` (from `mvp`); local work-unit commits only, no push. Checks: `npm test`, `npm run typecheck`, `npm run build:web`.

## Specs
S1. "100% lo del agente tiene q estar dentro" → decision: "Solo portátil, pero completo" (assistant stays desktop-only; verified end to end, no gaps).
S2. "notificaciones para las tareas y eventos" → decision: "Ambas" (desktop notification and iPhone push; desktop first, push second).
S3. Events notify a configurable lead time before `start` (default 10 min); tasks with `due` notify in a daily digest at a configurable hour (default 09:00) and when overdue. Each notification fires once (ledger), survives restarts.
S4. Private folders (`.kioku/mobile.json` exclude) never appear in a push payload or subscription-visible data.
S5. Push is opt-in from the installed PWA ("Más"); VAPID keys generated locally; payload encrypted (RFC 8291) with node:crypto, no new dependencies.

## Tasks
T1 | S1 | inline | done | Gap found: assistant had no calendar tools. Added list_events (read, hides excluded task/project links) and create_event (auto, undoable, validates end>start) + prompt line. RED 3 failing, then GREEN; suite 418/418, typecheck GREEN. Real Hermes on temp vault created and read back an event. Risk: none (adds tools; existing tool contracts unchanged).
T2 | S3 | inline | pending | Pure scheduler: given vault state + now + ledger, returns notifications due; config `.kioku/notifications.json`; tests.
T3 | S2,S3 | inline | done | src/server/notifier.ts (channels, per-channel ledger .kioku/notify-<name>.json, retry on failure, 7-day prune) + desktopChannel (notify-send) started by the daemon. RED module-not-found, then 4/4 GREEN; suite green, typecheck GREEN. Live smoke: temp daemon + event in 3 min fired at once, ledger written, notify-send exit 0. Risk: none (new module; daemon start adds a timer).
T4a | S4,S5 | inline | done | src/server/webpush.ts: RFC 8291 encryption (matches the RFC test vector byte for byte), VAPID ES256 JWT (verified with the public key), endpoint allowlist (SSRF), 0600 keys, store read from disk each time, push channel (410 removes sub). 9 tests GREEN.
T4b | S2,S4 | inline | done | Routes GET /api/push/key, POST subscribe/unsubscribe (mobile allowlist adds the two POSTs; 404 when push is off), `kioku pair --revoke` clears subscriptions, daemon wires PushStore + pushChannel with mobile.json exclusions (+ hidden calendar paths); notifier fails closed when a channel cannot compute exclusions and hides tasks of hidden projects. RED 3+1, GREEN; suite 440/440, typecheck GREEN. Risk: items 2, 3 (new routes in the mobile allowlist; additive).
T4c | S2,S5 | delegated (context backstop) | pending | Service worker push + notificationclick handlers, web/src/push.ts (subscribe/unsubscribe), opt-in button in «Más».
T5 | S1-S5 | inline | pending | Docs, CHANGELOG, validation, iPhone checklist.

## Log
L1. "vale q entra en el mvp, 100% lo del agente tiene q eestar dentro, y me gustaria añadir notificaciones para las tareas y eventos sbs"
L2. Decisions: agent scope = "Solo portátil, pero completo"; notifications = "Ambas".
L3. Slice boundary: T1 (assistant calendar tools) is slice 1; T2+T3 (scheduler + desktop) slice 2; T4 (push) slice 3 on its own commit (risk items 2, 3); T5 docs closes.
L4. Slice boundary: T4a+T4b (push backend, own commit set because Risk names items 2, 3) is slice 3; T4c UI is slice 4; T5 docs closes.
