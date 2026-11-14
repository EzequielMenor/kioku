#!/bin/bash
# Instalador de Kioku para Mac (se abre con doble clic desde "Instalar Kioku.command").
# Sin Docker, sin Node previo y sin permisos de administrador: nada se instala fuera de ~/Applications/Kioku.app.
# La app se construye entera en una carpeta de preparación; la versión anterior no se toca hasta que la nueva está lista.
set -euo pipefail

# Versión de la aplicación ya validada en Mac (Intel y Apple Silicon). Se puede cambiar solo a propósito, con KIOKU_REF.
PINNED_REF="8580f9b89b4860d1406a5f79cd03551df85b2972"
REPO="${KIOKU_REPO:-EzequielMenor/kioku}"
REF="${KIOKU_REF:-$PINNED_REF}"
NODE_LINE="${KIOKU_NODE_LINE:-v24.x}"
APPS="$HOME/Applications"
APP_DEST="$APPS/Kioku.app"
WORKSPACE="$HOME/Library/Application Support/Kioku/Workspace"

usage() {
  cat <<EOF
Instalador de Kioku para Mac.

Uso: Instalar Kioku.command [--help]

Descarga Kioku y un Node.js oficial (verificado con el checksum de nodejs.org), construye la app y la
deja en ~/Applications/Kioku.app. Necesita Internet y unos minutos. Los datos de la app viven en
~/Library/Application Support/Kioku/Workspace y este instalador nunca los toca.

Si ya existe ~/Applications/Kioku.app pide confirmación (por defecto, no). Con la nueva app ya construida,
la anterior se aparta como Kioku.app.anterior-FECHA; no se borra. Si algo falla, se restaura.

La app no está firmada ni notarizada: macOS puede pedir confirmación al abrirla la primera vez
(clic derecho > Abrir, o Ajustes del Sistema > Privacidad y seguridad > Abrir igualmente).

Variables de entorno opcionales (para pruebas):
  KIOKU_REF=<commit|rama|etiqueta>   versión de Kioku (por defecto, el commit validado $PINNED_REF)
  KIOKU_REPO=<usuario/repositorio>   repositorio de GitHub (por defecto EzequielMenor/kioku)
  KIOKU_NODE_LINE=<vNN.x>            línea de Node.js, mínimo 24 (por defecto v24.x)
  KIOKU_INSTALL_NO_OPEN=1            no abrir la app al terminar
EOF
}

case "${1:-}" in
  "") ;;
  --help|-h) usage; exit 0 ;;
  *) echo "Opción desconocida: $1. Usa --help." >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { echo "Demasiados argumentos. Usa --help." >&2; exit 2; }

work=""; stage=""; backup=""; placed=0; apps_created=0
FOOTER="Nada de lo que ya tenías se ha modificado."

pause() { if [ -t 0 ]; then read -r -p "Pulsa Intro para cerrar. " _ || true; fi; }

# Solo deshace lo que este instalador movió: la versión anterior vuelve a su sitio si el destino sigue libre.
# La intención ($backup) se anota antes de mover; si la copia no existe, no se movió nada y no hay nada que restaurar.
restore_prior() {
  [ -n "$backup" ] && [ "$placed" != 1 ] || return 0
  if [ ! -d "$backup" ]; then
    backup=""; return 0
  elif [ ! -e "$APP_DEST" ] && [ ! -L "$APP_DEST" ] && mv "$backup" "$APP_DEST"; then
    FOOTER="Tu versión anterior sigue en $APP_DEST."
  else
    FOOTER="No pude devolver tu versión anterior a $APP_DEST. Sigue guardada en: $backup"
  fi
  backup=""
}

