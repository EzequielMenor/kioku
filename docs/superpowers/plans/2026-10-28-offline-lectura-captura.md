# Móvil fase 2 (v0.6.0): lectura y captura offline — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la PWA del iPhone se pueda leer y capturar sin conexión: réplica de notas, caché de lecturas, búsqueda local y cola de capturas idempotente.

**Architecture:** el servidor añade dos lecturas de sincronización y deduplica capturas por `x-kioku-op`. El cliente guarda notas y cola en IndexedDB detrás de una interfaz `Store` (con versión en memoria para los tests); un service worker sirve el shell y la última lectura de `/api/*` cuando no hay red. Toda la lógica pura vive en `web/src/offline/` y se prueba con `node:test`; lo que depende del navegador se verifica en un E2E con la red cortada.

**Tech Stack:** Node 24 (TS nativo, `node:test`), esbuild, Preact, IndexedDB, Service Worker. **Sin dependencias nuevas.**

**Spec:** `docs/superpowers/specs/2026-10-28-offline-lectura-captura-design.md`

## Global Constraints

- Issue **JARV-14**; rama `offline`; versión **0.6.0**. Commits `tipo(offline): … (JARV-14)`, en español, **sin `Co-Authored-By`** (regla del usuario y de AGENTS.md).
- TDD: cada tarea empieza con el test rojo y lo ve fallar. Antes de dar nada por hecho: `npm test`, `npm run typecheck`, `npm run build:web`.
- Pruebas solo con vaults temporales (`tmpVault` de `test/helpers.ts`) y `KIOKU_HOME` temporal. **Nunca** tocar la bóveda real del usuario, `~/.hermes` ni `~/.config`.
- Sin instalar software global ni dependencias. Imports con extensión `.ts`.
- Lo privado (`.kioku/mobile.json`) nunca sale: ni manifest, ni notas, ni cachés. Rutas normalizadas (`//`, `..`, mayúsculas, NFC) con `isPrivate` de `src/server/mobile.ts`.
- Textos de interfaz en español. Objetivos táctiles ≥ 44 px, inputs de 16 px.
- iOS no tiene sincronización en segundo plano: las capturas pendientes se envían al abrir la app con red.
- Merge, tag, push y reinicio del servicio solo con OK del usuario.
- **Ajuste respecto al spec:** `GET /api/sync/notes` recibe `paths` como **array JSON** (`?paths=["a.md","b.md"]`, URL-codificado), porque un nombre de nota puede contener comas. `.kioku/ops.json` se escribe con `vault.writeInternal` (atómico, igual que el resto de `.kioku/`), sin forzar 0600 porque no contiene secretos. El spec se corrige en la Tarea 9.

## Review Focus

1. **Nombres de nota con comas, `#`, `&`, acentos o espacios** en `sync/notes` y en la réplica (Tarea 1 y 3).
2. **Rutas privadas con trucos** (`privado/`, `Notas/../Privado/`, `Privado//`, NFC) en `paths`: 404 a toda la petición y sin texto filtrado (Tarea 1).
3. **Respuesta perdida:** el servidor aplicó la captura pero el cliente no recibió la respuesta; al reenviar con el mismo `opId` no se duplica, ni en secuencia ni en paralelo (Tarea 2 y 5).
4. **Nota borrada o hecha privada entre el manifest y la descarga** (`gone`): la réplica no guarda restos ni falla (Tarea 1 y 3).
5. **Cuota de almacenamiento agotada o evicción:** si `putNotes` lanza, la app sigue funcionando en línea, `lastSync` no avanza y no se corrompe lo ya guardado (Tarea 3).
6. **Shell viejo tras un despliegue:** el nombre de caché cambia con cada build y se borran las cachés antiguas (Tarea 7).

---

### Task 1: Endpoints `GET /api/sync/manifest` y `GET /api/sync/notes`

**Files:**
- Modify: `src/server/server.ts` (rama `GET` del `switch`, junto a `/api/notes`, ~línea 199)
- Test: `test/sync-api.test.ts` (nuevo; copiar `setup()` y `FM` de `test/mobile-role.test.ts:14-45`, con la misma `SEED`)

