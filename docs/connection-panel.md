# Panel de conexión

Pantalla «Conexiones y sincronización» (`ConnectionsView`, `web/src/connections.tsx`). Reúne el estado
del ordenador-centro, la ayuda para conectar y, en el móvil, los controles de la cola.
No añade backend, cola ni configuración de red: solo lee lo que ya existe.

## Qué muestra

- **Estado real.** Un `GET /api/health` hecho con `fetch` directo, `cache: "no-store"`,
  sin pasar por `api()` (así no hay respaldo offline ni de demo) y con un máximo de 5 s.
  El service worker tampoco guarda `/api/health`.
- **Errores honestos.** Si la petición falla o tarda demasiado, el panel dice que no
  puede distinguir un ordenador dormido o apagado de un dispositivo sin red o sin
  Tailscale. Una respuesta no sana (p. ej. 502) se muestra aparte. El botón
  **Reintentar** repite la comprobación.
- **Origen seguro.** Solo `esquema://host` (`safeOrigin`). Nunca la URL completa, la
  consulta `?k=`, cookies ni claves.
- **Sincronización (solo móvil).** Último estado observado por Kioku (`useOffline`) y
  «última sincronización» (`formatAgo`). La cola, los reenvíos y los conflictos los
  pinta `OfflineSection`, que el integrador pasa como `children`; no se duplica lógica.
- **Guía.** El ordenador es el centro y debe estar encendido; Tailscale hace falta en
  ambos dispositivos; no hay sincronización garantizada en segundo plano; la clave del
  móvil es única y compartida, así que revocarla desempareja todos los dispositivos.
  En el ordenador: `kioku setup`, `kioku doctor`, `kioku pair`, `kioku pair --revoke`,
  el lanzador de Mac y el servicio de Linux (opcional). En el móvil: instalar la PWA
  desde Safari (Compartir → Añadir a pantalla de inicio) o Android (Instalar aplicación)
  y cómo volver a emparejar.

Las órdenes se muestran para que las ejecute la persona; el panel no ejecuta nada,
no genera claves ni cambia la red.

## Demostración

Con `demo`, el panel se marca como **simulación**, no hace ninguna petición ni afirma
que haya conexión, y no muestra la cola de sincronización.

## Integración

```tsx
<ConnectionsView mobile={mobile} demo={lsGet("kioku.demo.active") === "1"}>{mobile && <OfflineSection off={off} />}</ConnectionsView>
```

Props: `demo?: boolean`, `mobile?: boolean` (por omisión, el rol detectado) y `children`
(solo se pintan en el móvil real). Las funciones sin DOM (`probeHealth`, `describeHealth`,
`safeOrigin`, `connectionGuide`) están en `web/src/connections-model.ts` y se prueban en
`test/connections.test.ts`.
