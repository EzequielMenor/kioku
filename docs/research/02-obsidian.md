# Investigación: Obsidian

**Fecha:** 2026-10-26 · **Versión analizada:** 1.14.5 (`~/.config/obsidian/obsidian-1.14.5.asar`, sha256 `3a349274…1780`; paquete Arch `obsidian 1.14.4-2`)
**Método:** REA (análisis estático de JavaScript, sin ejecutar la app) + documentación oficial + API pública de plugins (`obsidianmd/obsidian-api`).

## Alcance, ética y límites

- Análisis **estático e inerte**: REA parsea texto, no ejecuta Obsidian. No se tocó el vault ni se leyó contenido de notas. No se eludió ninguna protección; el ASAR es el artefacto que Obsidian instala en esta máquina.
- **No se copia código propietario.** Solo extraemos patrones de diseño y comportamiento; Kioku se implementa de forma independiente.
- **Cobertura REA parcial (honesto):** el análisis completo agotó el límite de 300 s por fuente (un bundle minificado de ~17 MB de texto). Resultado retenido: 33 fuentes JS relevantes, **8 parseadas**, 25 sin examinar; 2 522 entradas de inventario; 195 módulos; 3 070 hallazgos. Evidencia: `ev_e6be2705141c66fc66481d4847e8bb1fc2f98aba46e7d719fd79f572130a9fc4` (padre), vistas `ev_41e51234…cd5349`, `ev_75f17d84…b5af`.
- Etiquetas: **[REA]** observado en el artefacto · **[DOC]** documentación oficial · **[API]** `obsidian.d.ts` público · **[INF]** inferencia mía.

## Hallazgos

### O1. Bóveda = carpeta de Markdown plano; la app se adapta al disco — [DOC]
Fuente: <https://obsidian.md/help/Files+and+folders/How+Obsidian+stores+data>
- Notas = `.md` en una carpeta; se pueden editar con otros programas y Obsidian "refresca" al detectar cambios externos.
- `.obsidian/` (por vault) guarda ajustes, atajos, plugins; `workspace.json` cambia a cada archivo abierto (conviene excluirlo de git).
- **Caché de metadatos** local (IndexedDB) que alimenta grafo y outline; "puede desincronizarse" y se reconstruye desde ajustes.
- La ayuda recomienda no anidar vaults.

**Adoptamos:** carpeta de Markdown como verdad + índice derivado reconstruible (idéntico concepto: caché desechable). **Mejoramos:** reconstrucción como comando de primera clase (`kioku reindex`) con test de equivalencia incremental/completo.

### O2. Enlaces bidireccionales: texto en el archivo, resolución en el índice — [DOC] [API]
Fuentes: <https://obsidian.md/help/links>, <https://obsidian.md/help/Plugins/Backlinks>
- Sintaxis: `[[Nota]]`, `[[Nota|alias visible]]`, `[[Nota#Encabezado]]`, `[[Nota#^bloque]]`, `![[embed]]`; también enlaces Markdown con URL-encoding.
- Resolución por **nombre de archivo** (con ruta parcial opcional), y por `aliases` del frontmatter.
- Al renombrar, Obsidian actualiza enlaces entrantes (configurable).
- Backlinks = *menciones enlazadas* + *menciones sin enlazar* (texto que coincide con el título pero no es enlace).
- [API] `MetadataCache.resolvedLinks` / `unresolvedLinks`: `origen → destino → nº de enlaces`; `getFirstLinkpathDest(linkpath, sourcePath)` resuelve **relativo al archivo de origen**; `CachedMetadata` expone `links, embeds, tags, headings, sections, listItems, frontmatter, blocks`.
- [REA] En `app.js` se observa el uso de `metadataCache.getCache(path)` y `getFirstLinkpathDest(link, path)` para recorrer enlaces de un conjunto de archivos (en el flujo de Publish: "añadir archivos enlazados"). Confianza: baja-media (patrón literal en código minificado).

