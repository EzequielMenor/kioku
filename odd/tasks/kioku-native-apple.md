# Kioku en iPhone y Mac

Prioridad actual: instalación desde Finder, actualizaciones y gestión de dispositivos en macOS. iOS queda en pausa; conserva el objetivo de paridad con la web móvil.

## Specs

- **S1:** «vamos a hacer la app nativa en ios primero y q funcinoe todo correctamente»
- **S2:** «Todo lo que ya hace la web móvil»
- **S3:** «en el caso de mac me gustaria q se puediera instalar super facil»
- **S4:** «y actualizar cada vez q haya alguna actualizacion o algo nuevo, osea q en la propia app te avise o algo sbs»
- **S5:** «vale pues hazlo tio» (en respuesta a crear primero la estructura iOS sin conexión al servidor).
- **S6:** «vale pues ahroa enfocate en el tema de mac la app el tema de la instalacion, actualizacion y el tema de gestionar los dispositivos conectados de forma facil sbs»
- **S7:** «vale pues hazlo asi y el tema de actualizar q te llegue el aciso» (en respuesta a descargar Kioku desde GitHub Releases).
- **S8:** «Tailscale ya tiene otra publicación o Funnel: Kioku no la sobrescribe. Revísala en el ordenador.» (captura).
- **S9:** «El asistente no está disponible: No puedo leer assistant-model.json: revisa sus permisos».

## Tasks

- [ ] **T0 — S1, S5 · inline · commit pendiente:** proyecto SwiftUI `ios/Kioku.xcodeproj` con esquema compartido `Kioku`, pantalla de arranque explícitamente sin conexión y prueba de compilación para simulador sin firma. Sin red ni datos de usuario.
- [ ] **T1 — S1–S2 · inline + verify · commit pendiente:** base Swift reutilizable para validar conexión HTTPS con rol `mobile` consultando `GET /api/session`. La clave va solo en `x-kioku-key`; nunca aparece en URL, cookies ni mensajes. Probar con HTTP simulado, sin bóveda real.
- [ ] **T2 — S1–S2 · inline + verify · commit pendiente:** integrar en SwiftUI la conexión visible, clave en Keychain y desconexión; probar alta y reapertura en simulador.
- [ ] **T3 — S1–S2 · ruta por decidir · commits pendientes:** Hoy, tareas, búsqueda y lectura de notas; reutilizar filtros y permiso móvil existentes.
- [ ] **T4 — S1–S2 · ruta por decidir · commits pendientes:** captura y edición de notas/tareas, lectura sin conexión, cola idempotente y gestión de conflictos al volver la red.
- [ ] **T5 — S1–S2 · ruta por decidir · commits pendientes:** calendario, bases, Kio y acciones móviles, y los demás flujos habilitados de la PWA; comprobar paridad contra una instalación temporal. No extender permisos del rol móvil.
- [ ] **T6 — S1–S2 · ruta por decidir · commits pendientes:** validar recorridos diarios y recuperación de conexión con datos de prueba en simulador y en un iPhone; documentar cómo instalar la versión probada.
- [x] **T7 — S3, S6 · inline + verify · `da46f5d`:** empaquetar un `Kioku.app` construido en una imagen con acceso a Aplicaciones; validar contenido, rechazo de destinos existentes y limpieza si falla la creación. Sin instalar ni publicar. Riesgo 5 (empaquetado).
- [ ] **T10 — S3, S6 · después de T7 · commit pendiente:** probar arranque desde Finder con una copia aislada, preservación del estado existente y preparar firma Developer ID y notarización antes de distribuir.
- [ ] **T8 — S4, S7 · commit pendiente:** avisar de una versión publicada en GitHub Releases y ofrecer abrir la página para descargar; no instalar ni ejecutar nada automáticamente.
- [x] **T9 — S6 · inline · `1f0c28e`:** acceso «Dispositivos y actualizaciones…» en la barra de menús de Mac que abra «Conexión y dispositivos» dentro de Kioku. Reutiliza el panel para ver, vincular y revocar dispositivos, y los controles existentes de comprobación. Sin modificar credenciales, permisos ni ejecución de actualizaciones.

