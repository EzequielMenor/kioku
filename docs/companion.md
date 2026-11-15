# Kio: tu compañero de Kioku

Kio es la cara del asistente de Kioku. Hay **un solo agente** y dos sitios donde verlo:

- **Dentro de Kioku:** flotando en la esquina de la aplicación, con un panel compacto para hablarle (tecla `.`).
- **En tu escritorio**: flotando sobre tus ventanas, con el mismo panel. En Hyprland/Omarchy es el overlay GTK que se describe aquí; en macOS es la app nativa [Kioku.app](macos.md) (⌥⌘K, menú en la barra superior y arranque con launchd).

Los dos comparten **conversación, estado y ajustes**, que viven en el daemon: lo que le preguntas en el escritorio aparece en la pestaña *Asistente*, y si lo pones en concentración en un sitio, lo está en los dos. El modelo que responde es el que tengas configurado ([local con Ollama](assistant-local.md) o [cualquier otro](assistant-models.md)).

## Kio en el escritorio

```bash
kioku companion          # lo lanza (arranca el daemon si hace falta)
kioku companion toggle   # lo oculta o lo trae de vuelta (si no está en marcha, lo lanza)
kioku companion focus    # entra o sale del modo concentración
kioku companion panel    # abre o cierra la conversación
kioku companion status   # proceso, modo y modelo activo
kioku companion stop     # lo quita del escritorio   (--revoke retira además su credencial)
```

Con el ratón:

| Gesto | Qué hace |
|---|---|
| **Clic** en Kio | Abre o cierra la conversación. `Esc` la cierra. |
| **Arrastrar** | Lo mueve; la posición se recuerda (también entre reinicios y si cambias de pantalla). |
| **Clic derecho** | Modo concentración. |
| Clic en el aviso que asoma a su lado | Abre la conversación. |

Solo el cuerpo de Kio recibe clics: el aire de alrededor y sus esquinas redondeadas los dejan pasar a la ventana de debajo.

En el panel: escribe y pulsa `Enter` (`Mayús+Enter` para un salto de línea). Mientras responde, el botón pasa a **Detener**. Arriba: nueva conversación (`＋`), concentración (`◐`), abrir la conversación completa en Kioku (`⤢`), ocultar (`⌄`) y cerrar (`×`). Las acciones que Kio hace solo traen su **Deshacer**; lo que borra, mueve o reemplaza llega como **propuesta** y pide una segunda pulsación («Confirmar: aplicar») antes de tocar nada.

### Requisitos

Linux con Wayland y un compositor con `wlr-layer-shell` (Hyprland, Sway…), GTK4, `gtk4-layer-shell` y PyGObject. En Omarchy/Arch:

```bash
sudo pacman -S --needed gtk4 gtk4-layer-shell python-gobject python-cairo
```

`kioku companion` comprueba esto antes de arrancar y te dice qué falta. Kioku no instala nada por su cuenta.

### Atajos y arranque (Hyprland / Omarchy)

Añádelos **tú** a `~/.config/hypr/bindings.lua` (Kioku nunca toca tu configuración); comprueba antes que las teclas estén libres con `omarchy menu keybindings --print`:

```lua
o.bind("SUPER + K",       "Kio: conversación", "/ruta/a/kioku/bin/kioku companion panel")
o.bind("SUPER + ALT + K", "Kio: mostrar/ocultar", "/ruta/a/kioku/bin/kioku companion toggle")
```

Para que aparezca al iniciar sesión, lanza `/ruta/a/kioku/bin/kioku companion` desde tu arranque de Hyprland.

## Qué te dice su cara

El personaje pinta la actividad **real** del agente; no hay animaciones de adorno.

| Estado | Cuándo | Cómo se ve |
|---|---|---|
| Reposo | No hay nada en curso | Respira y parpadea |
| Te escucha | Estás escribiéndole | Ojos abiertos, ondas |
| Pensando | Consulta en curso; al lado, qué hace («Leyendo Notas/X.md…») | Mira arriba, tres puntos |
| Respondiendo | Está llegando el texto | Habla |
| Espera tu decisión | Hay una propuesta por confirmar | Ceja levantada, `?` ámbar |
| Hecho | Acaba de terminar bien | Sonríe, ✓ |
| Algo falló | La consulta falló (el motivo, en el panel) | Rojo, `!` |
| En concentración | Modo concentración o sin conexión con Kioku | Pequeño, apagado, ojos entornados |

Con el panel cerrado asoma un aviso corto solo cuando hay algo que atender (piensa, responde, espera tu decisión o falló).

