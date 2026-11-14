# Aplicación Mac de Kioku (prueba local)

La aplicación reúne el servidor y un runtime de Node: el uso base no exige instalar Node ni gestionar Docker. **Todavía no es una descarga firmada ni una instalación validada en Mac.** El asistente queda para una etapa posterior.

## Preparar la aplicación

Pasos para quien construye el paquete, no para el usuario final:

1. Instala las dependencias del proyecto y ejecuta `npm run build:web`.
2. Consigue un ejecutable oficial de Node.js 24 o superior para macOS y la arquitectura del Mac (arm64 o x64), verifica su procedencia y checksum. El script no lo descarga ni lo ejecuta en Linux.
3. Ejecuta `node scripts/build-macos-app.mjs --node RUTA/AL/node --output dist/Kioku.app`.
4. Prueba el paquete en un Mac de esa arquitectura. La comprobación Mach-O solo valida cabecera/arquitectura, no acredita procedencia, versión, firma o compatibilidad.

El destino debe ser nuevo. Consulta `--help` para el uso. No contiene el checkout, pruebas ni datos personales; incluye el código, interfaz compilada, dependencia YAML, runtime y licencia de Kioku. Quien distribuya Node debe acompañar también su licencia y avisos de terceros correspondientes.

## Abrir en el Mac

Abre `Kioku.app`. Inicia el servidor local y abre **Conexiones y sincronización** en el navegador. Usa una carpeta independiente: `~/Library/Application Support/Kioku/Workspace`. No importa notas, copia claves ni cambia el servidor nativo existente ni la alternativa Docker. `scripts/kioku-server.sh` sigue gestionando el servidor nativo actual y `Kioku.command` sigue abriendo la alternativa Docker. No configures estas instalaciones independientes como si fueran una sola.

El servidor sigue activo tras cerrar la pestaña. No se añade un servicio de inicio de sesión ni se cambian preferencias de suspensión. El acceso desde fuera necesita Mac encendido y Tailscale conectado; nunca abras puertos del router ni uses Funnel. La guía de acceso privado está en [Conexiones](connections.md).

## Validación automática en macOS (GitHub Actions)

El workflow `.github/workflows/macos-validation.yml` comprueba la app en un runner de Apple Silicon (`macos-15`, arm64) y otro Intel (`macos-15-intel`, x64). Se dispara con un `push` a `feat/JARV-38-private-setup-ui` que cambie el propio workflow o `test/macos-ci.test.ts`; no corre con cambios de seguimiento ni en otras ramas. Solo lee el repositorio: sin secretos, publicación, firma ni artefactos.

| Qué comprueba | Cómo |
|---------------|------|
| Build y calidad | `npm ci`, `npm run build:web`, `npm test`, `npm run typecheck`; cada fallo hace fallar el job. |
| Arranque nativo | La prueba construye una `.app` en una ruta con espacios con el Node Mach-O del runner, ejecuta su `Contents/MacOS/Kioku` real y descubre el daemon con `kioku status`. |
| Servidor | La API devuelve 401 sin clave y 200 con la clave de `kioku url`; se sirven `index.html` y `app.js` del paquete; el daemon usa el runtime del paquete. |
| Segundo arranque | Reutiliza el mismo daemon (mismo pid). |
| Aislamiento | `HOME` y `KIOKU_HOME` apuntan a directorios temporales del runner, y la prueba usa un `HOME` propio con marcadores sintéticos de una instalación previa que deben quedar intactos. La clave nunca se imprime. |

La prueba nativa solo corre en macOS con `KIOKU_MAC_SMOKE=1` (lo define el workflow); en Linux se omite y solo se verifica la estructura del workflow. Al terminar solo detiene el daemon que `status` identificó en su `HOME` temporal.

**Límites:** el lanzador llama a `/usr/bin/open`, así que el runner abre su navegador por defecto con la URL local; esa ventana no se cierra porque no es un proceso propio de la prueba (el runner es efímero). Esto **no** prueba la apertura por Finder, firma ni notarización, el instalador, Tailscale ni el acceso desde otro dispositivo real, ni sustituye la revisión independiente pendiente de las conexiones (T2).

## Antes de distribuir

- Validar apertura por Finder en un Mac, permisos y archivos con espacios en la ruta.
- Comprobar versión real del runtime, arquitectura y requisitos del sistema operativo.
- Revisar arranque simultáneo con el servidor nativo existente o Docker sin compartir datos ni credenciales.
- Comprobar acceso local, reinicio y conexión real desde otro dispositivo mediante Tailscale.
- Preparar firma, notarización y avisos de licencias con las credenciales del propietario. No se han realizado aquí.

No se migra ni retira ninguna instalación automáticamente. La [guía del servidor Mac existente](local-macos.md) describe el arranque y las copias actuales. Antes de cualquier migración futura, validar una copia y su restauración aislada; un archivo tar legible no basta para demostrar que la restauración es correcta.
