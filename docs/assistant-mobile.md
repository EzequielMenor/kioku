# Asistente desde el móvil

El móvil emparejado (`kioku pair`) puede hablar con el mismo asistente de Kioku, con las mismas herramientas y las mismas aprobaciones, **siempre con el portátil encendido** y sin ver nunca lo que `.kioku/mobile.json` marca como privado. Lo crítico sigue pidiendo tu confirmación, ahora también desde el móvil.

## Ruta rápida

1. En el portátil: `kioku pair` y abre el enlace en el móvil (como hasta ahora).
2. En el móvil: **Más → Asistente**. Pregunta lo que quieras: organizar la Bandeja, ver qué hacer hoy, agenda, bases de datos…
3. Si el asistente propone algo crítico (borrar, mover, reescribir, tocar muchas notas), aparece en **Más → Propuestas** (y como aviso en «Hoy»). Revisa los cambios exactos y confirma con **Aplicar**; nada se aplica solo.

## Qué puede hacer el móvil

| Acción | Móvil | Cómo |
|--------|-------|------|
| Preguntar y ver el estado | Sí | `POST /api/assistant/ask`, `GET /api/assistant/status` |
| Cambios pequeños del asistente (crear tarea, cambiar estado…) | Sí, con **Deshacer** | `GET /api/assistant/actions`, `POST /api/assistant/undo` |
| Ver, aplicar o descartar propuestas | Solo las **nacidas en el móvil** | `GET /api/proposals`, `POST /api/proposals/<id>/apply\|reject` |
| Memoria de Hermes, herramientas (`tools/list`, `tools/call`), configuración, exportar, claves | No | 403 con la clave del móvil |
| Preguntar sin conexión | No | Sin cola ni caché: el móvil avisa y no guarda la pregunta |

## Cómo se protege la privacidad

| Regla | Detalle |
|-------|---------|
| Una sola lista por llamada | Cada llamada de herramienta de una consulta del móvil recalcula `assistant.json` + `mobile.json` + actividades de calendario ocultas (`hiddenCalendarPaths`). Si cambia la privacidad a mitad, se bloquean nuevas herramientas y se descarta la respuesta completa (409), incluido el texto libre del modelo. |
| Nada global | La lista del móvil viaja con la llamada; la compartida del escritorio no se modifica. Una sesión del móvil sin lista no ejecuta ninguna herramienta. |
| Escribir tampoco | Crear o tocar algo donde el móvil no ve (carpeta privada, destino de un movimiento…) se rechaza, incluso como propuesta. |
| Salida filtrada | Los resultados pasan por el filtro de lecturas del móvil y pierden los elementos de lista que nombran algo oculto. La respuesta de `ask` lleva las lecturas y acciones **re-filtradas con la privacidad de ahora** y sin instantáneas previas (`beforeText`). |
| Sin SSE del asistente | Los eventos `assistant.*` nunca llegan al móvil; la respuesta de `ask` es el único canal. |
| Origen de cada cosa | Las sesiones del móvil se identifican (`mobile-…`) y sus propuestas llevan la marca `mobile:<sesión>` que fija el servidor. Deshacer y propuestas del escritorio **no existen** para el móvil (404). |
| Revisión al operar | Al listar, aplicar, descartar o deshacer se recomprueba que **todas** las rutas (origen y destino), textos y enlaces `[[…]]` sigan visibles. Si ahora tocan algo oculto: 404 y nada cambia. |
| Conversaciones separadas | El móvil usa `mobile:<huella>:<id>`; el escritorio conserva su identificador tal cual. La huella cambia si cambian las exclusiones: la misma conversación pasa a otro espacio (no se borra nada). |
| Revocar corta | Si el emparejamiento se revoca o rota mientras corre una consulta, sus herramientas y su respuesta dejan de valer (401). |

## Requisito del motor (fail-closed)

El móvil solo puede preguntar si el motor declara `isolatesMobile = true`: memoria, sesiones y skills de Hermes **separados** para `session.role === "mobile"` (y por `session.scope`). Si no, `GET /api/assistant/status` dice `{ ok: false, reason }` y `ask` responde 503 sin invocar el motor: de lo contrario la memoria de Hermes podría arrastrar datos privados del escritorio al móvil.

## Límites conocidos

- La huella de privacidad (`session.scope`) incluye también las actividades de calendario ocultas. Si cambia qué es visible, se usa otra carpeta de memoria, sesiones y skills (`.kioku/hermes-mobile/<huella>`), sin borrar el estado anterior.
- Un texto de propuesta se compara con las carpetas ocultas por nombre; un dato privado sin ruta ni enlace no puede detectarse, pero el modelo del móvil nunca lo recibe.
- El móvil no ve las propuestas del escritorio aunque sean «visibles»: así no se confía en textos escritos por un modelo que sí vio lo privado.
- Aprobar una propuesta de borrado desde el móvil mueve la nota a `.kioku/trash` (recuperable), tras un diálogo de confirmación.

## Comprobar

```bash
node --test test/mobile-assistant.test.ts test/mobile-role.test.ts test/assistant-server.test.ts test/assistant-chat.test.ts test/mobile-ui.test.ts
npm run typecheck
```
