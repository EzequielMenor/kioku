# Kioku: diagnóstico de Kio y guía de conexiones

Avance local (ProjectOS no disponible en esta sesión).

- En el chat Kio mostró: «El asistente no está disponible: No puedo leer assistant-model.json: revisa sus permisos».
- El diagnóstico ahora distingue permisos (`EACCES`/`EPERM`), una ruta que no es carpeta (`ENOTDIR`) y otros fallos de lectura. No cambia permisos, el modelo elegido ni el trato de un override inválido.
- La guía distingue desconectar un dispositivo emparejado por QR de revocar la clave móvil compartida por terminal.
- RED: reproducidos el mensaje incorrecto con una ruta inválida y el mensaje genérico con el error de permisos simulado. GREEN: `npm test` (845 pasaron, 44 omitidas, 0 fallidas) y `npm run typecheck` (0).
- Pendiente: determinar la causa exacta en la instalación afectada, validar un mensaje real de Kio y comprobar el emparejamiento entre dispositivos con el servidor del usuario. No se accedió a la bóveda ni se cambió la instalación.
