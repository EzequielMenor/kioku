# Móvil fase 2 (v0.6.0): lectura offline y captura offline

Issue: JARV-14. Continúa D-19 (PWA por Tailscale, rol `mobile`). Fase 3 (JARV-15, v0.7.0) añade edición offline y sincronización; queda fuera de este documento.

## Objetivo y criterio de éxito

El iPhone es útil sin cobertura: se **lee** el vault (salvo carpetas privadas) y se **captura**; las capturas llegan solas al volver la red, **sin duplicarse** aunque el envío se corte a medias.

Éxito: en modo avión se abre la app instalada y se ven Hoy, Tareas, Proyectos, Bandeja y Notas; se abre y se busca una nota; se captura, aparece un indicador de pendientes y, al volver la conexión y abrir la app, la captura está en Bandeja exactamente una vez.

## Decisiones ya tomadas (usuario)

- Tailscale, iOS, PWA instalada. Escritura móvil: capturar, tareas y editar notas (esta fase solo captura).
- Sin asistente, propuestas, foco, borrado ni edición de bases en el móvil.
- La copia offline es **todo el vault salvo las carpetas privadas** de `.kioku/mobile.json`.
- Offline, las pantallas muestran los datos de la **última sincronización**, con la marca «sincronizado hace X».
- Las capturas pendientes se envían **al abrir la app con red** (iOS no ofrece sincronización en segundo plano).

## Enfoque

Réplica de notas en IndexedDB más caché de lecturas en el service worker. Se descarta reimplementar Hoy, tareas, proyectos y grafo en el cliente a partir de las notas: duplicaría la lógica del servidor y arriesga divergencias.

## 1. Servidor

- `GET /api/sync/manifest` → `[{ path, mtime, hash }]` de todas las notas, ya filtrado con el mismo criterio que el resto de lecturas del rol `mobile` (`isPrivate`, rutas normalizadas).
- `GET /api/sync/notes?paths=a,b` → `[{ path, mtime, hash, text }]`. Lotes con tope de cantidad (50) y de bytes (1 MiB de texto); lo que no cabe se pide en otro lote. Si alguna ruta es privada, 404 como en el resto de lecturas.
- `hash` = SHA-256 hexadecimal del texto, para comparar sin depender de relojes.
- `POST /api/capture` acepta `x-kioku-op: <uuid>`. El servidor mantiene `.kioku/ops.json` (escritura atómica, fuera del vault de notas, 0600) con `{ opId → resultado, fecha }`, caducidad de 30 días y tope de 5000 entradas. Repetir un `opId` devuelve el resultado guardado y **no** crea otra nota. Peticiones concurrentes con el mismo `opId` se serializan en el proceso.
- Ventana residual documentada: si el daemon cae entre escribir la nota y anotar la operación, puede aparecer **un duplicado en Bandeja, nunca una captura perdida**.
- Los endpoints `sync` entran en la lista blanca de lecturas del rol `mobile` y existen también para `full`.

## 2. Service worker (`web/sw.js`)

- Se compila con esbuild a `dist/web/sw.js`, alcance `/`. El daemon lo sirve con `no-cache` (como el resto de estáticos) y `service-worker-allowed` no es necesario.
- **Shell**: HTML, `app.js`, CSS, fuentes e iconos se precargan en una caché cuyo nombre incluye el hash del build; al activarse borra las cachés viejas. Navegación sin red devuelve el `index.html` guardado.
- **Lecturas `/api/*`**: red primero con 3 s de espera; si falla, la última respuesta guardada. Se guardan solo respuestas 200 de GET de lectura. Nunca `/api/events`, `/api/health` ni rutas de asistente/propuestas.
- **401**: borra cachés y réplica (revocación o clave inválida).
- Las escrituras (`POST/PUT`) nunca pasan por la caché.

## 3. Réplica de notas (IndexedDB)

- Almacén `notes` `{ path, mtime, hash, text }` y almacén `meta` `{ lastSync }`.
- Sincronización al abrir con red, tras un evento SSE y a demanda: se compara el manifest con lo local, se bajan las notas nuevas o con otro `hash`, y se borran las que ya no están (incluidas las que pasaron a privadas).
- Tras sincronizar se precalientan las pantallas principales (Hoy, Tareas, Proyectos, Bandeja, Notas, grafo) para que el service worker las tenga guardadas.
- **Búsqueda offline** en el cliente sobre la réplica (título, cabeceras y texto, con ranking sencillo); se usa solo cuando `/api/search` falla.
- Una nota abierta sin red sale de la réplica; sus backlinks se muestran si estaban en la caché de lecturas.
- `navigator.storage.persist()` se solicita al instalar; «Más» muestra el espacio usado.
- La lógica va detrás de una interfaz `Store` con implementación en memoria (tests) y adaptador de IndexedDB. Sin dependencias nuevas.

## 4. Cola de capturas

- Cada captura recibe un `opId` (UUID). Con red se envía directamente; si falla por red o 5xx, o no hay conexión, queda en el almacén `queue` `{ opId, text, createdAt, state, error? }`.
- Se reenvía **en orden** al abrir la app, al evento `online` y tras cada sincronización, con espera creciente.
- Un 4xx marca la captura como `failed`, la conserva visible y no reintenta; el usuario puede reenviarla o descartarla.
- Indicador de pendientes en «Más» y en la barra; aviso «sin conexión» cuando corresponda; marca «sincronizado hace X» en las pantallas de lectura.

## 5. Privacidad y amenazas

- Lo privado nunca entra en manifest, notas ni cachés, y se purga de la réplica si cambia `mobile.json`.
- **Límite que se documenta (D-21)**: revocar el móvil (`kioku pair --revoke`) no borra a distancia la copia local, porque con el teléfono sin conexión nadie puede. La protege el bloqueo del iPhone. La réplica se purga en cuanto el móvil vuelve a hablar con el servidor y recibe un 401.
- La cola puede contener texto sensible hasta que se envíe; se vacía al confirmarse.

## 6. Pruebas

- `node:test`: filtro de privados en ambos endpoints (rutas con `..`, `//`, mayúsculas), límites de lote, rol, y la idempotencia (mismo `opId` dos veces y a la vez → una nota; `opId` distinto → dos).
- Lógica de réplica y cola con el `Store` en memoria: diff del manifest, borrado de notas retiradas, orden de la cola, 4xx frente a 5xx, reintento tras corte.
- E2E en Chromium con la red cortada (`Network.emulateNetworkConditions`): carga con red, pasa a offline y recarga; ve Hoy y una nota; busca; captura; vuelve la red y la captura llega una vez.
- No se puede reproducir en Chromium el comportamiento propio de iOS (evicción de almacenamiento, sin sincronización en segundo plano): se valida en el iPhone.

## 7. Entrega

Versión 0.6.0, CHANGELOG, decisión D-21 en `docs/design/02-TRD-architecture.md`, nota en `docs/validation.md`, README. Rama `offline`; merge, tag y push solo con OK del usuario.

## Fuera de alcance

Edición y completar tareas offline, resolución de conflictos (fase 3), sincronización en segundo plano, cifrado de la réplica en el dispositivo, copia selectiva por carpeta.
