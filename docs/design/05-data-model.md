# Modelo de datos

## Regla de oro
**La verdad está en archivos de texto. Todo lo demás se puede borrar y reconstruir.**

```
~/Documents/Kioku/            ← KIOKU_HOME (configurable)
├── Bandeja/                   capturas sin procesar
├── Proyectos/                 un .md por proyecto
├── Tareas/                    un .md por tarea
├── Notas/                     conocimiento libre (subcarpetas permitidas)
├── Diario/                    YYYY-MM-DD.md
├── Recursos/                  documentos, referencias
└── .kioku/
    ├── config.json            preferencias (puerto, proveedor IA, …)
    ├── log/YYYY-MM.jsonl      actividad (append-only, texto plano)
    ├── proposals/<id>.json    propuestas de IA pendientes/resueltas
    ├── trash/                 borrados recuperables
    └── index.db               ÍNDICE DERIVADO (SQLite) — desechable
```

Las carpetas son **convención, no obligación**: el `type` del frontmatter manda sobre la carpeta (como Obsidian: la carpeta no es semántica). Cualquier `.md` que alguien deje en cualquier sitio se indexa.

## Entidad base: Nota
Archivo `.md`, frontmatter YAML opcional. Si no tiene `type`, es `note`.

| Campo frontmatter | Tipo | Notas |
|---|---|---|
| `id` | string (ULID) | Se escribe al crear con Kioku. Si falta (archivo externo), la identidad es la ruta |
| `type` | `note` `task` `project` `journal` `resource` `capture` `database` | |
| `title` | string | Si falta: primer `# H1`, si no, nombre de archivo |
| `tags` | lista | También se extraen `#etiquetas` del cuerpo |
| `aliases` | lista | Para resolver `[[alias]]` (compatible Obsidian); alimenta la tabla `names` del índice |
| `created` | ISO-8601 | Lo escribe Kioku al crear. No hay `updated`: la fecha de modificación es la del fichero |

Propiedades desconocidas **se conservan intactas** al reescribir el frontmatter (Kioku no pisa lo que no entiende).

## Tipos especializados (propiedades de "base de datos", estilo Notion/Bases)

**task**
| Campo | Valores |
|---|---|
| `status` | `todo` · `doing` · `done` · `dropped` (agrupados como Notion `status`: abierto / en curso / cerrado) |
| `project` | `"[[Nombre del proyecto]]"` (relación) |
| `due` | `YYYY-MM-DD` opcional |
| `priority` | `1`(alta) · `2` · `3` opcional |
| `done_at` | ISO-8601 al completarse |

**project**
| Campo | Valores |
|---|---|
| `status` | `active` · `paused` · `done` · `someday` |
| `goal` | `"[[Objetivo]]"` opcional (v1: texto libre) |

Cuerpo de un proyecto — secciones reconocidas por título (resto libre):
```markdown
## Decisiones
- 2026-10-25 — Usar SQLite como índice, no como fuente de verdad.
## Bitácora
- 2026-10-25 18:40 — Dejado en: falta cablear el watcher al índice.
```
Esto es **Markdown legible en Obsidian**, y es lo que alimenta la tarjeta de retomar (ver §Retomar).

**database** (`Bases/<Nombre>.md`): una colección de notas con vistas, al estilo Notion. Es Markdown normal: la definición vive en el frontmatter y el cuerpo es libre.
```yaml
type: database
source: { folder: "Libros/", type: null, tags: [] }   # qué notas son sus filas (todas las condiciones a la vez)
properties:                                           # esquema opcional; lo no declarado se infiere del valor
  Estado: { type: select, options: [Quiero leer, Leyendo, Leído] }
views:
  - { name: Tabla, kind: table, columns: [title, Estado, Autor, Nota], filter: [{prop: Estado, op: is, value: Leyendo}], sort: [{prop: Nota, dir: desc}], group: null }
  - { name: Por estado, kind: board, group: Estado }
```
- **Filas:** las notas que cumplen `source` (carpeta sin distinguir mayúsculas, `type`, etiquetas); una base nunca es fila de sí misma ni de otra. Sin `source` no tiene filas. Cada celda es una propiedad del frontmatter de su nota (más `title`, `tags`, `path`, `type`, `mtime`).
- **Tipos:** `text` `number` `date` (AAAA-MM-DD) `checkbox` `select` `multi` `url` `relation` (`[[enlace]]`). Se infieren del primer valor no vacío; `properties` puede fijar tipo y opciones.
- **Filtros** (se combinan con Y): `is` `is_not` `contains` `empty` `not_empty` `gt` `lt` `before` `after` `checked`. **Orden** multi-clave estable con los vacíos siempre al final. **Agrupación** en el orden de las opciones del esquema.
- **Tolerancia:** una vista o propiedad inválida se descarta con un aviso y la base sigue abriéndose; una vista escrita a mano con errores no se pierde al guardar otra.
- Plantillas al crear: vacía, tareas (`source.type: task`), proyectos y libros. Fuera de V1: calendario, galería, relaciones entre bases, rollups, fórmulas.

