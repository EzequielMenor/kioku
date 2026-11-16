#!/bin/bash
# Construye la Kioku.app NATIVA en un Mac: Kio (Swift, macos/) + la CLI y el daemon de Kioku con su Node incluido
# + la interfaz web. No instala nada global ni toca ~/Applications: deja la app donde digas.
#
#   scripts/build-macos-native.sh --node RUTA/node --output DESTINO/Kioku.app [--scratch CARPETA] [--license LICENSE_DE_NODE]
#
# Requisitos: macOS 13+, las herramientas de Xcode (xcode-select --install), las dependencias del proyecto
# (npm ci) y un Node 24+ OFICIAL de nodejs.org para copiarlo dentro (uno de Homebrew depende de bibliotecas de
# Homebrew y la app dejaría de arrancar si las actualizas). El instalador («Instalar Kioku.command») ya hace todo esto.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin=""; out=""; scratch=""; license=""
while [ $# -gt 0 ]; do
  case "$1" in
    --node) node_bin="${2:-}"; shift 2 ;;
    --output) out="${2:-}"; shift 2 ;;
    --scratch) scratch="${2:-}"; shift 2 ;;
    --license) license="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $1 (usa --help)" >&2; exit 2 ;;
  esac
done
[ "$(uname -s)" = "Darwin" ] || { echo "Solo en macOS." >&2; exit 1; }
[ -n "$node_bin" ] && [ -n "$out" ] || { echo "Uso: $0 --node RUTA/node --output DESTINO/Kioku.app" >&2; exit 2; }
xcode-select -p >/dev/null 2>&1 || { echo "Faltan las herramientas de Xcode: ejecuta «xcode-select --install» y vuelve a intentarlo." >&2; exit 1; }
swift_bin="$(xcrun --find swift)"
scratch="${scratch:-$root/macos/.build}"

cd "$root"
[ -f dist/web/index.html ] || { echo "Falta la interfaz compilada: ejecuta npm ci && npm run build:web." >&2; exit 1; }

echo "Compilando Kio (Swift, release)…"
"$swift_bin" build -c release --package-path macos --scratch-path "$scratch"
bin_dir="$("$swift_bin" build -c release --package-path macos --scratch-path "$scratch" --show-bin-path)"
kio="$bin_dir/Kioku"
[ -x "$kio" ] || { echo "No encuentro el ejecutable compilado ($kio)." >&2; exit 1; }

tmp="$(mktemp -d "${TMPDIR:-/tmp}/kioku-icono.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
icon_args=()
if "$kio" --render-iconset "$tmp/Kioku.iconset" "$root/companion/character.json" && /usr/bin/iconutil -c icns "$tmp/Kioku.iconset" -o "$tmp/Kioku.icns"; then
  icon_args=(--icon "$tmp/Kioku.icns")
else
  echo "Aviso: no pude generar el icono; la app usará el genérico." >&2
fi

"$node_bin" scripts/build-macos-app.mjs --node "$node_bin" --output "$out" --kio "$kio" ${icon_args[@]+"${icon_args[@]}"}
# El Node oficial exige distribuir su licencia y avisos de terceros junto al runtime.
[ -z "$license" ] || cp "$license" "$out/Contents/Resources/runtime/LICENSE"
# Firma ad hoc (sin certificado): sella el paquete completo (ejecutable, Info.plist y recursos) para que macOS lo trate como una app íntegra.
/usr/bin/codesign --force --deep --sign - "$out" >/dev/null 2>&1 || echo "Aviso: no pude firmar ad hoc la app." >&2
echo "Listo: $out"
