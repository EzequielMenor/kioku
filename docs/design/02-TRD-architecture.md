# TRD y Arquitectura

## Vista general

```
 Hyprland bind ──► `kioku quick` ──► ventana Chromium --app (Quick, "caliente" en special workspace)
                                              │  HTTP/JSON + SSE (127.0.0.1)
 Workspace (Chromium --app, Preact+CM6) ──────┤
 CLI `kioku …` ──────────────────────────────┤
                                              ▼
                              Daemon Node 24 (src/server)
                                              │
                                  Kioku facade (src/core/kioku.ts)
              ┌───────────────┬───────────────┼────────────────┬──────────────┐
           Vault (FS)     Index (SQLite)   ActivityLog     ProposalStore   AIProvider
        Markdown = verdad  derivado, FTS5   JSONL append   .kioku/proposals  (reglas hoy)
```

- **Fuente de verdad**: los `.md` del vault. `.kioku/index.db` es derivado y se reconstruye (`kioku reindex`; un test comprueba incremental == desde cero).
- **Única memoria**: `.kioku/log/YYYY-MM.jsonl` (append-only, legible). No hay memoria oculta de IA.
- **Todo cambio no manual** (IA, automatismos) pasa por **propuestas** con hash `before`; `apply` comprueba TODOS los hashes antes de escribir.
- Daemon solo escucha en `127.0.0.1`; comprueba `Host` (anti DNS-rebinding) y `Origin`; POST/PUT exigen `application/json`; rutas de usuario deben acabar en `.md`, sin `..` ni segmentos con punto.

## Pila y por qué

| Pieza | Elección | Motivo |
|---|---|---|
| Runtime | Node 24 con TypeScript nativo (sin build de backend) | Ya instalado; sin Rust en la máquina; cero toolchain extra |
| Índice | `node:sqlite` + FTS5 (`unicode61 remove_diacritics 2`) | Sin dependencias nativas; búsqueda en español sin acentos |
| UI | Preact + CodeMirror 6, empaquetado con esbuild | ~580 KB; Markdown real y editable; sin framework pesado |
| Ventanas | `chromium --app=` | Ya instalado; Quick y Workspace sin Electron/Tauri |
| Frontmatter | `yaml` (Document API) | Conserva comentarios y propiedades desconocidas |

## Registro de decisiones

