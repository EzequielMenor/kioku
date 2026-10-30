#!/bin/bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
compose=(docker compose -f "$project_dir/compose.local.yml")

start() {
  if ! docker info >/dev/null 2>&1; then
    docker desktop start --timeout 60
  fi
  "${compose[@]}" up -d --no-build --wait --wait-timeout 45
}

case "${1:-open}" in
  start) start ;;
  open)
    start
    # Let Kioku create its normal login URL; never print or store it in a file.
    login_url="$("${compose[@]}" exec -T kioku node src/cli/main.ts url)"
    case "$login_url" in
      http://127.0.0.1:47800/*) /usr/bin/open "$login_url" ;;
      *) echo "Kioku no ha devuelto una URL local válida." >&2; exit 1 ;;
    esac
    ;;
  stop) "${compose[@]}" stop ;;
  status) "${compose[@]}" ps ;;
  *) echo "Uso: $0 [open|start|stop|status]" >&2; exit 1 ;;
esac
