#!/bin/bash
set -euo pipefail

# launchd arranca con un PATH mínimo: node 24+ y docker/tailscale tienen que estar a mano.
export PATH="${PATH:-/usr/bin:/bin}:/opt/homebrew/opt/node@26/bin:/opt/homebrew/bin:/usr/local/bin:/usr/sbin:/sbin"

project_dir="$(cd -- "$(dirname -- "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$project_dir"

label="com.ezequiel.kioku-server"
domain="gui/$(id -u)"
plist="$HOME/Library/LaunchAgents/$label.plist"
env_file="${KIOKU_ENV_FILE:-$project_dir/.env}"

export KIOKU_HOME="${KIOKU_HOME:-$HOME/Documents/Kioku}"
export KIOKU_PORT="${KIOKU_PORT:-47800}"
if [ -f "$env_file" ]; then
  set -a
  . "$env_file"
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

restart() {
  if launchctl print "$domain/$label" >/dev/null 2>&1; then
    launchctl kickstart -k "$domain/$label"
  else
    launchctl bootstrap "$domain" "$plist"
  fi
  for _ in $(seq 1 30); do health && break; sleep 1; done
  health || { echo "Kioku no responde en http://127.0.0.1:$KIOKU_PORT (ver ~/Library/Logs/kioku-server.log)." >&2; return 1; }
}

start() {
  docker_up
  serving >/dev/null || echo "Aviso: tailscale serve no está activo (¿Tailscale parado?)." >&2
  restart
}

allowed_host() { sed -n 's/^KIOKU_ALLOWED_HOSTS=//p' "$env_file" 2>/dev/null | tail -1; }

# Acceso privado desde iPhone u otros equipos mediante Tailscale (sin Funnel ni puertos abiertos al router).
remote() {
  local show="${1:-}" status host url tmp
  command -v tailscale >/dev/null 2>&1 || { echo "Tailscale no está instalado en este equipo. Instálalo, inicia sesión y vuelve a ejecutar este comando." >&2; exit 1; }
  status="$(tailscale status --json 2>/dev/null)" || { echo "Tailscale no está conectado. Ábrelo, inicia sesión (misma cuenta que el iPhone) y vuelve a ejecutar este comando." >&2; exit 1; }
  host="$(printf '%s' "$status" | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const n = JSON.parse(s).Self?.DNSName; if (n) console.log(n.replace(/\.$/, "")); } catch {}
    });')"
  if ! printf '%s' "$host" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'; then
    echo "No pude obtener un nombre válido del equipo en Tailscale. Comprueba que MagicDNS está activo y que el equipo aparece conectado." >&2
    exit 1
  fi
  if [ "$(allowed_host)" != "$host" ]; then
    # Solo cambia el host aceptado: las notas, la clave móvil y el índice se conservan.
    tmp="$(mktemp)"
    grep -v '^KIOKU_ALLOWED_HOSTS=' "$env_file" > "$tmp" 2>/dev/null || true
    printf 'KIOKU_ALLOWED_HOSTS=%s\n' "$host" >> "$tmp"
    mv "$tmp" "$env_file"
    restart || exit 1
  fi
  serving >/dev/null || echo "Aviso: tailscale serve no está activo (¿Tailscale parado?)." >&2
  url="$(KIOKU_ALLOWED_HOSTS="$host" KIOKU_PUBLIC_HOST="$host" node src/cli/main.ts pair | sed -n 's/^ *\(https:\/\/[^ ]*\)$/\1/p' | head -n 1)"
  [ -n "$url" ] || { echo "Kioku no devolvió un enlace de emparejamiento." >&2; exit 1; }
  echo "Kioku ya acepta el acceso privado como https://$host"
  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s' "$url" | pbcopy
    echo "El enlace de emparejamiento está en el portapapeles (no se muestra: lleva la clave del móvil)."
    echo "Con el iPhone cerca, pégalo en Safari mediante el portapapeles universal. Si no, ejecuta de nuevo con «remote --show»."
  else
    echo "Abre esta dirección en el móvil (lleva la clave del móvil: no la compartas):"
    echo "  $url"
  fi
  [ "$show" = "--show" ] && echo "  $url"
  echo "Después, en Safari: Compartir → Añadir a pantalla de inicio. El Mac debe seguir encendido y sin suspensión."
  return 0
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
  remote) shift; remote "${1:-}" ;;
  backup)
    mkdir -p "$HOME/KiokuBackups"
    dest="$HOME/KiokuBackups/kioku-home-$(date +%Y%m%d-%H%M%S).tar.gz"
    partial="$dest.partial"
    list="$(mktemp)"
    trap 'rm -f "$list" "$partial"' EXIT
    # Los sockets del gateway y los ficheros que APFS comprimió y ya no puede leer
    # (estado de Hermes) abortan tar: se omiten y se avisa; el resto se copia entero.
    (cd "$KIOKU_HOME" && find . \( -type d -o -type f \) ! -path './.kioku/index.db*' ! -flags +compressed -print) > "$list"
    skipped="$(find "$KIOKU_HOME" -type f -flags +compressed | wc -l | tr -d ' ')"
    tar czf "$partial" --no-xattrs --no-recursion -C "$KIOKU_HOME" -T "$list"
    tar -tzf "$partial" >/dev/null
    mv "$partial" "$dest"
    [ "$skipped" -eq 0 ] || echo "Aviso: $skipped ficheros comprimidos por APFS (estado de Hermes) no se pueden leer y no van en la copia." >&2
    ls -lh "$dest"
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
  *) echo "Uso: $0 [open|start|remote [--show]|stop|status|url|pair|backup|serve|update|logs]" >&2; exit 1 ;;
esac
