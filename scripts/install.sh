#!/bin/bash
# Instalador único de Kioku para macOS y Linux.
# Uso rápido: curl -fsSL https://raw.githubusercontent.com/EzequielMenor/kioku/main/scripts/install.sh | bash
set -euo pipefail

REPO="${KIOKU_REPO:-EzequielMenor/kioku}"
REF="${KIOKU_REF:-main}"
NODE_LINE="${KIOKU_NODE_LINE:-v24.x}"
INSTALL_DIR="${KIOKU_INSTALL_DIR:-$HOME/.local/share/kioku}"
BIN_DIR="${KIOKU_BIN_DIR:-$HOME/.local/bin}"
YES="${KIOKU_INSTALL_YES:-0}"
NO_OPEN="${KIOKU_INSTALL_NO_OPEN:-0}"
NO_SERVICE="${KIOKU_INSTALL_NO_SERVICE:-0}"

usage() {
  cat <<EOF
Instalador de Kioku (macOS y Linux).

Uso: install.sh [--yes] [--no-open] [--no-service] [--help]

  --yes, -y       Acepta reemplazar instalación previa y activar arranque automático (Linux)
  --no-open       No abre Kioku al terminar
  --no-service    En Linux, no configura el servicio de usuario systemd
  --help, -h      Muestra esta ayuda sin usar la red

Variables opcionales:
  KIOKU_REPO=<usuario/repo>    Repositorio GitHub (por defecto EzequielMenor/kioku)
  KIOKU_REF=<rama|commit|tag>  Versión a instalar (por defecto main)
  KIOKU_NODE_LINE=<vNN.x>      Línea de Node.js si hace falta descargarlo (por defecto v24.x)
  KIOKU_INSTALL_DIR=<ruta>     Carpeta de instalación en Linux (por defecto ~/.local/share/kioku)
  KIOKU_BIN_DIR=<ruta>         Carpeta del comando kioku en Linux (por defecto ~/.local/bin)
  KIOKU_INSTALL_YES=1          Igual que --yes
  KIOKU_INSTALL_NO_OPEN=1      Igual que --no-open
  KIOKU_INSTALL_NO_SERVICE=1   Igual que --no-service
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --no-open) NO_OPEN=1 ;;
    --no-service) NO_SERVICE=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Opción desconocida: $1. Usa --help." >&2; exit 2 ;;
  esac
  shift
done

