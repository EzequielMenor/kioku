# Operaciones móviles sin conexión

El móvil envía una instantánea inmutable con un `opId` por operación a `POST /api/mobile/operation`. Las capturas conservan su registro anterior, separado del diario de edición.

## Sincronización

- Una operación `edit` lleva `opId`, `kind`, `path`, `baseHash` y `text`. Una operación `task` añade `status` explícito: `todo`, `doing`, `done` o `dropped`.
- Si el hash coincide, la respuesta es `200` con `{ outcome: "applied", path, hash, text? }`; `text` es la instantánea canónica guardada, incluida en los recibos nuevos y al repetirlos. El cliente conserva el `done_at` generado por el servidor al preparar descendientes no intentados, sin cambiar sus cuerpos ni sus estados explícitos. Si no coincide, se conserva el original y se publica una copia en la misma carpeta; la respuesta `409` lleva `code: "mobile-conflict"`, `error` y `result: { outcome: "conflict", path, hash }`.
- Reenviar la misma operación recupera su resultado; reutilizar el identificador con otro contenido se rechaza. Las rutas privadas, inválidas o eliminadas no se editan.
- El cliente debe usar el hash devuelto para la siguiente operación dependiente y detener la cadena de esa nota ante un conflicto.

## Cola y borradores locales

`MutationQueue` guarda el borrador y la operación juntos, separados de la réplica y de las capturas. `clearReplica` no los borra; `clear` sí. El texto de cada operación es una instantánea completa, también para tareas; quien llama debe materializar el estado explícito sobre el texto local más reciente.

`add(input, opId?)` enlaza cada operación con la anterior de su ruta. `flush(transport)` persiste el cuerpo antes de enviarlo y usa el hash de la respuesta aplicada para preparar la siguiente operación. El transporte recibe ese cuerpo y devuelve `{ outcome, path, hash }`; debe convertir el `409 mobile-conflict` en `outcome: "conflict"` y lanzar `SendError` para los rechazos definitivos. Los demás errores detienen el envío para reintentar el mismo cuerpo e identificador. `list()` incluye estados aplicados, pendientes, conflictos y errores; `draft(path)` devuelve el borrador sin sustituirlo al llegar una respuesta. `retry(opId)` solo reactiva un rechazo definitivo; `discard(opId)` rechaza el borrado si existen dependientes. No hay fusión ni sobrescritura forzada.

Tras confirmar una operación aplicada se elimina su borrador solo si sigue coincidiendo y no hay cambios posteriores. Una nueva cadena usa la base recién leída. En «Más», el usuario puede confirmar el descarte de la cadena local; no se borra la copia de conflicto del servidor. La edición exige IndexedDB persistente y el editor guarda cada cambio antes de programar su envío.

La cola comparte un envío simultáneo por instancia, no entre pestañas o instancias independientes. Los recibos aplicados se conservan para resolver dependencias.

La comparación del hash y el reemplazo no son una operación CAS del sistema de archivos: un editor externo que escriba entre ambos pasos puede ganar o perder la carrera. Si el cambio se detecta antes del reemplazo, se conserva el original y se crea una copia de conflicto.

Para recuperar una publicación interrumpida, el diario guarda un enlace interno preparado y reconoce su copia por dispositivo e inodo, no por igualdad de contenido. El enlace se conserva para los reintentos; modificar la copia en el mismo inodo antes de completar el recibo puede invalidar esa recuperación, que entonces falla sin sobrescribirla. El diario no coordina a los editores externos.
