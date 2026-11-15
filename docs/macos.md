# Kioku en macOS: la app con Kio

**Kioku.app** es la app de escritorio para usar Kioku a diario en el Mac. Incluye a Kio flotando sobre las ventanas, la conversación con el asistente, la ventana de Kioku y un menú en la barra superior. Arranca sola al iniciar sesión mediante launchd. El asistente funciona con **Ollama local y `qwen3.5:9b`**: el texto de tus notas no sale del Mac.

Es el mismo Kioku que en Linux: el mismo daemon, las mismas herramientas del agente, la misma conversación y los mismos datos. Lo que cambia en macOS es la interfaz de escritorio, nativa en SwiftUI/AppKit en lugar de GTK.

## Qué es cada pieza

| Pieza | Qué hace | Dónde vive |
|---|---|---|
| **Daemon de Kioku** (Node) | Bóveda, índice, API local, agente y conversaciones. Escucha solo en `127.0.0.1:47800`. | Dentro de la app (`Contents/Resources/app` + su Node en `runtime/`), lanzado por launchd |
| **Kioku.app** (Swift) | Kio, su panel, la ventana de Kioku, el menú y la configuración inicial | `~/Applications/Kioku.app` |
| **Ollama** | Ejecuta `qwen3.5:9b` en el Mac | La app de Ollama (la instalas tú) |
| **Bóveda** | Tus notas en Markdown, más `.kioku/` (índice, claves, conversaciones) | `~/Documents/Kioku`, o la carpeta que elijas |

Arranque con macOS (launchd, solo para tu usuario):

- `~/Library/LaunchAgents/local.kioku.daemon.plist`: el daemon arranca al iniciar sesión y se relanza si se cae. Si lo detienes tú, no se relanza.
- `~/Library/LaunchAgents/local.kioku.app.plist`: abre Kioku.app al iniciar sesión, en la sesión gráfica.
- Los logs están en `~/Library/Logs/Kioku/`.

## Instalar

Necesitas macOS 13 o posterior, las herramientas de Xcode (`xcode-select --install`, gratis y sin cuenta de desarrollador) e Internet durante la instalación.

```bash
# Desde una copia del repositorio (o el ZIP de esta rama):
KIOKU_REF=feat/kioku-macos ./Instalar\ Kioku.command
```

El instalador descarga un Node oficial (verifica su checksum), compila Kio en Swift, construye la app en una carpeta temporal y la coloca en `~/Applications/Kioku.app`. Si ya había una, primero la aparta como copia. No pide permisos de administrador, no instala nada global y no toca tus datos. Sin las herramientas de Xcode instala la versión antigua, que abre Kioku en el navegador y no incluye a Kio.

La app no está firmada con un certificado de Apple. La primera vez, haz clic derecho > **Abrir**.

### Configuración inicial (la primera vez que la abres)

La ventana **Estado y configuración** comprueba cada punto y ofrece el botón para resolverlo. No cambia nada hasta que pulsas ese botón.

1. **Bóveda**: por defecto `~/Documents/Kioku`. Puedes elegir otra con «Cambiar…». Una carpeta de Obsidian sin marcar no se usa nunca; para traerla, usa `kioku import-obsidian`.
2. **Arranque con macOS**: el botón «Activar» crea los dos LaunchAgents y arranca el daemon.
   Si en tu Mac ya arranca otra instalación de Kioku (p. ej. `com.ezequiel.kioku-server`, el servidor de la rama antigua), la app la detecta y ofrece **«Sustituir…»**, con confirmación. Eso detiene el agente antiguo y guarda su plist en `~/Library/Application Support/Kioku/legacy/` para que puedas volver atrás. Después carga el nuevo en **el mismo puerto (47800)**, así que `tailscale serve` y el móvil emparejado siguen funcionando. Tus notas no se tocan.
3. **Ollama con qwen3.5:9b**: si Ollama no responde en `127.0.0.1:11434`, verás un enlace a su descarga. Si responde pero falta el modelo, «Descargar el modelo» lo baja (unos 6 GB) y muestra el progreso.
4. **Asistente**: «Usar qwen3.5:9b» deja el asistente en Ollama local. Equivale a `kioku assistant model ollama`. La conversación lo indica con «local · qwen3.5:9b».

Puedes volver a esta ventana cuando quieras desde el menú de Kioku > **Estado y configuración…**

### Sin la app (por terminal)

```bash
kioku service install --app ~/Applications/Kioku.app   # LaunchAgents del daemon y de la app
kioku service install --replace-legacy                  # …sustituyendo un arranque antiguo de Kioku
kioku service status                                    # launchd · daemon: activo · app: …
kioku service uninstall                                 # quita los dos agentes (no toca datos)
kioku assistant model ollama                            # qwen3.5:9b en http://localhost:11434/v1
kioku assistant model ollama qwen3:8b                   # otro modelo
kioku companion status|toggle|focus|panel|stop          # igual que en Linux
```

