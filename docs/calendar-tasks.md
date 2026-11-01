# Calendario: tareas (JARV-27)

Crear tareas sin salir del calendario, verlas en un panel lateral, darles hora arrastrándolas y enlazarlas a una actividad (también a un evento). Solo escritorio y en línea: el móvil conserva su lista blanca y no puede crear ni editar tareas desde aquí.

## Qué se puede hacer

| Acción | Dónde | Cómo |
|---|---|---|
| Crear una tarea | Panel «Tareas pendientes» | Escribe el título y pulsa «Añadir tarea». Fecha, estimación (minutos) y proyecto son opcionales, dentro de «Fecha, estimación y proyecto». |
| Editar una tarea | Panel | «Editar» abre el formulario en la misma fila; solo se envía lo que cambió y Esc cancela. Vaciar un campo lo quita. |
| Completar una tarea | Panel | «Completar» la quita de pendientes sin cambiar su bloque o evento. También está disponible con el rol móvil. |
| Darle hora | Panel → calendario | Arrastra la tarea a la cuadrícula del día (se crea un bloque a la hora bajo el puntero, ajustada a 15 min), a un día de la semana o a la lista del día (primer hueco libre donde cabe). |
| Darle hora sin arrastrar | Panel | «Programar» abre «Nueva actividad» con la tarea, el título y la duración ya puestos: sirve con teclado y en pantallas táctiles. |
| Enlazar una tarea a una actividad | Detalle de la actividad | «Tarea de este evento / bloque»: elegir una existente, cambiarla, quitar el enlace o «crear una nueva» y enlazarla en un paso. Vale para eventos y bloques, en cualquier momento. |

El bloque que nace de una tarea dura lo que estima (30 min si no tiene estimación) y queda enlazado a ella. Si se cruza con otra actividad se avisa, pero no se impide.

## Reglas

- **El título es literal.** No pasa por la sintaxis de captura: «mañana», «p1», «#etiqueta» o «@proyecto» se quedan como texto. Una tarea creada aquí no cae en la Bandeja ni crea proyectos o decisiones.
- **Fechas legibles en el panel.** El vencimiento se expresa respecto a hoy (reloj del servidor), aunque se vea otro día: hoy, mañana, día de la semana para los próximos seis días, o fecha completa; las vencidas muestran su fecha. La fecha guardada y la del formulario no cambian.
- **Completar es independiente.** Terminar un bloque no completa su tarea ni al revés; enlazar o quitar el enlace no modifica la tarea ni la finalización del bloque.
- **Un evento puede llevar tarea.** Antes el modelo lo rechazaba; ahora `task` es válido en un evento, que sigue sin poder terminarse (`done_at` se rechaza). Convertir un bloque en evento conserva la tarea y suelta la finalización.
- **Validación antes de escribir.** Título: 1–200 caracteres en una línea. Fecha: `YYYY-MM-DD` real. Estimación: entero de 1 a 1440 minutos. Proyecto: una nota existente de tipo proyecto. Lo inválido falla con 400 y no escribe nada; un `hash` viejo falla con 409.

## API (escrituras solo con rol completo)

| Ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /api/task/create` | `{ title, due?, estimate?, projectPath? }` | `{ path, title, hash }` |
| `POST /api/task/update` | `{ path, hash, title?, due?, estimate?, projectPath? }` (`null` quita fecha, estimación o proyecto) | `{ path, title, hash }` |
| `POST /api/calendar/link` | `{ path, hash, taskPath }` (`null` quita el enlace) **o** `{ path, hash, task: { title, … } }` | la actividad, sin relaciones crudas |
| `GET /api/calendar/projects` | — | `[{ path, title }]` para elegir proyecto |

`GET /api/calendar` no cambia de forma; cada tarea pendiente trae además su `hash` para editarla en el sitio. Las tres rutas de escritura **no** están en la lista blanca del móvil (responden 403 sin tocar nada); `/api/calendar/projects` es una lectura y pasa por el mismo filtro de privacidad que el resto.

## Código

- Núcleo: `Kioku.createTask` / `updateTask` (`src/core/kioku.ts`), `Calendar.linkTask` / `linkNewTask` / `projects` (`src/core/calendar-store.ts`), `parseBlock` (`src/core/calendar.ts`).
- Interfaz: `TaskPanel`, `TaskLinker` (`web/src/calendar.tsx`), lógica pura en `web/src/calendar-model.ts` (`taskInput`, `taskChanges`, `taskDraftBlock`, `dropStart`, `pendingTasks`), soltado en `DayGrid` (`web/src/calendar-grid.tsx`).
- Pruebas: `test/calendar-tasks.test.ts`.

## Límites

Sin modo sin conexión (la cola móvil no incluye estas acciones), sin prioridades en el panel y una sola tarea por actividad. La finalización por teclado devuelve el foco a otra acción del lateral o a su encabezado; un doble clic rápido sobre una fila que desaparece puede dejar el foco en el documento, sin completar una segunda tarea en la prueba observada.
