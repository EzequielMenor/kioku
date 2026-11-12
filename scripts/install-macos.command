#!/bin/bash
# Instalador de Kioku para Mac (doble clic). Sin Docker, sin Node previo, sin sudo.
# Todo queda en ~/Library/Application Support/Kioku y ~/Applications/Kioku.app.
# No toca tu instalación actual de Kioku, su bóveda ni tus claves.
set -euo pipefail

REPO="${KIOKU_REPO:-EzequielMenor/kioku}"
REF="${KIOKU_REF:-feat/JARV-38-private-setup-ui}"
NODE_LINE="${KIOKU_NODE_LINE:-v24.x}"
BASE="$HOME/Library/Application Support/Kioku"
APP_DEST="$HOME/Applications/Kioku.app"

fail() { echo; echo "No se pudo instalar: $*" >&2; echo "Nada de lo que ya tenías se ha modificado." >&2; read -r -p "Pulsa Intro para cerrar. " _ || true; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "este instalador es solo para macOS."
case "$(uname -m)" in
  arm64) NODE_ARCH="darwin-arm64" ;;
  x86_64) NODE_ARCH="darwin-x64" ;;
  *) fail "arquitectura no soportada: $(uname -m)." ;;
esac

echo "Instalando Kioku. Tarda unos minutos y necesita Internet."
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$BASE" "$HOME/Applications"

# 1) Node oficial, verificado con el checksum publicado por nodejs.org (queda solo dentro de Kioku).
index="https://nodejs.org/dist/latest-$NODE_LINE"
curl -fsSL "$index/SHASUMS256.txt" -o "$work/SHASUMS256.txt" || fail "no pude consultar nodejs.org."
file="$(awk -v a="$NODE_ARCH" '$2 ~ "^node-v[0-9.]+-" a "\\.tar\\.gz$" {print $2; exit}' "$work/SHASUMS256.txt")"
[ -n "$file" ] || fail "no encontré Node para $NODE_ARCH."
expected="$(awk -v f="$file" '$2 == f {print $1}' "$work/SHASUMS256.txt")"
echo "Descargando $file…"
curl -fsSL "$index/$file" -o "$work/node.tar.gz" || fail "falló la descarga de Node."
[ "$(shasum -a 256 "$work/node.tar.gz" | awk '{print $1}')" = "$expected" ] || fail "el checksum de Node no coincide; no se usa."
mkdir "$work/node" && tar -xzf "$work/node.tar.gz" -C "$work/node" --strip-components=1
export PATH="$work/node/bin:$PATH"

# 2) Código de Kioku desde GitHub.
echo "Descargando Kioku ($REF)…"
mkdir "$work/src"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF" | tar -xz -C "$work/src" --strip-components=1 \
  || fail "no pude descargar $REPO@$REF (¿el repositorio es privado?)."

# 3) Dependencias y interfaz.
cd "$work/src"
echo "Preparando la aplicación…"
npm ci --silent || fail "falló npm ci."
npm run build:web --silent || fail "falló la compilación de la interfaz."

# 4) Aplicación .app. Una versión anterior se aparta, nunca se borra.
if [ -e "$APP_DEST" ]; then
  mv "$APP_DEST" "$APP_DEST.anterior-$(date +%Y%m%d-%H%M%S)"
  echo "La versión anterior se guardó junto a la nueva."
fi
node scripts/build-macos-app.mjs --node "$work/node/bin/node" --output "$APP_DEST" || fail "falló al crear la aplicación."
xattr -dr com.apple.quarantine "$APP_DEST" 2>/dev/null || true

echo
echo "Listo: $APP_DEST"
echo "Tus datos de esta app viven en: $BASE/Workspace (separados de cualquier otra instalación)."
open "$APP_DEST" || true
