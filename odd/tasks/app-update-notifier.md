# Aviso de actualizaciones e instalación desde la app (`app-update-notifier`)

## Objetivo
Hacer que Kioku en escritorio compruebe de forma discreta y privada si hay cambios nuevos en `main` (`EzequielMenor/kioku`), avise en la interfaz cuándo hay actualización disponible y permita pulsar **«Actualizar ahora»** desde la propia app para descargar, reconstruir de forma atómica (manteniendo notas, claves y copia `.anterior-...`) y reiniciar el servicio/app.

## Problema y por qué
Hoy ni `Kioku.app` en macOS ni la instalación Linux guardan el commit instalado ni consultan GitHub, por lo que el usuario no sabe si su app quedó desactualizada tras subir cambios a `main` y tiene que ejecutar `install.sh --yes` manualmente en terminal.

## Alcance
- Estampado de metadatos de compilación/instalación (`build-info.json`) en macOS (`build-macos-app.mjs`, `install-macos.command`) y Linux (`install.sh`).
- Servicio backend `src/server/updates.ts` (detección vía feed Atom público de GitHub o JSON en pruebas, caché en `.kioku/update-check.json`, estado en vivo y lanzador seguro de actualización + reinicio).
- Rutas HTTP `/api/update/status`, `/api/update/check` y `/api/update/install` restringidas a escritorio (`role === "full"`, sin móvil ni compañero, y `localAdmin` + `{ confirm: true }` para instalar).
- UI en escritorio: tarjeta **Actualizaciones** en `Conexiones y sincronización` + barra discreta de aviso en `App` con recarga automática al volver el daemon.
- Documentación breve en `README.md` y `docs/macos-app.md`.

## Restricciones
- Cero telemetría ni datos locales enviados fuera; solo lectura anónima pública del feed de commits cuando el escritorio lo consulta (con caché de 6 h salvo petición manual).
- El móvil (`role: "mobile"`), el compañero (`companion`) y clientes remotos nunca pueden consultar ni disparar actualizaciones de sistema.
- No tocar `$KIOKU_HOME`, bóvedas reales, `~/.hermes` ni `~/.config`; probar siempre con carpetas temporales y runners/fetchers inyectados.
- Si corre en Docker o en un checkout `git` con cambios sin commitear, desactivar auto-instalación y mostrar el comando manual seguro.

## Checklist
- [x] **T1 — Metadatos de versión y commit (`build-info.json`)**: `src/server/build-info.ts`, `scripts/build-macos-app.mjs`, `scripts/install-macos.command`, `scripts/install.sh`, cubierto por tests.
  - Criterio: el tarball `tar.gz` de GitHub o repo `.git` resuelve el SHA de 40 caracteres y lo guarda en `build-info.json`; `build-macos-app.mjs` lo incluye en `Contents/Resources/app/build-info.json`.
- [x] **T2 — Motor de detección y actualización (`src/server/updates.ts`)**: caché, parser Atom/JSON, estados, guardado de errores, actualización atómica vía instalador y reinicio limpio.
  - Criterio: pruebas RED→GREEN verifican caché TTL, `force`, detección de commit nuevo vs igual, rechazo en `git` sucio/Docker y secuencia completa de actualización con runner falso sin tocar red real ni ficheros reales.
- [x] **T3 — API segura en `src/server/server.ts` y `src/server/mobile.ts`**: `/api/update/status`, `/api/update/check`, `/api/update/install`.
  - Criterio: `mobile`, `companion` y `POST /install` remoto o sin `confirm: true` devuelven `403`/`400`; `localAdmin` ejecuta flujo completo.
- [x] **T4 — UI en escritorio (`web/src/update-panel.tsx`, `web/src/app.tsx`, `web/src/connections.tsx`)**: banner discreto cuando hay actualización, tarjeta en `/conexiones` con «Buscar actualizaciones» y «Actualizar ahora», confirmación y recarga automática tras el reinicio.
  - Criterio: `npm run build:web` y pruebas de componente/modelo o API verifican el flujo sin regresiones en móvil ni modo demo.
- [x] **T5 — Documentación y validación integral**: `README.md`, `docs/macos-app.md`, `npm run typecheck`, `npm run build:web`, `npm test` y `git diff --check` en verde.

## Evidencia de verificación
- `git diff --check`: 0 errores.
- `npm run build:web`: compilado (`dist/web/app.js 983.2kb`, `dist/web/app.css 65.4kb`, `dist/web/quick.js 16.6kb`).
- `npm run typecheck`: 0 errores (`tsc --noEmit -p .`).
- `python3 -m unittest discover -s companion/overlay -p "test_*.py"`: `Ran 22 tests`, OK.
- `npm test`: 806 pruebas (`804 pass, 0 fail, 2 skipped` nativos de macOS en Linux), incluidas las 8 pruebas nuevas de `test/updates.test.ts` (stamp PAX, `readBuildInfo`, parser Atom, caché/TTL, seguridad 403 móvil/compañero/remoto, empaquetado `.app` y UI real en Chromium escritorio vs móvil).

## Progreso y siguiente paso
- Completado e integrado en `integration/kioku-1.0` y `main`. Pendiente únicamente validación final de `macos-validation.yml` tras el push.