**Interfaces:**
- Produces: `GET /api/sync/manifest` → `{ path: string; mtime: number; hash: string }[]`; `GET /api/sync/notes?paths=<JSON string[]>` → `{ notes: { path: string; mtime: number; hash: string; text: string }[]; pending: string[]; gone: string[] }`. Constantes `SYNC_MAX_PATHS = 50` y `SYNC_MAX_BYTES = 1_048_576` en `server.ts`.
- `pending` = rutas pedidas que no cupieron por el tope de bytes (el cliente las vuelve a pedir); `gone` = rutas que ya no existen. Una nota que por sí sola supera el tope se devuelve sola.

- [ ] **Step 1: Escribir los tests rojos** en `test/sync-api.test.ts` (rol `mobile`, `exclude: ["Privado/"]`):
  - `manifest: lista las notas visibles con path, mtime y hash, sin lo privado` → status 200; paths ordenados `["Notas/Publica.md", "Tareas/Tarea publica.md"]`; el `hash` de `Notas/Publica.md` es igual al de `GET /api/note?path=Notas%2FPublica.md`; `r.text` no contiene `"Privado"`.
  - `notes: devuelve el texto pedido, también con comas, #, & y acentos` → `s.j.vault.write("Notas/Año, mes & #1.md", FM("type: note\n") + "cuerpo")` + `await s.j.reindex()`; pedir `paths=encodeURIComponent(JSON.stringify([...]))`; `notes[0].text` contiene `"cuerpo"`, `pending` y `gone` vacíos.
  - `notes: una ruta privada, con trucos o no, da 404 a toda la petición y no filtra texto` → para `Privado/Secreto.md`, `privado/Secreto.md`, `Notas/../Privado/Secreto.md`, `Privado//Secreto.md` (junto a una pública válida): status 404 y `!text.includes("MARCASECRETA")`.
  - `notes: más de 50 rutas → 400; JSON inválido → 400; sin clave → 401`.
  - `notes: lo que no cabe en 1 MiB vuelve en pending, y una nota mayor que el tope sale sola` → tres notas de 600 KiB: `notes.length === 1`, `pending.length === 2`; una de 1,5 MiB pedida sola: `notes.length === 1`.
  - `notes: una nota borrada tras el manifest sale en gone` → pedir una ruta pública inexistente: `gone` la contiene y el status es 200.
- [ ] **Step 2: Ejecutar** `npm test -- test/sync-api.test.ts`. Expected: FAIL (404 de ruta desconocida).
- [ ] **Step 3: Implementar** los dos `case` en `server.ts`. Manifest: `j.index.listNotes({ limit: 1_000_000 })` mapeado a `{ path, mtime, hash }` (el filtro de privados lo aplica `mobileView`). Notes: parsear `paths` con `JSON.parse` dentro de `try` (400 si no es array de strings o supera `SYNC_MAX_PATHS`); **primero** recorrer todas con `skip?.(x)` → `HttpError(404, "No existe")`; después `userPath(x)` y `j.vault.read(x)` (un `VaultError` `not-found` pasa a `gone`); acumular texto hasta `SYNC_MAX_BYTES` (la primera nota siempre entra) y el resto a `pending`.
- [ ] **Step 4: Ejecutar** `npm test -- test/sync-api.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/server/server.ts test/sync-api.test.ts && git commit -m "feat(offline): endpoints de sincronización de notas filtrados por privacidad (JARV-14)"`

### Task 2: Captura idempotente con `x-kioku-op`

**Files:**
- Create: `src/server/ops.ts`
- Modify: `src/server/server.ts` (`case "/api/capture"`, ~línea 260; instanciar `new OpsLedger(j.vault)` junto a `undo`)
- Test: `test/ops.test.ts` (nuevo), `test/sync-api.test.ts` (añadir casos de servidor)

