# PRD — Kioku

**Estado:** v1 en construcción · **Usuario:** una sola persona (Ezequiel) · **Plataforma objetivo:** Omarchy (Arch + Hyprland/Wayland), MacBook Pro Intel 16 GB.

## 1. Propósito

Kioku es un segundo cerebro y sistema operativo personal, local-first. Su valor no es "guardar notas" (Obsidian ya lo hace) ni "montar bases de datos" (Notion ya lo hace), sino **reducir la fricción de decidir, mantener el rumbo y retomar**.

## 2. Los tres problemas (criterio de éxito de todo el producto)

| # | Problema | Resolución en Kioku | Cómo sabemos que funciona |
|---|---|---|---|
| P1 | Al empezar el día hay demasiadas opciones | Pantalla **Hoy**: una sugerencia principal ("empieza por esto") + 2 alternativas, con la razón explícita de cada una | En < 10 s desde abrir la app sabes qué hacer. Test: con N tareas y fechas conocidas, la sugerencia es determinista y explicable |
| P2 | Trabajando, me desvío | **Sesión de foco**: una tarea/proyecto activo siempre visible; las ideas que surgen se capturan a la Bandeja *sin cambiar de contexto* y no reaparecen hasta terminar | Capturar una idea en < 3 s sin abandonar la pantalla de foco |
| P3 | Retomo tras días y reconstruyo contexto | **Tarjeta de retomar** por proyecto: dónde lo dejaste (checkpoint), qué se decidió, qué falta, qué archivos tocaste | Al abrir tras N días, la tarjeta muestra checkpoint + decisiones + pendientes sin buscar nada |

## 3. Principios (no negociables)

1. **Local-first, privado por defecto.** Sin servicios cloud obligatorios. El daemon escucha solo en `127.0.0.1`.
2. **Los datos son tuyos y legibles**: Markdown + frontmatter YAML en una carpeta. Un índice SQLite derivado que se puede borrar y reconstruir. Exportar = copiar la carpeta.
3. **Teclado primero.** Toda acción tiene acceso por paleta de comandos.
4. **La organización no es trabajo.** Captura sin decidir dónde va; Kioku propone, tú confirmas.
5. **IA transparente.** Ninguna modificación por IA se aplica sin una *propuesta* visible (diff) que apruebas, y queda auditada. Sin memoria opaca: todo lo que "sabe" Kioku está en archivos que puedes leer.
6. **Sin gamificación** (rachas, puntos, logros).
7. **Nunca tocar el vault de Obsidian existente.** La importación es solo-lectura de origen y copia a la carpeta de Kioku, y solo bajo comando explícito.

## 4. Experiencias

### Quick (captura instantánea)
- Ventana flotante tipo Spotlight, invocable desde cualquier app con un atajo de Hyprland → `kioku quick`.
- Un solo campo. Escribir y Enter = captura a Bandeja. Prefijos: `t ` tarea · `d ` decisión (del proyecto en foco) · `n ` nota · `/` buscar · `>` comandos.
- Sin prefijo y con texto → pregunta no; captura y listo (la organización viene después).
- Esc cierra. Objetivo: de atajo a texto guardado < 2 s.

### Workspace (aplicación completa)
- Barra lateral: Hoy · Bandeja · Proyectos · Tareas · Notas (árbol) · Diario.
- Paleta `Ctrl+K` global. Editor Markdown con `[[enlaces]]` autocompletados y panel de backlinks.
- **Hoy (centro de control)**: foco actual, sugerencia, tarjetas de retomar de proyectos activos, bandeja pendiente de procesar, propuestas por aprobar.

## 5. Alcance de la V1

**Incluido**
1. Captura rápida (Quick + CLI `kioku add`).
2. Almacenamiento local persistente (Markdown + índice SQLite reconstruible + log de actividad JSONL).
3. Organización básica: notas, tareas (estado, fecha, proyecto), proyectos, diario, etiquetas, enlaces/backlinks.
4. Búsqueda y recuperación: texto completo (FTS5) + salto difuso por título + backlinks.
5. Centro de control: Hoy, sesiones de foco, checkpoints, decisiones, tarjeta de retomar.
6. Base de IA: interfaz de proveedor, cola de propuestas con aprobación, auditoría; resumen "retomar" determinista (sin LLM) como línea base.
7. Importar Obsidian (solo lectura del origen) y exportar/restaurar (zip/carpeta).

**Excluido de V1 (con razón en `07-implementation-plan.md`)**: grafo visual, vistas calendario/timeline/galería, rollups/fórmulas, editor WYSIWYG por bloques, plugins de terceros, sincronización entre dispositivos, app móvil, LLM real conectado (solo la interfaz + proveedor local opcional), voz.

## 6. Fuera de alcance, por decisión
Colaboración multiusuario, permisos, servidores propios, telemetría, cuentas.

## 7. Métricas de aceptación de V1
- Arranque en frío del daemon < 500 ms; búsqueda < 50 ms para 10 000 notas (medido en pruebas).
- Reconstruir el índice desde cero reproduce exactamente el mismo estado (test).
- Borrar `.kioku/index.db` no pierde ningún dato del usuario.
- Cero escrituras fuera de la carpeta de Kioku en toda la suite de pruebas.
