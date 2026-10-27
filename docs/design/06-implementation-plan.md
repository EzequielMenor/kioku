# Plan de implementación

## V1 (hecho)
1. Núcleo: vault seguro, parser Markdown/frontmatter, índice SQLite+FTS5, enlaces/backlinks.
2. Captura con gramática (`t`, `d`, `n`, fechas, `@proyecto`, `p1..p3`), Bandeja.
3. Tareas y proyectos tipados; "Hoy" explicable; tarjeta de retomar (checkpoint, decisiones, abiertas, tocadas).
4. Foco con aparcado de capturas y checkpoint al terminar.
5. Propuestas (aprobación obligatoria) + triage por reglas + `contextFor`.
6. Daemon + API + SSE; CLI; Quick y Workspace (Preact + CodeMirror 6).
7. Export/restore, import de Obsidian de solo lectura.

## Hecho tras la V1
- Servicio systemd de usuario (`jarvis service install|uninstall|status`).
- Vista de grafo (global y local por nota; canvas propio, sin dependencias).
- Vistas Tabla y Tablero de tareas (ordenar, mover entre estados; escriben `status` en el Markdown).
- Proveedor LLM opcional (API compatible con OpenAI: Ollama/llama.cpp/API con clave propia): `jarvis ai …` y panel en Propuestas.
- Bases de datos (D-17): Tabla / Tablero / Lista sobre cualquier carpeta, tipo o etiqueta, con propiedades tipadas, filtros, orden, agrupación, columnas y vistas guardadas en Markdown; panel de propiedades genérico en cada nota; el asistente las consulta y añade filas. Ver `05-data-model.md`.
- Asistente (Hermes en jaula): herramientas con niveles y Deshacer, propuestas, memoria visible, mantenimiento, diálogos propios, `jarvis ask`. Ver `07-assistant-spec.md`.

## Después (por prioridad)
1. Bases de datos, siguientes pasos: vista Calendario y Galería, relaciones entre bases y rollups, fórmulas, plantillas de fila, herramienta del asistente para crear bases (hoy solo filas).
2. Renombrar nota reescribiendo enlaces entrantes (vía propuesta).
3. Más usos de IA (resumir proyecto, sugerir enlaces) con el mismo patrón: payload visible → confirmación → propuesta.
4. Plantillas, recurrencia de tareas, recordatorios.
5. `.desktop`/empaquetado; sincronización opcional cifrada (fuera del núcleo).

## Criterios de aceptación V1
- Capturar desde Quick sin ratón y que aparezca en la Bandeja.
- Reabrir tras días y ver en Hoy el siguiente paso y el checkpoint del proyecto.
- Cualquier modificación sugerida requiere aprobación visible.
- Borrar `.jarvis/index.db` y reindexar produce el mismo resultado.