**Interfaces:**
- Produces: `class OpsLedger { constructor(vault: Vault, opts?: { now?: () => number; max?: number; ttlMs?: number }); run<T>(opId: string, fn: () => Promise<T>): Promise<T> }`. Por defecto `max = 5000`, `ttlMs = 30 * 86_400_000`. Estado en `.kioku/ops.json` como `{ [opId]: { at: number; result: unknown } }`.
- `export function validOp(v: string): string` lanza `HttpError`-compatible `Error` con `.status = 400` si no cumple `/^[0-9a-f-]{8,64}$/i`.

- [ ] **Step 1: Tests rojos** en `test/ops.test.ts` (con `tmpVault` y `Vault`):
  - `mismo opId dos veces: fn se ejecuta una vez y devuelve el mismo resultado`.
  - `en paralelo: dos llamadas simultáneas con el mismo opId ejecutan fn una sola vez` (`Promise.all`).
  - `opIds distintos ejecutan fn cada uno`.
  - `si fn lanza, no se registra: el reintento vuelve a ejecutar fn`.
  - `caduca: pasados 31 días (now inyectado) fn vuelve a ejecutarse`.
  - `tope: con max = 3 y cuatro operaciones, la más antigua se olvida y las tres últimas siguen deduplicando`.
  - `persiste: otro OpsLedger sobre el mismo vault reconoce un opId ya aplicado`.
  - `validOp rechaza "../x", "" y 65 caracteres; acepta un UUID`.
  En `test/sync-api.test.ts`: `POST /api/capture` dos veces con `x-kioku-op` igual → una sola nota nueva (`s.j.inbox().length` sube en 1) y cuerpos JSON idénticos; cabecera `x-kioku-op: ../x` → 400; sin cabecera → 200 como antes.
- [ ] **Step 2: Ejecutar** `npm test -- test/ops.test.ts test/sync-api.test.ts`. Expected: FAIL (`ops.ts` no existe).
- [ ] **Step 3: Implementar** `OpsLedger.run`: mapa en memoria de promesas en vuelo por `opId`; leer/escribir `ops.json` con `readInternal`/`writeInternal`; podar por caducidad y por `max` (las más antiguas primero) al escribir. Cablear en `server.ts`: si llega `x-kioku-op` (`validOp`), `ops.run(op, () => j.capture(str(body.text, "text")))`; si no, comportamiento actual.
- [ ] **Step 4: Ejecutar** los mismos tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(offline): la captura es idempotente por x-kioku-op (JARV-14)`

### Task 3: Interfaz `Store`, réplica y sincronización

**Files:**
- Create: `web/src/offline/store.ts`, `web/src/offline/replica.ts`
- Test: `test/offline-replica.test.ts`

**Interfaces:**
- Produces (`store.ts`):
  ```ts
  export interface StoredNote { path: string; mtime: number; hash: string; text: string }
  export interface QueuedCapture { opId: string; text: string; createdAt: number; state: "pending" | "failed"; error?: string }
  export interface Store {
    allNotes(): Promise<StoredNote[]>; getNote(path: string): Promise<StoredNote | undefined>;
    putNotes(notes: StoredNote[]): Promise<void>; deleteNotes(paths: string[]): Promise<void>;
    getMeta<T>(key: string): Promise<T | undefined>; setMeta(key: string, value: unknown): Promise<void>;
    queue(): Promise<QueuedCapture[]>; putCapture(c: QueuedCapture): Promise<void>; deleteCapture(opId: string): Promise<void>;
    clear(): Promise<void>;
  }
  export class MemoryStore implements Store {}
  ```
  `queue()` devuelve por `createdAt` ascendente.
- Produces (`replica.ts`): `export type GetJson = <T>(path: string) => Promise<T>`; `export interface SyncResult { added: number; updated: number; removed: number; at: number }`; `export async function syncReplica(store: Store, get: GetJson, now?: () => number): Promise<SyncResult>`; `export const BATCH = 50`.

- [ ] **Step 1: Tests rojos** con un `get` falso que simula `/api/sync/manifest` y `/api/sync/notes` (contando llamadas):
  - `primera sincronización: descarga todo y guarda lastSync`.
  - `sin cambios: no pide /api/sync/notes` (0 llamadas).
  - `cambia un hash: solo se vuelve a descargar esa nota`.
  - `desaparece del manifest (borrada o ahora privada): se borra de la réplica`.
  - `gone se ignora y pending se vuelve a pedir hasta completar` (servidor falso que devuelve 1 por llamada).
  - `120 notas nuevas: lotes de 50 como máximo` (3 llamadas).
  - `nombres con comas, # y acentos viajan bien en paths` (el falso decodifica el JSON y compara).
  - `error en el 2.º lote: el 1.º queda guardado, lastSync no cambia y el error se propaga`.
  - `putNotes lanza (cuota): syncReplica rechaza, lastSync no cambia y lo anterior sigue intacto`.
