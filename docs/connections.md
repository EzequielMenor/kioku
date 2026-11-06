# Tu ordenador como centro de Kioku

Instala Kioku en un ordenador y conecta tus dispositivos a **esa misma instancia** mediante Tailscale. No se combinan bóvedas de instalaciones independientes. El ordenador debe permanecer encendido, sin suspensión y con Kioku y Tailscale activos.

## Empezar

Desde el repositorio, con Node.js 24 o superior:

```sh
npm install
npm run build:web
bin/kioku setup
bin/kioku open
```

`setup` muestra los pasos sin instalar software, modificar tu red ni generar claves. Si usas `bin/kioku`, sustituye `kioku` por `bin/kioku` en los comandos siguientes. Para Mac con Docker Desktop, consulta la sección específica de abajo.

## Conectar otro dispositivo

1. Instala Tailscale en el ordenador y el dispositivo; inicia sesión con la misma cuenta y habilita MagicDNS y HTTPS en tu tailnet. No uses Funnel ni abras puertos en el router.
2. Ejecuta `kioku doctor` en el ordenador. Muestra qué falta, el nombre DNS y el puerto real del daemon, sin imprimir claves. Salida **0** significa comprobaciones locales correctas; **1** significa que falta algún paso. No garantiza que otro dispositivo tenga acceso.
3. Reinicia Kioku con `KIOKU_ALLOWED_HOSTS` igual al nombre DNS que indicó el diagnóstico. En Linux con servicio de usuario, ejecuta `KIOKU_ALLOWED_HOSTS=equipo.tu-tailnet.ts.net kioku service install`: conserva esa variable. Sin servicio, detén tu daemon antes de arrancar `KIOKU_ALLOWED_HOSTS=equipo.tu-tailnet.ts.net kioku daemon` en primer plano. Usa tu nombre real, no el ejemplo.
4. Configura manualmente el proxy privado con el comando que muestra `doctor`, por ejemplo `tailscale serve --bg http://127.0.0.1:47800`. Revisa `tailscale serve status`; si el daemon usa otro puerto, el proxy debe usarlo también.
5. Repite `kioku doctor`. Antes de emparejar, configura las carpetas que no deben viajar en `.kioku/mobile.json`, por ejemplo `{"exclude":["Privado/"]}`.
6. Ejecuta `kioku pair` y abre el enlace en el dispositivo. **Contiene una clave móvil; no lo compartas ni lo publiques.** No uses `kioku url` para emparejar: esa URL contiene la clave completa del escritorio.
7. En iPhone/iPad: Safari → Compartir → Añadir a pantalla de inicio. En Android: Chrome → menú → Instalar aplicación o Añadir a pantalla de inicio. Abre siempre ese mismo origen privado.

El arranque automático de Linux (`kioku service install`) es un servicio de usuario. No evita que el equipo duerma ni garantiza continuar tras cerrar sesión. Kioku no cambia estas preferencias del sistema.

## Ver y recuperar la conexión

Abre **Conexiones y sincronización** en la barra lateral o en **Más** desde el móvil. La comprobación de conexión consulta el servidor, no una lectura guardada. Si falla, no puede distinguir entre equipo apagado, suspensión, Tailscale desconectado o red caída.

En el móvil se ve la última copia y las capturas o ediciones pendientes. Puedes revisar errores y conflictos con los controles existentes; un conflicto conserva el original y una copia de conflicto. Mantén la app abierta con red para enviar los cambios. No hay garantía de sincronización en segundo plano, y calendario y asistente requieren conexión.

| Síntoma | Qué revisar |
|---|---|
| Kioku no responde | Arranca Kioku, comprueba la suspensión y vuelve a comprobar. |
| Nombre rechazado | Configura `KIOKU_ALLOWED_HOSTS` en el proceso o servicio real y reinícialo. Cambiar solo la variable en otra terminal no basta. |
| Proxy incorrecto | Compara el puerto real con `tailscale serve status`. |
| Funciona en el ordenador, no en el móvil | Tailscale activo en ambos, misma tailnet y permisos/ACL adecuados; prueba el enlace privado en ese dispositivo. |
| Sin copia local o almacenamiento no disponible | Abre con red en el mismo navegador/origen; evita modo privado. No borres los datos del sitio si hay cambios sin enviar. |

## Mac con Docker Desktop

Para uso **local**, abre `Kioku.command` o ejecuta `./scripts/kioku-local.sh open`. Necesitas una imagen construida desde esta revisión; el lanzador existente no recompila automáticamente. Sigue [la guía local de Mac](local-macos.md).

El contenedor local no incluye Tailscale. `kioku doctor` dentro de él no podrá comprobar el Tailscale del Mac; no interpretes ese fallo como una prueba completa de acceso remoto. Para acceso privado:

1. Instala y conecta Tailscale en el **Mac y el móvil**. Obtén el nombre DNS del Mac con `tailscale status --json` y habilita HTTPS en tu tailnet.
2. En `compose.local.yml`, añade `KIOKU_ALLOWED_HOSTS: "nombre-real.tu-tailnet.ts.net"` a `services.kioku.environment`. No cambies el puerto publicado en loopback ni los volúmenes.
3. Recrea **ambos servicios juntos**, preservando los volúmenes: `docker compose -f compose.local.yml up -d --build`. No uses `down -v`. Si guardas datos importantes, valida antes una copia externa y su restauración aislada.
4. En el Mac, ejecuta `tailscale serve --bg http://127.0.0.1:47800` y revisa `tailscale serve status`: proxy HTTPS privado al puerto local, sin Funnel.
5. Genera el enlace limitado desde el contenedor: `docker compose -f compose.local.yml exec -e KIOKU_PUBLIC_HOST=nombre-real.tu-tailnet.ts.net kioku node src/cli/main.ts pair`.
6. Abre el enlace en el móvil y comprueba lectura y captura. Docker Desktop, Tailscale y el Mac deben seguir activos. La salud local o el estado de Compose no prueban este recorrido remoto.

Estos pasos son instrucciones: el desarrollo no los ejecuta sobre tu máquina ni valida tu iPhone, Android o Mac real.

## Desconectar móviles

`kioku pair --revoke` revoca la **clave compartida de todos los móviles**, no solo uno. El acceso al servidor se rechaza desde ese momento; lo ya descargado puede permanecer en cada dispositivo. La app intenta limpiar su réplica al recibir el rechazo, pero no es un borrado remoto garantizado. Desinstala la app y elimina los datos del sitio si necesitas retirarlos del teléfono, después de resolver cualquier cambio pendiente.

Para volver a conectar, ejecuta `kioku pair` y empareja de nuevo los dispositivos deseados. No hay inventario ni revocación individual por dispositivo en esta versión.

## Comprobación final con datos de prueba

- [ ] Desde otro dispositivo, abrir el enlace privado y leer una nota de prueba.
- [ ] Instalar la PWA; crear una captura de prueba sin red y volver a abrir con red.
- [ ] Confirmar que llega una sola vez y que la pantalla ya no la muestra pendiente.
- [ ] Confirmar que las carpetas privadas no aparecen en el móvil.
- [ ] Reiniciar Kioku y revisar nombre DNS, puerto, proxy y acceso privado.

Estas comprobaciones reales quedan a cargo del operador; las pruebas automatizadas usan bóvedas temporales, servidores locales y ejecutables Tailscale simulados.
