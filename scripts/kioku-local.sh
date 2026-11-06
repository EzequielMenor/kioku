#!/bin/bash
set -euo pipefail

# launchd arranca con un PATH mínimo: sin esto no encuentra docker ni tailscale.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

project_dir="$(cd -- "$(dirname -- "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$project_dir"
compose=(docker compose -f "$project_dir/compose.local.yml")

public_host() {
  local h="${KIOKU_PUBLIC_HOST:-}"
  if [ -z "$h" ] && [ -f "$project_dir/.env" ]; then
    h="$(sed -n 's/^KIOKU_PUBLIC_HOST=//p' "$project_dir/.env" | tail -1)"
  fi
  printf '%s' "$h"
}

tailscale_up() {
  if ! tailscale status >/dev/null 2>&1; then
    /usr/bin/open -a Tailscale || true
    for _ in $(seq 1 30); do
      tailscale status >/dev/null 2>&1 && break
      sleep 2
    done
  fi
}

# Publica Kioku en la tailnet por HTTPS (solo dispositivos autorizados) apuntando al loopback.
serve() {
  tailscale_up
  tailscale serve --bg http://127.0.0.1:47800
}

start() {
  if ! docker info >/dev/null 2>&1; then
    docker desktop start --timeout 120
  fi
  "${compose[@]}" up -d --no-build --wait --wait-timeout 60
  serve >/dev/null || echo "Aviso: tailscale serve no está activo (¿Tailscale parado?)." >&2
}

update() {
  if [ -z "$(git status --porcelain)" ]; then
    git pull --ff-only
  else
    echo "Hay cambios locales sin commitear: no hago git pull." >&2
  fi
  rev="$(git rev-parse --short HEAD)"
  docker build -t kioku:local -t "kioku:local-$rev" .
  start
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
  url)
    start
    host="$(public_host)"
    login_url="$("${compose[@]}" exec -T kioku node src/cli/main.ts url)"
    if [ -n "$host" ]; then
      printf '%s\n' "${login_url/http:\/\/127.0.0.1:47800/https://$host}"
    else
      printf '%s\n' "$login_url"
    fi
    ;;
  pair) start; "${compose[@]}" exec -T kioku node src/cli/main.ts pair ;;
  backup)
    mkdir -p "$HOME/KiokuBackups"
    docker run --rm -v kioku-local_data:/data -v "$HOME/KiokuBackups:/backup" alpine \
      tar czf "/backup/kioku-data-$(date +%Y%m%d-%H%M%S).tar.gz" -C /data .
    ls -lh "$HOME/KiokuBackups" | tail -3
    ;;
  serve) serve ;;
  update) update ;;
  stop) "${compose[@]}" stop ;;
  status) "${compose[@]}" ps ;;
  *) echo "Uso: $0 [open|start|stop|status|url|pair|backup|serve|update]" >&2; exit 1 ;;
esac
