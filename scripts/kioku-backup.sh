#!/bin/bash
# Export only: never stop, start, restore or remove containers or volumes.
set -euo pipefail
umask 077
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
usage() { echo "Uso: bash scripts/kioku-backup.sh /ruta/absoluta/copia-nueva"; }
if [ "${1:-}" = "--help" ]; then usage; exit 0; fi
if [ "$#" -ne 1 ]; then usage >&2; exit 1; fi
dest="$1"
case "$dest" in /*) ;; *) echo "El destino debe ser una ruta absoluta nueva fuera del repositorio." >&2; exit 1 ;; esac
parent="$(cd -- "$(dirname -- "$dest")" && pwd -P)"
name="$(basename -- "$dest")"
case "$name" in .|..|/) echo "Destino inválido." >&2; exit 1 ;; esac
dest="$parent/$name"
case "$dest/" in "$project_dir/"*) echo "Guarda la copia fuera del repositorio." >&2; exit 1 ;; esac
if [ -e "$dest" ] || [ -L "$dest" ]; then echo "El destino ya existe; no se sobrescribe." >&2; exit 1; fi
container="$(docker compose -f "$project_dir/compose.local.yml" ps --all --quiet kioku)"
if [ -z "$container" ] || [[ "$container" == *$'\n'* ]]; then echo "Se necesita exactamente un contenedor Kioku existente." >&2; exit 1; fi
state="$(docker inspect --format '{{.State.Status}}' "$container")"
if [ "$state" != "exited" ] && [ "$state" != "created" ]; then
  echo "Kioku debe estar parado. Ejecuta ./scripts/kioku-local.sh stop antes de copiar." >&2
  exit 1
fi
# mkdir is exclusive: a pre-existing destination is never reused.
mkdir -m 700 -- "$dest"
trap 'echo "Copia incompleta: conserva y revisa los archivos parciales del destino; no son una copia validada." >&2' ERR
# docker cp emits a tar stream; /. includes hidden files, not just Markdown.
docker cp "$container:/data/." - > "$dest/data.tar"
[ -s "$dest/data.tar" ]
tar -tf "$dest/data.tar" > "$dest/entries.txt"
[ -s "$dest/entries.txt" ]
# Catch a restart during export; never change the source state ourselves.
state="$(docker inspect --format '{{.State.Status}}' "$container")"
[ "$state" = "exited" ] || [ "$state" = "created" ]
(cd -- "$dest" && shasum -a 256 data.tar > SHA256SUMS && shasum -a 256 -c SHA256SUMS >/dev/null)
trap - ERR
echo "Copia exportada y archivo legible; checksum comprobado. No se ha probado una restauración."
echo "Contiene datos privados y credenciales: no compartas los archivos. El contenedor y el volumen no se han modificado."
