# Kioku como servidor en este Mac

Kioku corre **nativo** en el Mac mini (Node 26), no en Docker: así el asistente
puede lanzar Hermes en su contenedor. La rama es `feat/hermes-central` (v0.8.0)
y los datos viven en `~/Documents/Kioku`.

## Direcciones

| Desde | Dirección |
|---|---|
| El propio Mac | <http://127.0.0.1:47800> |
| Cualquier dispositivo de tu tailnet | <https://mac-mini-de-ezequiel.tail9a2b64.ts.net> |
| Móvil (clave de rol `mobile`) | `kioku-server pair` |

El nombre público vive en `.env` (`KIOKU_PUBLIC_HOST`, `KIOKU_ALLOWED_HOSTS`).
Si cambia el nombre del nodo en Tailscale, edita `.env` y reinicia.

## Uso diario

```sh
kioku-server start     # arranca el daemon y reactiva tailscale serve
kioku-server open      # arranca y abre el navegador
kioku-server url       # URL con clave, ya con el origen https de la tailnet
kioku-server pair      # URL de emparejamiento del móvil
kioku-server status    # agente, salud, Docker y tailscale serve
kioku-server backup    # copia el vault a ~/KiokuBackups
kioku-server logs
kioku-server stop
```

`kioku-server` es un enlace a `scripts/kioku-server.sh` en `~/.local/bin`, así
que funciona desde cualquier carpeta.

## Arranque automático

- **LaunchAgent** `~/Library/LaunchAgents/com.ezequiel.kioku-server.plist`:
  `RunAtLoad` + `KeepAlive`, ejecuta `scripts/kioku-server.sh run`. Si el daemon
  muere, launchd lo vuelve a levantar.
- **Tailscale** arranca al iniciar sesión (`TailscaleStartOnLogin = 1`) y
  `tailscale serve` persiste la publicación HTTPS del puerto 47800.
- **Docker Desktop** se abre desde el script: solo lo necesita el asistente.
- **Energía**: `pmset` tiene `sleep 0`, el Mac no se suspende en corriente.

Log: `~/Library/Logs/kioku-server.log`. Si algo no responde:

```sh
launchctl kickstart -k gui/$(id -u)/com.ezequiel.kioku-server
kioku-server status
```

## Asistente (Hermes)

Funciona con **Codex** (tu suscripción) y la imagen
`nousresearch/hermes-agent:stable`, lanzada en un contenedor por consulta.
Configurado en `~/Documents/Kioku/.kioku/assistant.json`:

```json
{ "model": { "provider": "openai-codex", "default": "gpt-6-sol" } }
```

Requisitos que ya están puestos:

- Docker Desktop con **Settings → Resources → Network → Enable host networking**
  (`hostNetworkingEnabled` en su `settings-store.json`). Sin eso el contenedor no
  alcanza ni Ollama ni el puente MCP.
- `~/.hermes/auth.json` para Codex; se monta solo ese fichero, no el home.

**Importante:** el modelo debe ir **explícito**. Si se deja vacío, Hermes crea
sesiones con `model` vacío y luego se niega a reanudarlas (`storage_unavailable`).

Para usar un modelo local, cambia el `assistant.json`:

```json
{ "model": { "provider": "ollama", "default": "qwen3.5:9b" } }
```

Ollama responde, pero un 9B no descubre bien las 26 herramientas diferidas de
Kioku: tiende a contestar de memoria. Codex es lo que funciona hoy.

## Acceso y seguridad

- El daemon escucha **solo en `127.0.0.1`**; `tailscale serve` termina TLS con el
  certificado de la tailnet y reenvía al loopback.
- No hay puertos abiertos a Internet ni Tailscale Funnel.
- Hosts no listados → 403. El móvil tiene su propia clave y no puede usar el
  asistente ni borrar.

## Datos y copias

Vault: `~/Documents/Kioku` (Markdown + `.kioku/` con índice, claves y estado de
Hermes). El índice es desechable: se reconstruye desde los ficheros.

```sh
kioku-server backup    # ~/KiokuBackups/kioku-home-<fecha>.tar.gz
```

Cópialo fuera del Mac de vez en cuando: un backup en el mismo disco no protege
del disco.

## Actualizar

```sh
kioku-server update    # git pull --ff-only + npm ci + build:web + reinicio
```

Solo hace `git pull` si el árbol está limpio; si hay cambios locales, reconstruye
con lo que haya. Conserva el vault y las claves.

## El despliegue Docker anterior

`compose.local.yml` y `scripts/kioku-local.sh` siguen ahí como alternativa, pero
en contenedor el asistente **no** funciona (la imagen es Linux y espera `bwrap`,
y no tiene socket de Docker ni `~/.hermes`). El volumen `kioku-local_data`
conserva los datos que se migraron a `~/Documents/Kioku`; no lo borres sin
comprobar antes.
