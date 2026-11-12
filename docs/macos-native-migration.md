# Mac: copia antes de valorar la migración

> **Documento histórico (12 nov 2026).** La migración nativa ya está hecha en este Mac: Kioku corre por launchd (`com.ezequiel.kioku-server`) desde `~/Proyectos/kioku-hermes-central`, con el vault en `~/Documents/Kioku` y el puerto 47800 ocupado por ese daemon. Los pasos de abajo describen la instalación Docker anterior y ya no aplican: no hay contenedor que parar ni que copiar, y `kioku-local.sh start` choca con el puerto. Para copia y estado usa `./scripts/kioku-server.sh backup` y `./scripts/kioku-server.sh status`. Se conservan como referencia de lo que se hizo y de lo que una restauración todavía no demuestra.

Kioku ya funciona por Docker y desde el iPhone. Esta preparación **no migra nada** ni cambia esa instalación. Ejecuta los pasos desde la carpeta de Kioku en el Mac. No instales todavía una segunda instancia.

## Crear la copia

Reserva un destino privado fuera de la carpeta del repositorio; su carpeta padre debe existir y el destino final debe ser nuevo. El ejemplo usa tu carpeta personal. No compartas el archivo: contiene toda la bóveda y la carpeta oculta `.kioku`, incluidas claves de acceso y otros datos privados.

1. Cierra Kioku en todos los dispositivos y evita cualquier escritura durante la copia.
2. Para Kioku explícitamente (el script de copia no lo hace por ti):

   ```sh
   ./scripts/kioku-local.sh stop
   ```

3. Exporta el contenedor parado, sin borrar ni cambiar el volumen:

   ```sh
   bash scripts/kioku-backup.sh "$HOME/kioku-backup-$(date +%Y%m%d-%H%M%S)"
   ```

   Cópialo tal cual: el timestamp es sustitución de comando, `$(date …)`. Una variante como `&(dte …)` no se ejecuta y crea una carpeta con ese texto literal.

   El script exige exactamente un contenedor existente y parado. No ejecuta `up`, `stop`, restauraciones ni borrados. Usa `docker cp` para exportar `/data/.`, incluidos archivos ocultos. Comprueba que el tar tenga entradas y que su checksum se pueda verificar. No reinicies Docker/Kioku ni permitas otras escrituras durante la exportación. La comprobación de estado antes y después no es un bloqueo frente a otros procesos.

4. Si termina bien, puedes volver a usar la instalación actual:

   ```sh
   ./scripts/kioku-local.sh start
   ```

   Si falla, el destino puede contener archivos parciales: **no es una copia válida**. Conserva el volumen original y el error para investigar; no reutilices ese destino.

## Qué demuestra y qué falta

El mensaje de éxito acredita una exportación legible y un checksum, no una restauración completa ni compatibilidad con otra versión. Antes de migrar hay que verificar la copia en un entorno aislado, comparar los datos esperados y guardar otra copia protegida fuera del Mac. Un checksum no cifra la copia.

No ejecutes `docker compose down -v`, no borres el volumen y no sobrescribas una bóveda existente. `Kioku.command` sigue abriendo Docker. No arranques una instancia nativa en el mismo puerto mientras Docker está activo. La conexión del iPhone debe conservarse o volver a validarse expresamente; no se cambia aquí.

La ejecución nativa con Node y el aislamiento/conexión de Hermes en macOS aún necesitan validación técnica. No está demostrado que mover Kioku fuera del contenedor baste para disponer de Hermes. La restauración, el cambio de arranque y la retirada del contenedor quedan fuera de estos pasos.

Comunica solo el resultado o el error del script, nunca el contenido de la copia ni enlaces con claves.