- [ ] **Step 2: Ejecutar** `npm test -- test/offline-replica.test.ts`. Expected: FAIL (módulos inexistentes).
- [ ] **Step 3: Implementar** `MemoryStore` y `syncReplica`: manifest → diff por `hash` → lotes de `BATCH` pidiendo `/api/sync/notes?paths=${encodeURIComponent(JSON.stringify(lote))}`; repetir con `pending`; `putNotes` por lote; `deleteNotes` de lo que ya no está; `setMeta("lastSync", at)` solo al terminar sin error.
- [ ] **Step 4: Ejecutar.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(offline): réplica de notas con sincronización por manifest (JARV-14)`

### Task 4: Búsqueda local

**Files:**
- Create: `web/src/offline/search.ts`
- Test: `test/offline-search.test.ts`

**Interfaces:**
- Consumes: `StoredNote` (Tarea 3), `SearchHit` de `web/src/types.ts` (`{ path; title; type; snippet; kind: "title" | "content"; score }`).
- Produces: `export function searchNotes(notes: StoredNote[], query: string, limit?: number): SearchHit[]` (`limit` por defecto 12).

- [ ] **Step 1: Tests rojos:** consulta vacía o de 1 carácter → `[]`; insensible a mayúsculas y acentos (`"cafe"` encuentra `"Café"`); todas las palabras deben aparecer (AND); un acierto en el título (`kind: "title"`) puntúa más que uno solo en el cuerpo (`kind: "content"`); ignora el frontmatter; `snippet` contiene el texto alrededor del acierto; respeta `limit`; el título sale de la primera cabecera `# ` o, si no hay, del nombre del fichero sin `.md`; `type` sale de `type:` del frontmatter o `"note"`.
- [ ] **Step 2: Ejecutar** `npm test -- test/offline-search.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar** normalización NFD sin diacríticos y minúsculas; puntuación título 10 / cabecera 4 / cuerpo 1 por palabra; orden por `score` descendente y, a igualdad, por `path`.
- [ ] **Step 4: Ejecutar.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(offline): búsqueda local sobre la réplica (JARV-14)`

### Task 5: Cola de capturas

**Files:**
- Create: `web/src/offline/queue.ts`, `web/src/offline/capture.ts`
- Test: `test/offline-queue.test.ts`

**Interfaces:**
- Consumes: `Store`, `QueuedCapture` (Tarea 3); `ApiError` de `web/src/api.ts`; `CaptureResult` de `web/src/types.ts`.
- Produces (`queue.ts`):
  ```ts
  export class SendError extends Error { retryable: boolean; constructor(message: string, retryable: boolean) }
  export const backoffMs = (attempt: number): number  // min(30_000, 1000 * 2 ** attempt)
  export class CaptureQueue {
    constructor(store: Store, newId?: () => string)
    add(text: string, opId?: string): Promise<QueuedCapture>
    list(): Promise<QueuedCapture[]>
    flush(send: (c: QueuedCapture) => Promise<void>): Promise<{ sent: number; failed: number; stopped: boolean }>
    retry(opId: string): Promise<void>; discard(opId: string): Promise<void>
  }
  ```
- Produces (`capture.ts`): `isRetryable(e: unknown): boolean` (error de red = no es `ApiError`; o `ApiError` con status 401, 408, 429 o ≥ 500); `submitCapture(deps: { post(text: string, opId: string): Promise<CaptureResult>; queue: CaptureQueue; newId(): string }, text: string): Promise<{ sent: true; result: CaptureResult } | { sent: false; queued: QueuedCapture }>`.

