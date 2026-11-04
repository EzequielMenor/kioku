# Bases: estructura editable desde la tabla (fase 1)

Fecha: 2026-11-04 · Estado: pendiente de revisión · Extiende D-17 (`docs/design/02-TRD-architecture.md`)

## Objetivo

Que una base se pueda moldear con clics, como en Notion, sin abrir el fichero `Bases/<Nombre>.md` para editar YAML:
añadir, renombrar, cambiar de tipo y borrar propiedades, y gestionar las opciones de selección con colores. Markdown
sigue siendo la fuente de verdad (Obsidian ve los mismos cambios) y `index.db` sigue siendo derivado y borrable.

Es la fase 1 de tres. Fase 2: celdas y filas ricas (etiquetas de colores en celdas, selector de fechas y relaciones,
fila nueva dentro de la tabla, panel lateral de fila). Fase 3: barra de vista (filtrar/ordenar/agrupar/ocultar directo,
ancho y orden de columnas). Calendario y Galería quedan fuera de las tres.

## Decisiones tomadas con el usuario

- Renombrar y borrar una propiedad **reescribe las notas que son filas** (clave del frontmatter), con confirmación que
  indica cuántas notas se afectan y con Deshacer. No se queda en una simple etiqueta de la base.
- Prioridades pedidas: estructura editable, celdas/filas ricas y filtros más directos. El orden de las fases lo propuse
  yo (la estructura primero porque las otras dos se apoyan en ella); el usuario no fijó un orden.

## Fuera de alcance de la fase 1

Celdas ricas, selector de fechas/relaciones, panel lateral de fila, fila nueva en la tabla, barra rápida de filtros,
ancho/orden de columnas, vistas Calendario y Galería, edición de esquema en móvil.

## 1. Modelo (`src/core/database.ts`, puro)

- `PropSchema.options` admite `string | { name: string; color?: OptionColor }`. Las listas de strings actuales se
  siguen leyendo igual (sin color). Al escribir, una opción sin color se guarda como string y una con color como objeto.
- `OptionColor`: `gray | brown | orange | yellow | green | blue | purple | red`. Un color desconocido se descarta con
  aviso (no falla la base).
- `Column.options` pasa a ser `{ name, color? }[]`; los consumidores (`queryRows`, `availableColumns`, el cliente
  web, `query_database` del asistente) se adaptan. La salida del asistente sigue entregando solo los nombres.
- Operaciones puras sobre el frontmatter de la base (`properties`, `views`), sin disco:
  añadir/renombrar/cambiar tipo/borrar propiedad; añadir/renombrar/recolorear/reordenar/borrar opción.
- Validación de nombres de propiedad: se recortan; no pueden estar vacíos; no pueden ser claves de sistema o reservadas
  (`id`, `type`, `created`, `title`, `tags`, `parked`, `path`, `mtime`, `source`, `properties`, `views`); no pueden
  colisionar con otra propiedad ya existente en el esquema o en alguna fila, sin distinguir mayúsculas.
- Las columnas de sistema (`title`, `tags`, `path`, `type`, `mtime`) no se renombran, no cambian de tipo ni se borran.
  `tags` y `mtime` solo se pueden ocultar en la vista.
- Una propiedad que solo existe inferida de las filas (sin entrada en `properties`) se puede renombrar y borrar igual;
  si se le cambia el tipo o se le editan opciones, se crea su entrada en el esquema.

## 2. Escritura (`src/core/kioku.ts` y `src/server/server.ts`)

Dos rutas nuevas, ambas POST con `{ path, op }` (`op` es una unión etiquetada: `add-property`, `rename-property`,
`set-type`, `delete-property`, `add-option`, `rename-option`, `set-option-color`, `reorder-options`, `delete-option`):
`/api/database/schema/preview` (cuántas notas se verían afectadas, sin escribir) y `/api/database/schema` (aplica y
devuelve `undoId`). Reutilizan la cola en serie de `mutateViews` (parte del texto del fichero, no del índice).

