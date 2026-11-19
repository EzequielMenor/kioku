# Kioku: diagnóstico de Kio y guía de conexiones

Avance local (ProjectOS no disponible en esta sesión).

- En el chat Kio mostró: «El asistente no está disponible: No puedo leer assistant-model.json: revisa sus permisos».
- El diagnóstico ahora distingue permisos (`EACCES`/`EPERM`), una ruta que no es carpeta (`ENOTDIR`) y otros fallos de lectura. No cambia permisos, el modelo elegido ni el trato de un override inválido.
- La guía distingue desconectar un dispositivo emparejado por QR de revocar la clave móvil compartida por terminal.
- RED: reproducidos el mensaje incorrecto con una ruta inválida y el mensaje genérico con el error de permisos simulado. GREEN: `npm test` (845 pasaron, 44 omitidas, 0 fallidas) y `npm run typecheck` (0).
- Pendiente: determinar la causa exacta en la instalación afectada, validar un mensaje real de Kio y comprobar el emparejamiento entre dispositivos con el servidor del usuario. No se accedió a la bóveda ni se cambió la instalación.

## Resolución y empaquetado macOS

- Causa raíz identificada (sin modificar la bóveda ni las instalaciones existentes):
  - Existían dos copias nativas (`local.kioku.app`, v0.8.0): `/Applications/Kioku.app` (abierta desde Finder, 18 nov, `drwx------`) y `~/Applications/Kioku.app` (15 nov, antigua). Un daemon antiguo de `~/Applications/Kioku.app` atendía el puerto `47800` y `local.kioku.app.plist` apuntaba a `~/Applications/Kioku.app`, mientras `local.kioku.daemon.plist` apuntaba a `/Applications/Kioku.app` y entraba en bucle con `Unknown system error -11, read`.
  - `/Users/ezequielmenor/Documents/Kioku` está dentro de `~/Documents` gestionado por iCloud Drive (`com.apple.CloudDocs.iCloudDriveFileProvider`): los archivos (`.kioku/assistant-model.json`, `.kioku/assistant.json`, claves y notas) quedaron desalojados (`dataless` / `SF_DATALESS`). Al leerlos, `fileproviderd` fallaba la materialización devolviendo `EDEADLK` (`errno -11`), que el código anterior traducía erróneamente como falta de permisos, y SQLite WAL devolvía `disk I/O error`.
- Correcciones aplicadas:
  - `src/assistant/model-config.ts`, `src/cli/main.ts`, `src/core/index.ts`, `src/cli/launchd.ts`: detección de lecturas `dataless`/`EDEADLK` (`-11`) en `assistant-model.json`, `assistant.json` y arranque del daemon; fallback de SQLite WAL → DELETE ante `disk I/O error`; borrado seguro de `runtime.json` solo si pertenece al PID actual; exposición del programa instalado en `launchdStatus`.
  - `macos/Sources/KiokuKit/Paths.swift`, `SetupWindow.swift`, `AppDelegate.swift`, `WorkspaceWindow.swift`, `scripts/build-macos-app.mjs`: detección `lstat` (`SF_DATALESS`) sin leer ni modificar la bóveda con aviso visual y botón «Mostrar en Finder»; detección de desajuste entre `Kioku.app` y LaunchAgents («Usar esta copia»); menú de aplicación (`NSApp.mainMenu`) + `statusItem` persistente; navegación por ruta en ventana ya abierta; permisos `0755`/`0644` en el bundle.
  - `src/server/private-connection.ts`, `src/server/server.ts`, `web/src/app.tsx`, `connections.tsx`, `connections-model.ts`, `device-access.tsx`, `device-access.css`: enlace directo «Conexiones y sincronización» en la barra lateral reutilizando la misma pantalla; lista paso a paso de lo que falta en Tailscale; sonda local HTTPS `POST /api/connections/probe` («Comprobar si conecta»); tarjeta visual «Si se corta la conexión» sin terminal; desconexión individual confirmando que el resto no se ve afectado.
- Verificación:
  - `npm run typecheck`, `npm run build:web`, `npm test` (850 pasaron, 0 fallidas, 44 omitidas) y `swift test` (34 pasaron, 0 fallidas).
  - Empaquetado nativo en `dist/macos/Kioku.app` y `dist/macos/Kioku.dmg` (sin reemplazar `/Applications/Kioku.app` ni `~/Applications/Kioku.app` sin autorización).
  - Prueba con bóveda temporal y Ollama real (`qwen3.5:9b`): respuesta real de Kio, flujo de alta/revocación individual de dispositivos y apertura vía Finder/LaunchServices (`open -n`). No probado con un segundo dispositivo físico (QR no verificado con móvil real).
  - Corrección del actualizador integrado tras reproducir el problema en `/Applications/Kioku.app`:
    - `src/server/build-info.ts`: `readGitHead` ahora resuelve worktrees (`.git` con `gitdir:` y `commondir`) para que los paquetes construidos desde un worktree incluyan el SHA real en `build-info.json` y no ofrezcan falsas actualizaciones.
    - `scripts/install-macos.command`, `scripts/install.sh` y `src/server/updates.ts`: soporte de `KIOKU_MAC_APPS_DIR` para actualizar la app en su carpeta actual (p. ej. `/Applications`) en lugar de crear una segunda copia en `~/Applications`; bloqueo seguro si el instalador remoto todavía no soporta `KIOKU_MAC_APPS_DIR`; y reinicio real en macOS vía `launchctl kickstart -k` de `local.kioku.daemon`/`local.kioku.app` para que la app no se quede parada en «Recargar».
