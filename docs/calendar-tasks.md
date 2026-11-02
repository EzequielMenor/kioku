# Calendario: tareas (JARV-27)

Crear tareas sin salir del calendario, verlas en un panel lateral, darles hora arrastrándolas y enlazarlas a una actividad (también a un evento). Desde el calendario es solo escritorio y en línea. El formulario de la pantalla **Tareas** (más abajo) también funciona en el móvil, en línea.

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

## Formulario en la pantalla Tareas

«Añadir tarea» (Tareas) y el título de una tarea en **Lista, Tabla o Tablero** abren el mismo formulario. Sustituye a la antigua barra de captura de esa pantalla; Hoy, Proyecto y Quick siguen igual (el título de sus tareas abre la nota y la captura con `t …` interpreta la sintaxis).

| Campo | Notas |
|---|---|
| Título | Único obligatorio; se guarda literal (1–200 caracteres, una línea). |
| Fecha límite, Estimación | Opcionales; vaciar el campo al editar lo quita. |
| Estado | Pendiente, En curso, Hecha o Descartada. Pasar a «Hecha» fija `done_at`; guardar sin cambiar el estado lo conserva. |
| Prioridad | Sin prioridad, Alta (1), Media (2) o Baja (3). |
| Área | Opcional e independiente del proyecto: una tarea puede tener área sin proyecto, y viceversa. |
| Proyecto | Opcional. |

- Al editar solo se envía lo que cambió: el cuerpo Markdown y las propiedades que el formulario no conoce quedan intactos. «Abrir nota» lleva al Markdown.
- Es un diálogo nativo modal: el foco queda atrapado, Esc o «Cancelar» cierran sin escribir y el foco vuelve al elemento que lo abrió. Mientras guarda no se puede cancelar ni enviar dos veces.
- Si falla (por ejemplo 409 porque la nota cambió en el portátil) el error se ve en el diálogo y lo escrito se conserva; cancela y vuelve a abrir la tarea para cargar la versión actual. Tras guardar, la lista se recarga.
- **Solo en línea, también en el móvil.** No usa la cola sin conexión: sin red muestra el error y no guarda nada. Los cambios de estado de las listas (casilla, selector) conservan su comportamiento sin conexión de siempre.

## Reglas

- **El título es literal.** No pasa por la sintaxis de captura: «mañana», «p1», «#etiqueta» o «@proyecto» se quedan como texto. Una tarea creada aquí no cae en la Bandeja ni crea proyectos o decisiones.
- **Fechas legibles en el panel.** El vencimiento se expresa respecto a hoy (reloj del servidor), aunque se vea otro día: hoy, mañana, día de la semana para los próximos seis días, o fecha completa; las vencidas muestran su fecha. La fecha guardada y la del formulario no cambian.
- **Completar es independiente.** Terminar un bloque no completa su tarea ni al revés; enlazar o quitar el enlace no modifica la tarea ni la finalización del bloque.
- **Un evento puede llevar tarea.** Antes el modelo lo rechazaba; ahora `task` es válido en un evento, que sigue sin poder terminarse (`done_at` se rechaza). Convertir un bloque en evento conserva la tarea y suelta la finalización.
- **Validación antes de escribir.** Título: 1–200 caracteres en una línea. Fecha: `YYYY-MM-DD` real. Estimación: entero de 1 a 1440 minutos. Proyecto: una nota existente de tipo proyecto. Área: una nota de tipo área existente. Estado: `todo`, `doing`, `done` o `dropped`. Prioridad: 1, 2, 3 o `null`. Lo inválido falla con 400 y no escribe nada; un `hash` viejo falla con 409.

## API

| Ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /api/task/create` | `{ title, due?, estimate?, projectPath?, areaPath?, status?, priority? }` | `{ path, title, hash }` |
| `POST /api/task/update` | `{ path, hash, title?, due?, estimate?, projectPath?, areaPath?, status?, priority? }` (`null` quita fecha, estimación, proyecto, área o prioridad) | `{ path, title, hash }` |
| `POST /api/calendar/link` | `{ path, hash, taskPath }` (`null` quita el enlace) **o** `{ path, hash, task: { title, … } }` | la actividad, sin relaciones crudas |
| `GET /api/calendar/projects` | — | `[{ path, title }]` para elegir proyecto |

`GET /api/calendar` no cambia de forma; cada tarea pendiente trae además su `hash` para editarla en el sitio.

- **Estado, prioridad y área** solo los leen `task/create` y `task/update`. `calendar/link` con `task` sigue aceptando únicamente título, fecha, estimación y proyecto: esos campos se ignoran, sin error.
- **Móvil:** `task/create` y `task/update` están en su lista blanca (en línea, sin cola). `calendar/link` no: responde 403 sin tocar nada. Si la tarea, el proyecto o el área caen en una carpeta privada de `.kioku/mobile.json` responde 403 (en `task/update` también si el proyecto o el área que la tarea ya tiene son privados o no se resuelven, aunque el cuerpo intente quitarlos), y también si el fichero de la tarea nueva (`Tareas/<título>.md`) quedaría en una carpeta o fichero privado, antes de escribir nada.
- `/api/calendar/projects` y `/api/calendar/areas` son lecturas y pasan por el mismo filtro de privacidad que el resto.

## Código

- Núcleo: `Kioku.createTask` / `updateTask` (`src/core/kioku.ts`), `Calendar.linkTask` / `linkNewTask` / `projects` (`src/core/calendar-store.ts`), `parseBlock` (`src/core/calendar.ts`).
- Formulario de Tareas: `web/src/task-form.tsx` (+ `.css`), enlaces en `TaskLine`/`TasksView` (`web/src/app.tsx`) y `web/src/task-views.tsx`; ruta del servidor en `taskFields` (`src/server/server.ts`).
- Interfaz del calendario: `TaskPanel`, `TaskLinker` (`web/src/calendar.tsx`), lógica pura en `web/src/calendar-model.ts` (`taskInput`, `taskChanges`, `taskDraftBlock`, `dropStart`, `pendingTasks`), soltado en `DayGrid` (`web/src/calendar-grid.tsx`).
- Pruebas: `test/calendar-tasks.test.ts`, `test/task-form.test.ts` y `test/task-form-browser.test.ts` (Chromium real; se omite sin Chromium o sin `npm run build:web`).

## Límites

Sin modo sin conexión (la cola móvil no incluye estas acciones), sin prioridades en el panel del calendario (sí en el formulario de Tareas) y una sola tarea por actividad. La finalización por teclado devuelve el foco a otra acción del lateral o a su encabezado; un doble clic rápido sobre una fila que desaparece puede dejar el foco en el documento, sin completar una segunda tarea en la prueba observada.
