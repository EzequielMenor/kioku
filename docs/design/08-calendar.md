# Calendario

**Estado: alcance UX v2 implementado y verificado localmente (JARV-27, JARV-28, JARV-29).** Tareas, prioridades, semana L–D, arrastre nativo de tareas, teclado, 390 px y contraste de los controles nuevos comprobados; detalle y límites en [Validación](../validation.md). Sin publicación ni despliegue. El arrastre nativo entre días se conserva **sin verificar** por decisión del usuario. Fuera del alcance inicial: escrituras sin conexión, captura y asistente. JARV-21, JARV-22 y JARV-24 siguen abiertos; este documento no los da por completados.

## Quick path

1. **Día** ofrece cuadrícula horaria y lista con cuenta regresiva. **Semana** muestra lunes a domingo por defecto.
2. **Crear:** título, inicio y fin. Tarea, área y proyecto son opcionales y se pueden añadir después.
3. **Editar en el sitio:** un clic en una actividad abre su panel. Se mueve y redimensiona arrastrando, o con «Un día antes / después».
4. **Prioridades** de tareas: Alta, Media o Baja, con un toque (JARV-28).
5. **Validación:** 381 pruebas, tipos y build verdes; ver [evidencia y límites](../validation.md).

## Problema

Cuesta organizarse y se pierde tiempo decidiendo qué hacer. La interfaz debe responder rápido a tres preguntas: qué estoy haciendo, qué viene después y cuánto tiempo libre tengo, sin culpabilizar por los retrasos ni obligar a llenar los huecos.

## Conceptos

| Concepto | Qué es | Notas |
|---|---|---|
| Tarea | Algo por hacer, con o sin fecha límite (`due`). | Ya existe. Se añade una estimación opcional (`estimate`). |
| Bloque | Periodo con inicio y fin reservado para trabajar. Puede asociarse a una tarea. | Una tarea puede tener varios bloques. **Terminar un bloque no completa la tarea**: son acciones separadas. |
| Evento | Compromiso con horario. | No necesita tarea. |

Un bloque es **suelto** si no tiene tarea (por ejemplo «Entrenar»).

## Decisiones de UX

Esta tabla recoge la UX v2 aceptada y su estado real. «Base» es lo que ya está en el código de JARV-26; «v2» es lo acordado para JARV-27/28/29.

| Tema | Decisión aceptada | Estado |
|---|---|---|
| Crear primero, completar después | Crear pide lo mínimo (título y horario). Tarea, área y proyecto son opcionales y se añaden después desde el panel. | Base (JARV-26): clic o arrastre fija el horario; solo se escribe el título y Enter. El formulario completo conserva inicio y fin obligatorios. Las tareas simples son JARV-27. |
| Semana | Lunes a domingo (L–D) por defecto. Ocultar el fin de semana es una opción explícita; con el fin de semana oculto la semana pasa a ser L–V. La elección se recuerda en el navegador. | Comprobado en Chromium: siete días por defecto; ocultar muestra cinco y restaurar la semana completa sobrevive a recargar. |
| Hora | 24 h en todas partes (14:00, nunca AM/PM). Los campos separan la fecha y la hora escrita como HH:mm. | Base: `DateTime24` en `web/src/calendar.tsx`. |
| Edición en el sitio | Título, tipo, inicio, fin y área editables en el panel. Mover y redimensionar arrastrando (pasos de 15 min). Duplicar y borrar con «Deshacer». | Base (JARV-26). Teclado y tacto sin verificar completamente (S8). |
| Tareas desde el panel lateral | Una tarea pendiente arrastrada al calendario se convierte en bloque con hora. | Hecho (JARV-27). Arrastre nativo y persistencia comprobados; hash y foco corregidos y revalidados. |
| Tareas dentro de un evento | En cualquier momento se puede enlazar una tarea existente o crear una nueva. | Hecho (JARV-27); enlaces, finalización independiente y guardas de hash comprobados. |
| Prioridades | Selector de un toque con **Alta / Media / Baja**, visible también sin color. Los datos siguen guardándose como 1 / 2 / 3. La captura rápida acepta `p1`, `p2`, `p3`. | Hecho (JARV-28, `34ce465`): selector, persistencia numérica y recarga comprobados en Chromium; ver `../task-priorities.md`. |

