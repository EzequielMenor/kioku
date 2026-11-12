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

## Antes de distribuir

- Validar apertura por Finder en un Mac, permisos y archivos con espacios en la ruta.
- Comprobar versión real del runtime, arquitectura y requisitos del sistema operativo.
- Revisar arranque simultáneo con el servidor nativo existente o Docker sin compartir datos ni credenciales.
- Comprobar acceso local, reinicio y conexión real desde otro dispositivo mediante Tailscale.
- Preparar firma, notarización y avisos de licencias con las credenciales del propietario. No se han realizado aquí.

No se migra ni retira ninguna instalación automáticamente. La [guía del servidor Mac existente](local-macos.md) describe el arranque y las copias actuales. Antes de cualquier migración futura, validar una copia y su restauración aislada; un archivo tar legible no basta para demostrar que la restauración es correcta.