| Operación | Esquema/vistas | Notas (filas) |
|---|---|---|
| Añadir propiedad | entrada en `properties` | no se toca ninguna fila |
| Renombrar propiedad | clave nueva en `properties`; actualiza `columns`, `filter`, `sort` y `group` de **todas** las vistas | renombra la clave del frontmatter en las filas de la base que la tengan |
| Cambiar tipo | cambia `type` (si pasa a `select`/`multi`, las opciones se siembran con los valores distintos presentes, máx. 50, sin color; si deja de serlo, se descartan) | no convierte valores: un valor que no encaja se muestra tal cual con un indicador |
| Borrar propiedad | quita la entrada y sus referencias en las vistas | quita la clave de las filas de la base |
| Añadir/reordenar/recolorear opción | edita `options` | no se toca |
| Renombrar opción | edita `options` y las referencias en filtros (`is`/`is_not`) | cambia el valor en las filas que lo tienen |
| Borrar opción | quita de `options` | por defecto el valor se queda en las notas; solo se vacía si el usuario marca «vaciar también en N notas» |

Reglas comunes:

- "Filas de la base" = notas que cumplen `matchesSource` y no están excluidas por `exclude`. Las filas de otra base
  que compartan clave no se tocan.
- Las operaciones que tocan filas validan todo antes de escribir: colisión de clave en alguna fila, conflicto de hash
  en una fila o carpeta excluida abortan el lote entero sin escribir nada.
- Esas operaciones toman una instantánea con `UndoStore.capture` (la base y todas las filas afectadas), escriben y
  llaman a `commit` con `tool: "database.<op>"` y un `summary` legible. La respuesta incluye `undoId`. Se deshace con
  el `/api/assistant/undo` existente, que ya se niega si algo cambió después.
- Las rutas respetan el mismo filtro de rutas de usuario que el resto del servidor (`userPath`) y no están en la
  lista de rutas de móvil (`src/server/mobile.ts`).

## 3. Interfaz (`web/src/`)

- `databases.tsx` (414 líneas) se parte en ficheros con una responsabilidad cada uno: lista de bases, vista de base,
  panel de filtros, celdas, vistas (tabla/lista/tablero) y un componente `Popover` nuevo. Sin dependencias nuevas.
- **Menú de cabecera.** Pulsar el nombre de una columna abre un popover: renombrar, tipo, opciones (si es selección o
  múltiple), ocultar en esta vista (usa el borrador de vista existente, no escribe), ordenar ↑/↓ y borrar propiedad.
- **«+ Propiedad».** Columna final de la tabla: nombre y tipo; aparece vacía en todas las filas.
- **Opciones con color.** Lista editable dentro del popover (punto de color, renombrar, arrastrar para reordenar,
  borrar). Escribir un valor nuevo en una celda de selección ofrece «Crear "X"» y añade la opción al esquema.
- **Confirmaciones.** Renombrar y borrar propiedad, y renombrar/borrar opción con vaciado, muestran cuántas notas se
  verán afectadas (`askConfirm`). Después, un toast con **Deshacer** (el mecanismo de toast ya existe).
- **Móvil.** Solo lectura de la estructura, igual que hoy con «Guardar vista»: sin menú de cabecera ni «+ Propiedad».

## 4. Pruebas (TDD)

Todas con vaults y `KIOKU_HOME` temporales; nunca se toca la bóveda real del usuario.

- Unitarias de las funciones puras: parseo retrocompatible de `options`, color desconocido con aviso, renombrar con
  colisión (también sin distinguir mayúsculas), actualización de referencias en vistas, siembra de opciones al pasar a
  `select`, columnas de sistema protegidas.
- `test/databases.test.ts`: reescritura de varias notas, Deshacer del lote completo, aborto sin escritura parcial ante
  colisión o conflicto de hash, respeto de `exclude`, filas de otra base intactas.
- Prueba de navegador: menú de cabecera (renombrar, cambiar tipo, borrar con confirmación y Deshacer) y «+ Propiedad».
- Se actualizan D-17 en `docs/design/02-TRD-architecture.md`, el README (sección Bases), `docs/design/07-assistant-spec.md`
  (formato de `options` en `query_database`) y el CHANGELOG.
- `npm test`, `npm run typecheck` y `npm run build:web` en verde antes de darlo por hecho.

## Riesgos

- Reescribir muchas notas a la vez: mitigado con validación previa, aborto atómico y el Deshacer por hashes.
- Una edición externa (Obsidian) entre la confirmación y la escritura: el hash base lo detecta y aborta el lote.
- Cambio de forma de `Column.options` (strings → objetos): afecta a `query_database` y al cliente web; se cubre con
  pruebas de ambos.