Descartado a propósito: numerar cada actividad al estilo del metro de Tokio (letra + número; ver [Station numbering](https://en.wikipedia.org/wiki/Station_numbering)). Se mantiene una letra o símbolo por área, sin volverse críptica.

## Prototipo

`docs/design/calendar/prototype.dc.html` es la copia del prototipo interactivo. Es un artefacto del formato Design Canvas y necesita su runtime (`support.js`) para abrirse; no funciona como HTML suelto. Enlace privado del autor: https://claude.ai/artifact/DFwmJmoWdjk9Hyy5WBbXp5

Se exploraron tres propuestas con los mismos datos ficticios (miércoles 10:20):

- **A · Panel de salidas**: **elegida**.
- B · Líneas del día: descartada por ahora; la lectura del diagrama exige aprendizaje y usa mucho espacio vertical.
- C · Agenda híbrida: descartada por ahora; es la más parecida a un calendario convencional y la más densa. Se conserva como posible vista alternativa de la semana.

### Decisiones tomadas sobre A

1. **Lista ordenada de actividades** con hora, actividad, área (letra + nombre; el color nunca es el único indicador), duración y cuenta regresiva («40 min restantes», «70 min para empezar»).
2. **El bloque en curso es la fila rellena de índigo**, con la pastilla «En curso», su progreso y los botones «Terminar bloque» y «Reprogramar».
3. **Aviso «Siguiente»** de una línea sobre la lista, con el tiempo libre que hay antes.
4. **Día / Semana.** Semana muestra los días en orden, una tira con la ocupación de cada día (07:00–22:00) y encabezados con el tiempo libre. Mover entre días: arrastrar una fila sobre un día, o «Un día antes / después» (alternativa táctil y de teclado).
5. **Los huecos ayudan a decidir, sin presión.** «Usar este hueco» lista las tareas pendientes cuya estimación cabe; «Dejarlo libre» es una respuesta válida. No se rellena nada automáticamente.
6. **Filtro por área** (letra + nombre), incluida «Sin área».
7. **Lo vencido no se mueve solo.** Un bloque pasado sin terminar se muestra como «Sin terminar» (trazo punteado, nunca rojo) y se ofrece «Reprogramar».
8. **Estados sin depender del color:** pastilla con glifo y texto (Hecho, En curso, Sin terminar, Ya pasó, Pendiente); eventos con ◆ y barra hueca.
9. **Móvil con su propia adaptación:** filas de dos líneas, detalle como hoja inferior, tira semanal reducida y barra inferior de secciones.
10. **Crear y editar en el sitio** (JARV-26). Día tiene una cuadrícula horaria (07–22; se amplía si hay algo fuera) además de la lista. Se crea arrastrando en un hueco (un clic da una hora) o escribiendo una línea de texto natural («gym mañana 18-19»); ambas crean un **evento**. Se mueve, redimensiona (pasos de 15 min; Esc cancela), duplica y borra con «Deshacer» (el borrado va a `.kioku/trash/`).
11. **Identidad:** tinta y papel, índigo 藍, Shippori Mincho en títulos, cifras tabulares, bordes finos y esquinas de 4–8 px, sello 記 solo en la marca.

### Referencias consultadas

- Structured: línea de tiempo diaria que detecta el tiempo libre y sugiere llenarlo ([reseña](https://daveswift.com/structured/)). Aquí la sugerencia es opcional.
- Numeración de estaciones del metro de Tokio ([Desirability Lab](https://desirabilitylab.com/backfill/backfill-2025-381-tokyo-subway-signage-system)).
- Flighty: metáfora de panel de salidas y críticas por el rojo en retrasos mínimos ([hilo en Hacker News](https://hn.nuxt.dev/item/47511589)).

Son fuentes mixtas (reseñas, blogs de diseño y foros), no manuales oficiales.

## Qué es ficticio en el prototipo

- La hora está fija en miércoles 10:20; el estado no persiste.
- Solo hay cinco días (lunes a viernes) y los datos son de ejemplo. La implementación muestra L–D por defecto.
- «Asociar a una tarea» y las secciones del menú distintas de Calendario son ilustrativas.
- Las fuentes del prototipo se cargan desde Google Fonts. **En la implementación se usa lo empaquetado (D-20)**: sin peticiones externas.
- El arrastre entre días del prototipo no se ha comprobado. En producción se conserva **sin verificación de arrastre nativo**; los controles «Un día antes / después» sí se probaron con persistencia real.

## Modelo de datos (D-23)

Coherente con la bóveda en Markdown como fuente de verdad y SQLite como índice (ver `05-data-model.md`).

- Bloques y eventos como notas Markdown con frontmatter en `Calendario/<id>.md`, con `type: block`:
  - `kind`: `block` | `event`
  - `start`, `end`: fecha y hora locales (`YYYY-MM-DDTHH:mm`)
  - `task`: enlace `[[…]]` opcional en bloques y eventos (JARV-27)
  - `project`: enlace `[[…]]` a un proyecto, opcional
  - `area`: enlace `[[Areas/<id>]]` a un área, opcional (bloques y eventos); independiente del proyecto y de la tarea
  - `done_at`: instante en que se terminó el bloque (solo bloques)
- **Áreas** («líneas»): una nota por área en `Areas/<id>.md` con `type: area`, `title` y `color` (`#RRGGBB`, en minúsculas). La ruta es el identificador estable: renombrar o recolorear solo cambia esa nota. Kioku no crea áreas de ejemplo ni las infiere. Una actividad sin `area` no se reescribe hasta que se le asigna una; se muestra como «Sin área». Si el área se borra o su color deja de ser válido, la actividad sigue y se lee sin área.
- Tareas: campo opcional `estimate` (minutos) además de `due`. Las prioridades siguen en el frontmatter como número (1 Alta, 2 Media, 3 Baja).
- Índice: lectura derivada de `notes.fm_json` mediante `noteRows()`, sin tabla nueva ni migración SQLite. Reindexar reconstruye las actividades desde Markdown.
- Reglas: terminar un bloque nunca cambia `status` de la tarea; completar la tarea nunca toca sus bloques; reprogramar solo cambia `start` y `end`; nada se mueve automáticamente.
- Los cambios comprueban el hash leído y preservan el resto del Markdown. Reintentar una creación con el mismo identificador y contenido no duplica la actividad.

## API en línea (base JARV-26)

Solo con el daemon conectado; no hay cola sin conexión para el calendario. Todas las rutas exigen la clave y respetan los roles: el móvil puede leer y escribir el calendario con las mismas reglas de privacidad que el resto (`.kioku/mobile.json`).

| Ruta | Cuerpo / parámetros | Respuesta |
|---|---|---|
| `GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` | Fechas locales, ambas **inclusivas**; máximo 367 días. | `{ items, tasks, invalid, now, areas }` |
| `POST /api/calendar/create` | `{ id, title, kind, start, end, taskPath?, projectPath?, areaPath? }` (`id` de 8–64 caracteres, `[a-zA-Z0-9-]`). Reintentar con el mismo contenido devuelve la misma actividad. | La actividad |
| `POST /api/calendar/move` | `{ path, start, end, hash }` | La actividad |
| `POST /api/calendar/update` | `{ path, hash, title?, kind?, start?, end? }`: solo cambia lo indicado; pasar a evento conserva la tarea y quita `done_at`. | La actividad |
| `POST /api/calendar/delete` | `{ path, hash }`: manda la actividad a `.kioku/trash/` (no borra de verdad). | `{ ok: true }` |
| `POST /api/calendar/restore` | `{ path }`: devuelve la última copia desde la papelera; `409` si la ruta ya existe y `404` si no hay copia. | La actividad |
| `POST /api/calendar/finish` | `{ path, hash }` | La actividad |
| `GET /api/calendar/areas` | — | `AreaRow[]` = `{ path, title, color, hash }[]`, ordenadas por título |
| `POST /api/calendar/areas/create` | `{ id, title, color }`. Mismo `id` y contenido: idempotente; otro contenido: `409`. | `AreaRow` |
| `POST /api/calendar/areas/update` | `{ path, title, color, hash }` | `AreaRow` |
| `POST /api/calendar/area` | `{ path, areaPath: string \| null, hash }`: asigna, cambia o quita (`null`) el área. Mismo área: no escribe. | La actividad |

- `update`, `delete` y `restore` son solo de escritorio: el móvil las recibe con `403` (la edición en el móvil es JARV-22).
- Cada actividad lleva `path`, `title`, `kind`, `start`, `end`, `hash`, `state`, `taskPath`, `projectPath`, `projectTitle`, `areaPath`, `areaTitle`, `areaColor` (los tres `null` si no tiene área o ya no es válida) y, si se terminó, `done_at`. Las relaciones crudas no salen en la API. `/api/task/status` rechaza (`400`) bloques y áreas.
- Mover y terminar exigen el `hash` leído: si la actividad cambió, `409` y nada se escribe. Terminar un bloque nunca completa su tarea ni a la inversa.
- Errores como en el resto de la API (`{ error, code? }`): rango, fecha, tipo, tarea o proyecto inválidos → `400`; hash obsoleto o `id` ya usado con otro contenido → `409`. Una petición inválida no cambia nada.
- Los huecos libres no se calculan en el servidor: la UI los deriva de las actividades visibles.
- **Tareas (JARV-27):** `POST /api/task/create`, `POST /api/task/update` y `POST /api/calendar/link` crean, editan y enlazan tareas con comprobación de hash; son solo de escritorio. `GET /api/calendar/projects` ofrece proyectos y filtra los privados para el móvil. Contratos y límites en [Tareas del calendario](../calendar-tasks.md); pruebas automatizadas y verificación independiente en verde.
- **Móvil.** Las actividades que apuntan a una nota privada (la propia actividad, su tarea o su proyecto, también el heredado) o a una relación sin resolver no aparecen. Mover o terminar una actividad oculta responde `404`; crear con rutas privadas, `403`. Una actividad cuya área es privada se oculta igual. La lectura no se guarda en la caché del service worker (`web/src/sw-rules.ts`).

## Interfaz web

Ruta `#/calendario` (atajo `g c`; en la barra inferior del móvil entre Hoy y Tareas). Código: `web/src/calendar.tsx` (vista), `web/src/calendar-grid.tsx` (cuadrícula), `web/src/calendar-model.ts` (lógica pura, con pruebas en `test/calendar-ui.test.ts`) y `web/src/calendar.css`. Reutiliza `api`, `guard`, `useRevision` y `useApi`, y no hace peticiones externas.

- **Día / Semana.** Día es una lista ordenada con la hora, la actividad, el área, la duración y la cuenta regresiva; la fila en curso va rellena de índigo con su progreso y «Terminar bloque» / «Reprogramar» en línea.
- **Semana (L–D por defecto).** Muestra siete días desde lunes (o desde domingo, si se elige). Con «Fin de semana» desmarcado, muestra L–V. Ambas preferencias se guardan en `localStorage` (`calendar.weekStart`, `calendar.weekend`) y se restauran al recargar. Una tira de ocupación 07–22 por día y el tiempo libre, calculado con `freeGaps`.
- **Reloj dinámico.** Los estados y las cuentas se recalculan en el navegador cada 15 s a partir de la hora del servidor (`now`) más el tiempo transcurrido. Las fechas son locales sin zona, como en el núcleo.
- **Huecos.** Cada hueco libre tiene «Usar este hueco»: lista las tareas pendientes con estimación positiva que caben y «Programar en este hueco» crea un bloque con esa tarea. «Dejarlo libre» lo marca solo mientras la página sigue abierta; no se rellena nada solo.
- **Áreas.** «Áreas» permite crear y editar nombre y color; no hay borrado. El filtro ofrece todas las áreas y «Sin área», sin inferirlas del proyecto. Los colores se resuelven al recargar y el texto de las insignias usa negro o blanco según contraste.
- **Crear.** «Nueva actividad»: tipo (bloque o evento), título, inicio y fin (`DateTime24`), área opcional y, para bloques, tarea opcional. El panel de detalle permite enlazar, cambiar o quitar una tarea después de crear la actividad, también en eventos (JARV-27).
- **Mover.** Arrastrar una fila sobre un día (ratón; el arrastre HTML5 no funciona al tacto), «Un día antes / después» en el detalle, o «Reprogramar» con inicio y fin escritos a mano. Se avisa si la nueva hora se cruza con otra actividad o ya pasó, pero nunca se bloquea ni se mueve nada automáticamente.
- **Detalle.** Hoja con foco atrapado, Esc para cerrar y retorno del foco a quien la abrió. «Terminar bloque» y «Completar tarea» (`/api/task/status`) son acciones separadas.
- **Solo en línea.** Sin conexión, la acción falla sin enviar nada («no se ha guardado nada»). Si la red falla después de enviar, se dice «No se pudo confirmar el guardado. Recargá antes de reintentar» y los reintentos de crear usan el mismo identificador. No hay cola ni éxito simulado.
- **Tareas pendientes (JARV-27):** panel lateral con creación por título literal y edición en la fila; fecha, estimación y proyecto opcionales. Arrastrar a la cuadrícula fija la hora; soltar en un día busca el primer hueco donde cabe. «Programar» ofrece la alternativa de teclado/táctil. El detalle enlaza una tarea existente o crea una nueva. Verificado independientemente, incluido arrastre nativo y teclado.
- **Prioridades (JARV-28):** selector Alta / Media / Baja en las propiedades de la tarea y etiquetas en las listas, tabla y tablero; «Sin prioridad» elimina el valor sin cambiar el formato de los datos.

## Límites conocidos

- El filtro por área solo cambia las filas; los huecos y la ocupación cuentan todas las actividades.
- Las tareas sin estimación no se sugieren; «libre a propósito» no se guarda.
- El arrastre de tareas al día y a la semana tiene prueba nativa con ratón. El arrastre anterior de actividades entre días conserva su límite histórico; «Un día antes / después» sigue como alternativa.
- Arrastrar una continuación a otro día mueve la actividad entera (su inicio original) a ese día.
- Firefox, Safari y pantallas táctiles reales no se han probado. Los controles nuevos se comprobaron a 1600/390 px en tinta/papel: sin desborde y contraste de texto medido ≥4,5 (mínimos 4,59 y 5,44); no es una auditoría de toda la aplicación.
- Validación acotada a esta entrega y a Chromium; no se afirma compatibilidad en todos los navegadores ni auditoría global. Ver [Validación](../validation.md).

## Plan

Siguiendo TDD (`npm test` y `npm run typecheck` en verde, `npm run build:web` para la web; pruebas con bóvedas y `KIOKU_HOME` temporales).

| Fase | Estado | Nota |
|---|---|---|
| 1. Modelo y núcleo | Hecho (base) | Estados, huecos libres, `estimate`, casos de borde. |
| 2. API | Hecho y verificado | Hash obligatorio y actualizado también en operaciones sin cambios; rechazo sin mutación. |
| 3. Web: vista Día | Hecho y verificado | Crear/editar/programar/enlazar, arrastre nativo y retorno del foco comprobados. |
| 4. Web: vista Semana | L–D comprobado en Chromium | Opción L–V y persistencia de semana completa comprobadas; otros límites en `../validation.md`. |
| 5. Móvil | Adaptación hecha | Escrituras sin conexión fuera del alcance inicial (JARV-22 abierto). |
| 6. Asistente y captura | Fuera de alcance | Captura: `p1/p2/p3` se mantienen como atajo (JARV-28). JARV-23 en Todo. |
| 7. Validación | Alcance v2 verificado | Arrastre de tareas, teclado, 390 px y contraste de texto nuevos comprobados. Límites históricos JARV-24 siguen explícitos. |

## Fuera de alcance por ahora

Sincronización con calendarios externos, recurrencias, zonas horarias múltiples, planificación automática, animación de las cifras y botón «+» de captura rápida.

## Checklist de revisión

- [x] Semana muestra L–D por defecto y L–V solo si se oculta el fin de semana.
- [x] La hora aparece en 24 h en los campos comprobados.
- [x] Crear pide solo lo mínimo; tarea, área y proyecto son opcionales.
- [x] Editar en el sitio funciona sin salir de la vista.
- [x] Tareas desde el panel lateral y desde un evento (JARV-27).
- [x] Prioridades Alta / Media / Baja, con datos 1 / 2 / 3 compatibles (JARV-28).
- [x] Comprobaciones de esta entrega y recheck de sus dos bloqueos completados; límites históricos documentados.

## Siguiente paso

Entrega lista en la rama local `feat/JARV-27-calendar-completion`. Publicar, integrar o desplegar requiere autorización separada. Offline y asistente quedan fuera; JARV-21 conserva la discrepancia histórica sobre mover al pasado y JARV-24 los límites de validación que no cubre esta entrega.
