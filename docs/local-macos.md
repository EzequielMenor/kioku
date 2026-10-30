# Kioku en este Mac

Rama `feature/dokploy-private`, imagen `kioku:local-a68f7da` construida con el
Dockerfile original. `compose.local.yml` es una configuración independiente;
`compose.dokploy.yml` conserva el despliegue con Tailscale.

Abre `Kioku.command` con doble clic, o ejecuta:

```sh
./scripts/kioku-local.sh open
```

El lanzador inicia Docker Desktop si hace falta, arranca los contenedores y abre
el navegador con la URL de acceso generada por Kioku. Después del primer acceso,
puedes usar <http://127.0.0.1:47800>. No compartas la URL inicial con clave.

```sh
./scripts/kioku-local.sh status
./scripts/kioku-local.sh stop
./scripts/kioku-local.sh start
```

Las notas nuevas se guardan en el volumen Docker `kioku-local_data`, separado
de las carpetas del Mac. Parar o recrear los contenedores conserva el volumen.
No ejecutes `down -v`, ni borres ese volumen. El volumen todavía necesita una
copia de seguridad externa antes de guardar información que no puedas perder.

El puerto se publica únicamente en `127.0.0.1:47800`. Un proxy TCP dentro del
contenedor gateway conecta con el daemon, que sigue en loopback. Ambos
comparten la red; recréalos juntos con el mismo archivo Compose. Se mantienen
la clave de acceso y las comprobaciones de Host y Origin del servidor.

Los contenedores se reinician mientras Docker Desktop esté en ejecución.
El lanzador no modifica el inicio de sesión del Mac ni compila automáticamente.
Hermes y las ventanas/atajos de Hyprland no están disponibles en esta imagen.