cleanup() {
  restore_prior
  [ -z "$work" ] || rm -rf "$work"
  [ -z "$stage" ] || rm -rf "$stage"
  if [ "$apps_created" = 1 ]; then rmdir "$APPS" 2>/dev/null || true; fi
}
trap cleanup EXIT
# Ctrl-C o cierre de la ventana: se deshace lo movido y se cuenta lo que pasó de verdad.
interrupted() {
  restore_prior
  if [ "$placed" = 1 ]; then
    echo "Instalación interrumpida cuando la nueva Kioku ya estaba colocada en $APP_DEST." >&2
    [ -z "$backup" ] || echo "Tu versión anterior está en: $backup" >&2
  else
    echo "Instalación interrumpida. $FOOTER" >&2
  fi
  exit 130
}
trap interrupted INT TERM HUP

fail() {
  restore_prior
  echo; echo "No se pudo instalar: $*" >&2; echo "$FOOTER" >&2
  pause; exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "este instalador es solo para macOS."
case "$(uname -m)" in
  arm64) NODE_ARCH="darwin-arm64" ;;
  x86_64) NODE_ARCH="darwin-x64" ;;
  *) fail "arquitectura no soportada: $(uname -m)." ;;
esac
# Los valores acaban en URLs: solo caracteres ordinarios.
case "$REPO" in *..*|*/*/*|*[!A-Za-z0-9._/-]*|/*|*/) fail "KIOKU_REPO no es válido." ;; */*) ;; *) fail "KIOKU_REPO no es válido." ;; esac
case "$REF" in ""|*..*|*[!A-Za-z0-9._/-]*|-*) fail "KIOKU_REF no es válido." ;; esac
case "$NODE_LINE" in v[0-9][0-9].x) [ "${NODE_LINE:1:2}" -ge 24 ] || fail "KIOKU_NODE_LINE debe ser v24.x o superior." ;; *) fail "KIOKU_NODE_LINE no es válido (ejemplo: v24.x)." ;; esac

# Un enlace en el destino o en su carpeta podría apuntar fuera de ~/Applications: no se sigue.
[ ! -L "$APPS" ] || fail "$APPS es un enlace simbólico; no instalo a través de enlaces."
[ ! -L "$APP_DEST" ] || fail "$APP_DEST es un enlace simbólico; no lo modifico."
had_prior=0
if [ -e "$APP_DEST" ]; then
  had_prior=1
  echo "Ya hay una Kioku en $APP_DEST."
  echo "Se guardará la anterior como copia junto a la nueva. Tus datos (Workspace, claves) no se tocan."
  answer=""; read -r -p "¿Reemplazarla? [s/N] " answer || true
  case "$answer" in
    s|S|si|SI|Si|sí|SÍ|Sí) ;;
    *) echo "No se ha instalado nada. Tu Kioku sigue como estaba."; exit 0 ;;
  esac
fi

echo "Instalando Kioku. Tarda unos minutos y necesita Internet."
[ "$REF" = "$PINNED_REF" ] || echo "Aviso: usando una versión distinta de la validada (KIOKU_REF=$REF)."
work="$(mktemp -d)"
if [ ! -d "$APPS" ]; then mkdir "$APPS" || fail "no pude crear $APPS."; apps_created=1; fi
stage="$(mktemp -d "$APPS/.Kioku-instalacion.XXXXXX")" || fail "no pude preparar una carpeta temporal en $APPS."

# 1) Node oficial, solo para construir (queda en una carpeta temporal y se borra al terminar).
index="https://nodejs.org/dist/latest-$NODE_LINE"
curl -fsSL --proto '=https' --tlsv1.2 "$index/SHASUMS256.txt" -o "$work/SHASUMS256.txt" || fail "no pude consultar nodejs.org."
file="$(awk -v a="$NODE_ARCH" '$2 ~ "^node-v[0-9.]+-" a "\\.tar\\.gz$" {print $2; exit}' "$work/SHASUMS256.txt")"
[ -n "$file" ] || fail "no encontré Node para $NODE_ARCH."
expected="$(awk -v f="$file" '$2 == f {print $1}' "$work/SHASUMS256.txt")"
echo "Descargando $file…"
curl -fsSL --proto '=https' --tlsv1.2 "$index/$file" -o "$work/node.tar.gz" || fail "falló la descarga de Node."
[ "$(shasum -a 256 "$work/node.tar.gz" | awk '{print $1}')" = "$expected" ] || fail "el checksum de Node no coincide; no se usa."
mkdir "$work/node" && tar -xzf "$work/node.tar.gz" -C "$work/node" --strip-components=1 || fail "no pude extraer Node."
export PATH="$work/node/bin:$PATH"
# Las cachés de npm se quedan en la carpeta temporal, no en tu usuario.
export npm_config_cache="$work/npm-cache" npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
node_version="$(node --version)" || fail "el Node descargado no se ejecuta en este Mac."
case "$node_version" in v2[4-9].*|v[3-9][0-9].*) ;; *) fail "se necesita Node 24 o superior (descargado: $node_version)." ;; esac
[ -f "$work/node/LICENSE" ] || fail "el paquete de Node no incluye su licencia."

# 2) Código de Kioku desde GitHub (codeload acepta commits, ramas y etiquetas).
echo "Descargando Kioku ($REF)…"
mkdir "$work/src"
curl -fsSL --proto '=https' --tlsv1.2 "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$work/src.tar.gz" \
  || fail "no pude descargar $REPO@$REF (¿el repositorio es privado o la versión no existe?)."
tar -xzf "$work/src.tar.gz" -C "$work/src" --strip-components=1 || fail "el código descargado no se puede extraer."

# 3) Dependencias, interfaz y .app, todo en la carpeta de preparación.
cd "$work/src"
echo "Preparando la aplicación…"
npm ci --silent || fail "falló npm ci."
npm run build:web --silent || fail "falló la compilación de la interfaz."
node scripts/build-macos-app.mjs --node "$work/node/bin/node" --output "$stage/Kioku.app" || fail "falló al crear la aplicación."
# El Node oficial exige distribuir su licencia y los avisos de terceros (el fichero LICENSE oficial los incluye).
cp "$work/node/LICENSE" "$stage/Kioku.app/Contents/Resources/runtime/LICENSE" || fail "no pude copiar la licencia de Node."
for part in Contents/MacOS/Kioku Contents/Resources/runtime/node; do
  [ -f "$stage/Kioku.app/$part" ] && [ -x "$stage/Kioku.app/$part" ] || fail "la aplicación construida está incompleta ($part)."
done

# 4) Colocación. Solo ahora se mueve la versión anterior, y se restaura si la nueva no llega a su sitio.
now_exists=0; if [ -e "$APP_DEST" ] || [ -L "$APP_DEST" ]; then now_exists=1; fi
[ "$now_exists" = "$had_prior" ] || fail "$APP_DEST cambió durante la instalación; no la modifico."
if [ "$had_prior" = 1 ]; then
  [ ! -L "$APP_DEST" ] || fail "$APP_DEST cambió durante la instalación; no la modifico."
  moved="$APP_DEST.anterior-$(date +%Y%m%d-%H%M%S)-$$"
  [ ! -e "$moved" ] && [ ! -L "$moved" ] || fail "ya existe la copia $moved."
  backup="$moved"
  mv "$APP_DEST" "$moved" || fail "no pude apartar la versión anterior."
  FOOTER="Tu versión anterior se movió a: $backup"
fi
mv "$stage/Kioku.app" "$APP_DEST" || fail "no pude colocar la aplicación nueva en $APP_DEST."
placed=1; apps_created=0

echo
echo "Listo: $APP_DEST"
[ -z "$backup" ] || echo "La versión anterior se guardó en: $backup (bórrala cuando quieras)."
echo "Los datos de esta app viven en: $WORKSPACE (no se ha tocado nada de ahí)."
echo "Si macOS pide confirmación al abrirla la primera vez: clic derecho > Abrir."
if [ "${KIOKU_INSTALL_NO_OPEN:-}" = 1 ]; then
  echo "No se abre la app (KIOKU_INSTALL_NO_OPEN=1)."
elif ! open "$APP_DEST"; then
  echo "Kioku está instalado, pero no pude abrirlo automáticamente. Ábrelo desde $APPS." >&2
fi
