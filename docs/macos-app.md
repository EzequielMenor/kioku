# Aplicación Mac de Kioku

La aplicación reúne el servidor y un runtime de Node: el uso base no exige instalar Node ni gestionar Docker. **El instalador y el arranque nativo pasaron las pruebas automáticas en Mac Intel y Apple Silicon.** Incluye **Kio** dentro de la interfaz web y el **motor nativo** para usar un modelo local compatible ([Ollama](assistant-local.md)) sin Docker; usar Hermes Agent vía Docker para proveedores remotos sigue siendo opcional aparte ([guía Mac](assistant-macos.md)). Al ser una instalación local sin firma ni notarización de Apple, macOS puede pedir confirmación la primera vez al abrirla.

## Instalar con un comando (recomendado)

```bash
curl -fsSL https://raw.githubusercontent.com/EzequielMenor/kioku/main/scripts/install.sh | bash
```

Opciones útiles: `--yes` (reemplaza una `Kioku.app` previa guardando copia de respaldo sin preguntar) y `--no-open`. Una vez instalada, `Kioku.app` comprueba discretamente en escritorio si hay cambios nuevos en `main` y muestra un aviso con **Actualizar ahora** dentro de la propia interfaz (**Conexiones y sincronización**), guardando la copia `.anterior-...` y reabriendo la app nueva automáticamente.

## Instalar con doble clic

