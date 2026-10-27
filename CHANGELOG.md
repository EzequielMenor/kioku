# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [0.4.1] — 2026-10-27

### Corregido
- **Propuestas desde la interfaz web:** «Aplicar», «Descartar» y «Revisar bandeja» fallaban con «Se requiere application/json», porque la web enviaba esos POST sin cuerpo. Solo funcionaban desde la CLI. El cliente ahora envía siempre JSON; el daemon sigue siendo estricto.
- **Asistente:** si cambiabas de pantalla mientras respondía y volvías antes de que terminase, la vista no mostraba ni el indicador ni la respuesta hasta salir y entrar otra vez. La conversación vive ahora fuera de la vista.
- Pulsar Enter en el chat mientras el asistente responde ya no borra lo que habías escrito.

## [0.4.0] — 2026-10-27

### Seguridad
- **La API local exige una clave por daemon** (JARV-1). Antes, cualquier proceso que alcanzase `127.0.0.1` —incluida la jaula del asistente, que comparte la red— podía llamar a rutas como `/api/note/delete`. Ahora todas las rutas `/api` (lecturas incluidas) piden la clave guardada en `.kioku/secret` (0600), por cookie `HttpOnly; SameSite=Strict` o cabecera `x-kioku-key`. Las herramientas del asistente siguen usando su token de sesión y `/api/health` solo devuelve `{ok:true}`.
- El secreto no entra en las copias de seguridad (`kioku export`).

### Añadido
- `kioku url`: imprime la URL de acceso (lleva la clave en `?k=`; el daemon la cambia por una cookie y redirige). `kioku open` y `kioku quick` la usan solos.
- La interfaz muestra «Falta la clave de Kioku» si se abre sin ella.

### Migrar desde 0.3.0
- Reinicia el daemon (`systemctl --user restart kioku`) y cierra las ventanas de Kioku abiertas: se reabren con `kioku open` / `kioku quick`. Si tenías la interfaz abierta en otro navegador, usa `kioku url`.

## [0.3.0] — 2026-10-27

### Cambiado
- **El proyecto pasa a llamarse Kioku** (記憶, «memoria» en japonés), antes JARVIS. Afecta a todo:
  - el comando es `kioku` (antes `jarvis`) y el paquete se llama `kioku`;
  - las variables de entorno son `KIOKU_HOME`, `KIOKU_PORT`… (antes `JARVIS_*`);
  - la carpeta interna de cada bóveda es `.kioku/` (antes `.jarvis/`) y la carpeta de datos por defecto es `~/Documents/Kioku`;
  - el servicio de usuario es `kioku.service`, y las ventanas se llaman «Kioku Quick» y «Kioku Workspace»;
  - la clase principal `Jarvis` es ahora `Kioku` (`src/core/kioku.ts`).

### Migrar desde 0.2.0 o anterior
Con el daemon parado: mueve `~/Documents/Jarvis` a `~/Documents/Kioku` y, dentro, `.jarvis` a `.kioku`; renombra `jarvis-sessions.json` a `kioku-sessions.json` en `.kioku/hermes/`; ejecuta `kioku service uninstall` con el comando antiguo y `kioku service install` con el nuevo; y actualiza tus atajos de Hyprland (`bin/kioku`).

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
