# Asistente con un modelo local (Ollama)

Kioku puede hablar **directamente** con un modelo que corre en tus equipos, sin Hermes y sin que el texto de tus notas salga de ellos. Lo atiende el **motor nativo**: Kioku llama a la API «chat completions» (la de OpenAI, que Ollama, LM Studio, llama.cpp y vLLM también ofrecen) y le da al modelo **solo las herramientas de Kioku**. El modelo no tiene terminal, ficheros ni red: lo único que puede hacer es pedir una herramienta, y cada llamada pasa por el daemon con las mismas reglas de siempre (exclusiones, Deshacer, propuestas para lo delicado).

Es el mismo asistente en todas partes: la pestaña **Asistente**, Kio dentro de Kioku, [Kio en el escritorio](companion.md) y `kioku ask` comparten conversación, estado y modelo.

## 1. Tener Ollama con un modelo que use herramientas

```bash
ollama pull qwen3:8b        # o el modelo que prefieras; debe admitir «tools»
ollama list
```

El modelo tiene que saber llamar herramientas (*tool calling*). Si no sabe, Kioku lo dice: «El modelo … no admite herramientas». Los modelos pequeños (≤ 9B) a veces contestan de memoria en vez de consultar tus notas; si te pasa, prueba uno mayor.

## 2. Decirle a Kioku que lo use

**Desde la interfaz:** abre el [panel de gestión del modelo](assistant-model-management.md) (lanzador de comandos → «Modelo de Hermes»), elige **Ollama (local)**, escribe el nombre del modelo y, si Ollama no está en este equipo, su dirección. Pulsa **Guardar**.

**O a mano**, en `.kioku/assistant.json` de tu espacio:

```json
{ "model": { "provider": "ollama", "default": "qwen3:8b" } }
```

Sin `base_url` se usa `http://localhost:11434/v1`. Para un Ollama en otro equipo de tu tailnet:

```json
{ "model": { "provider": "ollama", "default": "qwen3:8b", "base_url": "http://mac-mini.tu-tailnet.ts.net:11434/v1" } }
```

Cualquier otro servidor compatible con OpenAI va con `"provider": "custom"` y su `base_url` (terminada en `/v1`).

`http://` solo se admite hacia `localhost` o hacia un equipo de tu tailnet de Tailscale (direcciones `100.64.0.0/10` o nombres `*.ts.net`, donde el tráfico ya va cifrado). Para cualquier otro destino, `https://`.

## 3. Comprobarlo

```bash
kioku assistant status
```

```text
Asistente: listo
  Motor:      nativo de Kioku (habla directo con un endpoint compatible con OpenAI, p. ej. Ollama)
  Proveedor:  ollama · modelo qwen3:8b
  Destino:    http://mac-mini.tu-tailnet.ts.net:11434 (local: el texto de tus notas no sale de tus equipos)
```

La orden informa del **proveedor activo**, sea cual sea: con Codex u otra API dirá «Hermes Agent» y «remoto». Si algo falla, la primera línea trae el motivo y qué hacer. En la interfaz, la etiqueta junto al nombre de Kio dice lo mismo (`local · qwen3:8b` o `remoto · …`).

## Ollama en otro equipo (p. ej. un Mac mini por Tailscale)

Recién instalado, Ollama solo escucha en su propio `localhost`: desde otro equipo la conexión se **rechaza** aunque Tailscale funcione. Hay que publicarlo en la dirección de Tailscale de ese equipo.

En el Mac (app de Ollama):

```bash
tailscale ip -4                                   # p. ej. 100.101.102.103
launchctl setenv OLLAMA_HOST 100.101.102.103:11434
# sal de Ollama (icono de la barra → Quit) y vuelve a abrirlo
```

En Linux con systemd: `sudo systemctl edit ollama` y añade `Environment=OLLAMA_HOST=100.101.102.103:11434` en `[Service]`; luego `sudo systemctl restart ollama`.

Comprueba desde el equipo donde corre Kioku:

```bash
curl http://mac-mini.tu-tailnet.ts.net:11434/v1/models
```

Usa la IP de Tailscale y no `0.0.0.0`: así Ollama no queda abierto a la red local de casa o de una cafetería, solo a tus equipos. El Mac debe estar encendido y **sin suspender** (*Ajustes → Batería/Energía → evitar el reposo*).

## Qué motor atiende

`.kioku/assistant.json → "engine"` lo fija; sin él (`"auto"`) se decide por el proveedor:

| `engine` | Quién atiende |
|---|---|
| ausente o `"auto"` | `ollama` y `custom` → **nativo** · el resto (Codex, OpenRouter, Anthropic…) → **Hermes** |
| `"native"` | Siempre el nativo (solo proveedores que hablan «chat completions»: Ollama, `custom`, OpenRouter, DeepSeek…) |
| `"hermes"` | Siempre Hermes en su jaula (`bwrap` en Linux, Docker en Mac), también para Ollama |

**No hay cambio automático de proveedor.** Si Ollama no responde, Kioku lo dice y no reenvía tu pregunta ni tus notas a otro destino: eso lo decides tú cambiando el modelo.

## Tiempos y límites