**Adoptamos:** sintaxis idéntica (compatibilidad total con tu vault), tabla `links` con destino resuelto (equivale a `resolvedLinks`), backlinks + menciones sin enlazar. **Diferencia consciente:** resolvemos también por **título** (rango más bajo), porque nuestras capturas se crean desde Quick sin pensar en nombres de archivo.

### O3. Propiedades = YAML frontmatter; tipos por nombre de propiedad — [DOC]
Fuente: <https://obsidian.md/help/properties>
- Tipos: texto, lista, número, casilla, fecha, fecha-hora, etiquetas; el tipo se asigna **por nombre de propiedad, para todo el vault**.
- Propiedades por defecto: `tags`, `aliases`, `cssclasses`.
- No soporta propiedades anidadas ni edición masiva (limitaciones conocidas).

**Adoptamos:** frontmatter YAML como esquema de "base de datos" (así una tarea es una nota con `status`, `due`…). **Cuidado clave:** preservar propiedades/comentarios desconocidos al reescribir (implementado y probado: `setFrontmatter`).

### O4. Bases = vistas de base de datos *sobre* notas existentes (no almacenamiento propio) — [DOC]
Fuente: <https://obsidian.md/help/bases>
- Archivo `.base` (o bloque embebido) que define **vistas** (tabla, lista, tarjetas, kanban, mapa) con filtros, orden, agrupación y fórmulas; "todos los datos viven en tus Markdown y sus propiedades".
- Es la respuesta de Obsidian a las bases de datos de Notion: **vista, no contenedor**.

**Adoptamos el principio** (vista guardada = consulta sobre propiedades; los datos siguen siendo archivos). **V1:** vistas fijas (Hoy, Bandeja, Tareas por estado/proyecto). **V2:** vistas guardadas definidas por el usuario en un archivo `.view.md`/YAML.

### O5. Editor: CodeMirror 6 + base heredada de CodeMirror 5 — [REA]
- `app.js` contiene el patrón de CodeMirror 6: `view.state.facet(...)`, `view.viewport.from/to`, `ct.iter(...)`, `ct.spans(...)` y `w6.range(from,to)` (decoraciones y rangos). Además se empaqueta `lib/codemirror/codemirror.js` y `lib/codemirror/modes.min.js` (CM5, para resaltado de código en bloques/legacy).
- Confianza: **media** (se observan identificadores minificados con la forma de la API de CM6; no se ha extraído el nombre del paquete porque está minificado).
- [INF] El "Live Preview" es CM6 con decoraciones que ocultan la sintaxis fuera de la línea activa.

**Decisión:** usar CodeMirror 6 (paquetes oficiales `@codemirror/*`, open source MIT) con decoraciones propias para wikilinks/encabezados. No copiamos nada de Obsidian: usamos la misma librería pública.

### O6. Comandos y atajos: registro declarativo con disponibilidad condicional — [REA] [API]
- [REA] Se observan registros del tipo `addCommand({id:"workspace:new-tab", name:…, checkCallback(e){…return true}, hotkeys:[ (["Mod"],"T") ]})`, y navegación de foco entre paneles `editor:focus-<dirección>` con `checkCallback`.
- [REA] `checkCallback(checking)`: si `checking` es verdadero solo informa si el comando está disponible; si es falso, lo ejecuta. Es el mecanismo que permite que la **paleta muestre solo comandos aplicables al contexto**.
- [REA] Modales de sugerencia con instrucciones fijas **↑↓ navegar · ↵ abrir · esc cerrar**, y `scope.register(["Shift"],"Enter", …)` (mapa de teclas por ámbito/modal).
- [API] `Command {id, name, icon, hotkeys, callback, checkCallback, editorCallback, editorCheckCallback}`; `SuggestModal<T>` con `getSuggestions / renderSuggestion / onChooseSuggestion`.

**Adoptamos (patrón):** registro de comandos `{id, name, hotkey, available(ctx), run(ctx)}`; la paleta filtra por `available`. Ámbitos de teclado (global / lista / modal). Pie de instrucciones de teclas visible en el modal.