- [ ] **Step 1: Tests rojos:**
  - `flush: envía en orden de creación y borra lo enviado`.
  - `flush: un error reintentable detiene la cola (stopped = true) y conserva el resto y el orden`.
  - `flush: un error no reintentable marca la captura como failed con su mensaje y sigue con las demás`.
  - `flush: ignora las failed; retry() la devuelve a pending; discard() la borra`.
  - `add usa el opId dado o genera uno`.
  - `backoffMs: 1000, 2000, 4000… con tope 30000`.
  - `isRetryable: TypeError de red → true; ApiError 400 → false; 401, 408, 429, 503 → true`.
  - `submitCapture: éxito → sent true y no encola; error de red → encola con el MISMO opId que se envió; ApiError 400 → se relanza y no se encola; ApiError 503 → encola`.
  - `respuesta perdida: post lanza TypeError tras haber "aplicado" en el servidor; flush reenvía con el mismo opId y el servidor falso (que deduplica) acaba con una sola nota`.
- [ ] **Step 2: Ejecutar** `npm test -- test/offline-queue.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar** según las firmas.
- [ ] **Step 4: Ejecutar.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(offline): cola de capturas con reenvío ordenado e idempotente (JARV-14)`

### Task 6: Adaptador IndexedDB y fallback de lectura

**Files:**
- Create: `web/src/offline/idb-store.ts`, `web/src/offline/reader.ts`
- Modify: `web/src/api.ts` (añadir `headers` opcional y gancho de lectura)
- Test: `test/offline-reader.test.ts`

**Interfaces:**
- Consumes: `Store`, `StoredNote`, `searchNotes`.
- Produces: `openIdbStore(name?: string): Promise<Store>` (nombre por defecto `"kioku-offline"`; almacenes `notes` con clave `path`, `meta` con clave `key`, `queue` con clave `opId`); `makeOfflineReader(store: Store): (path: string) => Promise<unknown | undefined>` que resuelve `/api/note?path=…` → `NoteInfo` (`web/src/types.ts`) y `/api/search?q=…&limit=…` → `SearchHit[]`, y devuelve `undefined` para cualquier otra ruta o si la nota no está; `export function setOfflineReader(fn: ((path: string) => Promise<unknown | undefined>) | null): void` y `api(method, path, body?, headers?)` en `api.ts`.
- Comportamiento de `NoteInfo` degradado: `note.title`/`type` salen del texto (cabecera `# `/nombre y `type:`), `tags: []`, `fm: {}`, `fmError: false`, y `backlinks`, `outgoing` y `unlinked` vacíos.

