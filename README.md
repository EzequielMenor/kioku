# JARVIS

Segundo cerebro local-first: Markdown en carpeta, índice SQLite derivado, captura instantánea (Quick), espacio de trabajo (Workspace) y propuestas de IA que siempre apruebas tú.

## Uso
```bash
npm install && npm run build:web
bin/jarvis quick        # captura (asigna una tecla de Hyprland, ver contrib/)
bin/jarvis open         # Workspace
bin/jarvis add "t Llamar a Ana !mañana @Proyecto p1"
bin/jarvis today | resume | search | focus start|end | proposals | export | restore
```
Arranque automático (opcional): `jarvis service install` (servicio de usuario de systemd; `uninstall` lo quita).
IA real opcional (desactivada por defecto): `jarvis ai config http://127.0.0.1:11434/v1 <modelo>` (Ollama u otro servidor compatible con OpenAI; para una API remota añade el nombre de la variable de entorno con tu clave). `jarvis ai preview` muestra exactamente qué se enviaría; solo se envía con `jarvis ai triage --yes` o desde Propuestas, y el resultado son propuestas que apruebas tú.
Datos en `~/Documents/Jarvis` (o `JARVIS_HOME`). Tu bóveda de Obsidian **no se toca**: para traerla, `jarvis import-obsidian <ruta>` hace una copia de solo lectura (primero informa; `--yes` aplica).

Docs: `docs/research` (Notion/Obsidian), `docs/design` (PRD, TRD, UX, flujos, datos, plan), `docs/validation.md`.
Tests: `npm test` · Tipos: `npm run typecheck`.