### O7. Extensibilidad: plugins como módulos con ciclo de vida — [DOC] [API] [REA]
- [DOC] `Plugin` con `onload()` / `onunload()`; recursos registrados con `register*` para liberarlos al descargar. Plugins en `.obsidian/plugins/<id>/{manifest.json,main.js}`.
- [REA] Se observa carga/comprobación de `…/plugins` en el disco del vault y `addSettingTab(...)` por plugin.
- [API] Superficie: `App {vault, metadataCache, workspace, fileManager}`, `Events.on(...)`, eventos de `Vault` (create/modify/delete/rename), `MetadataCache` (`changed`, `resolved`, `deleted`), `Workspace` (`file-open`, `active-leaf-change`, `layout-change`), `FileManager.processFrontMatter(file, fn)` (lectura-mutación-guardado **atómico** del frontmatter) y `renameFile` (que actualiza enlaces).
- [REA] También existen en el bundle núcleos que en Obsidian son "plugins del core": Canvas (`canvas.nudgeSelection`), Sync, Publish → la propia app está construida sobre la misma arquitectura de módulos.

**Decisión V1:** *sin plugins de terceros*. **Pero** la arquitectura interna se diseña igual: `Kioku` (núcleo) expone un bus de eventos tipado (`note.changed`, `index.updated`, `focus.started`…) y los módulos (Hoy, Bandeja, Foco, IA) son consumidores del mismo contrato público. Eso deja la puerta abierta a extensiones y a que un agente IA use la misma API (CLI/HTTP).

### O8. Búsqueda y navegación — [DOC] [REA] [INF]
- [REA] Modal de búsqueda con clases `mod-search-suggestion`, `searchInfoEl`, `requestUpdateSearch()` (búsqueda incremental asíncrona al teclear), y un buscador dentro del documento (`document-replace`, `_foundInPageHandler`).
- [INF] Conmutador rápido (Ctrl+O) = búsqueda difusa por nombre de archivo; búsqueda global = texto completo con operadores. No se verificó la implementación del índice (está minificada y quedó fuera de la cobertura).

**Adoptamos:** un solo modal que combina difuso-por-título (primero) + texto completo (después). **Medimos nosotros** el rendimiento (SQLite FTS5 + bm25) en lugar de suponer.

### O9. Interacción con archivos existentes — [DOC] [INF]
- Observa cambios externos y los reindexa; no bloquea archivos; el usuario puede trabajar en paralelo con otros editores/Git.
- [INF] Para no corromper, Obsidian escribe de forma que otros procesos vean estados coherentes; la API `processFrontMatter` existe precisamente para evitar sobrescrituras ciegas.

**Adoptamos:** `fs.watch` → resincronización por `mtime+size` → `hash`; al guardar desde Kioku comparamos el hash leído (si cambió fuera: **conflicto**, no sobrescribe). Escritura atómica (tmp + rename). Probado.

## Qué descartamos de Obsidian
| Rasgo | Motivo |
|---|---|
| Vista gráfica del grafo (V1) | Valor bajo frente a tus 3 problemas; los datos (`links`) ya están para añadirla después |
| Sync/Publish propietarios | Local-first; la sincronización será Git/Syncthing sobre la carpeta |
| Live-preview WYSIWYG completo | Coste alto; V1 usa resaltado + decoraciones ligeras |
| Canvas | Fuera de alcance |
| Ecosistema de plugins en V1 | Diferido; arquitectura preparada (O7) |

## Evidencia/limitaciones pendientes (para completar con más tiempo)
1. Reintentar REA con `source_paths:["app.js"]`, `analysis_timeout_ms` ≥ 1 800 000 y menos nodos semánticos para tipificar la caché de metadatos y el buscador (hoy: inferencia).
2. Observación en tiempo de ejecución (Electron CDP) de eventos de `metadataCache` — **requiere abrir tu vault real: no se hace sin tu autorización expresa.** No es necesario para V1.
