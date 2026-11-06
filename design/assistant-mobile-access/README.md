# Assistant mobile and Mac–iPhone access proposals

Visual prototypes only. No production code, real model calls, installation, access links or credential changes. User approved mockups before choosing an implementation.

## Directions

1. **Conversación tranquila** — `01-calm-conversation.html`: Prioriza conversar y revisar cambios sin ruido; ofrece menos información de agenda en la pantalla inicial.
2. **Tu día, conversado** — `02-day-companion.html`: Da orientación y hace visible el estado del sistema; incorpora más elementos y deja menos espacio inicial al diálogo.
3. **Conversación con capas** — `03-layered-conversation.html`: Máximo foco y separación entre pensar y actuar; historial y gestión quedan un nivel más adentro.

Recommended starting point: 01, the conversation-first layout. The other directions are alternatives, not additional features.

## Try the prototypes

- Toggle light/dark theme.
- Simulate the Mac being offline: messages and approvals become unavailable, but existing conversation stays readable.
- Review the exact sample note moves, cancel or explicitly confirm the simulation. No real notes change.
- Open the proposed provider/model control (only a local visual selection) and iPhone installation guidance.
- Send a sample message. Responses are static mock content, never Hermes output.

## Design system and validation boundary

Uses `design/system.md`, derived from `web/src/app.css` and `web/src/quick.css`: 25 color tokens, two themes, system font fallbacks only, existing component radii and shadows. No external assets. Each artboard has its own inline styles, SVG and script plus a CSP that prevents network requests.

Prototype state does not persist. Settings, start-at-login, the Mac menu/launcher, and the guided iPhone setup are proposals, not implemented functionality. The Mac must still be reachable for the real mobile assistant; visual checks do not establish Docker or physical iPhone compatibility. Optional local embeddings remain out of scope.

## Observed checks

- Structural check passed for all three artboards: manifest paths, Spanish language, inline-only assets, source palette, system fonts, focus/reduced-motion rules and JavaScript syntax.
- Chromium passed at 1440 px and 390 px: page/phone overflow, open/cancel/confirm review, model visual selection, installation guidance, Escape, theme toggle, simulated offline state, sample messages and reduced-motion preference. The system board rendered 25 swatches.
- All 44 text/surface contrast combinations across both themes passed 4.5:1; minimum measured 5.43:1.
- Screenshot inspection found the initial review button in direction 01 below the fold. The first adjustment passed desktop but still clipped it by 11.53 px in the narrow view; the second spacing adjustment passed both. Final review button bottom / scroll bottom: 746.39 / 779.66 px at desktop, 899.67 / 908.14 px at narrow view. Only direction 01 was changed during this refinement.
- No meaningful production RED/GREEN applies to this visual-only deliverable. Production tests/build were not rerun because no app, server, dependencies or production test files changed. Real Mac, Docker execution and physical iPhone testing remain outside this mockup validation.
- No canvas comments were received or resolved. No commits or publication were requested for these prototypes.
