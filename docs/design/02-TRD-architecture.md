# TRD y Arquitectura

## Vista general

```
 Hyprland bind ──► `jarvis quick` ──► ventana Chromium --app (Quick, "caliente" en special workspace)
                                              │  HTTP/JSON + SSE (127.0.0.1)
 Workspace (Chromium --app, Preact+CM6) ──────┤
 CLI `jarvis …` ──────────────────────────────┤
                                              ▼
                              Daemon Node 24 (src/server)
                                              │
                                  Jarvis facade (src/core/jarvis.ts)
              ┌───────────────┬───────────────┼────────────────┬──────────────┐
           Vault (FS)     Index (SQLite)   ActivityLog     ProposalStore   AIProvider
        Markdown = verdad  derivado, FTS5   JSONL append   .jarvis/proposals  (reglas hoy)
```

- **Fuente de verdad**: los `.md` del vault. `.jarvis/index.db` es derivado y se reconstruye (`jarvis reindex`; un test comprueba incremental == desde cero).
- **Única memoria**: `.jarvis/log/YYYY-MM.jsonl` (append-only, legible). No hay memoria oculta de IA.
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
| D-06 | Atajo global = bind de Hyprland → `jarvis quick` | Wayland no permite atajos globales a apps; no se modifica config del usuario |
| D-07 | Priorización "Hoy" determinista y explicable | El usuario ve el porqué (reasons); sin LLM obligatorio |
| D-08 | IA solo vía `AIProvider` + propuestas; `jarvis context` muestra el payload | Transparencia y aprobación; sin memoria opaca |
| D-09 | Capturas durante un foco quedan "aparcadas" (`parked`) | Evita desvío mientras se trabaja; reaparecen al terminar |
| D-10 | Escritura atómica + hash base (detección de conflictos) | Convive con Obsidian/sincronizadores sin pisar cambios |
| D-11 | Papelera en `.jarvis/trash`, nunca borrado duro | Reversible |
| D-12 | Import de Obsidian = copia de solo lectura a `Notas/Importado/` | Nunca se modifica la bóveda original; informe de enlaces rotos |
| D-13 | Vault de JARVIS por defecto `~/Documents/Jarvis`; `guardHome` rechaza carpetas con `.obsidian` | Protección de la bóveda real |
| D-14 | Sin sincronización ni nube en V1 | Requisito; export/restore tar.gz como respaldo |
| D-15 | LLM opcional compatible con OpenAI (`.jarvis/ai.json`, clave solo en variable de entorno); solo se envía tras ver el payload exacto (hash verificado en el servidor); el modelo únicamente clasifica y JARVIS construye las operaciones; cada envío queda en el log (`ai.request`) | Privacidad y control: nada sale sin que lo veas; un modelo no puede inventar rutas ni escribir |
| D-16 | Asistente = Hermes Agent en jaula `bwrap` (sin montar la bóveda); solo ve las herramientas de JARVIS vía un puente MCP que llama al daemon con un token por sesión; los niveles (lectura / auto con Deshacer / aprobación) y el límite de 5 notas por consulta los impone el servidor, no el modelo | Un modelo (o una nota hostil) no puede borrar ni salirse de lo permitido; todo lo automático es reversible y queda en el registro. Spec: `07-assistant-spec.md` |

## Límites conocidos
- La edición es Markdown con resaltado, no WYSIWYG ni bloques.
- Quick "caliente" depende de Hyprland; en otros entornos abre una ventana efímera.
- Sin el asistente (Hermes) ni un proveedor LLM configurado, el motor de propuestas es de reglas.
