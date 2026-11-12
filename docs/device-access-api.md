# Acceso individual de dispositivos

Las nuevas conexiones usan una credencial móvil por dispositivo. La pantalla del ordenador administra los accesos; la credencial completa del escritorio nunca se entrega al móvil. El asistente no cambia en esta etapa.

## API

Todas las rutas mantienen las comprobaciones de Host y Origin. Las respuestas no se guardan en caché. La administración exige autenticación de escritorio; el móvil recibe 403 y una petición sin autenticar recibe 401.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /api/devices` | — | `{devices: [{id,name,createdAt}], legacyPaired: boolean}` |
| `POST /api/devices/enrollments` | `{}` | 201 `{token,expiresAt}`; dura cinco minutos, un uso y se invalida al reiniciar |
| `POST /api/devices/redeem` | `{token,name}` | 201 `{id,name,createdAt}` y cookie móvil HttpOnly/SameSite=Strict; no exige autenticación previa |
| `DELETE /api/devices/:id` | `{}` | 200 `{revoked:true}`; 404 si no existe |

El nombre tiene entre 1 y 80 caracteres sin controles. Un enlace inválido, usado o caducado recibe 401; nombre inválido, 400; límite de dispositivos o enlaces pendientes, 409. Hay un máximo de 100 dispositivos y 20 enlaces pendientes. El token no es la credencial del dispositivo: el servidor genera otra al canjearlo, guarda solo su hash y fija una cookie Secure cuando se accede por el origen HTTPS permitido.

La interfaz debe colocar el token temporal en el fragmento del enlace, nunca en registros ni servicios QR externos. El usuario confirma el nombre antes del canje. No guardar enlaces en almacenamiento persistente ni mostrarlos en una demo pública.

## Revocación y compatibilidad

Revocar un dispositivo bloquea sus siguientes peticiones y cierra sus flujos de cambios; sus avisos push dejan de enviarse. No modifica los accesos de otros dispositivos ni borra datos descargados. No es un borrado remoto.

El emparejamiento antiguo con `kioku pair` sigue funcionando con su clave compartida. `legacyPaired` señala que existe ese acceso: no representa un inventario de los teléfonos antiguos. `kioku pair --revoke` sigue retirando esa clave compartida; las conexiones nuevas se retiran individualmente en la interfaz. No se convierten claves existentes en dispositivos ni se migran datos automáticamente.

El registro `.kioku/device-credentials.json` se escribe de forma atómica con permisos 0600 y se excluye de las exportaciones, incluidos temporales. Si está corrupto, se rechazan sus operaciones sin sobrescribirlo. Los códigos pendientes solo viven en la memoria del daemon.
