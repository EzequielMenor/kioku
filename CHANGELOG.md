# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [0.6.0] — 2026-10-28

### Añadido
- **Móvil sin conexión: lectura y captura** (JARV-14, fase 2 de 3). La PWA guarda una copia de las notas en IndexedDB (todo el vault salvo las carpetas de `.kioku/mobile.json`) y un **service worker** guarda el shell y la última respuesta de cada pantalla. Sin red se abren Hoy, Tareas, Proyectos, Bandeja y Notas con la franja «Sin conexión · datos de hace X», se abre cualquier nota y se busca en ella (búsqueda local).
- **Captura sin conexión:** si no hay red queda en una cola (insignia en «Más» y en la barra) y se envía por orden al abrir la app con red, al volver la conexión y tras cada sincronización, con espera creciente. Un rechazo definitivo (4xx) queda como «no se pudo enviar» con *Reenviar* / *Descartar*.
- **Sin duplicados:** `POST /api/capture` acepta `x-kioku-op` y deduplica por operación (`.kioku/ops.json`, 0600, 30 días, 5000 entradas), también con peticiones simultáneas o si se perdió la respuesta.
- `GET /api/sync/manifest` y `GET /api/sync/notes` (lotes de 50 notas / 1 MiB), filtrados por privacidad como el resto de lecturas del móvil.
- «Más» muestra pendientes, última sincronización, espacio usado y «Sincronizar ahora».

### Seguridad
- Lo privado nunca entra en la réplica ni en las cachés; si una carpeta pasa a privada se purga de la copia **en la siguiente sincronización con red** (sin red el teléfono no puede saberlo) y un 404 en una lectura borra su copia guardada. Con la clave revocada (401) se vacían la réplica y las lecturas guardadas (las capturas aún sin enviar se conservan). **Límite conocido (D-21):** revocar el móvil no puede borrar a distancia la copia de un teléfono sin conexión; la protege el bloqueo del iPhone.
- Ventana residual: si el daemon cae justo entre guardar la nota y anotar la operación, puede aparecer **un duplicado** en la Bandeja, nunca una captura perdida.

### Desarrollo
- `web/src/offline/` (réplica, búsqueda, cola, IndexedDB, runtime) y `web/src/sw.ts` con `sw-rules.ts`; `scripts/build-web.mjs` compila `sw.js` con un id de build que nombra la caché del shell (cada despliegue borra la anterior).
- Tests: sincronización, ops, réplica, búsqueda, cola, lector, reglas del service worker y comportamiento del worker. E2E en Chromium con el daemon detenido: 18 comprobaciones (lectura y búsqueda sin red, captura pendiente y envío único, respuesta perdida, privacidad en IndexedDB y cachés, cambio de build, purga por 401, sin errores de consola ni dominios externos).

## [0.5.1] — 2026-10-27

### Cambiado
- **Rediseño «tinta y papel»** (JARV-16): paleta cálida para el tema oscuro («tinta») y un tema claro «papel» cuidado, con **índigo (藍)** como único acento; esquinas más suaves, líneas finas y más aire. Los títulos pasan a serif (**Shippori Mincho**, empaquetada: subconjunto latino, sin cargar nada de Internet) y el texto sigue en sans.
- **Nueva marca: sello 記** (hanko) en la barra lateral, el icono de la PWA y el favicon; el kanji va como trazos, sin depender de ninguna fuente.
- Los colores por tipo del grafo salen de variables del tema (`--t-*`) y se ven bien también sobre papel. La ventana Quick usa la misma paleta.
- Las fuentes se sirven como `font/woff2` con caché de una semana; el resto sigue sin caché.
- Contraste revisado (texto ≥ 4.5:1 en ambos temas). Capturas del README renovadas.

### Corregido
- **Móvil (iOS 26):** en la app instalada aparecía una franja negra bajo la navegación inferior. Es un fallo de WebKit (301108): con `viewport-fit=cover` y barra de estado translúcida, iOS da a la web una ventana más corta que la pantalla (el alto de la barra) mientras el documento sea más bajo que ella. Ahora, en modo instalada, el documento mide como la pantalla (`min-height: min(100lvh, 100% + safe-area-inset-top)`), el contenido reserva el área segura superior y el bloqueo del scroll del documento queda solo para el navegador. Requiere reinstalar el icono en la pantalla de inicio.
- La barra inferior mide como una barra de pestañas de iOS (≈83 pt con el indicador de inicio) y el contenido y el botón «+» cuentan con esa medida.

### Desarrollo
- Nueva dependencia de desarrollo `@fontsource/shippori-mincho` 5.3.0 (licencia OFL-1.1); el build copia solo los dos pesos usados.
- `test/web-assets.test.ts`: sin recursos externos, fuente empaquetada, sello sin `<text>`, manifest/`theme-color`/fondo coherentes, colores del grafo en variables y la maquetación móvil (viewport anclado, regla de WebKit 301108, barra de 83 pt).

## [0.5.0] — 2026-10-27

### Añadido
- **Kioku en el iPhone/iPad** (JARV-13, fase 1 de 3): la interfaz funciona en pantallas estrechas (barra inferior, botón «+» para capturar, nota con su panel debajo, tableros de una columna, zoom por pellizco en el grafo) y se instala como app («Añadir a pantalla de inicio»: manifiesto e iconos). Por ahora **requiere conexión** con el portátil (sin conexión: 0.6 y 0.7).
- **Acceso por Tailscale:** `tailscale serve` publica el daemon, que sigue ligado a `127.0.0.1`. Solo acepta `Host`/`Origin` de la lista cerrada `KIOKU_ALLOWED_HOSTS` (el servicio la conserva).
- **`kioku pair` / `kioku pair --revoke`:** crea una clave solo para el móvil (`.kioku/secret-mobile`, 0600, fuera de las copias) con la dirección para abrirla (y QR si hay `qrencode`); revocarla surte efecto al instante.
- **Rol «móvil» impuesto por el servidor:** puede leer, capturar, marcar tareas y editar notas/propiedades; borrar, asistente, propuestas, foco, escritorio, mantenimiento y edición de bases devuelven 403 aunque se fuerce la petición. La interfaz oculta esos controles.
- **Carpetas privadas** (`.kioku/mobile.json`, `{"exclude": ["Privado/"]}`): nunca salen del portátil. Se aplican a todas las lecturas y escrituras del móvil (incluidos Hoy, el grafo con sus contadores, la búsqueda y los eventos en vivo) y normalizan trucos de ruta.
- La pantalla «Falta la clave» admite pegar la clave o la dirección de `kioku pair` (iOS no siempre pasa la cookie de Safari a la app instalada).
- Favicon (arregla el 404 de `/favicon.ico`).

### Cambiado
- La cookie de acceso dura un año (antes era de sesión) y lleva `Secure` cuando el acceso no es local.

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
