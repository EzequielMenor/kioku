# Kioku: cierre y pulido — decisiones de producto

Fecha: 2026-11-16 · Rama: `integration/kioku-cierre` (main 0730a70 + `feat/kioku-macos` + `feat/notes-editor-graph`)

## Objetivo

Kioku está terminado cuando puedo instalarlo, configurarlo sin entender sus tripas y usarlo a diario: abrir, escribir una
idea, recuperarla semanas después, llevar tareas, mirar el calendario y marcar hábitos sin dedicar tiempo a organizar.
Es una fase de cierre: se simplifica e integra lo que ya existe y no se añaden funciones que no aporten valor directo.

Referentes: la sencillez de Apple Notes, la organización de Notion (páginas, bases, vistas), la libertad de Obsidian
(Markdown, enlaces) y, por detrás, Kio, que organiza, relaciona, recupera y actualiza. Todo se puede usar y editar sin
el modelo de IA.

## Estado comprobado (antes de tocar nada)

- `main` = 0730a70 está publicado. Fuera de `main` quedaban `feat/kioku-macos` (10 commits) y `feat/notes-editor-graph`
  (2 commits). Ya están unidas en esta rama: dos conflictos resueltos (instalador de macOS y `cli/main.ts`) y 836 tests
  en verde.
- Mac mini: Kioku.app responde por HTTPS 443 y corre una versión anterior a `main`.
- Omarchy: corre su propio servicio desde un checkout antiguo.
- Las dos bóvedas (13 y 17 notas) son de pruebas. **Decisión del usuario:** se empieza con una bóveda limpia en el
  Mac mini y las anteriores quedan como respaldo. No se borra ninguna sin autorización.

## Decisiones

**D1. Un solo servidor.** El Mac mini es el servidor, con Ollama local y `qwen3.5:9b`. Omarchy y el iPhone son clientes
de `https://<mac>.ts.net` por Tailscale (web instalable). El servicio propio de Omarchy se para al migrar; su bóveda
se queda donde está, como respaldo.

**D2. Conflicto del 8443 corregido.** Para decidir si Kioku está publicado solo cuenta el HTTPS 443 de ese equipo. Las
demás publicaciones de Tailscale del usuario ni bloquean a Kioku ni se tocan. Funnel en el 443 sigue considerándose
conflicto, porque Kioku nunca se publica en Internet.

**D3. Navegación con seis entradas.** Hoy · Kio · Notas · Tareas · Calendario · Bases, más **Ajustes** abajo.
- *Bandeja* deja de ser una sección y pasa a ser «Sin organizar», dentro de Notas y en Hoy. Kio la vacía solo.
- *Grafo* pasa a ser una vista de Notas («Lista | Grafo») y el panel «Relacionadas» de cada nota.
- *Proyectos* pasa a ser una pestaña de Tareas.
- *Propuestas* y *Actividad* se integran en Kio, con contador en el menú.
- *Diario* pasa a ser un botón en Notas.
- *Conexiones y sincronización*, el tema, el modelo de Kio y las actualizaciones van a Ajustes.
- Las rutas antiguas siguen funcionando, para no romper enlaces ni la app de macOS.
- Móvil: Hoy · Notas · **Kio** (centro) · Tareas · Más (Calendario, Bases, Ajustes).

**D4. Una sola caja de escritura.** En Hoy y en Kio hay una caja: «Escribe una idea, una tarea o pregúntale a Kio».
- *Con Kio disponible:* Kio decide qué hacer. Guarda notas, crea tareas o eventos, marca hábitos o lecturas, y responde
  si es una pregunta. Actúa directamente y deja Deshacer.
- *Sin Kio (sin modelo o sin conexión):* se guarda al instante en «Sin organizar», sin perder nada, y Kio lo ordena
  cuando vuelva.
- Los prefijos rápidos (`t`, `n`, `d`) siguen funcionando sin IA, para quien los quiera.

**D5. Autonomía con red de seguridad.** Kio ordena «Sin organizar» por su cuenta, sin propuestas: convierte en nota o
tarea, enlaza y etiqueta. Cada cambio queda en Actividad con Deshacer. Pide aprobación en lo destructivo (borrar, mover),
en lo masivo (más de 5 notas por consulta), en la estructura de las bases y en el contenido con enlaces externos. Hoy
muestra «Lo último que ha hecho Kio» con Deshacer.

