# Kioku — versión candidata de cierre

Rama: `integration/kioku-cierre` (sin fusionar con `main`). Fecha: 2026-11-18.

Kioku es tu segundo cerebro local: escribes como en Apple Notes, lo tienes ordenado como en Notion, todo queda en
ficheros Markdown como en Obsidian, y **Kio** (el asistente, con qwen3.5:9b en tu Mac mini) organiza, apunta y
recuerda por ti. Lo que hace Kio se puede deshacer, y lo delicado (borrar, mover, tocar muchas notas) te lo propone
antes.

## Instalar (Mac mini como servidor)

Antes: Ollama con `qwen3.5:9b` y Tailscale en el Mac mini.

1. **Instala la app** en el Mac mini. Descarga el ZIP de la rama, descomprímelo y abre Terminal en esa carpeta:
   ```bash
   KIOKU_REF=integration/kioku-cierre ./Instalar\ Kioku.command
   ```
   No necesita Node ni Docker ni permisos de administrador. Si ya tenías Kioku.app, la anterior se aparta como
   `Kioku.app.anterior-FECHA`; no se borra.
2. **Ábrela y sigue «Estado y configuración»:** bóveda `~/Documents/Kioku`, «Activar» el arranque con macOS y «Usar
   qwen3.5:9b». Kioku pide a Ollama el contexto que necesita; no hay que configurar nada en Ollama.
3. **Conecta tus otros dispositivos:** en **Ajustes → Conexión y dispositivos**, «Activar acceso privado» y
   «Añadir dispositivo» para el iPhone. En Omarchy, abre la dirección `https://<mac>.ts.net` en Chromium e instálala
   como aplicación.

La guía detallada, que incluye cómo apartar la bóveda de pruebas sin borrarla y cómo volver atrás, está en
[puesta-en-marcha.md](puesta-en-marcha.md).

## Qué se ha comprobado de verdad

Ver [validation.md → Versión candidata de cierre](validation.md#versión-candidata-de-cierre-2026-11-18). En resumen:

- Kio con **qwen3.5:9b real** (el Ollama del Mac mini, por Tailscale) sobre una bóveda temporal: crear notas,
  organizar la bandeja, crear tareas, marcar hábitos, apuntar lectura, recuperar datos y cinco trampas de honestidad.
  Cada respuesta se ha comparado con lo que cambió de verdad en disco.
- Suite completa, typecheck y compilación de la web.
- Recorridos de escritorio (1440 px) y móvil (390 px, rol móvil) en Chromium real, con capturas.
- Búsqueda medida con 40 notas y 32 preguntas.

## Comprobaciones manuales pendientes (las haces tú)

- [ ] El instalador en el Mac mini real (el de GitHub Actions usa un macOS limpio, no tu Mac).
- [ ] Kioku.app nativa: Kio flotando, ⌥⌘K, menú de la barra superior.
- [ ] En el Mac mini, Kio contesta en un tiempo aceptable para ti. En las pruebas, entre 15 y 60 s por petición, y
      hasta 4 minutos al ordenar varias capturas de golpe.
- [ ] iPhone: emparejar, capturar sin conexión y ver que se sincroniza al volver.
- [ ] Omarchy como cliente del Mac mini (la PWA por `https://<mac>.ts.net`).
- [ ] Las seis comprobaciones de [puesta-en-marcha.md § 6](puesta-en-marcha.md#6-comprobación-la-haces-tú-a-mano).
