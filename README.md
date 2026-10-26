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

## Asistente
El asistente es la forma principal de organizar el espacio: pregúntale, pídele que clasifique la Bandeja o que revise el espacio (pestaña **Asistente**, tecla `a`, o `jarvis ask "…"`; en Quick, `a <pregunta>`).
- **Motor:** [Hermes Agent](https://github.com/NousResearch/hermes-agent) con tu suscripción de Codex (`~/.hermes/auth.json`), dentro de una jaula `bwrap`. Requisitos: `bwrap` y Hermes instalado en `~/.hermes`. Comprueba con `jarvis assistant status`.
- **Qué puede hacer:** lo pequeño y reversible lo hace solo y queda con botón **Deshacer** (`jarvis assistant actions|undo <id>`); borrar, mover o tocar más de 5 notas lo deja como **propuesta** que apruebas tú. Responde siempre en español.
- **Qué ve:** solo lo que lee a través de las herramientas de JARVIS (nunca monta tu bóveda). El texto de las notas leídas se envía al proveedor del modelo; cada consulta queda en el log con las notas leídas. Excluye carpetas en `.jarvis/assistant.json` (`{"exclude": ["Privado/"]}`). `Notas/Importado/` es de solo lectura para él.
- **Memoria y skills:** texto plano en `.jarvis/hermes/` (pantalla «Memoria» del asistente); puedes borrarlo. Las exportaciones no incluyen sus credenciales ni logs.

Docs: `docs/research` (Notion/Obsidian), `docs/design` (PRD, TRD, UX, flujos, datos, plan), `docs/validation.md`.
Tests: `npm test` · Tipos: `npm run typecheck`.
