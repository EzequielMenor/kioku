# Local connections — JARV-37
Objective: finish the computer-as-hub installation, private connection and sync experience. Branch: feat/local-connections.
Delivery: feature-branch-chain, separate reviewable work units (~800 authored lines forecast); runner: node:test, npm test, npm run typecheck, npm run build:web.

## Specs
S1. User: «pues cierrala». Context requested: «poder instalarlo y gestionar las conexiones mas faicl y tal tambien esta hecho, para poder conectar desde cualquier sitio mas facil y estar sincronizado y tal '?». Deliver a coherent guided install/connect experience using existing capabilities, not a new hosted product.
S2. Selected option: «Tu ordenador como centro». Option description: «Instalación y conexión guiadas con Tailscale; acceso remoto mientras ese ordenador esté encendido.»
S3. Selected delivery: «Feature/tracker branch chain (recommended)». Separate work units; no push or PR authorization.

## Tasks
T1 | S1-S2 | inline (writer admission rejected; runtime explicitly directed inline, no retry) | done | Guided setup/doctor CLI, safe diagnostics and actionable installation/pairing instructions; tests/help/docs | commit pending.
T2 | S1-S2 | delegated (runtime context backstop now fired; independent new UI unit) | in_progress | Discoverable connection/sync panel reusing current health/session/offline state; setup, pairing and revocation guidance; tests/docs | commit pending.
T3 | S1-S3 | inline | pending | Integrate navigation while preserving dirty files, full tests/typecheck/build, independent security verification and native review as due; record commits | commit pending.

## Log
L1. Original implementation request: «pues cierrala».
L2. User selected «Tu ordenador como centro»; no automatic remote exposure, personal-config writes, global installs, cloud hosting or multi-master sync. Existing mobile queue and server permission guards remain authoritative. One shared mobile credential currently exists: do not claim per-device management.
L3. Existing dirty files: package.json, web/src/api.ts, web/src/app.css, web/src/app.tsx, web/src/hooks.ts; untracked .commandcode/, .router-integration-80NOkK/, design/, demo/landing/preview artifacts and bases documents are unrelated. Preserve them; stage only proven task changes. Base commit 5066cc7. New branch feat/local-connections.
L4. Explorer mapped CLI pair/service/desktop, auth gates and offline runtime. Spot check src/cli/pair.ts confirms manual instructions and mobile-key reuse. Do not change server port fallback or systemd lifecycle contracts without necessity; prefer diagnostic mismatch reporting. Runtime network/system changes require explicit user operation and are not executed during development.
L5. Risk: item 2 (pairing secrets and private remote access), item 5 (installation guidance). Independent verifier required after implementation. Forecast ~800 authored changed lines; user chose feature-branch-chain. No external persistent-memory tools are available; Engram mirror unavailable, local document authoritative.
L6. T1 public CLI RED observed: 4/4 failures (commands absent); GREEN: node --test test/setup.test.ts test/pair.test.ts passed 11/11, npm run typecheck passed. T1 remains in progress for docs and diagnostic boundary coverage. Initial worker admission failed before writes; no retry. A subsequent runtime context backstop (81,856 tokens) admitted the independent T2 UI unit as task mw4ubphw-2-p66o. Engram unavailable.
L7. T1 completed: five new CLI tests plus seven existing pairing tests pass; missing/malformed Tailscale, live Host denial, nondefault port, Funnel and no-write guards covered. Worker T2 initially returned partial due to concurrent T1 type error; parent corrected host && union to host ? value : undefined, then typecheck passed. T2 model tests 11/11; integration RED for missing navigation and More active state, GREEN 12/12 after minimal app edits. Build passes. Full suite before navigation: 598/598 passed in 23s. Final integrated suite and Chromium functional checks remain.
L8. UI follows existing Spanish project conventions. This is production implementation, not a new visual-design request; preserve existing design artifacts and do not resync their stale system automatically. Functional browser verification required if a browser tool is available; otherwise report missing proof.