| ID | Decisión | Justificación / alternativa descartada |
|---|---|---|
| D-01 | Markdown plano en carpeta como fuente de verdad | Propiedad de los datos, compatible con Obsidian. Descartado: BD propia (Notion) |
| D-02 | SQLite solo como índice derivable | Búsqueda/backlinks rápidos sin perder portabilidad |
| D-03 | Propiedades tipadas en frontmatter, no árbol de bloques | Obtiene vistas tipo Notion sin romper Markdown. Descartado: bloques (formato propietario) |
| D-04 | Enlaces estilo Obsidian (`[[x]]`, alias, `#h`, `^b`, `![[ ]]`) | Interoperabilidad con la bóveda existente |
| D-05 | Daemon local + UI en Chromium app | Sin Rust; Quick arranca en ms al estar caliente |
| D-06 | Atajo global = bind de Hyprland → `kioku quick` | Wayland no permite atajos globales a apps; no se modifica config del usuario |
| D-07 | Priorización "Hoy" determinista y explicable | El usuario ve el porqué (reasons); sin LLM obligatorio |
| D-08 | IA solo vía `AIProvider` + propuestas; `kioku context` muestra el payload | Transparencia y aprobación; sin memoria opaca |
| D-09 | Capturas durante un foco quedan "aparcadas" (`parked`) | Evita desvío mientras se trabaja; reaparecen al terminar |
| D-10 | Escritura atómica + hash base (detección de conflictos) | Convive con Obsidian/sincronizadores sin pisar cambios |
| D-11 | Papelera en `.kioku/trash`, nunca borrado duro | Reversible |
| D-12 | Import de Obsidian = copia de solo lectura a `Notas/Importado/` | Nunca se modifica la bóveda original; informe de enlaces rotos |
| D-13 | Vault de Kioku por defecto `~/Documents/Kioku`; `guardHome` rechaza carpetas con `.obsidian` | Protección de la bóveda real |
| D-14 | Sin sincronización ni nube en V1 | Requisito; export/restore tar.gz como respaldo |
| D-15 | LLM opcional compatible con OpenAI (`.kioku/ai.json`, clave solo en variable de entorno); solo se envía tras ver el payload exacto (hash verificado en el servidor); el modelo únicamente clasifica y Kioku construye las operaciones; cada envío queda en el log (`ai.request`) | Privacidad y control: nada sale sin que lo veas; un modelo no puede inventar rutas ni escribir |
| D-16 | Asistente = Hermes Agent en jaula `bwrap` (sin montar la bóveda); solo ve las herramientas de Kioku vía un puente MCP que llama al daemon con un token por sesión; los niveles (lectura / auto con Deshacer / aprobación) y el límite de 5 notas por consulta los impone el servidor, no el modelo | Un modelo (o una nota hostil) no puede borrar ni salirse de lo permitido; todo lo automático es reversible y queda en el registro. Spec: `07-assistant-spec.md` |
| D-17 | Bases de datos = una nota Markdown `Bases/<Nombre>.md` (`type: database`) con `source` (carpeta/tipo/etiquetas que definen las filas), `properties` (esquema opcional: tipo y opciones) y `views` (tabla/tablero/lista con filtros, orden, agrupación y columnas). Las filas son notas normales y cada celda una propiedad de su frontmatter; no hay tabla nueva en el índice: se consulta en memoria sobre `notes.fm_json` (`src/core/database.ts`, puro y tolerante: lo inválido se descarta con aviso). El asistente las usa con `list_databases`/`query_database` (respetan `exclude`) y `create_row` (auto con Deshacer); `set_props` admite cualquier propiedad de usuario con valores simples, pero nunca `id`/`created`/`type`/`parked` ni la definición de una base | Mismo contrato que el resto: Markdown = fuente de verdad (se abren y editan en Obsidian), `index.db` derivado y borrable (test: borrar y reindexar da el mismo resultado), sin estado opaco, y todo cambio del asistente sigue siendo reversible y acotado |
| D-18 | La API local exige una clave por daemon (`.kioku/secret`, 64 hex, 0600, generada una vez) en todas las rutas `/api`, lecturas incluidas; viaja en cookie `kioku_key` (`HttpOnly; SameSite=Strict`) o cabecera `x-kioku-key` y se compara en tiempo constante. Se entrega con `/?k=<clave>` (cookie + redirección a la ruta limpia). Quedan fuera solo `/api/assistant/tools/list\|call` (token de sesión) y `/api/health` (`{ok:true}`). Las copias de seguridad excluyen el secreto | La jaula del asistente comparte la red (necesita llegar a su proveedor): sin clave podría leer o escribir saltándose las exclusiones y los niveles. Las lecturas también se protegen porque `GET /api/note` esquivaría `exclude`. Complementa D-16 |
| D-19 | Kioku en el móvil/iPad = una PWA que habla con el mismo daemon por Tailscale (`tailscale serve --bg 47800` publica `https://<equipo>.<tailnet>.ts.net`; el daemon sigue ligado a `127.0.0.1`). El `Host`/`Origin` de esa dirección se acepta solo si está en `KIOKU_ALLOWED_HOSTS` (lista cerrada y exacta, nunca sufijos ni comodines). El móvil usa **otra credencial** (`.kioku/secret-mobile`, 0600, fuera de las exportaciones; `kioku pair` la crea y `kioku pair --revoke` la borra, y el daemon la relee en cada petición, así que revocar es inmediato) con el rol `mobile`, que impone el **servidor** con una lista blanca: todas las lecturas, capturar, tareas, crear/editar notas y propiedades; nunca borrar, asistente, propuestas, foco, escritorio, mantenimiento ni edición de bases. `.kioku/mobile.json` (`{"exclude": ["Privado/"]}`) define carpetas que nunca salen del portátil: se aplican a **todas** las lecturas del rol `mobile` (rutas, listas, búsqueda, Hoy, grafo —también sus contadores y grados—, SSE) y a sus escrituras, normalizando la ruta (`//`, `..`, mayúsculas/NFC). La cookie dura un año y lleva `Secure` cuando el acceso no es local | El móvil es un cliente más y un teléfono se pierde: la credencial limitada, la lista blanca en servidor y las carpetas privadas acotan el daño, y se revoca sin tocar el portátil. Complementa D-18. La edición/lectura sin conexión llegará en las fases 2 y 3 (réplica en IndexedDB) |
| D-21 | Móvil sin conexión (lectura y captura): **réplica de notas en IndexedDB** (manifest por hash → lotes de 50 notas / 1 MiB) + **service worker** con shell versionado por build y lecturas `/api/*` «red primero 3 s, si no la última copia»; búsqueda local sobre la réplica; **cola de capturas** reenviada en orden con `x-kioku-op` y deduplicación en `.kioku/ops.json`. El worker avisa a la página de si hay servidor. Lo privado no entra en réplica ni cachés. **Límites:** sin sincronización en segundo plano (iOS); revocar no borra a distancia la copia local (la protege el bloqueo del teléfono; se purga al recibir un 401); ventana residual de un posible duplicado, nunca una pérdida | No se reimplementa en el cliente la lógica de Hoy/tareas/proyectos (divergiría del servidor); la réplica sirve notas y búsqueda y las pantallas salen de la caché |
| D-20 | Sistema visual «tinta y papel»: todo el color y la tipografía viven en variables CSS (`app.css`), con dos temas de primera clase (tinta/papel) y un acento (índigo). La serif de los títulos (Shippori Mincho, OFL) va **empaquetada** (`dist/web/fonts/`, subconjunto latino) y la marca (sello 記) es un SVG con trazos: la UI no hace ninguna petición externa, requisito para que el modo sin conexión (fase 2) cachee el diseño completo | Local-first también en lo visual; sin dependencia de Google Fonts; el kanji no arrastra una fuente CJK |

## Límites conocidos
- La edición es Markdown con resaltado, no WYSIWYG ni bloques.
- Quick "caliente" depende de Hyprland; en otros entornos abre una ventana efímera.
- Sin el asistente (Hermes) ni un proveedor LLM configurado, el motor de propuestas es de reglas.
