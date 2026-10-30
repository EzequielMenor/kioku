# Calendario

Estado: **diseño aprobado en prototipo; núcleo y API en línea implementados, interfaz pendiente**. Este documento recoge lo decidido, el modelo de datos propuesto y el plan. La decisión de arquitectura se registrará como D-23 en `02-TRD-architecture.md` cuando se confirme el modelo de datos.

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

1. **Lista ordenada de actividades** con hora, actividad, proyecto o área (letra + nombre; el color nunca es el único indicador), duración y cuenta regresiva grande («40 min restantes», «70 min para empezar»).
2. **El bloque en curso es la fila rellena de índigo** con la pastilla «En curso», su progreso y los botones «Terminar bloque» y «Reprogramar» debajo. No hay tarjeta aparte.
3. **Aviso de una línea «Siguiente»** sobre la lista, con el tiempo libre que hay antes.
4. **Día / Semana.** Semana muestra los cinco días en orden, una tira con la ocupación de cada día (07:00–22:00) y encabezados con el tiempo libre. Mover entre días: arrastrar una fila sobre un día, o «Un día antes / después» (alternativa táctil y accesible).
5. **Los huecos ayudan a decidir, sin presión.** «Usar este hueco» lista las tareas pendientes cuya estimación cabe; «Dejarlo libre» es una respuesta válida («está bien así»). No se rellena nada automáticamente.
6. **Filtro por proyecto o área** (letra + nombre).
7. **Lo vencido no se mueve solo.** Un bloque pasado sin terminar se muestra como «Sin terminar» (trazo punteado, nunca rojo) y se ofrece «Reprogramar». Idea tomada de la crítica a Flighty por marcar en rojo cualquier retraso.
8. **Estados no dependen del color:** pastilla con glifo y texto (Hecho, En curso, Sin terminar, Ya pasó, Pendiente); eventos con ◆ y barra hueca.
9. **Móvil con su propia adaptación:** filas de dos líneas con la cuenta regresiva a la derecha, detalle como hoja inferior, tira semanal reducida, barra inferior de secciones.
10. **Identidad:** tinta y papel, índigo 藍, Shippori Mincho en títulos, cifras tabulares, bordes finos y esquinas de 4–8 px, sello 記 solo en la marca.

Descartado a propósito: numerar cada actividad al estilo del metro de Tokio (letra + número; ver [Station numbering](https://en.wikipedia.org/wiki/Station_numbering)). Se mantiene la letra por proyecto, que ya cumple esa función sin volverse críptica.

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
- El arrastre entre días no se ha comprobado en un navegador.

## Modelo de datos propuesto (pendiente de confirmar)

Coherente con la bóveda en Markdown como fuente de verdad y SQLite como índice (ver `05-data-model.md`).

- Bloques y eventos como notas Markdown con frontmatter, p. ej. en una carpeta de calendario, con `type: block`:
  - `kind`: `block` | `event`
  - `start`, `end`: fecha y hora locales (`YYYY-MM-DDTHH:mm`)
  - `task`: enlace `[[…]]` opcional (solo bloques)
  - `project`: clave de proyecto o área, opcional
  - `done_at`: instante en que se terminó el bloque (solo bloques)
- Tareas: nuevo campo opcional `estimate` (minutos) además de `due`.
- Índice: tabla `blocks(path PK, kind, start, end, task_path, project_key, done_at)`, derivada del Markdown.
- Reglas: terminar un bloque nunca cambia `status` de la tarea; completar la tarea nunca toca sus bloques; reprogramar solo cambia `start` y `end`; nada se mueve automáticamente.
- Pregunta abierta: ¿un archivo por bloque o un archivo por día? Un archivo por bloque encaja con la edición móvil sin conexión (D-22: hash base por nota) y evita conflictos entre dispositivos.

## API en línea (implementada)

Solo con el daemon conectado; no hay cola sin conexión para el calendario. Todas las rutas exigen la clave y respetan los roles: el móvil puede leer y escribir el calendario con las mismas reglas de privacidad que el resto (`.kioku/mobile.json`).

| Ruta | Cuerpo / parámetros | Respuesta |
|---|---|---|
| `GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` | Fechas locales, ambas **inclusivas**; máximo 367 días. | `{ items, tasks, invalid, now }` |
| `POST /api/calendar/create` | `{ id, title, kind, start, end, taskPath?, projectPath? }` (`id` de 8–64 caracteres, `[a-zA-Z0-9-]`). Reintentar con el mismo contenido devuelve la misma actividad. | La actividad |
| `POST /api/calendar/move` | `{ path, start, end, hash }` | La actividad |
| `POST /api/calendar/finish` | `{ path, hash }` | La actividad |

- Cada actividad lleva `path`, `title`, `kind`, `start`, `end`, `hash`, `state`, `taskPath`, `projectPath`, `projectTitle` y, si se terminó, `done_at`. Las relaciones crudas (`task`, `project`) no salen en la API.
- Mover y terminar exigen el `hash` leído: si la actividad cambió, `409` y nada se escribe. Terminar un bloque nunca completa su tarea ni a la inversa; nada se reprograma solo.
- Errores como en el resto de la API (`{ error, code? }`): rango, fecha, tipo, tarea o proyecto inválidos → `400`; hash obsoleto o `id` ya usado con otro contenido → `409`. Una petición inválida no cambia nada.
- Los huecos libres no se calculan en el servidor: la UI los deriva de las actividades visibles.
- **Móvil.** Las actividades que apuntan a una nota privada (la propia actividad, su tarea o su proyecto, también el heredado de la tarea) o a una relación que no se resuelve no aparecen, y las tareas privadas tampoco; así no se filtran títulos, cuentas ni huecos. Mover o terminar una actividad oculta responde `404`; crear con rutas privadas, `403`.
- La lectura no se guarda en la caché del service worker (`web/src/sw-rules.ts`): una agenda antigua parecería actual y podría conservar referencias que el móvil ya no debe ver.

## Plan

Siguiendo TDD (`npm test` y `npm run typecheck` en verde, `npm run build:web` para la web; pruebas con bóvedas y `KIOKU_HOME` temporales).

1. **Modelo y núcleo.** Confirmar el modelo (D-23). Parseo e indexado de bloques, `estimate` en tareas, cálculo de estado (hecho / en curso / sin terminar / ya pasó / pendiente) y de huecos libres. Pruebas del cálculo con casos de borde: bloques que se tocan, cruces, cambio de día, hora local.
2. **API.** Lectura por rango de fechas; crear, mover y terminar bloques; sugerencias de tareas para un hueco. Operaciones idempotentes con el mismo estilo que `mobile-operations`.
3. **Web: vista Día.** Fila en curso con progreso, aviso «Siguiente», filtro por proyecto, «Usar este hueco», detalle con la tarea asociada y acciones separadas (terminar bloque / completar tarea).
4. **Web: vista Semana.** Tira de ocupación, encabezados por día, mover con arrastre y con botones, avisos de cruce.
5. **Móvil.** Adaptación propia (hoja inferior, filas de dos líneas). Integrar las escrituras con la cola de operaciones sin conexión.
6. **Asistente y captura.** Que la captura pueda crear bloques (`@proyecto`, hora) y que el asistente proponga bloques como propuesta aprobable. Fuera del alcance inicial.
7. **Validación** en `docs/validation.md`: casos con hora, huecos y vencidos; revisión de contraste y de uso solo con teclado.

## Fuera de alcance por ahora

Sincronización con calendarios externos, recurrencias, zonas horarias múltiples, planificación automática, animación de las cifras y botón «+» de captura rápida.
