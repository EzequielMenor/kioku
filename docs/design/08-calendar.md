# Calendario

Estado: **calendario en línea implementado y verificado**: núcleo, API, Día/Semana y adaptación móvil. Evidencia y límites en `../validation.md`. El arrastre nativo se conserva explícitamente sin verificar por decisión del usuario; «Un día antes / después» sí está probado. Fuera del alcance inicial: escrituras sin conexión, captura y asistente. Este documento recoge lo decidido, el modelo confirmado y el plan. La decisión está registrada como D-23 en `02-TRD-architecture.md`.

## Problema

Cuesta organizarse y se pierde tiempo decidiendo qué hacer. La interfaz debe responder rápido a tres preguntas: qué estoy haciendo, qué viene después y cuánto tiempo libre tengo, sin culpabilizar por los retrasos ni obligar a llenar los huecos.

## Conceptos

| Concepto | Qué es | Notas |
|---|---|---|
| Tarea | Algo por hacer, con o sin fecha límite (`due`). | Ya existe. Se añade una estimación opcional. |
| Bloque | Periodo con inicio y fin reservado para trabajar. Puede asociarse a una tarea. | Una tarea puede tener varios bloques. **Terminar un bloque no completa la tarea**: son acciones separadas. |
| Evento | Compromiso con horario. | No necesita tarea. |

Un bloque es **suelto** si no tiene tarea (por ejemplo «Entrenar»).

## Prototipo

`docs/design/calendar/prototype.dc.html` es la copia del prototipo interactivo. Es un artefacto del formato Design Canvas y necesita su runtime (`support.js`) para abrirse; no funciona como HTML suelto. Enlace privado del autor: https://claude.ai/artifact/DFwmJmoWdjk9Hyy5WBbXp5

Se exploraron tres propuestas con los mismos datos ficticios (miércoles 10:20):

- **A · Panel de salidas** — **elegida**.
- B · Líneas del día — descartada por ahora; la lectura del diagrama exige aprendizaje y usa mucho espacio vertical.
- C · Agenda híbrida — descartada por ahora; es la más parecida a un calendario convencional y la más densa. Se conserva como posible vista alternativa de la semana.

### Decisiones tomadas sobre A

1. **Lista ordenada de actividades** con hora, actividad, área (letra + nombre; el color nunca es el único indicador), duración y cuenta regresiva grande («40 min restantes», «70 min para empezar»).
2. **El bloque en curso es la fila rellena de índigo** con la pastilla «En curso», su progreso y los botones «Terminar bloque» y «Reprogramar» debajo. No hay tarjeta aparte.
3. **Aviso de una línea «Siguiente»** sobre la lista, con el tiempo libre que hay antes.
4. **Día / Semana.** Semana muestra los cinco días en orden, una tira con la ocupación de cada día (07:00–22:00) y encabezados con el tiempo libre. Mover entre días: arrastrar una fila sobre un día, o «Un día antes / después» (alternativa táctil y accesible).
5. **Los huecos ayudan a decidir, sin presión.** «Usar este hueco» lista las tareas pendientes cuya estimación cabe; «Dejarlo libre» es una respuesta válida («está bien así»). No se rellena nada automáticamente.
6. **Filtro por área** (letra + nombre), incluida «Sin área».
7. **Lo vencido no se mueve solo.** Un bloque pasado sin terminar se muestra como «Sin terminar» (trazo punteado, nunca rojo) y se ofrece «Reprogramar». Idea tomada de la crítica a Flighty por marcar en rojo cualquier retraso.
8. **Estados no dependen del color:** pastilla con glifo y texto (Hecho, En curso, Sin terminar, Ya pasó, Pendiente); eventos con ◆ y barra hueca.
9. **Móvil con su propia adaptación:** filas de dos líneas con la cuenta regresiva a la derecha, detalle como hoja inferior, tira semanal reducida, barra inferior de secciones.
10. **Identidad:** tinta y papel, índigo 藍, Shippori Mincho en títulos, cifras tabulares, bordes finos y esquinas de 4–8 px, sello 記 solo en la marca.

