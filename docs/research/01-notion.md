# Investigación: Notion

**Fecha:** 2026-10-26 · **Método:** documentación oficial + API pública. REA no se aplicó a Notion.

## Alcance y límites (honestidad metodológica)

- Notion **no está instalado** en esta máquina (no hay paquete ni `~/.config/notion*`) y es una aplicación web propietaria con servidor cerrado.
- No se capturó tráfico de ninguna cuenta ni se eludió ninguna protección. Capturar una sesión autenticada de Notion con REA (`capture_browser_scenario`) requeriría iniciar sesión con datos personales, y lo que se obtendría (contratos de API privada) no es algo que debamos reproducir. **Se descarta por no aportar valor frente al riesgo.**
- Todo lo de abajo es **[COMPROBADO]** (leído en fuente oficial citada) o **[INFERIDO]** (mi deducción, marcada así).

## Hallazgos

### N1. Todo es un bloque; la página es un bloque con hijos — [COMPROBADO]
Fuente: <https://www.notion.com/blog/data-model-behind-notion>

- Bloque = `id` (UUID v4) + `properties` (la principal, `title`) + `type` + `content` (array ordenado de ids hijos, "punteros hacia abajo") + `parent` (puntero hacia arriba, usado solo para permisos).
- El **tipo está desacoplado del almacenamiento**: "Turn into" solo cambia `type`; las propiedades que el nuevo tipo no usa se conservan (un to-do marcado sobrevive a pasar por heading y volver).
- Una página es un bloque cuyo contenido son sus hijos. La indentación es estructural: mueve el bloque al `content` del anterior.
- Edición = operaciones sobre registros agrupadas en **transacciones** que se aplican primero en local (UI en ms) y se encolan en `TransactionQueue` (IndexedDB/SQLite) hasta que el servidor acepta.

**Qué merece la pena para Kioku:** el desacople tipo/datos y la creación optimista local. **Qué descartamos:** el servidor de transacciones, WebSocket de sincronización y permisos por herencia (Kioku es de un solo usuario y local-first). **Qué adaptamos:** nuestro "bloque" será el **Markdown**; no necesitamos un árbol de bloques en base de datos para v1 (ver decisión D-03).

### N2. Bases de datos = colecciones de páginas con propiedades tipadas — [COMPROBADO]
Fuente: <https://developers.notion.com/reference/property-object>, <https://www.notion.com/help/intro-to-databases>

- Cada fila **es una página** (puede abrirse y tener contenido). Propiedades tipadas: `title` (obligatoria, única), `rich_text`, `number`, `select`, `multi_select`, `status` (opciones agrupadas por progreso: To-do / In progress / Complete), `date` (con rango), `checkbox`, `url`, `email`, `phone_number`, `files`, `people`, `relation` (uni o bidireccional), `rollup` (función sobre propiedad vía relación, solo lectura), `formula` (solo lectura), `unique_id`, `created_time`, `last_edited_time`…
- Una base de datos puede tener **N vistas** sobre los mismos datos: tabla, lista, tablero, calendario, galería, gráfico (y timeline). Cada vista guarda su propio filtro, orden, agrupación y propiedades visibles.
- Vistas enlazadas (*linked views*): mostrar una colección dentro de otra página; full-page vs inline.
- La API actual separa `database` (contenedor) de `data source` (esquema + filas) — [COMPROBADO] por el endpoint `POST /v1/data_sources/{id}/query`.

**Para Kioku (v1):** `status` agrupado, `date`, `select`, `relation` y *vistas guardadas* (filtro+orden+agrupación). **Diferido:** rollup, formula, vistas calendario/timeline/galería.

### N3. Navegación y velocidad de interacción — [COMPROBADO]
Fuente: <https://www.notion.com/help/keyboard-shortcuts>

- `Ctrl/Cmd+P` o `Ctrl/Cmd+K`: buscar / saltar a recientes (un único punto de entrada para navegar).
- `/` abre el menú de bloques con filtrado por texto; `/turn` cambia el tipo; atajos Markdown (`#`, `-`, `[]`, `---`) crean bloques al teclear.
- `Ctrl+/` menú de acciones sobre la selección.
- La ayuda **no documenta** una captura rápida global ni un "centro de mando" propio — [COMPROBADO como ausencia en esa página].

**Para Kioku:** paleta de comandos única (`Ctrl+K`) que une *buscar + navegar + crear + ejecutar acciones*; slash menu. Esto es el núcleo de **Quick**.

### N4. Páginas anidadas como organización — [COMPROBADO] / [INFERIDO]
- [COMPROBADO] árbol arbitrario de sub-páginas bajo el workspace.
- [INFERIDO] La barra lateral en árbol + "recientes" + favoritos es el patrón dominante de orientación; el árbol solo escala si hay búsqueda rápida encima. Nuestro diseño pone la búsqueda primero y el árbol después.

### N5. Qué NO copiar (y por qué)
| Rasgo de Notion | Decisión | Motivo |
|---|---|---|
| Datos en servidor propietario | Descartar | Choca con local-first / propiedad de datos |
| Modelo de bloques en BD | Descartar en v1 | Rompe "Markdown siempre"; ver D-03 |
| Permisos/colaboración | Descartar | Uso personal |
| Plantillas/buttons/automatizaciones | Diferir | Complejidad sin valor para los 3 problemas |
| Rollups/fórmulas | Diferir | Útiles pero no resuelven el problema central |

## Límites de este informe
- No se observó la UI real de Notion; las afirmaciones de "experiencia de edición" provienen de su ayuda oficial, no de uso directo.
- Las páginas de ayuda consultadas no cubren relaciones/rollups/timeline en profundidad; para eso usé la referencia de la API (propiedades).