- [ ] **Step 1: Tests rojos:** `reader: /api/note devuelve el texto y el hash de la réplica, con relaciones vacías`; `reader: nota ausente → undefined`; `reader: /api/search usa searchNotes y respeta limit`; `reader: otras rutas → undefined`; `api(): si fetch falla con TypeError y hay lector que responde, devuelve su valor` (stub de `globalThis.fetch`); `api(): sin lector, o si el lector devuelve undefined, relanza el error`; `api(): una respuesta HTTP de error (p. ej. 404) NO usa el lector`; `api(): envía las cabeceras extra en un POST`.
- [ ] **Step 2: Ejecutar** `npm test -- test/offline-reader.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar.** En `api()`: envolver el `fetch` en `try`; solo si lanza (error de red) y `method === "GET"`, consultar el lector. `openIdbStore` no se prueba en Node (se valida en la Tarea 9).
- [ ] **Step 4: Ejecutar** el test y `npm run typecheck`. Expected: PASS y sin errores.
- [ ] **Step 5: Commit** `feat(offline): adaptador IndexedDB y lectura de notas y búsqueda sin red (JARV-14)`

### Task 7: Service worker

**Files:**
- Create: `web/src/sw-rules.ts`, `web/src/sw.ts`
- Modify: `scripts/build-web.mjs`, `src/server/server.ts` (solo si `/sw.js` no se sirve ya con `no-cache`; comprobarlo)
- Test: `test/sw-rules.test.ts`, `test/web-assets.test.ts` (añadir)

**Interfaces:**
- Produces (`sw-rules.ts`): `READ_TIMEOUT_MS = 3000`; `API_CACHE = "kioku-api"`; `cacheableRead(method: string, pathname: string): boolean` (GET bajo `/api/` excepto `/api/events`, `/api/health`, `/api/assistant*`, `/api/proposals*`, `/api/ai*`); `isShell(method: string, pathname: string): boolean` (GET que no empieza por `/api/`); `shellCacheName(buildId: string): string` → `` `kioku-shell-${buildId}` ``.
- `sw.ts` usa las constantes globales inyectadas por esbuild `__BUILD_ID__` (string) y `__PRECACHE__` (string[]): `/`, `/index.html`, `/app.js`, `/app.css`, `/manifest.webmanifest`, los iconos y las dos fuentes.

- [ ] **Step 1: Tests rojos:** `cacheableRead` verdadero para `GET /api/today`, `/api/note`, `/api/sync/manifest`; falso para `GET /api/events`, `/api/health`, `/api/assistant/status`, `/api/proposals`, `/api/ai`, y para cualquier `POST`; `isShell` verdadero para `GET /app.js` y falso para `/api/x` y para `POST /`; `shellCacheName("abc") === "kioku-shell-abc"`. En `web-assets.test.ts`: el script de build genera `sw.js` y define `__BUILD_ID__` y `__PRECACHE__`; `web/src/sw.ts` borra las cachés `kioku-shell-*` que no sean la actual (cadena `"kioku-shell-"` y `caches.delete`) y borra `API_CACHE` al recibir un 401.
- [ ] **Step 2: Ejecutar** `npm test -- test/sw-rules.test.ts test/web-assets.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar.** `sw.ts`: `install` precarga y hace `skipWaiting()`; `activate` borra cachés antiguas y hace `clients.claim()`; `fetch`: navegaciones → red con `READ_TIMEOUT_MS` y, si falla, `index.html` cacheado; resto del shell → caché primero; lecturas cacheables → red con `AbortController` a `READ_TIMEOUT_MS`, guardar copia si `res.ok`, y si falla servir la copia; 401 → `caches.delete(API_CACHE)`; todo lo demás sin interceptar. `build-web.mjs`: tras el build principal calcular `BUILD_ID` (SHA-256 de `app.js`, `app.css` e `index.html`, 12 caracteres) y compilar `web/src/sw.ts` a `dist/web/sw.js` (`format: "iife"`) con `define`.
- [ ] **Step 4: Ejecutar** los tests, `npm run typecheck` y `npm run build:web`; comprobar que `dist/web/sw.js` existe. Expected: PASS.
- [ ] **Step 5: Commit** `feat(offline): service worker con shell versionado y lecturas de respaldo (JARV-14)`

### Task 8: Integración en la interfaz

**Files:**
- Create: `web/src/offline/runtime.ts`
- Modify: `web/src/app.tsx` (arranque, `CaptureOverlay`, `MoreSheet`, barra inferior, manejo de `UNAUTHORIZED_EVENT`), `web/src/app.css`
- Test: `test/offline-runtime.test.ts` (solo lo puro) y `test/web-assets.test.ts`