Descartado a propósito: numerar cada actividad al estilo del metro de Tokio (letra + número; ver [Station numbering](https://en.wikipedia.org/wiki/Station_numbering)). Se mantiene una letra o símbolo por área, sin volverse críptica.

### Referencias consultadas

- Structured: línea de tiempo diaria que detecta el tiempo libre y sugiere llenarlo ([reseña](https://daveswift.com/structured/)). Aquí la sugerencia es opcional.
- Numeración de estaciones del metro de Tokio ([Desirability Lab](https://desirabilitylab.com/backfill/backfill-2025-381-tokyo-subway-signage-system)).
- Flighty: metáfora de panel de salidas y críticas por el rojo en retrasos mínimos ([hilo en Hacker News](https://hn.nuxt.dev/item/47511589)).

Son fuentes mixtas (reseñas, blogs de diseño y foros), no manuales oficiales.

## Qué es ficticio en el prototipo

- La hora está fija en miércoles 10:20; el estado no persiste.
- Solo hay cinco días (lunes a viernes) y los datos son de ejemplo.
- «Asociar a una tarea» y las secciones del menú distintas de Calendario son ilustrativas.
- Las fuentes se cargan desde Google Fonts. **En la implementación se usa lo empaquetado (D-20)**: sin peticiones externas.
- El arrastre entre días del prototipo no se ha comprobado. En producción se conserva **sin verificación de arrastre nativo**, por decisión del usuario; los controles «Un día antes / después» sí se probaron con persistencia real.

## Modelo de datos confirmado (D-23)

Coherente con la bóveda en Markdown como fuente de verdad y SQLite como índice (ver `05-data-model.md`).

- Bloques y eventos como notas Markdown con frontmatter, p. ej. en una carpeta de calendario, con `type: block`:
  - `kind`: `block` | `event`
  - `start`, `end`: fecha y hora locales (`YYYY-MM-DDTHH:mm`)
  - `task`: enlace `[[…]]` opcional (solo bloques)
  - `project`: enlace `[[…]]` a un proyecto, opcional
  - `area`: enlace `[[Areas/<id>]]` a un área, opcional (bloques y eventos); independiente del proyecto y de la tarea
  - `done_at`: instante en que se terminó el bloque (solo bloques)
- **Áreas** («líneas»): una nota Markdown por área en `Areas/<id>.md` con `type: area`, `title` y `color` (`#RRGGBB`, se guarda en minúsculas). La ruta es el identificador estable: renombrar o recolorear solo cambia esa nota y todas las actividades que la enlazan lo reflejan tras reindexar. Son independientes de los proyectos; Kioku no crea áreas de ejemplo ni las infiere (JW, Estudio, Trabajo u Ocio son ejemplos del usuario). Una actividad sin `area` no se reescribe nunca hasta que se le asigna una; se muestra como «Sin área». Si el área se borra o su color deja de ser válido, la actividad sigue y se lee sin área. Sin migración de esquema: `NoteType` gana `area` y el índice sigue derivado de `notes.fm_json`.
- Tareas: nuevo campo opcional `estimate` (minutos) además de `due`.
- Índice: lectura derivada de `notes.fm_json` mediante `noteRows()`, sin tabla nueva ni migración SQLite. Reindexar reconstruye las actividades desde Markdown.
- Reglas: terminar un bloque nunca cambia `status` de la tarea; completar la tarea nunca toca sus bloques; reprogramar solo cambia `start` y `end`; nada se mueve automáticamente.
- Un archivo por bloque o evento en `Calendario/<id>.md`, confirmado por el usuario. Los cambios comprueban el hash leído y preservan el resto del Markdown; reintentar una creación con el mismo identificador y contenido no duplica la actividad. La futura integración con escrituras móviles sin conexión queda fuera de esta entrega.

## API en línea (implementada)

Solo con el daemon conectado; no hay cola sin conexión para el calendario. Todas las rutas exigen la clave y respetan los roles: el móvil puede leer y escribir el calendario con las mismas reglas de privacidad que el resto (`.kioku/mobile.json`).

| Ruta | Cuerpo / parámetros | Respuesta |
|---|---|---|
| `GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` | Fechas locales, ambas **inclusivas**; máximo 367 días. | `{ items, tasks, invalid, now }` |
| `POST /api/calendar/create` | `{ id, title, kind, start, end, taskPath?, projectPath?, areaPath? }` (`id` de 8–64 caracteres, `[a-zA-Z0-9-]`). Reintentar con el mismo contenido devuelve la misma actividad. | La actividad |
| `POST /api/calendar/move` | `{ path, start, end, hash }` | La actividad |
| `POST /api/calendar/finish` | `{ path, hash }` | La actividad |
| `GET /api/calendar/areas` | — | `AreaRow[]` = `{ path, title, color, hash }[]`, ordenadas por título |
| `POST /api/calendar/areas/create` | `{ id, title, color }` (`id` como arriba; `title` de 1–60 caracteres en una línea; `color` `#RRGGBB`). Mismo `id` y contenido: idempotente; otro contenido: `409`. | `AreaRow` |
| `POST /api/calendar/areas/update` | `{ path, title, color, hash }` | `AreaRow` |
| `POST /api/calendar/area` | `{ path, areaPath: string \| null, hash }`: asigna, cambia o quita (`null`) el área de un bloque o evento existente. Mismo área: no escribe. | La actividad |

- `GET /api/calendar` añade `areas: AreaRow[]` (las mismas de `/api/calendar/areas`) para que la UI pinte etiquetas y filtros con una sola lectura; el resto de campos no cambia.
- Cada actividad lleva `path`, `title`, `kind`, `start`, `end`, `hash`, `state`, `taskPath`, `projectPath`, `projectTitle`, `areaPath`, `areaTitle`, `areaColor` (los tres `null` si no tiene área o ya no es válida) y, si se terminó, `done_at`. Las relaciones crudas (`task`, `project`, `area`) no salen en la API. `/api/task/status` rechaza (`400`) bloques y áreas: no son tareas.
- Mover y terminar exigen el `hash` leído: si la actividad cambió, `409` y nada se escribe. Terminar un bloque nunca completa su tarea ni a la inversa; nada se reprograma solo.
- Errores como en el resto de la API (`{ error, code? }`): rango, fecha, tipo, tarea o proyecto inválidos → `400`; hash obsoleto o `id` ya usado con otro contenido → `409`. Título o color de área inválidos, o un `areaPath` que no es un área válida → `400`. Una petición inválida no cambia nada.
- Los huecos libres no se calculan en el servidor: la UI los deriva de las actividades visibles.
- **Móvil.** Las actividades que apuntan a una nota privada (la propia actividad, su tarea o su proyecto, también el heredado de la tarea) o a una relación que no se resuelve no aparecen. Las rutas de esas actividades se añaden a las exclusiones efectivas de todas las lecturas y escrituras móviles: notas, búsqueda, grafo, sincronización, enlaces y actividad en vivo, no solo calendario. El filtro SSE recalcula esa visibilidad con cada evento. Mover o terminar una actividad oculta responde `404`; crear con rutas privadas o un proyecto heredado sin resolver, `403`. Las tareas ordinarias conservan su comportamiento previo.
- **Móvil y áreas.** Una actividad cuya área es privada (o no se resuelve) se oculta igual que si lo fuera su tarea o su proyecto, así que ni su nombre ni su color salen por el calendario ni por las rutas genéricas, la sincronización o el flujo en vivo. `areas` y `/api/calendar/areas` omiten las áreas privadas. Crear o editar un área, o asignarla, funciona desde el móvil con las mismas reglas: `areaPath` privado en crear → `403`, asignar a una actividad oculta o con un `areaPath` privado → `404`, editar un área privada → `403`, crear un área cuya ruta `Areas/<id>.md` es privada → `403`; ninguna deja rastro en Markdown, hash, recuento ni registro.
- La lectura no se guarda en la caché del service worker (`web/src/sw-rules.ts`): una agenda antigua parecería actual y podría conservar referencias que el móvil ya no debe ver.

## Interfaz web (implementada)

Ruta `#/calendario` (atajo `g c`; en la barra inferior del móvil entre Hoy y Tareas). Código: `web/src/calendar.tsx` (vista), `web/src/calendar-model.ts` (lógica pura con pruebas en `test/calendar-ui.test.ts`) y `web/src/calendar.css`. Reutiliza `api`, `guard`, `useRevision` y `useApi`, las fuentes y los tokens empaquetados, y no hace peticiones externas.

- **Día / Semana.** Día es una lista ordenada con la hora, la actividad, el área (letra + nombre y color), la duración y la cuenta regresiva a la derecha; la fila en curso va rellena de índigo con su progreso y los botones «Terminar bloque» y «Reprogramar» en línea; «Sin terminar» tiene trazo punteado (no rojo). Semana muestra lunes a viernes (un sábado o domingo apunta a la semana que empieza), una tira de ocupación 07–22 por día y el tiempo libre, calculado con el mismo núcleo (`freeGaps`) que une los intervalos solapados. Arriba, la línea «Siguiente» con el tiempo libre justo antes. Una actividad que cruza la medianoche aparece en cada día que ocupa (también en la vista Día del siguiente, aunque esté en curso): el día en que empieza indica «hasta jue 29 08:00» y los siguientes la marcan «Sigue» con «desde mié 28 23:00». Los datos, la ruta y las acciones (mover, terminar) son siempre los de la actividad original.
- **Reloj dinámico.** Los estados y las cuentas se recalculan en el navegador cada 15 s a partir de la hora del servidor (`now`) más el tiempo transcurrido, no de un instante fijo. Las fechas son locales sin zona (como en el núcleo): si el navegador y el servidor estuvieran en zonas distintas, las horas se leerían en la del navegador.
- **Huecos.** Cada hueco libre positivo, por corto que sea (el diseño no fija un mínimo; hoy cuenta desde ahora y los días pasados no ofrecen ninguno), tiene «Usar este hueco»: lista solo las tareas pendientes con estimación positiva que caben (si ninguna cabe, lo dice), y «Programar en este hueco» crea un bloque con esa tarea. «Dejarlo libre» lo marca como libre a propósito solo mientras la página sigue abierta; no se rellena nada solo. También se puede crear un bloque o evento a mano en el hueco.
- **Áreas.** «Áreas» permite crear y editar nombre y color con selector o código `#RRGGBB`; no hay borrado. Las filas llevan carril y etiqueta por área, y la ocupación semanal usa sus colores también en eventos. El filtro ofrece todas las áreas y «Sin área», sin inferirlas del proyecto. El detalle conserva el proyecto independiente y permite asignar, cambiar o quitar el área. Los colores se resuelven al recargar y el texto de las insignias usa negro o blanco según contraste.
- **Crear.** «Nueva actividad»: bloque o evento, título, inicio y fin (`datetime-local`), área opcional y, para bloques, una tarea existente (opcional). Un bloque se enlaza a su tarea **solo al crearlo**: no hay endpoint para asociar o cambiar la tarea después.
- **Mover.** Arrastrar una fila sobre un día de la semana (ratón; el arrastre HTML5 no funciona al tacto), «Un día antes / después» en el detalle (alternativa de teclado y táctil) o «Reprogramar» con inicio y fin escritos a mano. Se avisa si la nueva hora se cruza con otra actividad o ya pasó, pero nunca se bloquea ni se mueve nada automáticamente.
- **Detalle.** Hoja con foco atrapado, Esc para cerrar y retorno del foco a quien la abrió; en pantallas estrechas es una hoja inferior. «Terminar bloque» y «Completar tarea» (`/api/task/status`) son acciones separadas, con enlaces a la tarea y al proyecto.
- **Solo en línea.** Sin conexión (el navegador lo sabe antes de enviar) se muestra el aviso y la acción falla sin enviar nada («no se ha guardado nada»). Si la red falla *después* de enviar, la petición pudo llegar y perderse solo la respuesta: entonces se dice «No se pudo confirmar el guardado. Recargá antes de reintentar», se recarga la vista y los reintentos de crear usan el mismo identificador mientras la hoja siga abierta, así que no duplican. No hay cola ni éxito simulado. Una nota de `Calendario/` con datos inválidos aparece como aviso con enlace en vez de romper la vista.
- **Límites conocidos.** El filtro por área solo cambia las filas (los huecos y la ocupación cuentan todas las actividades); las tareas sin estimación no se sugieren; «libre a propósito» no se guarda. El arrastre nativo se conserva sin prueba disponible: la alternativa comprobada es «Un día antes / después». Firefox y Safari no se han probado. Arrastrar una continuación a otro día mueve la actividad entera (su inicio original) a ese día.

## Plan

Siguiendo TDD (`npm test` y `npm run typecheck` en verde, `npm run build:web` para la web; pruebas con bóvedas y `KIOKU_HOME` temporales).

1. **Modelo y núcleo.** *(hecho)* Modelo confirmado (D-23). Parseo e indexado de bloques, `estimate` en tareas, cálculo de estado (hecho / en curso / sin terminar / ya pasó / pendiente) y de huecos libres. Pruebas del cálculo con casos de borde: bloques que se tocan, cruces, cambio de día, hora local.
2. **API.** *(hecho)* Lectura por rango de fechas; crear, mover y terminar bloques. La respuesta incluye tareas pendientes con estimación para sugerir las que caben en cada hueco en la UI. Crear usa identificador estable; mover y terminar son idempotentes y comprueban el hash antes de cambiar contenido.
3. **Web: vista Día.** *(hecho)* Fila en curso con progreso, aviso «Siguiente», filtro por área, «Usar este hueco», detalle con la tarea asociada y acciones separadas (terminar bloque / completar tarea).
4. **Web: vista Semana.** *(hecho)* Tira de ocupación, encabezados por día, mover con arrastre y con botones, avisos de cruce.
5. **Móvil.** *(adaptación hecha; escrituras sin conexión fuera del alcance inicial)* Adaptación propia (hoja inferior, filas de dos líneas, barra inferior). Integrar las escrituras con la cola de operaciones sin conexión queda pendiente: hoy el calendario es solo en línea.
6. **Asistente y captura.** Que la captura pueda crear bloques (`@proyecto`, hora) y que el asistente proponga bloques como propuesta aprobable. Fuera del alcance inicial.
7. **Validación** *(hecha; límites documentados)* en `docs/validation.md`: suite310/310, typecheck/build, Chromium en tinta/papel y móvil/escritorio, controles accesibles y recheck independiente de privacidad/foco. No se afirma una auditoría completa de contraste ni arrastre nativo verificado.

## Fuera de alcance por ahora

Sincronización con calendarios externos, recurrencias, zonas horarias múltiples, planificación automática, animación de las cifras y botón «+» de captura rápida.
