#!/bin/bash
# Doble clic para instalar Kioku en este Mac. Ver: Instalar Kioku.command --help
set -euo pipefail
here="$(cd -- "$(dirname -- "$0")" && pwd)"
exec /bin/bash "$here/scripts/install-macos.command" "$@"
