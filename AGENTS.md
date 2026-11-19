# Kioku — notas para agentes

## Gestión de tareas

Este repositorio se gestiona en ProjectOS (servidor MCP `projectos`), proyecto **JARV**.
Antes de empezar trabajo nuevo, usa `next_work` con `project: "JARV"`. Referencia los issues por clave (JARV-12) en
commits y registra los commits como evidencia con `log_progress` / `complete_issue`.

## Reglas del proyecto

- Los datos del usuario (su bóveda de Obsidian, `~/.hermes`, `~/.config`) no se tocan: las pruebas usan vaults y `KIOKU_HOME` temporales.
- Sin instalar software global ni operaciones destructivas sin preguntar.
- TDD: `npm test` y `npm run typecheck` en verde antes de dar algo por hecho. Web: `npm run build:web`.
- Diseño: `docs/design/` (spec del asistente en `07-assistant-spec.md`, decisiones D-xx en `02-TRD-architecture.md`); validación en `docs/validation.md`.
- Si el MCP projectos no está disponible, se puede empezar trabajo local sin next_work. Registrá el avance en odd/tasks/ y no inventes claves de issues ni registros deProjectOS.

<!-- agentes-dev: inicio -->
Trabaja en el worktree de la tarea y conserva los cambios que ya encuentres.
Resuelve directamente las tareas pequeñas. Delega solo una parte independiente cuando el contexto o el tiempo lo justifiquen.
Antes de terminar, revisa el diff y ejecuta las comprobaciones del proyecto que correspondan. Al entregar, indica el resultado real y lo pendiente.
Solicita autorización antes de publicar, destruir datos o ampliar el ámbito de trabajo. Mantén las credenciales fuera del código, los logs y la memoria.

Abre Claude para UI y UX, Antigravity para backend o investigación y Command Code para trabajo general y revisión. Puedes cambiar de agente sin cambiar el worktree ni las reglas del proyecto.

Si una decisión previa es relevante, usa el servidor local `engram-compartido`. Confirma el proyecto con `mem_current_project` y busca con su ID explícito. Abre únicamente las observaciones que necesites.
Guarda solo decisiones duraderas, causas confirmadas y descubrimientos con evidencia. Reutiliza una clave temática estable. Si un proyecto nuevo aún no tiene recuerdos y Engram rechaza su nombre explícito, confirma primero el ID devuelto, omite `project` y `session_id` en la primera escritura y verifica después por el ID explícito.
<!-- agentes-dev: fin -->