## Modos

El modo es del agente, así que lo comparten el Kio de escritorio y el de Kioku.

- **Visible:** lo normal.
- **Concentración:** pequeño, quieto y en silencio (sin avisos). Sigue atendiendo si le hablas, y avisa con su cara si hay una propuesta esperando o algo falló. Una **sesión de foco** de Kioku (`kioku focus start …`) lo pone así sola mientras dura.
- **Oculto:** desaparece de los dos sitios. Vuelve con `kioku companion toggle`, `kioku companion` o el botón «Kio: oculto» de la barra lateral de Kioku. El proceso de escritorio sigue en marcha y conectado, sin dibujar nada.

Además, **con Kioku en primer plano el de escritorio se retira** (manda el personaje integrado) y vuelve cuando cambias de ventana.

## Escritorios virtuales y pantalla completa

- Kio no pertenece a ningún escritorio virtual: está en la pantalla, así que te acompaña al cambiar de escritorio.
- Con una aplicación **a pantalla completa** queda debajo (no tapa vídeos ni juegos) y reaparece al salir.
- El panel pide el teclado **solo al abrirlo** (con un clic en Kio o con `kioku companion panel`); Kio por sí mismo nunca roba el foco, y si haces clic en otra ventana el teclado vuelve a ella.

## Conexión y seguridad

- El overlay es un proceso aparte (`companion/overlay/kioku_companion.py`, GTK4 + Layer Shell) que habla **solo con el daemon local** (`127.0.0.1`).
- Usa una **credencial propia y limitada** (`.kioku/secret-companion`, solo legible por ti): conversar, ver el estado, deshacer lo que hizo el asistente y confirmar propuestas. No puede buscar, leer ni escribir notas directamente, ni cambiar el modelo, ni ver la memoria: el daemon responde 403. Nunca tiene la clave completa.
- **Reconexión:** si el daemon se detiene o se reinicia, Kio se queda en reposo («sin conexión») y reintenta solo (cada 0,5–8 s); al volver recarga el estado y la conversación reales. Una consulta que estaba en curso no lo deja «pensando» para siempre.
- Solo entrega su credencial al daemon que sigue vivo: relee el puerto en cada intento y, si el proceso que lo anotó ya no existe, no conecta aunque otro programa escuche en ese puerto.
- `kioku companion stop --revoke` borra la credencial; el daemon deja de aceptarla al instante.

Ficheros que usa, todos en `.kioku/` de tu espacio: `secret-companion` (credencial), `companion.json` (modo, conversación activa y posición; lo escribe el daemon), `companion-overlay.pid`, `companion-overlay.json` (que ya leíste el aviso de privacidad) y `companion.log`.

## Si algo no va

| Síntoma | Causa y arreglo |
|---|---|
| «El daemon … no reconoce al compañero: es de una versión anterior» | El daemon en marcha es de antes de Kioku Companion. Reinícialo con esta versión (`systemctl --user restart kioku` si usas el servicio) y repite `kioku companion`. |
| «Kio necesita GTK4 con gtk4-layer-shell…» | Instala los paquetes de [Requisitos](#requisitos). |
| «No hay sesión Wayland» | Lánzalo desde tu sesión gráfica, no desde SSH ni desde un servicio sin `WAYLAND_DISPLAY`. |
| Kio aparece apagado y pequeño | Modo concentración, una sesión de foco en curso, o no hay conexión con el daemon (pasa el ratón por encima: lo dice). |
| No aparece | `kioku companion status`: puede estar **oculto** o Kioku estar en primer plano. |
| No arranca | Mira `.kioku/companion.log`. |

## Límites conocidos

- El overlay GTK es solo para Linux/Wayland con `wlr-layer-shell`. En macOS lo hace [Kioku.app](macos.md). En GNOME o X11, Kio vive únicamente dentro de Kioku.
- Aparece en la pantalla que el compositor elige al lanzarlo (la que tiene el foco); no hay selector de monitor.
- El panel es de texto plano: no pinta Markdown ni abre las notas citadas (para eso, `⤢`).
- Sin voz: el estado «te escucha» corresponde a que estás escribiendo.
- El diseño del personaje está en `companion/character.json`. La web (`web/src/companion-face.ts`), el escritorio de Linux (`companion/overlay/face.py`) y el de macOS (`macos/Sources/KiokuKit/Face.swift`) lo pintan igual. Si cambias uno, cambia los otros.

Qué se ha probado y qué no: [validation.md](validation.md).
