# Validación V1 (2026-10-26)

## Verificado
- `npm test`: 35/35. Incluye reindex incremental == desde cero, conflicto por hash, propuestas con precheck, seguridad Host/Origin/Content-Type, rutas no permitidas.
- `npm run typecheck` sin errores; `npm run build:web` → app.js 598 KB, quick.js 16 KB.
- CLI con `JARVIS_HOME` temporal: add/today/resume/search/proposals/triage.
- UI: daemon temporal + Chromium headless con CDP; capturas con REA (`capture_web_screenshot`) de **Hoy** y **Proyecto** (tarjetas, checkpoint, decisiones, tareas, editor CodeMirror con resaltado, panel de propiedades y backlinks). Nada se hizo sobre datos reales.
- Quick en Hyprland 0.56 real (config Lua): `jarvis quick` crea la ventana flotante 700×150 centrada en el workspace especial `jarvis`, alterna mostrar/ocultar, y `POST /api/desktop/quick/hide` la oculta. Se corrigieron dos fallos hallados al probar: `hyprctl dispatch exec [reglas]` ya no existe (ahora `hyprctl eval` con `hl.dsp.exec_cmd(cmd, {reglas})`) y un perfil de Chromium compartido con el Workspace impedía aplicar las reglas.
- Editor: escribir, autocompletado `[[`, autoguardado con frontmatter intacto (probado por CDP).

- Grafo (global y local): capturas con 33 notas enlazadas; layout con auto-encuadre. Test de `Index.graph` (enlaces rotos ignorados, foco por saltos).
- Tabla y Tablero de tareas: capturas; mover una tarjeta de «Pendiente» a «En curso» desde la UI escribió `status: doing` (comprobado en `/api/tasks`).
- IA real: tests con `fetch` simulado (hash obligatorio, rutas inventadas descartadas, clave ausente, errores HTTP, registro `ai.request`) y E2E CLI+UI contra un servidor compatible con OpenAI falso en 127.0.0.1. **No probado con un modelo real** (no hay Ollama en la máquina).
- Servicio systemd: código y unidad escritos; **no instalado** (el sistema de permisos bloqueó la instalación sin tu orden expresa). Instálalo tú: `jarvis service install`.

## No verificado todavía
- El bind de teclado real (`contrib/hyprland-bind.lua`): lo añade el usuario; se probó el comando `jarvis quick`, no la pulsación.
- Ctrl+Enter y el aviso de conflicto externo del editor solo por revisión de código; sin test E2E.
- Paleta, captura modal, fin de foco y propuestas en UI: construidas y tipadas, sin captura de pantalla.
- REA: el análisis completo de los bundles de Notion se agotó (300 s); la investigación usa evidencia parcial y documentación (ver `docs/research`).

## Falta / siguientes pasos
Ver `06-implementation-plan.md`.

## Seguridad de datos
La bóveda de Obsidian (`~/Documents/Mi espacio`) no se ha leído ni modificado. `guardHome` impide usarla como vault de JARVIS; la importación es opt-in y de solo lectura sobre el origen.