**Interfaces:**
- Consumes: todo lo anterior, `isMobile()` de `web/src/role.ts`, `onChange` de `web/src/api.ts`.
- Produces (`runtime.ts`): `OfflineState { online: boolean; pending: number; failed: number; lastSync: number | null; syncing: boolean }`; `startOffline(): void` (solo si `isMobile()`: registra `/sw.js`, pide `navigator.storage.persist()`, abre el `Store`, instala el lector con `setOfflineReader`, y lanza sincronización y envío al abrir, al evento `online` y tras cada evento SSE con espera de 2 s); `syncNow(): Promise<void>` (réplica + precalentado de `/api/today`, `/api/tasks`, `/api/projects`, `/api/inbox`, `/api/notes`, `/api/graph` y el `/api/project?path=` de cada proyecto); `submit(text: string)` (usa `submitCapture` con `x-kioku-op`); `wipeOffline(): Promise<void>` (`store.clear()` + `caches.delete("kioku-api")`); `useOffline(): OfflineState`; `formatAgo(from: number, now: number): string` → «ahora», «hace 5 min», «hace 2 h», «hace 3 d».
- UI: franja `.offline-bar` («Sin conexión · datos de hace X») cuando `!online`; insignia con el número de pendientes en «Más» (barra inferior); en la hoja «Más»: pendientes y fallidas (reenviar/descartar), «Última sincronización: hace X», botón «Sincronizar ahora» y uso de almacenamiento (`navigator.storage.estimate()`); `CaptureOverlay` muestra «Guardada sin conexión; se enviará al abrir con red» cuando se encola; `UNAUTHORIZED_EVENT` llama a `wipeOffline()`.

- [ ] **Step 1: Tests rojos:** `formatAgo` (30 s → «ahora», 5 min, 2 h, 3 d, valores futuros → «ahora»); en `web-assets.test.ts`: `app.tsx` llama a `startOffline()` y usa `submit` en `CaptureOverlay`, y el CSS define `.offline-bar` y la insignia de pendientes dentro del bloque móvil.
- [ ] **Step 2: Ejecutar** los tests. Expected: FAIL.
- [ ] **Step 3: Implementar** `runtime.ts` y los cambios de UI listados. Sin cambios de comportamiento para el rol `full`.
- [ ] **Step 4: Ejecutar** `npm test`, `npm run typecheck`, `npm run build:web`. Expected: todo en verde.
- [ ] **Step 5: Commit** `feat(offline): arranque, captura con cola, indicadores y purga al revocar (JARV-14)`

### Task 9: E2E sin red, documentación y versión 0.6.0

**Files:**
- Create: script E2E en el scratchpad de la sesión (usa `lib.mjs`; no entra en el repositorio)
- Modify: `package.json` y `package-lock.json` (0.6.0), `CHANGELOG.md`, `README.md`, `docs/design/02-TRD-architecture.md` (D-21), `docs/validation.md`, el spec (ajustes de la sección «Global Constraints»)

- [ ] **Step 1: E2E con Chromium y bóveda temporal** (rol móvil, red cortada con `Network.emulateNetworkConditions`): con red, abrir la app y esperar a la sincronización; cortar la red y recargar → se ve Hoy, la lista de notas y una nota; la búsqueda devuelve resultados; capturar «prueba offline» → insignia de 1 pendiente; volver la red → tras el envío hay **una sola** nota nueva en Bandeja; capturar, cortar justo después de que el servidor responda (reenvío forzado con el mismo `opId`) → sigue habiendo una sola; una carpeta privada configurada nunca aparece en IndexedDB ni en las cachés; con `kioku pair --revoke` simulado (401) se vacían IndexedDB y cachés; tras reconstruir con otro `BUILD_ID`, la caché del shell antigua desaparece. Expected: sin errores de consola y ninguna petición a dominios externos.
- [ ] **Step 2: Docs.** D-21 (réplica, caché, cola, idempotencia, límites: sin sincronización en segundo plano, la copia local no se borra a distancia al revocar), CHANGELOG `[0.6.0]`, README (versión y funciones), `docs/validation.md` (qué se valida en iPhone: evicción de almacenamiento y envío al abrir), y corregir en el spec el formato de `paths` y la nota sobre `ops.json`.
- [ ] **Step 3: Verificación final** `npm test`, `npm run typecheck`, `npm run build:web` en verde.
- [ ] **Step 4: Commit** `docs: fase 2 móvil, offline (CHANGELOG, D-21, validación) y versión 0.6.0 (JARV-14)`
- [ ] **Step 5:** Pedir al usuario que pruebe en el iPhone (reinstalar no hace falta; cerrar y abrir la PWA). Merge, tag `v0.6.0` y push solo con su OK; cerrar JARV-14 en ProjectOS con los commits como evidencia.
