# Actualizar el servicio de Kioku (Linux) y volver atrás

Procedimiento para pasar el servicio de usuario `kioku.service` a una versión nueva **sin tocar el checkout que usa hoy**, con copia de seguridad previa y vuelta atrás en un minuto. Pensado para una unidad escrita a mano que ejecuta `src/cli/main.ts daemon` desde un checkout (no para la instalada con `kioku service install`, que regenera su propia unidad).

Los comandos asumen la unidad habitual (`~/.config/systemd/user/kioku.service`, datos en `~/Documents/Kioku`, puerto 47800). Ajusta las rutas a tu caso.

## Cómo funciona el servicio

- La unidad ejecuta `node --no-warnings <checkout>/src/cli/main.ts daemon` con `KIOKU_HOME` (tus datos) y `KIOKU_ALLOWED_HOSTS` en `Environment=`. No hay paso de compilación para el daemon: **lo que haya en esa carpeta es lo que corre**. Lo único que se compila es la web (`npm run build:web` → `dist/web`), que el daemon sirve desde el mismo checkout.
- Por eso un `git checkout` en el checkout del servicio cambia el código en caliente en el siguiente reinicio, y por eso el procedimiento usa **otro checkout** y solo cambia la ruta de `ExecStart`.
- `Restart=on-failure`: si la versión nueva no arranca, systemd la reintenta en bucle cada 2 s. Compruébalo en el paso 4.

## Qué hay que respaldar

| Qué | Dónde | Por qué |
|---|---|---|
| Tus notas, bases y adjuntos | `~/Documents/Kioku/` (todo salvo `.kioku/`) | Es tu contenido. La actualización no lo modifica, pero es lo irrecuperable. |
| Credenciales y estado del daemon | `~/Documents/Kioku/.kioku/` : `secret`, `secret-mobile`, `vapid.json`, `push-subscriptions.json`, `mobile.json`, `ops.json`, `notify-*.json`, `trash/`, `hermes/` | `kioku export` **deja fuera** `secret`, `secret-mobile` y `runtime.json` a propósito. Sin ellos hay que volver a emparejar el móvil. |
| Conversaciones del asistente | `.kioku/conversations/` | Lo nuevo de esta versión; se crea al primer uso. |
| Credencial del compañero | `.kioku/secret-companion` | Se regenera con `kioku companion`; no hace falta respaldarla. |
| Índice | `.kioku/index.db*` | **No**: es derivado y se reconstruye. Mismo esquema (v2) en la versión anterior y en esta, así que volver atrás no obliga a reindexar. |
| La unidad | `~/.config/systemd/user/kioku.service` | Es lo único que se cambia. |
| Asistente de pago / Hermes | `~/.hermes/` (`auth.json`, `config.yaml`, memoria) | No lo toca la actualización; respáldalo si dependes de la sesión de Codex (la credencial vive ahí). |

> Los respaldos completos contienen claves privadas (`secret*`, `vapid.json`). Guárdalos con permisos `600`/`700` y fuera de carpetas sincronizadas.

## 1. Respaldo (con el servicio encendido)

```bash
set -e
STAMP=$(date +%Y%m%dT%H%M%S); B=~/Backups/kioku-$STAMP; mkdir -p "$B"; chmod 700 "$B"

# a) Estado completo, para volver exactamente a como estaba (sin el índice derivado)
tar -czf "$B/vault-completo.tar.gz" --exclude='.kioku/index.db*' --exclude='.kioku/runtime.json' -C ~/Documents Kioku
# b) Exportación portable de Kioku (sin claves), comprobable con `kioku restore`
KIOKU_HOME=~/Documents/Kioku node --no-warnings ~/Proyectos/Kioku/src/cli/main.ts export "$B/vault-portable.tar.gz"
# c) Unidad y estado del código actual
cp ~/.config/systemd/user/kioku.service "$B/kioku.service.orig"
git -C ~/Proyectos/Kioku rev-parse HEAD > "$B/checkout-HEAD.txt"
git -C ~/Proyectos/Kioku diff HEAD > "$B/checkout-cambios-sin-commit.patch"
git -C ~/Proyectos/Kioku status --short > "$B/checkout-status.txt"
chmod 600 "$B"/*
ls -la "$B"
```

Comprueba que el portable se restaura (no toca nada tuyo):

```bash
T=$(mktemp -d) && node --no-warnings ~/Proyectos/Kioku/src/cli/main.ts restore "$B/vault-portable.tar.gz" "$T/vault" && ls "$T/vault" | head
```

## 2. Preparar la versión nueva (sin afectar al servicio)

Un checkout aparte y estable, fijado a una etiqueta:

