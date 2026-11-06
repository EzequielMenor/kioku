# Asistente en macOS: Hermes aislado con Docker

En Mac, Kioku ejecuta **Hermes completo en Docker**; en Linux conserva `bwrap`. El modelo y las herramientas de Kioku son los mismos. No hay alternativa sin aislamiento si Docker falla.

**Estado de validación:** contratos de lanzamiento y limpieza probados con procesos simulados en Linux. No se ha ejecutado el contenedor en macOS; hace falta completar la lista final en un Mac antes de darlo por listo.

## Preparación en tu Mac (manual)

1. Instalá Node compatible con `package.json` y Docker Desktop. Iniciá Docker Desktop.
2. En Docker Desktop **4.34 o posterior**, habilitá **Settings → Resources → Network → Enable host networking**. Kioku escucha solo en `127.0.0.1`: no lo expongas en `0.0.0.0` para resolver la conexión. Referencia: <https://docs.docker.com/engine/network/drivers/host/>.
3. Descargá conscientemente la imagen oficial de Hermes:
   ```sh
   docker pull nousresearch/hermes-agent:stable
   ```
   Kioku usa `--pull=never`: nunca descarga imágenes ni instala dependencias automáticamente. Para fijar una versión exacta, descargá un digest de esa imagen y arrancá Kioku con `KIOKU_HERMES_IMAGE=nousresearch/hermes-agent@sha256:<digest>`.
4. Elegí el proveedor/modelo según [assistant-models.md](assistant-models.md). Con una API o un modelo local no hace falta un Hermes nativo en el Mac. Para Codex, autenticá Hermes previamente en el host: se necesita `~/.hermes/auth.json`. Kioku no monta todo `~/.hermes` ni copia esa credencial a la bóveda.
5. Arrancá `kioku daemon`; desde otra terminal ejecutá `kioku assistant status` y `kioku ask "¿Qué hago hoy?"`.

No uses como prueba tu bóveda real. Arrancá ambas terminales con el mismo `KIOKU_HOME` apuntando a una carpeta de prueba vacía. El emparejamiento del móvil sigue siendo el de Kioku, no el gateway de Hermes: [assistant-mobile.md](assistant-mobile.md).

## Qué se permite al contenedor

- Solo su estado de Hermes (`.kioku/hermes`, o `.kioku/hermes-mobile/<huella>`) es escribible; el puente MCP se monta solo lectura.
- Con Codex se montan únicamente `auth.json` y, si existe, `auth.lock`; con APIs no se montan.
- Las variables de clave seleccionadas se pasan por nombre (`--env NOMBRE`), no con valores en argv. Un administrador de Docker puede inspeccionar el entorno de sus contenedores: Docker local forma parte de la frontera de confianza.
- No se monta la bóveda completa, tu home, `~/.config` ni el socket Docker. Sistema de archivos de la imagen de solo lectura, usuario no root, sin capabilities y sin puertos publicados.
- Red de host para el puente a Kioku y modelos locales. Esto **no es aislamiento de red**; los permisos de la API de Kioku siguen imponiéndose mediante el token temporal de herramientas.
- La conexión Docker se fija al socket local (`~/.docker/run/docker.sock` o `/var/run/docker.sock`): no se heredan contextos remotos ni `DOCKER_HOST`.
- Cada consulta tiene un contenedor propio; al terminar o vencer el tiempo se elimina solo el id creado. Si el daemon muere abruptamente, puede quedar un contenedor `kioku-hermes-…`: inspeccionalo antes de retirarlo manualmente. Los ids propios quedan en `.kioku/docker-runs/` si falla la limpieza.
- La configuración usa SQLite `journal_mode: delete` para el estado de Hermes sobre bind mounts de Docker Desktop. Si traés una base Hermes existente en WAL, detené todos sus procesos y seguí el procedimiento oficial antes de migrarla; Kioku no convierte bases en caliente.

Referencia de la imagen y sus requisitos: <https://hermes-agent.nousresearch.com/docs/user-guide/docker>.

## Prueba pendiente en un Mac

- [ ] En una bóveda temporal, `assistant status` y una consulta real funcionan con el proveedor elegido.
- [ ] El puente MCP puede listar y crear una tarea y un evento; se ven y se pueden deshacer.
- [ ] Una propuesta crítica no cambia nada hasta aprobarla.
- [ ] El contenedor no puede leer una nota señuelo fuera de su carpeta de estado ni la bóveda por una ruta directa.
- [ ] Una consulta fallida y una cancelada por timeout no dejan contenedores vivos ni tokens en config.
- [ ] Si usás Codex, verificá una renovación de autenticación. El bind de fichero conserva el comportamiento de Linux; Hermes puede cambiar cómo renueva sus credenciales entre versiones. No amplíes el montaje a todo `~/.hermes` como solución.
- [ ] Desde el teléfono emparejado, chat y aprobaciones funcionan, sin datos privados; con el Mac suspendido aparece un error claro.