1. Descarga el [ZIP de `main`](https://codeload.github.com/EzequielMenor/kioku/zip/main) y extráelo.
2. Haz doble clic en **`Instalar Kioku.command`**. Si macOS dice que no puede verificarlo (no está firmado ni notarizado), haz clic derecho > **Abrir** > **Abrir**.
3. Espera unos minutos (necesita Internet). Al terminar se abre `~/Applications/Kioku.app` directamente en **Conexiones y sincronización**; la primera vez macOS puede pedir la misma confirmación (clic derecho > Abrir, o Ajustes del Sistema > Privacidad y seguridad > Abrir igualmente).

No hace falta Node, Docker, Homebrew ni escribir comandos. El instalador no pide permisos de administrador, no instala nada global, no cambia ajustes de red ni servicios, no quita la protección de cuarentena de macOS y no toca tus datos (`~/Library/Application Support/Kioku/Workspace`, claves, bóveda).

| Situación | Qué hace |
|-----------|----------|
| Primera instalación | Construye la app entera en una carpeta de preparación y solo entonces la coloca en `~/Applications/Kioku.app`. |
| Ya existe `Kioku.app` | Pregunta `¿Reemplazarla? [s/N]` (o acepta con `KIOKU_INSTALL_YES=1` / `--yes`). Con la nueva ya construida, aparta la anterior como `Kioku.app.anterior-FECHA-N`; nunca la borra ni borra copias previas. |
| Falla la descarga, el checksum o la construcción | No se toca la app anterior. |
| Falla la colocación final | Devuelve la app anterior a su sitio; si no puede, dice dónde quedó guardada. |
| `~/Applications` o `Kioku.app` es un enlace simbólico | Se rechaza sin modificar lo que haya detrás. |

Qué descarga: un Node.js oficial 24+ (`nodejs.org`, verificado con el checksum publicado allí) que se usa solo en una carpeta temporal y se copia dentro de la app como runtime junto con su `LICENSE` oficial (incluye avisos de terceros), y el código de Kioku (`main` por defecto) desde `codeload.github.com`. Todo lo temporal (Node, fuentes, cachés de npm y de compilación de Node) vive en una carpeta nueva `kioku-instalador.*` bajo `$TMPDIR` que se borra al terminar; esas cachés no se comparten con las del usuario ni llegan a la app que se abre. Si el repositorio fuera privado, esa descarga fallará y el instalador lo dirá.

`Instalar Kioku.command --help` explica el uso sin usar la red. Opciones por entorno (para pruebas; no cambian los valores por defecto):

| Variable | Efecto |
|----------|--------|
| `KIOKU_REF` | Commit, rama o etiqueta de Kioku distinto de `main`. Se avisa al ejecutar. |
| `KIOKU_REPO` | Repositorio `usuario/nombre` de GitHub. |
| `KIOKU_NODE_LINE` | Línea de Node (`v24.x` por defecto; mínimo 24). |
| `KIOKU_INSTALL_YES=1` | Acepta reemplazar `Kioku.app` existente sin preguntar. |
| `KIOKU_INSTALL_NO_OPEN=1` | No abre la app al terminar (lo usa el CI para no tocar el HOME real del runner). |

Si `open` falla tras instalar, el instalador lo cuenta y la instalación sigue siendo válida. `Kioku.command` (Docker) no cambia.

**Limitaciones:** la app y el instalador no están firmados ni notarizados con certificado de Apple Developer. El checksum prueba que la descarga coincide con lo publicado en `nodejs.org`, no la firma GPG de Node.

## Preparar la aplicación a mano

Pasos para quien construye el paquete manualmente (el instalador de arriba ya los hace):

1. Instala las dependencias del proyecto y ejecuta `npm run build:web`.
2. Consigue un ejecutable oficial de Node.js 24 o superior para macOS y la arquitectura del Mac (arm64 o x64), verifica su procedencia y checksum. El script no lo descarga ni lo ejecuta en Linux.
3. Ejecuta `node scripts/build-macos-app.mjs --node RUTA/AL/node --output dist/Kioku.app`.
4. Prueba el paquete en un Mac de esa arquitectura. La comprobación Mach-O solo valida cabecera/arquitectura, no acredita procedencia, versión, firma o compatibilidad.

El destino debe ser nuevo. Consulta `--help` para el uso. No contiene el checkout, pruebas ni datos personales; incluye el código, interfaz compilada, dependencia YAML, runtime y licencia de Kioku. Quien distribuya Node debe acompañar también su licencia y avisos de terceros correspondientes.

## Abrir en el Mac

Abre `Kioku.app`. Inicia el servidor local y abre **Conexiones y sincronización** en el navegador. Usa una carpeta independiente: `~/Library/Application Support/Kioku/Workspace`. No importa notas, copia claves ni cambia el servidor nativo existente ni la alternativa Docker. `scripts/kioku-server.sh` sigue gestionando el servidor nativo actual y `Kioku.command` sigue abriendo la alternativa Docker. No configures estas instalaciones independientes como si fueran una sola.

El servidor sigue activo tras cerrar la pestaña. No se añade un servicio de inicio de sesión ni se cambian preferencias de suspensión. El acceso desde fuera necesita Mac encendido y Tailscale conectado; nunca abras puertos del router ni uses Funnel. La guía de acceso privado está en [Conexiones](connections.md).

## Validación automática en macOS (GitHub Actions)

El workflow `.github/workflows/macos-validation.yml` comprueba la app en un runner de Apple Silicon (`macos-15`, arm64) y otro Intel (`macos-15-intel`, x64). Se dispara con un `push` a `feat/JARV-38-private-setup-ui` que cambie el propio workflow, `test/macos-ci.test.ts`, `src/cli/desktop.ts` (arranque del daemon), `test/desktop-startup.test.ts` o el instalador (`Instalar Kioku.command`, `scripts/install-macos.command`, `test/macos-installer.test.ts`); no corre con cambios de seguimiento ni en otras ramas. Solo lee el repositorio: sin secretos, publicación, firma ni artefactos.

| Qué comprueba | Cómo |
|---------------|------|
| Build y calidad | `npm ci`, `npm run build:web`, `npm test`, `npm run typecheck`; cada fallo hace fallar el job. |
| Arranque nativo | La prueba construye una `.app` en una ruta con espacios con el Node Mach-O del runner, ejecuta su `Contents/MacOS/Kioku` real y descubre el daemon con `kioku status`. |
| Servidor | La API devuelve 401 sin clave y 200 con la clave de `kioku url`; se sirven `index.html` y `app.js` del paquete; el daemon usa el runtime del paquete. |
| Segundo arranque | Reutiliza el mismo daemon (mismo pid): se comprobó en Intel y Apple Silicon. La recuperación de una sonda de salud inicialmente fallida se reproduce además en Linux con `test/desktop-startup.test.ts`; no se atribuye retrospectivamente una causa no observada al primer fallo de Intel. |
| Instalador | `test/macos-installer.test.ts` ejecuta `Instalar Kioku.command` real (Node oficial y commit fijado por red) en un `HOME` desechable con `KIOKU_INSTALL_NO_OPEN=1`; comprueba `Kioku.app`, la licencia de Node, el Mach-O de la arquitectura del runner, marcadores intactos y que la app instalada arranca, autentica y se reutiliza. En Linux se prueban las mismas reglas con herramientas externas simuladas (descarga, rollback, confirmación, enlaces). |
| Aislamiento | `HOME` y `KIOKU_HOME` apuntan a directorios temporales del runner, y la prueba usa un `HOME` propio con marcadores sintéticos de una instalación previa que deben quedar intactos. La clave nunca se imprime. |

La prueba nativa solo corre en macOS con `KIOKU_MAC_SMOKE=1`, y la del instalador con `KIOKU_INSTALLER_SMOKE=1` (ambas las define el workflow); en Linux se omite y solo se verifica la estructura del workflow. Al terminar solo detiene el daemon que `status` identificó en su `HOME` temporal.

**Límites:** el lanzador llama a `/usr/bin/open`, así que el runner abre su navegador por defecto con la URL local; esa ventana no se cierra porque no es un proceso propio de la prueba (el runner es efímero). Esto **no** prueba la apertura por Finder, firma ni notarización, el doble clic del instalador en Finder, Tailscale ni el acceso desde otro dispositivo real, ni sustituye la revisión independiente pendiente de las conexiones (T2).

## Antes de distribuir

- Validar apertura por Finder en un Mac, permisos y archivos con espacios en la ruta.
- Comprobar versión real del runtime, arquitectura y requisitos del sistema operativo.
- Revisar arranque simultáneo con el servidor nativo existente o Docker sin compartir datos ni credenciales.
- Comprobar acceso local, reinicio y conexión real desde otro dispositivo mediante Tailscale.
- Preparar firma, notarización y avisos de licencias con las credenciales del propietario. No se han realizado aquí.

No se migra ni retira ninguna instalación automáticamente. La [guía del servidor Mac existente](local-macos.md) describe el arranque y las copias actuales. Antes de cualquier migración futura, validar una copia y su restauración aislada; un archivo tar legible no basta para demostrar que la restauración es correcta.