- **Contexto: 16.384 tokens.** Con Ollama, Kioku usa su API nativa (`/api/chat`) y le pide `num_ctx` 16384. Por la vía «chat completions» (`/v1`), Ollama ignora ese ajuste y se queda en 4.096 tokens. El prompt de Kio con sus herramientas ya ocupa unos 4.000, así que las respuestas llegaban vacías o cortadas. Se cambia con `KIOKU_OLLAMA_NUM_CTX`. qwen3.5:9b ocupa así unos 6,6 GB (5,6 GB con 4.096). Si otra aplicación usa el mismo modelo con otro contexto, Ollama lo recarga al alternar; para evitarlo, `OLLAMA_CONTEXT_LENGTH=16384` en el equipo de Ollama.
- **Honestidad:** si el modelo dice haber hecho algo («he creado…», «Creada la tarea…») sin haber usado ninguna herramienta, Kioku se lo hace notar una vez. Si insiste, la respuesta dice que no se ha cambiado nada. Si termina sin texto, Kioku resume lo que de verdad se hizo. Si la consulta se corta, el error dice lo que ya había cambiado.
- **Razonamiento (`think`) activado, como trae el modelo.** Medido con qwen3.5:9b real: sin razonamiento es más rápido y encadena mejor varias acciones, pero responde preguntas sobre tus datos **sin consultarlas** (se inventó tareas y notas). Con razonamiento consulta siempre, aunque a veces anuncia una acción y se para sin hacerla. En ese caso, si ya leyó datos y aún no cambió nada, Kioku repite esa vuelta sin razonamiento. `KIOKU_OLLAMA_THINK=0|1` lo fuerza (no recomendado).
- **Tu espacio en el prompt:** las bases, los hábitos por su nombre, la propiedad que lleva el progreso y los próximos 7 días con su nombre. Así un modelo pequeño marca el hábito con `log_habit`, apunta la lectura con `log_progress` y no calcula «el viernes» a ojo.
- Hasta **4 minutos** por consulta en total; **2 minutos** de espera al primer fragmento (cubre la carga en frío del modelo) y **1 minuto** de silencio máximo entre fragmentos.
- Hasta **2 reintentos** si el modelo se cae o se reinicia antes de haber hecho nada (una llamada al modelo no tiene efectos en Kioku; las herramientas ya ejecutadas no se repiten).
- Hasta **12 vueltas** de herramientas por consulta. Cada resultado de herramienta se recorta a 24 000 caracteres.
- Recuerda los últimos **16 mensajes** de la conversación y tus preferencias en texto plano (`.kioku/hermes/memories/`, la misma memoria que usa Hermes: la ves y la borras en *Qué recuerda el asistente*).
- La respuesta llega **por fragmentos** y puedes **Detener** la consulta: se corta la generación en el modelo.
- El razonamiento que algunos modelos escriben entre `<think>` no se muestra ni se guarda.

## Si algo falla

| Lo que dice Kioku | Qué hacer |
|---|---|
| «…rechaza la conexión: el servidor del modelo no está en marcha» | En local: `ollama serve` (o abre la app). En otro equipo: publica Ollama en su IP de Tailscale (arriba). |
| «…no responde (tiempo de espera agotado)» | El equipo está apagado, suspendido o sin Tailscale. |
| «No encuentro el equipo de …» | Nombre mal escrito en `base_url` o Tailscale desconectado en este equipo. |
| «El modelo «…» no existe en …» | `ollama pull <modelo>` en el equipo que sirve el modelo. |
| «…no ofrece la API «chat completions» en esa dirección (404)» | `base_url` debe terminar en `/v1`. |
| «El modelo «…» no admite herramientas» | Elige un modelo con *tool calling*. |
| «…rechaza la petición (403)» | Ollama detrás de un proxy no acepta ese nombre de host: publícalo con `OLLAMA_HOST` en la IP de Tailscale. |
| «El motor nativo no atiende el proveedor …» | Quita `"engine": "native"` o elige Ollama/`custom`. |

## Seguridad

- El modelo **no ejecuta nada**: no hay terminal ni acceso a ficheros. Solo pide herramientas de Kioku, y el daemon aplica niveles, exclusiones (`"exclude"` en `assistant.json`), Deshacer y propuestas igual que con Hermes.
- Con un destino local o del tailnet no hace falta clave. Si el proveedor la necesita, va en `~/.hermes/.env` o en el entorno de Kioku, **nunca** en `assistant.json` (Kioku rechaza el fichero si ve una).
- El texto de las notas que el asistente lee viaja al modelo configurado. Con Ollama en tus equipos no sale de ellos; con un proveedor remoto, sí, y la interfaz lo marca en rojo como `remoto`.

## Estado de la validación

Comprobado con un servidor simulado (streaming de «chat completions» y de la API nativa de Ollama, herramientas, reintentos, tiempos de espera, cancelación, enrutado, guardia de honestidad) en `test/native-engine.test.ts`. **Y con qwen3.5:9b real** en el Ollama del Mac mini, por Tailscale, sobre una bóveda temporal: 16 escenarios, cada respuesta comparada con lo que cambió en disco. Resultados en [validation.md](validation.md#versión-candidata-de-cierre-2026-11-18).
