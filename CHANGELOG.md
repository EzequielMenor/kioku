# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [0.2.0] — 2026-10-27

### Añadido
- **Bases de datos** al estilo Notion: una base es una nota Markdown (`Bases/<Nombre>.md`) cuyas filas son notas normales. Propiedades tipadas (texto, número, fecha, casilla, selección, múltiple, URL, relación), vistas **Tabla**, **Tablero** y **Lista**, filtros, orden, agrupación, columnas y vistas guardadas. Plantillas: vacía, tareas, proyectos y libros.
- Panel de propiedades genérico en cada nota: muestra y edita cualquier clave del frontmatter según su tipo.
- **Asistente** (Hermes Agent en una jaula `bwrap`): consulta y organiza el espacio por niveles (lectura / automático con **Deshacer** / propuesta con aprobación), memoria visible en texto plano y exclusión de carpetas.
- Herramientas del asistente para bases: `list_databases`, `query_database` y `create_row`.
- Licencia MIT.

### Corregido
- `createRow` ya no puede escribir fuera de la zona de usuario con una carpeta de origen con `..` u oculta.
- Guardar una vista parte del fichero (no del índice) y se serializa: no se pierden vistas escritas a mano ni al guardar en paralelo.
- Los valores editados desde la UI conservan su tipo (casillas, números, listas de relación, ceros a la izquierda) y los enlaces de celdas URL solo admiten `http(s)`.

## [0.1.0] — 2026-10-26

### Añadido
- Núcleo local-first: bóveda Markdown + frontmatter YAML, índice SQLite derivado y reconstruible.
- **Quick** (captura instantánea) y **Workspace** (Hoy, Bandeja, Proyectos, Tareas, Notas, Grafo, Propuestas, Diario).
- Sesiones de foco, tarjetas de «retomar», decisiones y checkpoints por proyecto.
- Propuestas con diff que apruebas tú; IA opcional con modelo local o API propia (ves el payload antes de enviar).
- Exportar / restaurar, importar un vault de Obsidian (copia de solo lectura) y servicio de usuario de systemd.
