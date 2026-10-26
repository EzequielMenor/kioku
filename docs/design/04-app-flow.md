# App Flow

Flujos principales, con el resultado observable que verificamos en pruebas.

## F1 — Captura rápida (resuelve fricción de captura y P2)
1. Atajo de Hyprland ejecuta `jarvis quick`.
2. Si el daemon no corre, se arranca (≈ 300 ms). Se muestra/alterna la ventana Quick.
3. Usuario escribe. Gramática (primer token decide):
   | Entrada | Resultado |
   |---|---|
   | `texto libre` | `Bandeja/<ts>-<slug>.md` (type: capture) |
   | `t Llamar al banco !mañana @Proyecto` | `Tareas/…md` (task, due, project) |
   | `d Usar SQLite como índice` | línea en `## Decisiones` del proyecto en foco (o `@proyecto`) |
   | `n Título` | nota en `Notas/` |
   | `/consulta` o `Tab` | modo búsqueda |
   | `>` | paleta de comandos |
4. `Enter` guarda, muestra "✓ Guardado en Bandeja" 600 ms y cierra. Si hay sesión de foco, la captura lleva `focus: <tarea>` y **no aparece en listas hasta terminar el foco** (parking lot).
5. Fallo del guardado → la ventana NO se cierra y muestra el error (no se pierde texto).

Fechas naturales soportadas (v1): `hoy`, `mañana`, `lunes…domingo`, `+3d`, `YYYY-MM-DD`.

## F2 — Empezar el día (P1)
1. Abrir JARVIS → **Hoy**.
2. Arriba: *"Empieza por: «Tarea» — vence hoy · en curso"* (+ botón **Empezar foco**). Debajo, 2 alternativas, colapsadas por defecto.
3. Debajo: tarjetas "Retomar" de proyectos activos (máx. 3, por impulso).
4. Lateral: Bandeja (n sin procesar) y Propuestas pendientes.
5. `Enter` sobre la sugerencia → F3.

## F3 — Sesión de foco (P2)
1. `Empezar foco` (o `>foco <tarea>`) registra `focus.start`. Aparece una **barra de foco** persistente: tarea, proyecto, cronómetro.
2. Mientras dure: Quick sigue capturando (F1, parking lot). Abrir notas ajenas al proyecto en foco muestra un aviso discreto (una línea, descartable, sin sonido).
3. `Terminar foco`: pregunta una línea opcional **"¿Dónde lo dejas?"** → se añade a `## Bitácora` del proyecto y evento `checkpoint`. Ofrece marcar la tarea como hecha / seguir.
4. Las capturas del parking lot pasan a la Bandeja visible.

## F4 — Retomar (P3)
1. Abrir un proyecto (o ver su tarjeta en Hoy) → **ResumeCard**:
   *"Hace 3 días. Lo dejaste en: «falta cablear el watcher». Decisiones: …. Falta: 3 tareas. Tocaste: nota A, nota B."*
2. Cada elemento es un enlace. Botón **Continuar** inicia foco en la primera tarea abierta.
3. Es 100 % determinista (ver `05-data-model.md §Retomar`). Un proveedor de IA puede ofrecer reescritura en prosa como *propuesta de texto*, nunca reemplaza los datos.

## F5 — Buscar y navegar
- `Ctrl+K` en Workspace / modo búsqueda de Quick. Resultados mezclados: título (difuso, prioridad) y contenido (FTS5 con fragmento resaltado). `Enter` abre; `Ctrl+Enter` abre en panel lateral (v2).
- En una nota: panel **Backlinks** (menciones enlazadas) y *menciones sin enlazar* (búsqueda FTS del título).

## F6 — Procesar la Bandeja (la organización no debe ser trabajo)
1. JARVIS crea una **propuesta** por captura: tipo sugerido (tarea/nota), proyecto probable (coincidencia por palabras clave/enlaces), con razón.
2. Pantalla Bandeja: `a` aceptar, `e` editar, `x` descartar, `j/k` moverse. Aceptar ⇒ `applyProposal` (mueve/convierte con hash `before`).
3. Nada se aplica sin acción del usuario.

## F7 — Propuestas de IA
Cualquier generador (reglas hoy, LLM mañana) crea `Proposal`. UI: diff por operación → *Aprobar todo / Aprobar parcial / Rechazar*. Todo en el log.

## F8 — Importar / Exportar
- `jarvis import-obsidian <ruta>`: **solo lectura** del origen; copia `.md` y adjuntos a `Notas/Importado/`, informa de enlaces rotos. Dry-run por defecto; requiere `--yes`.
- `jarvis export <destino.zip>` y `jarvis restore <zip>` (restaura a carpeta vacía; nunca sobrescribe).

## Estados de error relevantes
| Situación | Comportamiento |
|---|---|
| Archivo cambiado fuera de JARVIS durante edición | Conflicto: se muestra diff y se elige; no se sobrescribe |
| Frontmatter YAML inválido | La nota se indexa como texto, se marca `⚠`, no se reescribe el frontmatter |
| Índice corrupto/ausente | Reconstrucción automática en segundo plano; la app sigue funcionando leyendo disco |
| Puerto ocupado | Siguiente puerto libre; se escribe en `.jarvis/runtime.json` |
| IA no disponible | Todo lo demás funciona; se omite la sugerencia en prosa |