case "$REPO" in *..*|*/*/*|*[!A-Za-z0-9._/-]*|/*|*/) echo "No se pudo instalar: KIOKU_REPO no es válido." >&2; exit 1 ;; */*) ;; *) echo "No se pudo instalar: KIOKU_REPO no es válido." >&2; exit 1 ;; esac
case "$REF" in ""|*..*|*[!A-Za-z0-9._/-]*|-*) echo "No se pudo instalar: KIOKU_REF no es válido." >&2; exit 1 ;; esac
case "$NODE_LINE" in v[0-9][0-9].x) [ "${NODE_LINE:1:2}" -ge 24 ] || { echo "No se pudo instalar: KIOKU_NODE_LINE debe ser v24.x o superior." >&2; exit 1; } ;; *) echo "No se pudo instalar: KIOKU_NODE_LINE no es válido (ejemplo: v24.x)." >&2; exit 1 ;; esac

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  here=""
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  fi
  mac_tmp=""
  cleanup_mac() { [ -z "$mac_tmp" ] || rm -rf "$mac_tmp"; }
  trap cleanup_mac EXIT
  if [ -n "$here" ] && [ -f "$here/install-macos.command" ]; then
    mac_script="$here/install-macos.command"
  else
    tmpbase="${TMPDIR:-/tmp}"; tmpbase="${tmpbase%/}"
    mac_tmp="$(mktemp -d "$tmpbase/kioku-instalador.XXXXXX")"
    mac_script="$mac_tmp/install-macos.command"
    curl -fsSL --proto '=https' --tlsv1.2 "https://raw.githubusercontent.com/$REPO/$REF/scripts/install-macos.command" -o "$mac_script" \
      || { echo "No se pudo descargar el instalador de macOS desde $REPO@$REF." >&2; exit 1; }
  fi
  mac_env=(KIOKU_REPO="$REPO" KIOKU_REF="$REF" KIOKU_NODE_LINE="$NODE_LINE")
  [ -n "${KIOKU_MAC_APPS_DIR:-}" ] && mac_env+=(KIOKU_MAC_APPS_DIR="$KIOKU_MAC_APPS_DIR")
  [ "$NO_OPEN" = 1 ] && mac_env+=(KIOKU_INSTALL_NO_OPEN=1)
  [ "$YES" = 1 ] && mac_env+=(KIOKU_INSTALL_YES=1)
  if [ ! -t 0 ] && [ "$YES" != 1 ] && [ -r /dev/tty ]; then
    env "${mac_env[@]}" /bin/bash "$mac_script" < /dev/tty
  else
    env "${mac_env[@]}" /bin/bash "$mac_script"
  fi
  exit $?
fi

[ "$OS" = "Linux" ] || { echo "No se pudo instalar: sistema operativo no soportado ($OS)." >&2; exit 1; }
case "$(uname -m)" in
  x86_64|amd64) NODE_ARCH="linux-x64" ;;
  aarch64|arm64) NODE_ARCH="linux-arm64" ;;
  *) echo "No se pudo instalar: arquitectura no soportada ($(uname -m))." >&2; exit 1 ;;
esac

work=""; stage=""; backup=""; placed=0; parent_created=0
FOOTER="Nada de lo que ya tenías se ha modificado."

restore_prior() {
  [ -n "$backup" ] && [ "$placed" != 1 ] || return 0
  if [ ! -d "$backup" ]; then
    backup=""; return 0
  elif [ ! -e "$INSTALL_DIR" ] && [ ! -L "$INSTALL_DIR" ] && mv "$backup" "$INSTALL_DIR"; then
    FOOTER="Tu versión anterior sigue en $INSTALL_DIR."
  else
    FOOTER="No pude devolver tu versión anterior a $INSTALL_DIR. Sigue guardada en: $backup"
  fi
  backup=""
}
cleanup() {
  restore_prior
  [ -z "$work" ] || rm -rf "$work"
  [ -z "$stage" ] || rm -rf "$stage"
  if [ "$parent_created" = 1 ]; then rmdir "$(dirname "$INSTALL_DIR")" 2>/dev/null || true; fi
}
trap cleanup EXIT
interrupted() {
  restore_prior
  echo "Instalación interrumpida. $FOOTER" >&2
  exit 130
}
trap interrupted INT TERM HUP
fail() {
  restore_prior
  echo; echo "No se pudo instalar: $*" >&2; echo "$FOOTER" >&2
  exit 1
}

INSTALL_PARENT="$(dirname "$INSTALL_DIR")"
[ ! -L "$INSTALL_PARENT" ] || fail "$INSTALL_PARENT es un enlace simbólico; no instalo a través de enlaces."
[ ! -L "$INSTALL_DIR" ] || fail "$INSTALL_DIR es un enlace simbólico; no lo modifico."
[ ! -L "$BIN_DIR" ] || fail "$BIN_DIR es un enlace simbólico; no instalo a través de enlaces."
if [ -L "$BIN_DIR/kioku" ]; then
  cur_target="$(readlink "$BIN_DIR/kioku" || true)"
  [ "$cur_target" = "$INSTALL_DIR/bin/kioku" ] || fail "$BIN_DIR/kioku ya es un enlace simbólico a otro destino ($cur_target)."
elif [ -e "$BIN_DIR/kioku" ]; then
  fail "$BIN_DIR/kioku ya existe y no es un enlace de Kioku."
fi

had_prior=0
[ -e "$INSTALL_DIR" ] && had_prior=1

tmpbase="${TMPDIR:-/tmp}"; tmpbase="${tmpbase%/}"
work="$(mktemp -d "$tmpbase/kioku-linux-work.XXXXXX")" || fail "no pude crear una carpeta temporal en ${tmpbase}."
if [ ! -d "$INSTALL_PARENT" ]; then mkdir -p "$INSTALL_PARENT" || fail "no pude crear $INSTALL_PARENT."; parent_created=1; fi
stage="$(mktemp -d "$INSTALL_PARENT/.kioku-linux-stage.XXXXXX")" || fail "no pude preparar carpeta temporal en $INSTALL_PARENT."

echo "Instalando Kioku en $INSTALL_DIR…"
# 1) Node 24+: usa el del sistema si sirve; si no, descarga uno privado y verificado dentro de $INSTALL_DIR/runtime.
sys_node_ok=0
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  case "$(node --version 2>/dev/null || true)" in v2[4-9].*|v[3-9][0-9].*) sys_node_ok=1 ;; esac
fi

node_bin_dir=""
if [ "$sys_node_ok" = 1 ]; then
  node_bin_dir="$(dirname "$(command -v node)")"
else
  index="https://nodejs.org/dist/latest-$NODE_LINE"
  curl -fsSL --proto '=https' --tlsv1.2 "$index/SHASUMS256.txt" -o "$work/SHASUMS256.txt" || fail "no pude consultar nodejs.org."
  file="$(awk -v a="$NODE_ARCH" '$2 ~ "^node-v[0-9.]+-" a "\\.tar\\.gz$" {print $2; exit}' "$work/SHASUMS256.txt")"
  [ -n "$file" ] || fail "no encontré Node para $NODE_ARCH."
  expected="$(awk -v f="$file" '$2 == f {print $1}' "$work/SHASUMS256.txt")"
  echo "Descargando $file…"
  curl -fsSL --proto '=https' --tlsv1.2 "$index/$file" -o "$work/node.tar.gz" || fail "falló la descarga de Node."
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$work/node.tar.gz" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$work/node.tar.gz" | awk '{print $1}')"
  else
    fail "falta sha256sum o shasum para verificar Node."
  fi
  [ "$actual" = "$expected" ] || fail "el checksum de Node no coincide; no se usa."
  mkdir "$work/node" && tar -xzf "$work/node.tar.gz" -C "$work/node" --strip-components=1 || fail "no pude extraer Node."
  [ -x "$work/node/bin/node" ] && [ -f "$work/node/LICENSE" ] || fail "el paquete de Node descargado está incompleto."
  case "$("$work/node/bin/node" --version)" in v2[4-9].*|v[3-9][0-9].*) ;; *) fail "se necesita Node 24 o superior." ;; esac
  node_bin_dir="$work/node/bin"
fi

private_env() {
  env PATH="$node_bin_dir:$PATH" npm_config_cache="$work/npm-cache" npm_config_update_notifier=false \
    npm_config_fund=false npm_config_audit=false NODE_COMPILE_CACHE="$work/node-compile-cache" "$@"
}

# 2) Código de Kioku y compilación en staging.
echo "Descargando Kioku ($REF)…"
curl -fsSL --proto '=https' --tlsv1.2 "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$work/src.tar.gz" \
  || fail "no pude descargar $REPO@$REF."
mkdir "$stage/kioku"
tar -xzf "$work/src.tar.gz" -C "$stage/kioku" --strip-components=1 || fail "el código descargado no se puede extraer."

cd "$stage/kioku"
echo "Preparando la aplicación…"
private_env npm ci --silent || fail "falló npm ci."
private_env npm run build:web --silent || fail "falló la compilación de la interfaz."
if [ -f "$stage/kioku/src/server/build-info.ts" ]; then
  private_env node --no-warnings --input-type=module -e '
    import fs from "node:fs";
    import { extractCommitFromTarGz, readBuildInfo } from "./src/server/build-info.ts";
    const [tarPath, repo, ref, installDir, binDir] = process.argv.slice(1);
    const info = readBuildInfo(".", { inDocker: false });
    const commit = extractCommitFromTarGz(tarPath) || info.commit;
    fs.writeFileSync("build-info.json", JSON.stringify({
      version: info.version, commit, ref, repo, channel: "linux-install",
      installDir, binDir, installedAt: new Date().toISOString(),
    }));
  ' "$work/src.tar.gz" "$REPO" "$REF" "$INSTALL_DIR" "$BIN_DIR" 2>/dev/null || true
fi
if [ "$sys_node_ok" != 1 ]; then
  mv "$work/node" "$stage/kioku/runtime" || fail "no pude incluir el runtime de Node."
fi

# 3) Colocación atómica sin tocar $KIOKU_HOME ni datos existentes.
if [ "$had_prior" = 1 ]; then
  moved="$INSTALL_DIR.anterior-$(date +%Y%m%d-%H%M%S)-$$"
  [ ! -e "$moved" ] && [ ! -L "$moved" ] || fail "ya existe la copia $moved."
  backup="$moved"
  mv "$INSTALL_DIR" "$moved" || fail "no pude apartar la versión anterior."
  FOOTER="Tu versión anterior se guardó en: $backup"
fi
mv "$stage/kioku" "$INSTALL_DIR" || fail "no pude colocar Kioku en $INSTALL_DIR."
placed=1; parent_created=0

mkdir -p "$BIN_DIR"
ln -sfn "$INSTALL_DIR/bin/kioku" "$BIN_DIR/kioku"

# 4) Servicio de usuario opcional (systemd) para arranque automático.
if [ "$NO_SERVICE" != 1 ] && command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  install_svc=0
  if [ "$YES" = 1 ]; then
    install_svc=1
  elif [ -t 0 ] || [ -r /dev/tty ]; then
    ans=""
    if [ -t 0 ]; then read -r -p "¿Activar arranque automático con tu sesión (systemd)? [S/n] " ans || true
    else read -r -p "¿Activar arranque automático con tu sesión (systemd)? [S/n] " ans < /dev/tty || true; fi
    case "$ans" in ""|s|S|si|SI|Si|sí|SÍ|Sí) install_svc=1 ;; esac
  fi
  if [ "$install_svc" = 1 ]; then
    "$BIN_DIR/kioku" service install || echo "Aviso: no pude activar el servicio systemd (puedes ejecutar: kioku service install)." >&2
  fi
fi

echo
echo "Listo: $BIN_DIR/kioku"
[ -z "$backup" ] || echo "La versión anterior se guardó en: $backup (bórrala cuando quieras)."
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Añade $BIN_DIR a tu PATH si no lo está (ej.: export PATH=\"$BIN_DIR:\$PATH\")." ;;
esac
echo "Tus notas viven en: ${KIOKU_HOME:-$HOME/Documents/Kioku} (no se ha tocado nada de ahí)."
echo "Para conectar otros dispositivos desde la app: abre Conexiones y sincronización (o ejecuta: kioku open /conexiones)."

if [ "$NO_OPEN" != 1 ]; then
  "$BIN_DIR/kioku" open /conexiones || echo "Kioku está instalado, pero no pude abrir el navegador automáticamente. Ejecuta: kioku open /conexiones" >&2
fi