**journal**: `Diario/YYYY-MM-DD.md`, con `focus: ["[[Tarea]]", …]` opcional (foco elegido del día).

**capture**: lo que crea Quick sin prefijo. Vive en `Bandeja/`. Se "procesa" convirtiéndolo (cambiar `type`, mover, enlazar a proyecto) — con propuesta de Kioku.

## Enlaces
Sintaxis Obsidian-compatible: `[[Destino]]`, `[[Destino|texto]]`, `[[Destino#Encabezado]]`, `[[Destino#^bloque]]`, `![[embed]]`. Resolución: coincidencia exacta de ruta → nombre de archivo (sin `.md`, insensible a mayúsculas/acentos) → alias. Ambigüedad → el más cercano por ruta; se registra como `ambiguous` en el índice.

## Índice SQLite (derivado)
```sql
notes(rid PK, path UNIQUE, uid, type, title, mtime, size, hash, body, fm_json, fm_error, tags_json)
links(src, dst_raw, dst_key, dst_path NULL, anchor, alias, embed)   -- dst_path NULL = sin resolver
names(key, path, rank)                                             -- título / alias / nombre de fichero → nota
tags(path, tag)
tasks(path PK, status, project_key, project_path, due, priority, done_at, focus)  -- vista tipada de type='task'
notes_fts USING fts5(title, body, tags, tokenize='unicode61 remove_diacritics 2')
events(id PK, ts, kind, path, data)                                -- carga del JSONL
meta(key, value)                                                   -- schema_version
```
Las bases de datos **no** tienen tabla propia: `notes.fm_json` ya guarda todo el frontmatter y las consultas filtran y ordenan en memoria (ver «Bases de datos»).
- **Reconstrucción:** `kioku reindex` borra y regenera desde disco. Test de invariantes: reindex ⇒ mismo resultado que el índice incremental.
- **Incremental:** el watcher (`fs.watch`) compara `mtime+hash` por archivo; sólo reparsea lo cambiado.
- **Coherencia con escrituras externas** (Obsidian/editor): si el hash en disco ≠ hash base al guardar desde Kioku, se rechaza el guardado con conflicto (nunca sobreescribir silenciosamente).

## Log de actividad (`.kioku/log/YYYY-MM.jsonl`)
Una línea JSON por evento: `{ts, kind, path?, data?}`.
`kind`: `note.open` `note.edit` `capture` `task.status` `focus.start` `focus.end` `checkpoint` `decision` `proposal.created` `proposal.applied` `proposal.rejected`.
Es texto plano, auditable, y **la única memoria** que usa Kioku para "ayer dejaste…". No hay otra.

## Retomar (contexto de un proyecto) — algoritmo determinista
Entrada: `project_path`. Salida (`ResumeCard`):
1. `lastCheckpoint`: última línea de `## Bitácora` (o el último `checkpoint` del log).
2. `decisions`: últimas 3 de `## Decisiones`.
3. `open`: tareas con `project = este` y `status ∈ {todo,doing}`, ordenadas (doing → due → prioridad).
4. `touched`: notas editadas por última vez (log) relacionadas (enlazadas desde/hacia el proyecto), top 5.
5. `idleDays`: días desde el último evento del proyecto.
Sin LLM. Un proveedor de IA puede reescribir esto en prosa, pero **los datos de origen son estos** y se muestran enlazados.

## Sugerencia de "Hoy" — puntuación explicable
`score = urgencia + enCurso + impulso + prioridad`
- urgencia: vencida +100, hoy +80, ≤3 días +40, ≤7 días +15
- enCurso: `status=doing` +60
- impulso: proyecto tocado en las últimas 48 h +20
- prioridad: p1 +30, p2 +15
- foco elegido hoy en el diario: +50
Cada sugerencia devuelve `reasons: string[]` ("vence hoy", "ya la empezaste"), mostradas en pantalla. Determinista y testeable.

## Propuestas (IA / automatización)
```json
{ "id":"01J…", "createdAt":"…", "source":"rules|llm:<modelo>", "status":"pending|applied|rejected",
  "title":"Mover 3 capturas a Proyecto X",
  "ops":[ {"op":"create|update|move|delete|setProp","path":"…","before":"hash|null","after":{…}} ],
  "rationale":"…" }
```
Reglas: (a) nada modifica el vault sin pasar por `applyProposal`; (b) cada `op` lleva el hash `before` y se aborta si el archivo cambió; (c) se muestra el diff; (d) aplicar/rechazar se registra en el log; (e) borrar = mover a `.kioku/trash/`.

## Qué NO está en el modelo (a propósito)
Árbol de bloques en base de datos, CRDT, usuarios/permisos, `rollup`/`formula` (v2), grafo precomputado (se deriva de `links`).