**D6. La misma conversación en todos los dispositivos.** El móvil usa las conversaciones del daemon, igual que el
escritorio, y las restricciones del móvil se siguen aplicando en el servidor.

**D7. Búsqueda.** FTS5 sigue siendo la base, porque funciona sin modelo. Los embeddings locales solo se adoptan si,
medidos con consultas reales en español, mejoran la recuperación de forma clara y con un coste aceptable en el M4 de
16 GB. Candidatos: `qwen3-embedding:0.6b`, `embeddinggemma` y `bge-m3`, vía Ollama. Si se adoptan, búsqueda híbrida
(FTS + vectores, fusión RRF) y «Relacionadas» calculadas. Si no aportan, se documenta y no se integran.

**D8. Hábitos y Biblia como vistas de Bases.**
- Se añaden dos tipos de vista a las bases existentes:
  - `habits`: rejilla de días con un toque para marcar hoy y la racha.
  - `progress`: barras de progreso agrupadas, por ejemplo libros por testamento.
- Plantillas: «Hábitos» y «Lectura de la Biblia» (66 libros con su número de capítulos).
- Kio puede marcarlos: «he leído Juan 3», «hoy hice ejercicio».

**D9. Configuración sin jerga.**
- En el Mac, Kio detecta Ollama y el modelo. Ajustes muestra «Kio: qwen3.5:9b en este Mac · funciona» y un selector
  de modelo.
- Fuera de la interfaz las palabras Hermes, JSON y proveedor. El aviso inicial pasa a ser una sola frase sobre dónde se
  procesan las notas.

## Etapas y criterios de aceptación

| Etapa | Contenido | Se acepta cuando |
|---|---|---|
| 1 Base | Unir ramas, fix 8443, runbook de bóveda limpia | Tests, typecheck y build en verde; la rama contiene ambas ramas; el runbook no borra nada |
| 2 Navegación | D3 y D9 | Escritorio 1440×900 y móvil 390×844 capturados; ninguna ruta antigua rota; tests verdes |
| 3 Kio central | D4, D5 y D6 | Con motor falso y con qwen3.5:9b real: una idea se guarda y se ordena, una tarea se crea, una pregunta se responde, Deshacer revierte; sin modelo nada se pierde |
| 4 Búsqueda | D7 | Informe con métricas (recall@5, MRR, latencia) de FTS frente a vectores frente a híbrida; se integra solo si mejora |
| 5 Seguimientos | D8 | Marcar hábito y lectura a mano y vía Kio; vistas usables en móvil |
| 6 Puesta en marcha | Instalar en el Mac mini, bóveda limpia, Omarchy e iPhone como clientes | Checklist manual completado por el usuario |

## Fuera de alcance

Nuevas pantallas, sincronización propia más allá de la actual, plugins, colaboración multiusuario, publicación en
Internet y cambios de proveedor de IA remoto.

## Estado al cierre (2026-11-17)

| Etapa | Estado | Verificado con |
|---|---|---|
| 1 Base | Hecha: ramas unidas, fix del 8443, [guía de puesta en marcha](../../puesta-en-marcha.md) | Tests, typecheck y build |
| 2 Navegación | Hecha (D3, D9) | Capturas a 1440×900 y 390×844; rutas antiguas redirigen |
| 3 Kio central | D4 y D5 hechas. **D6 pendiente** | Motor falso. **Falta qwen3.5:9b real** |
| 4 Búsqueda | **Sin empezar**: necesita Ollama del Mac mini accesible desde aquí | — |
| 5 Seguimientos | Hecha (D8): hábitos y Biblia a mano, desde Hoy y vía Kio (`log_habit`) | Motor falso y capturas en móvil |
| 6 Puesta en marcha | Guía escrita; la ejecutas tú | Checklist manual de la guía |

**D6 aplazada a propósito.** El móvil sigue con su propia conversación. Compartir la del escritorio expone en el
iPhone lo que Kio haya citado de carpetas privadas. Solo es seguro sin carpetas privadas, y hacerlo bien toca el
aislamiento del móvil, que hoy falla cerrado. Mejor no improvisarlo al cierre. Notas, tareas, bases y la actividad de
Kio sí se comparten.

**Fix adicional.** `index.sync` podía borrar del índice una nota recién escrita si coincidía con el vigilante de
archivos. Se veía al crear muchas filas seguidas. Está corregido y tiene test.
