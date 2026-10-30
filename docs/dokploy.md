# Kioku privado en Dokploy

## Alcance

Preparación local; no despliega ni importa tus datos. La UI web se construye dentro
de la imagen. Kioku escucha en loopback y comparte la red de un sidecar Tailscale
en modo userspace, sin puertos publicados, dispositivos ni privilegios adicionales.
No configures dominios de Dokploy/Traefik ni Tailscale Funnel.

El asistente Hermes y las acciones de escritorio no están disponibles en esta
imagen: no contiene Hermes, navegador, configuración personal ni credenciales.
La interfaz y las operaciones normales de notas/tareas siguen disponibles.

## Configurar (operador)

1. Revisá y publicá únicamente una revisión aprobada del repositorio. No despliegues
   los cambios offline pendientes como efecto colateral de esta preparación.
2. En Dokploy creá una aplicación **Docker Compose**, no Stack/Swarm, con build
   estándar desde el repositorio y archivo `compose.dokploy.yml`.
3. Configurá las variables en el panel privado de Dokploy (no en Git):
   - `TAILSCALE_IMAGE`: versión o digest probado de `tailscale/tailscale`;
     evitá `latest`. La imagen Node usa la rama 24; fijá también su digest
     antes de una entrega que requiera builds reproducibles.
   - `TS_AUTHKEY`: clave de registro no efímera creada en tu tailnet.
     Limitá su alcance con las ACL/grants correspondientes. Es una credencial:
     no la pegues en chats, logs o capturas.
   - `TS_HOSTNAME`: por defecto `kioku`; elegí un nombre que no esté ocupado.
   - `KIOKU_ALLOWED_HOSTS`: nombre DNS completo, por ejemplo
     `kioku.example-tailnet.ts.net`, sin protocolo, puerto ni barra.
4. Habilitá MagicDNS y certificados HTTPS en Tailscale. Restringí el acceso
   al nodo con las ACL/grants de la tailnet; Kioku mantiene además sus claves.
5. Cuando autorices el despliegue, verificá el DNS real del nodo en el panel
   de Tailscale. Si recibió un sufijo por colisión, corregí
   `KIOKU_ALLOWED_HOSTS` y recreá ambos servicios juntos.
6. En la consola del servicio **tailscale**, activá el proxy privado:
   `tailscale serve --bg http://127.0.0.1:47800`.
   Comprobá `tailscale serve status`. Serve guarda su configuración en el
   estado persistido; verificá que siga activa después de cada recreación.
   Si solicita habilitar HTTPS, completalo como operador y repetí el comando.

Tras registrar el nodo, retirá la clave de registro del panel (dejá
`TS_AUTHKEY` vacía) y revocala en Tailscale. `TS_AUTH_ONCE=true` reutiliza
la identidad del volumen; perderlo exige un registro nuevo.

## Acceso y comprobaciones

En la consola de **kioku**, `node src/cli/main.ts pair` genera una URL HTTPS
con clave móvil limitada; no la compartas. Conserva las restricciones del rol móvil.
Para acceso completo, `node src/cli/main.ts url` imprime una URL de loopback:
cambiá solamente su origen por `https://<nombre-DNS-real>`, conservando la
ruta, query y fragmento. Esa URL contiene una clave con acceso completo.

Desde un dispositivo autorizado en la tailnet:
- `https://<nombre-DNS-real>/api/health` debe responder correctamente.
- Abrí la URL de acceso y comprobá lectura, captura y edición con datos de prueba.
- Reiniciá/recreá **ambos servicios juntos** y comprobá que identidad, notas
  y acceso HTTPS persisten. No recrees solo el sidecar: Kioku comparte su
  namespace de red y debe recrearse con él.
- Sin conexión a la tailnet no debe haber acceso público al servicio.

Estas comprobaciones del servidor no se han ejecutado durante la preparación.

## Persistencia, copias y actualización

Los volúmenes `kioku-data` y `tailscale-state` conservan los datos y la identidad.
Mantené el mismo proyecto Compose y sus volúmenes entre despliegues. No uses
`down -v`, no borres volúmenes ni montes tu bóveda personal o carpetas del host.

Antes de importar, actualizar o restaurar, definí una copia externa y probá su
restauración en un entorno aislado. En la consola de Kioku,
`node src/cli/main.ts export /data/backup.tar.gz` crea un archivo que debés
copiar fuera del volumen mediante el mecanismo de backup de tu operador.
El archivo puede contener secretos de Kioku: protegelo y no lo publiques.
Una copia dentro del mismo volumen no protege contra perder ese volumen.
La identidad Tailscale requiere su propia copia protegida.

La transferencia de la bóveda actual, el destino de backups y cualquier
restauración quedan fuera de esta preparación y necesitan autorización.
No conectes laptop y servidor como escritores de la misma bóveda.

## Verificación local sin credenciales

```sh
node --test test/deployment.test.ts
TAILSCALE_IMAGE=tailscale/tailscale:stable \
KIOKU_ALLOWED_HOSTS=kioku.example-tailnet.ts.net \
docker compose -f compose.dokploy.yml config --quiet
npm test
npm run typecheck
npm run build:web
docker build -t kioku:local .
```

El valor `stable` anterior sirve solo para validar sintaxis, no para seleccionar
la imagen de producción. Build y prueba de contenedores requieren acceso al
daemon Docker. No se necesita una clave real para validar Compose.

Referencias: [Tailscale Docker](https://tailscale.com/docs/features/containers/docker/docker-params)
y [Dokploy Compose](https://docs.dokploy.com/docs/core/docker-compose).
