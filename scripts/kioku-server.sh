#!/bin/bash
set -euo pipefail

# launchd arranca con un PATH mínimo: node 24+ y docker/tailscale tienen que estar a mano.
export PATH="/opt/homebrew/opt/node@26/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

project_dir="$(cd -- "$(dirname -- "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$project_dir"

label="com.ezequiel.kioku-server"
domain="gui/$(id -u)"
plist="$HOME/Library/LaunchAgents/$label.plist"

export KIOKU_HOME="${KIOKU_HOME:-$HOME/Documents/Kioku}"
export KIOKU_PORT="${KIOKU_PORT:-47800}"
if [ -f "$project_dir/.env" ]; then
  set -a
  . "$project_dir/.env"
  set +a
fi

health() { curl -fsS -m 2 "http://127.0.0.1:$KIOKU_PORT/api/health" >/dev/null 2>&1; }

# El asistente lanza Hermes en un contenedor: necesita Docker Desktop despierto.
docker_up() {
  docker info >/dev/null 2>&1 && return 0
  /usr/bin/open -a Docker >/dev/null 2>&1 || true
}

serving() {
  if ! tailscale status >/dev/null 2>&1; then
    /usr/bin/open -a Tailscale || true
    for _ in $(seq 1 30); do tailscale status >/dev/null 2>&1 && break; sleep 2; done
  fi
  tailscale serve --bg "http://127.0.0.1:$KIOKU_PORT"
}

start() {
  docker_up
  serving >/dev/null || echo "Aviso: tailscale serve no está activo (¿Tailscale parado?)." >&2
  if launchctl print "$domain/$label" >/dev/null 2>&1; then
    launchctl kickstart -k "$domain/$label"
  else
    launchctl bootstrap "$domain" "$plist"
  fi
  for _ in $(seq 1 30); do health && break; sleep 1; done
  health || { echo "Kioku no responde en http://127.0.0.1:$KIOKU_PORT (ver ~/Library/Logs/kioku-server.log)." >&2; return 1; }
}

case "${1:-open}" in
  run) exec node src/cli/main.ts daemon ;;
  start) start ;;
  open)
    start
    /usr/bin/open "$(node src/cli/main.ts url)"
    ;;
  url) start; node src/cli/main.ts url ;;
  pair) start; node src/cli/main.ts pair ;;
  backup)
    mkdir -p "$HOME/KiokuBackups"
    tar czf "$HOME/KiokuBackups/kioku-home-$(date +%Y%m%d-%H%M%S).tar.gz" \
      --exclude='.kioku/index.db*' -C "$KIOKU_HOME" .
    ls -lh "$HOME/KiokuBackups" | tail -3
    ;;
  update)
    if [ -z "$(git status --porcelain)" ]; then git pull --ff-only; else echo "Hay cambios locales sin commitear: no hago git pull." >&2; fi
    npm ci --silent
    npm run build:web --silent
    start
    ;;
  stop) launchctl bootout "$domain/$label" 2>/dev/null || true; echo "Kioku parado." ;;
  serve) serving ;;
  status)
    launchctl print "$domain/$label" 2>/dev/null | grep -E '^\s+(state|pid|last exit code)' || echo "agente no cargado"
    health && echo "salud OK en http://127.0.0.1:$KIOKU_PORT" || echo "sin respuesta en http://127.0.0.1:$KIOKU_PORT"
    docker info >/dev/null 2>&1 && echo "docker OK (asistente disponible)" || echo "docker parado (el asistente no arrancará)"
    tailscale serve status 2>/dev/null | head -2
    ;;
  logs) tail -n 40 "$HOME/Library/Logs/kioku-server.log" ;;
  *) echo "Uso: $0 [open|start|stop|status|url|pair|backup|serve|update|logs]" >&2; exit 1 ;;
esac