- [ ] **T11 — S7 · commit pendiente:** preparar el `.dmg` verificable como asset de GitHub Releases; separar preparación de publicación y verificar que coincida con su tag y arquitectura. Riesgo 5.
- [ ] **T12 — S8 · commit pendiente:** reproducir con estado simulado el aviso de Tailscale y corregir el diagnóstico o el siguiente paso sin reemplazar Serve ni activar Funnel.
- [ ] **T13 — S9 · commit pendiente:** reproducir el error del asistente con configuración aislada, identificar la causa y corregir el comportamiento sin modificar los archivos reales ni ampliar permisos.

## Log

- **L1** — «vale bueno peus quiero hacer kioku nativo vale, creo q en mac ya esta hecho entonces pues eso vamos a hacer la app nativa en ios primero y q funcinoe todo
 correctamente, y en el caso de mac me gustaria q se puediera instalar super facil y actualizar cada vez q haya alguna actualizacion o algo nuevo, osea q en la propia app
 te avise o algo sbs»
- **L2** — Primera versión elegida: «Todo lo que ya hace la web móvil».
- **L3** — `feat/kioku-native-ios`; `AGENTS.md` tiene cambios previos, fuera del alcance. ProjectOS y Engram no están expuestos en esta sesión; seguimiento local. Separar unidades comprobables de unas 400 líneas; no publicar por este trabajo.
- **L4** — Xcode detecta SDK de iOS y simuladores locales. El Mac actual combina AppKit/SwiftUI con `WKWebView`. El rol móvil se consulta en `/api/session` y el actualizador existente aparece en la web de escritorio; ningún cambio al servidor es necesario para T1.
- **L5** — T1 bloqueada: el control de permisos no ejecutó la escritura de las pruebas y la base Swift de conexión; requiere revisión manual de esa operación. No se agregó código iOS ni se ejecutaron tests. No hacen falta credenciales reales.
- **L6** — «vale pues hazlo tio»: T0 separa el esqueleto nativo de T1, que sigue bloqueada. No se escribirá código de conexión ni se probará contra un servidor en T0.
- **L7** — «continua perdon». T0: proyecto SwiftUI, esquema compartido, pantalla «Sin conexión» y comprobación `bash ios/check-app.sh`. RED (66): faltaba `Kioku.xcodeproj`. Xcode reconoce el esquema; `plutil`, `xmllint` y `bash -n` pasan. GREEN bloqueado (65): se cae el servicio de compilación de Xcode 27.0; se reprodujo con DerivedData separado y tras agregar las fases estándar. No se lanzó la app en simulador.
- **L8** — El primer `npm run typecheck` falló porque faltaba `qrcode-generator`; con las dependencias locales restauradas, `npm run typecheck` pasa y `npm test` devuelve 840 aprobadas, 43 omitidas, 0 fallos. No se modificó el lockfile.
- **L9** — `swiftc -typecheck` de `KiokuApp.swift` con el SDK del simulador (iOS 17, arm64) pasa. T0 queda bloqueada hasta poder generar `Kioku.app` y abrirla; la comprobación de tipos no prueba el bundle ni el arranque. No se hizo commit.
- **L10** — «sale sin conexion»: confirmación del usuario de que Kioku arrancó en el simulador desde Xcode y mostró «Sin conexión». El build automatizado `bash ios/check-app.sh` sigue fallando con el mismo cierre del servicio de Xcode (65). Arranque manual confirmado; comprobación automatizada pendiente. T1 sigue bloqueada por el control de permisos.
- **L11** — «vale pues ahroa enfocate en el tema de mac la app el tema de la instalacion, actualizacion y el tema de gestionar los dispositivos conectados de forma facil sbs». T0–T6 quedan en pausa y T7–T9 pasan primero. No se publica ni se cambia la instalación ni los dispositivos reales durante las pruebas.
- **L12** — Relevamiento verificado por lectura: el instalador `.command` abre Terminal, el panel existente permite vincular y revocar dispositivos, y el actualizador actual descarga un script desde una rama mutable. T7 se separó de T10 para no confundir el empaquetado local con una descarga lista para distribuir.
- **L13** — T7 agrega `scripts/build-macos-dmg.mjs`, `test/macos-dmg.test.ts` y la guía. RED (1): no existía el script. Primera verificación (1): pasa el rechazo de destinos existentes; la creación y la prueba de limpieza no llegan a su resultado esperado por `spawnSync ... EAGAIN`. La suite posterior no pudo arrancar: `fork: Resource temporarily unavailable` (128). El segundo smoke tampoco pudo iniciar un subproceso de Node (1, `EAGAIN`). Quedan pendientes creación y montaje del DMG y suite. No se instaló ni se publicó nada.
- **L14** — Verificación independiente T7: bloqueada para S3 y S6. La revisión estática confirma que se prepara el bundle y el enlace a Aplicaciones, que no se reemplaza el destino y que se intenta limpiar el temporal. El proceso de pruebas no llegó a Node (128, `fork: Resource temporarily unavailable`; 0 tests). Sin imagen ni prueba de Finder; no se repite la verificación en este entorno mientras persista el incidente.
- **L15** — «vale pues hazlo terminalo ya tio». Se recuperó el lanzamiento de procesos. El smoke de T7 pasa los tres casos, incluido `hdiutil verify` y montaje en solo lectura de un bundle de prueba. `npm run typecheck` y `npm test` pasan (842 aprobadas, 44 omitidas). Falta el artefacto con la app real, la revisión de entrega y la validación de Finder del T10.
- **L16** — T9 RED (1): faltaba la entrada del menú; GREEN focalizado: 10 aprobadas y 1 omitida por falta de Chromium, incluyendo el chequeo de menú y las regresiones de dispositivos/actualizaciones. Typecheck y build web pasan. La descarga del runtime oficial Node arm64 se cotejó con su SHA-256. El motor Swift Build se detuvo por `Filesize limit exceeded` (153); se prueba el motor alternativo de SwiftPM con los mismos límites del sistema.
- **L17** — El motor alternativo compiló Swift/AppKit, armó `dist/kioku-mac-preview.ZBTxas/Kioku.app` y creó `Kioku.dmg` para Apple Silicon. `codesign --verify --deep --strict` pasa sobre el bundle (firma ad hoc) y `hdiutil verify` pasa sobre la imagen. Suite final: 843 aprobadas, 44 omitidas, 0 fallos. No se instaló, no se publicó, no está notarizada y no se probó el arrastre en Finder.
- **L18** — Commits locales: `1f0c28e` (acceso a Dispositivos y actualizaciones) y `da46f5d` (empaquetador). El control nativo no requiere otra revisión para estos candidatos bajo el presupuesto; inspección funcional independiente del DMG real en curso. T8 requiere concretar un canal de artefactos firmados; no se reutiliza como canal de la imagen la ejecución de un script remoto sin verificación.
- **L19** — Verificación independiente del DMG real: checksum válido, montaje en solo lectura, enlace a `/Applications`, binarios arm64 de Kioku/Node, licencia incluida, firma ad hoc válida y desmontaje limpio. T7 cerrada. T10 sigue bloqueada: faltan arrastre y primer arranque en Finder con estado aislado, comprobación de Gatekeeper y firma Developer ID/notarización. T8 espera un origen aprobado de versiones autenticadas. No se instaló ni se publicó nada.
- **L20** — «si si claro»; el usuario eligió «Firmar y notarizar» una copia local de Kioku con Apple, sin instalar ni publicar. `notarytool` y `stapler` disponibles. Preflight: 0 identidades válidas Developer ID Application visibles en el llavero y ningún perfil configurado mediante `KIOKU_NOTARY_PROFILE`. No se firmó ni se envió el artefacto. T10 espera que la identidad, incluida su clave privada, esté disponible localmente y que el usuario indique el alias del perfil de notarización.
- **L21** — «vale pues hazlo asi y el tema de actualizar q te llegue el aciso, y luego ahroa en la app tngo varios problemas me sale esto [Image#1] y en el asistente me sale esto El asistente no está disponible: No puedo leer assistant-model.json: revisa sus permisos». T8 pasa a aviso y enlace; T11–T13 separan publicación y diagnósticos. El primer comando de estado no arrancó (`EAGAIN`), por lo que aún no hay reproducción de los errores de la app.
- **L22** — Explorador no disponible; la búsqueda dirigida tampoco pudo iniciar `rg` (`EAGAIN`). No se cambiaron Tailscale, permisos, bóveda ni código de producción, y no se publicó nada. Retomar con un entorno que pueda ejecutar pruebas aisladas.
