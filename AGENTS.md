# JARVIS — notas para agentes

## Gestión de tareas
Este repositorio se gestiona en ProjectOS (servidor MCP `projectos`), proyecto **JARV**.
Antes de empezar trabajo nuevo, usa `next_work` con `project: "JARV"`. Referencia los issues por clave (JARV-12) en
commits y registra los commits como evidencia con `log_progress` / `complete_issue`.

## Reglas del proyecto
- Los datos del usuario (su bóveda de Obsidian, `~/.hermes`, `~/.config`) no se tocan: las pruebas usan vaults y `JARVIS_HOME` temporales.
- Sin instalar software global ni operaciones destructivas sin preguntar.
- TDD: `npm test` y `npm run typecheck` en verde antes de dar algo por hecho. Web: `npm run build:web`.
- Diseño: `docs/design/` (spec del asistente en `07-assistant-spec.md`, decisiones D-xx en `02-TRD-architecture.md`); validación en `docs/validation.md`.