```bash
git -C ~/Proyectos/Kioku worktree add --detach ~/Proyectos/Kioku-release kioku-1.0-rc1
cd ~/Proyectos/Kioku-release
npm ci && npm run build:web
npm run typecheck && npm test        # opcional; la suite abre Chromium sin ventana
```

Prueba de humo en un vault temporal y otro puerto (el servicio real sigue intacto en el 47800):

```bash
T=$(mktemp -d); KIOKU_HOME=$T KIOKU_PORT=47990 node --no-warnings src/cli/main.ts daemon &
sleep 2; curl -s http://127.0.0.1:47990/api/health      # {"ok":true}
kill %1
```

## 3. Cambiar de versión

Un único cambio: la ruta del `ExecStart`. `KIOKU_HOME` y `KIOKU_ALLOWED_HOSTS` se conservan.

```bash
U=~/.config/systemd/user/kioku.service
cp "$U" "$U.bak-antes-1.0"
sed -i 's#/home/eze/Proyectos/Kioku/src/cli/main.ts#/home/eze/Proyectos/Kioku-release/src/cli/main.ts#' "$U"
grep ExecStart "$U"                       # debe apuntar a Kioku-release
systemctl --user daemon-reload
systemctl --user restart kioku.service
```

## 4. Comprobar

```bash
systemctl --user is-active kioku.service                  # active
systemctl --user show kioku.service -p NRestarts          # 0: no está en bucle
journalctl --user -u kioku.service -n 5 --no-pager        # «Kioku escuchando en http://127.0.0.1:47800 (datos: …)»
curl -s http://127.0.0.1:47800/api/health                 # {"ok":true}
~/Proyectos/Kioku-release/bin/kioku assistant status      # motor, proveedor y destino reales
```

En el navegador: abre Kioku (`kioku open`), comprueba que ves tus notas, que Hoy y el calendario cargan, y que la pestaña Asistente contesta con el proveedor elegido.

## 5. Kio en el escritorio (manual: toca tu pantalla)

Requisitos: `sudo pacman -S --needed gtk4 gtk4-layer-shell python-gobject python-cairo` (los instalas tú).

```bash
~/Proyectos/Kioku-release/bin/kioku companion          # lanza a Kio; comprueba los requisitos
~/Proyectos/Kioku-release/bin/kioku companion status
```

Lista de comprobación (ver también `docs/companion.md`):

1. Kio aparece abajo a la derecha y no te quita el foco del teclado.
2. Clic en Kio: se abre el panel y recibe el teclado; clic en otra ventana: el teclado vuelve a ella.
3. Escribe una frase en el panel y abre Kioku en el navegador → misma conversación (pestaña Asistente).
4. Escribe otra en la web → aparece en el panel de Kio sin recargar.
5. Pide algo que borre o mueva una nota: llega como propuesta y pide confirmar.
6. `kioku companion focus` (concentración) y `kioku companion toggle` (ocultar y traer).
7. Pantalla completa en el mismo monitor: Kio queda tapado y reaparece al salir.
8. `kioku companion stop --revoke`: Kio desaparece y su credencial deja de valer.

Los atajos de Hyprland (`contrib/hyprland-bind.lua`) y el arranque con la sesión los añades tú; apunta las rutas a `Kioku-release/bin/kioku`.

## Volver atrás

Cambia solo la unidad; el código y el checkout anteriores siguen donde estaban.

```bash
U=~/.config/systemd/user/kioku.service
systemctl --user stop kioku.service
cp "$U.bak-antes-1.0" "$U"                 # o: cp ~/Backups/kioku-<fecha>/kioku.service.orig "$U"
systemctl --user daemon-reload
systemctl --user start kioku.service
curl -s http://127.0.0.1:47800/api/health
```

La versión anterior ignora los ficheros nuevos de `.kioku/` (`conversations/`, `secret-companion`, `assistant.json`) y reutiliza el mismo índice. Si Kio estaba en marcha, ciérralo antes: `kioku companion stop`.

### Si los datos quedaron mal (último recurso)

```bash
systemctl --user stop kioku.service
mv ~/Documents/Kioku ~/Documents/Kioku.roto-$(date +%s)        # no se borra nada
tar -xzf ~/Backups/kioku-<fecha>/vault-completo.tar.gz -C ~/Documents
systemctl --user start kioku.service                            # el índice se reconstruye al abrir
```

## Qué no cubre este procedimiento

- No instala ni configura Ollama ni cambia el proveedor del asistente: eso se decide aparte (`docs/assistant-local.md`).
- Los ensayos se hicieron con un vault restaurado y un modelo simulado; la validación con el proveedor real queda anotada en `docs/validation.md`.