## Uso diario

- **Kio** flota en la esquina inferior derecha, encima de las ventanas y en todos los escritorios (Spaces). Con una app a pantalla completa queda debajo y no la tapa. Nunca roba el foco.
- **Clic** en Kio, o **⌥⌘K** desde cualquier app, abre la conversación. **Esc** la cierra.
- **Arrastrar** lo mueve; la posición se guarda en el daemon. **Clic derecho**: modo concentración.
- La conversación funciona igual que en Linux y en la web. Enter envía y Mayús+Enter salta de línea. Mientras responde, el botón pasa a «Detener». Las acciones que hace solo traen **Deshacer**. Borrar, mover o reemplazar llega como **propuesta** y pide «Confirmar: aplicar». Arriba están: nueva conversación, concentración, abrir en Kioku, ocultar y cerrar.
- **Abrir Kioku** (menú, doble clic en la app o el botón ⤢ del panel) muestra la interfaz completa en una ventana nativa. Mientras está delante, el Kio de escritorio se retira, porque manda el que va integrado en la ventana. Con una ventana abierta, Kioku aparece en el Dock. Sin ninguna, vive solo en la barra de menús.
- **Salir de Kioku** cierra la app. El daemon sigue en marcha, así que el móvil, la web y `kioku` siguen funcionando.

Los estados de Kio, los modos (visible, concentración, oculto) y la conversación son los mismos que en Linux y en la web, porque los guarda el daemon: [companion.md](companion.md).

## Qué es multiplataforma y qué es de cada sistema

| Compartido (sin cambios) | Solo Linux | Solo macOS |
|---|---|---|
| Daemon y API (`src/server`, `src/core`) | Overlay GTK4 + layer-shell (`companion/overlay/`) | Kioku.app (`macos/`, SwiftUI/AppKit) |
| Agente, herramientas, motor nativo (Ollama) y Hermes (`src/assistant`) | Servicio de systemd (`kioku service`) | LaunchAgents de launchd (`src/cli/launchd.ts`) |
| Conversaciones y estado de Kio (`CompanionHub`) | Ventana Quick y Workspace con Hyprland + Chromium | Ventana nativa (WKWebView) y `open` |
| Interfaz web con su Kio, `companion/character.json` | `notify-send` | Notificaciones con `osascript` |
| Credencial limitada del compañero (`.kioku/secret-companion`) | Hermes aislado con bwrap | Hermes aislado con Docker (solo si no usas el motor nativo) |

La app de macOS usa el mismo contrato que el overlay de Linux:

- habla solo con `127.0.0.1` y con la credencial limitada del compañero;
- lee el puerto en `.kioku/runtime.json` y solo se lo cree si el proceso que lo anotó sigue vivo;
- escribe `.kioku/companion-overlay.pid` y responde a `SIGUSR1` (abrir o cerrar la conversación) y a `SIGTERM`;
- comparte con Linux el aviso de privacidad aceptado (`.kioku/companion-overlay.json`);
- dibuja a Kio con los mismos números de `companion/character.json`.

La clave completa solo se usa para iniciar sesión en la ventana de Kioku, igual que hace `kioku open`.

## Si algo no va

| Síntoma | Qué hacer |
|---|---|
| Kio aparece apagado y pequeño | Concentración, sesión de foco o sin conexión con el daemon. Pasa el ratón por encima para ver cuál. |
| «no reconoce a Kio: es de una versión anterior» | El daemon que está en marcha es el antiguo. En Estado y configuración, «Sustituir…». |
| El asistente no responde | Menú > Estado y configuración: Ollama debe responder y tener `qwen3.5:9b`. `kioku assistant status` dice el motivo. |
| No arranca al iniciar sesión | `kioku service status`. Logs: `~/Library/Logs/Kioku/daemon.log` y `app.log`. |
| ⌥⌘K no hace nada | Otra app ya usa ese atajo. El menú de Kioku > «Hablar con Kio» sigue funcionando. |
| Volver a la instalación antigua | `kioku service uninstall`, mueve el plist de `~/Library/Application Support/Kioku/legacy/` a `~/Library/LaunchAgents/` y `launchctl bootstrap gui/$(id -u) <plist>`. |

## Qué está verificado

Ver [validation.md](validation.md#kioku-en-macos-app-nativa). En resumen: el CI ejecuta la app en un macOS 15 real (Apple Silicon) con launchd, un daemon aislado y un Ollama **simulado** que anuncia qwen3.5:9b. Falta lo que solo puede comprobarse en tu Mac: el Ollama real con qwen3.5:9b, la sustitución del agente antiguo con tu bóveda real, el inicio de sesión real y el uso con ratón y teclado.
