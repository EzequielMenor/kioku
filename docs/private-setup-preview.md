# Borrador: instalación Mac y conexiones privadas

**Esta rama es trabajo en curso, no una versión lista para instalar.** Publicar el código no acredita su seguridad ni su funcionamiento final. No sustituye el servidor Mac que ya utilizas ni migra datos o claves.

## Qué contiene

- Un constructor de aplicación Mac con Node incluido: [paquete local](macos-app.md). No se entrega aquí un `.dmg`, un binario firmado ni una aplicación ejecutada en un Mac real.
- Accesos móviles individuales con enlaces temporales, revocación y QR generado localmente. [Contrato de dispositivos](device-access-api.md).
- Un panel en **Conexiones y sincronización** para detectar Tailscale y solicitar explícitamente la publicación privada de esta instancia. La interfaz completa sigue sin prueba final en navegador.
- El asistente queda fuera de esta etapa.

## Configuración privada implementada (aún sin validación final)

| Ruta | Acceso | Comportamiento previsto |
|---|---|---|
| `GET /api/connections/status` | Credencial completa | Consulta Tailscale sin cambiar su configuración; devuelve conexión, nombre, proxy preparado, origen privado, problema detectado y si la petición es local. |
| `POST /api/connections/configure` | Credencial completa desde loopback | Exige JSON `{"confirm":true}`. Usa el nombre de Tailscale detectado y el puerto real de Kioku; no acepta destinos aportados por el navegador. |

El código se niega a reemplazar otra publicación de Tailscale o Funnel. Solo solicita `tailscale serve --bg --https=443 http://127.0.0.1:<puerto>` tras la confirmación; no instala Tailscale, inicia sesión, abre el router ni usa Funnel. Guarda el nombre permitido en `.kioku/remote-host.json`; no guarda claves en ese ajuste. La instalación y autorización de Tailscale siguen siendo acciones del propietario.

## Qué se comprobó y qué falta

- Corrección del reloj de la demo en commit separado: RED/GREEN, tres zonas horarias, compilación web, tipos y suite de 706 pruebas en verde.
- Unidad inicial de dispositivos: 708 pruebas, tipos y compilación en verde. Su revisión independiente encontró dos defectos del registro corrupto/SSE, corregidos en `92f7788`; 32 pruebas focalizadas y tipos pasaron después.
- **Falta revalidación independiente de esas dos correcciones**: la preparación del recheck falló antes de ejecutar pruebas. No se sustituye esa evidencia por una afirmación de que funciona ni por otro verificador.
- Modelo QR y backend privado: 15 comprobaciones focalizadas y tipos pasaron antes del bloqueo. El navegador solo llegó a observar RED antes de implementar el panel. **No se ejecutaron el build, el navegador GREEN ni la suite completa del borrador final.**
- **Falta ejecución real en Mac**, compatibilidad del runtime, apertura desde Finder y conexión física desde otro dispositivo. Firma, notarización y avisos completos de distribución también están pendientes.
- La orden antigua `kioku pair --revoke` conserva su comportamiento heredado de retirar todas las suscripciones push; no se ha modificado silenciosamente.

## Uso actual y datos

Para la instalación que ya tienes, conserva el procedimiento de [servidor Mac actual](local-macos.md). No cambies a este borrador para sustituirla, no borres volúmenes y no copies claves entre instancias. Antes de una futura migración se necesita una copia validada mediante restauración aislada.

El estado y los bloqueos están en [el documento de JARV-38](../odd/tasks/mac-simple-setup.md). No se han modificado datos, configuración del Mac ni el motor del asistente desde este desarrollo.
