# Modelo del asistente (Hermes)

Hermes sigue siendo el agente de Kioku; aquí eliges **qué modelo y proveedor** usa. Sin configurar nada, todo funciona como siempre: Codex con tu suscripción (`~/.hermes/auth.json`).

## Dónde se configura

Orden de prioridad (lo primero manda):

1. **`.kioku/assistant.json`** del vault, sección `model`.
2. **`~/.hermes/config.yaml`** (tu configuración de Hermes): se hereda `model.provider`, `model.default`, `model.base_url` y `model.api_mode`.
3. Por defecto: `openai-codex`, modelo por defecto de Hermes.

`assistant.json` acepta el texto de siempre (solo cambia el modelo) o un objeto:

```json
{ "model": "gpt-5.5" }
```

```json
{
  "exclude": ["Privado/"],
  "model": { "provider": "openrouter", "default": "anthropic/claude-sonnet-4" }
}
```

```json
{ "model": { "provider": "custom", "default": "llama3.1", "base_url": "http://localhost:11434/v1", "api_mode": "chat_completions" } }
```

Reglas de la herencia: si `assistant.json` fija un `provider`, del config de Hermes solo se aprovecha lo que sea de **ese mismo** proveedor (no se mezcla el modelo o la URL de otro). Si solo pones el nombre del modelo, se conserva el proveedor de tu config de Hermes. La sección `exclude` no cambia.

## Proveedores soportados

`openai-codex` (suscripción, sin clave), `openrouter`, `anthropic`, `gemini`, `deepseek`, `zai`, `kimi-coding`, `minimax` y `custom` (cualquier endpoint compatible; `base_url` obligatorio). La lista es cerrada y vive en `src/assistant/model-config.ts`. Valores de `api_mode`: `chat_completions`, `codex_responses`, `anthropic_messages`. Referencia de campos: <https://hermes-agent.nousresearch.com/docs/user-guide/configuring-models>.

**Configuración de confianza:** un endpoint remoto `custom` recibe `OPENAI_API_KEY`. No aceptes cambios de `.kioku/assistant.json` de una sincronización o colaborador que no sea de confianza: quien puede cambiar `model.base_url` puede redirigir esa clave. Kioku no verifica la identidad comercial del proveedor. La API de notas y el móvil no permiten editar esa configuración.

`base_url` debe ser `https://` (o `http://` solo hacia `localhost`), sin usuario ni contraseña. Desde `assistant.json` solo se admite con `custom`; para el resto se hereda de tu config de Hermes.

## Claves de API

Nunca van en `assistant.json` (se rechaza cualquier campo de clave). Kioku busca **solo la variable de ese proveedor** (p. ej. `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY` para `custom`) primero en `~/.hermes/.env` y después en el entorno con el que arranca `kioku`. El resto del `.env` y del entorno no se reenvía.

En Linux la clave entra por un descriptor de fichero (`bwrap --args 3`); en Mac, por el entorno de Docker y solo con el nombre en argv (`--env NOMBRE`). No se escribe en el config del vault ni en respuestas de estado o errores. El administrador local de Docker puede inspeccionar el entorno de sus contenedores. Ver [macOS](assistant-macos.md). Con `custom` hacia `localhost` (p. ej. Ollama) la clave es opcional. Con proveedores distintos de Codex la jaula no monta `~/.hermes/auth.json`.

## Errores

Si algo no es válido, el asistente no arranca y el estado (`/api/assistant/status`, `kioku assistant status`) dice qué corregir y dónde, sin repetir el valor recibido: JSON/YAML roto, proveedor desconocido, `base_url` insegura, clave ausente o con saltos de línea. Se falla cerrado: nunca se cae en otro proveedor en silencio.

## Rol del asistente

Cambiar de modelo no cambia las reglas: el asistente ayuda a organizar y pensar, no reescribe notas sin petición explícita, y los cambios destructivos o masivos siguen pasando por propuestas que aprueba el usuario (los impone el daemon, no el modelo).

## Estado separado del móvil

El rol móvil usa su propia carpeta de Hermes (`.kioku/hermes-mobile/<huella-de-privacidad>`): memoria, sesiones y skills no se comparten con el escritorio (`.kioku/hermes`) ni con consultas de otra política de privacidad.
