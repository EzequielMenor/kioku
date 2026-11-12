#!/bin/bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
# Host aceptado para el acceso privado (solo un nombre DNS, nunca una clave). Lo escribe `remote`.
env_file="${KIOKU_LOCAL_ENV_FILE:-$project_dir/.kioku-local.env}"
port=47800

# Compose lee el archivo de entorno solo si existe, para que `start`/`open` conserven el host aceptado.
compose() {
  local args=(docker compose -f "$project_dir/compose.local.yml")
  [ -f "$env_file" ] && args+=(--env-file "$env_file")
  "${args[@]}" "$@"
}

start() {
  if ! docker info >/dev/null 2>&1; then
    docker desktop start --timeout 60
  fi
  compose up -d --no-build --wait --wait-timeout 45
}

# Acceso privado desde iPhone u otros equipos mediante Tailscale (sin Funnel ni puertos abiertos al router).
remote() {
  command -v tailscale >/dev/null 2>&1 || { echo "Tailscale no está instalado en este equipo. Instálalo, inicia sesión y vuelve a ejecutar este comando." >&2; exit 1; }
  local status host
  status="$(tailscale status --json 2>/dev/null)" || { echo "Tailscale no está conectado. Ábrelo, inicia sesión (misma cuenta que el iPhone) y vuelve a ejecutar este comando." >&2; exit 1; }
  start
  # Usa el Node del contenedor para leer el JSON: el Mac no necesita Node ni jq.
  host="$(printf '%s' "$status" | compose exec -T kioku node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const n = JSON.parse(s).Self?.DNSName; if (n) console.log(n.replace(/\.$/, "")); } catch {}
    });')"
  if ! printf '%s' "$host" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'; then
    echo "No pude obtener un nombre válido del equipo en Tailscale. Comprueba que MagicDNS está activo y que el equipo aparece conectado." >&2
    exit 1
  fi
  if ! grep -qx "KIOKU_ALLOWED_HOSTS=$host" "$env_file" 2>/dev/null; then
    printf 'KIOKU_ALLOWED_HOSTS=%s\n' "$host" > "$env_file"
    # Solo cambia el entorno del contenedor; los volúmenes y las notas se conservan.
    compose up -d --no-build --wait --wait-timeout 45
  fi
  tailscale serve --bg "http://127.0.0.1:$port" >/dev/null || { echo "No pude publicar el proxy privado con «tailscale serve». Si es la primera vez, Tailscale puede pedirte activar HTTPS en tu tailnet." >&2; exit 1; }
  local out url
  out="$(compose exec -T -e "KIOKU_PUBLIC_HOST=$host" kioku node src/cli/main.ts pair)"
  url="$(printf '%s\n' "$out" | sed -n 's/^ *\(https:\/\/[^ ]*\)$/\1/p' | head -n 1)"
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
  [ "${1:-}" = "--show" ] && { echo "  $url"; }
  echo "Después, en Safari: Compartir → Añadir a pantalla de inicio. El Mac debe seguir encendido y sin suspensión."
}

case "${1:-open}" in
  start) start ;;
  open)
    start
    # Let Kioku create its normal login URL; never print or store it in a file.
    login_url="$(compose exec -T kioku node src/cli/main.ts url)"
    case "$login_url" in
      http://127.0.0.1:47800/*) /usr/bin/open "$login_url" ;;
      *) echo "Kioku no ha devuelto una URL local válida." >&2; exit 1 ;;
    esac
    ;;
  remote) shift; remote "$@" ;;
  stop) compose stop ;;
  status) compose ps ;;
  *) echo "Uso: $0 [open|start|remote [--show]|stop|status]" >&2; exit 1 ;;
esac
