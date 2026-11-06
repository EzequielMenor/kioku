# Gestionar el modelo del asistente desde Kioku

Desde el escritorio puedes elegir proveedor y modelo de Hermes sin editar ficheros, y volver a la configuración anterior con un clic. Es un panel web de gestión (no una app nativa), solo para el rol completo: el móvil no lo ve ni lo puede llamar. La referencia de proveedores, claves y errores sigue en [assistant-models.md](assistant-models.md).

## Camino rápido

1. Abre el panel de gestión del asistente (lanzador de comandos del escritorio → «Modelo de Hermes»).
2. En **Modelo** elige proveedor, modelo (opcional) y, con `custom`, la dirección del endpoint. Pulsa **Guardar**.
3. Define la clave del proveedor donde indica el panel (`~/.hermes/.env` o el entorno de Kioku): **el panel nunca la pide ni la muestra**.
4. La siguiente pregunta al asistente ya usa la selección. **Heredar la configuración anterior** quita solo lo elegido aquí.

## Qué manda: orden de prioridad

| # | Fuente | Quién la escribe |
|---|--------|------------------|
| 1 | `.kioku/assistant-model.json` (override de la interfaz) | Solo este panel |
| 2 | `.kioku/assistant.json` → `model` | Tú, a mano |
| 3 | `~/.hermes/config.yaml` | Hermes / tú |
| 4 | Codex (tu suscripción) | Valor por defecto |

- Sin `assistant-model.json` todo funciona exactamente como antes.
- El override es una selección **completa**: mientras exista, la sección `model` de `assistant.json` no se mezcla con ella (de tu config de Hermes solo se hereda lo del **mismo** proveedor, como siempre).
- `assistant.json` no se reescribe nunca, así que sus exclusiones (`exclude`) y el resto de campos quedan idénticos byte a byte.

## Formato del fichero

```json
{
  "managed_by": "kioku-ui",
  "model": { "provider": "custom", "default": "llama3.1", "base_url": "http://localhost:11434/v1", "api_mode": "chat_completions" },
  "acknowledged_origin": "https://llm.example.com"
}
```

`acknowledged_origin` solo existe con un `base_url` remoto (véase abajo). La escritura es atómica (fichero temporal + renombrado, la misma ruta que el resto del estado interno).

## Seguridad: qué se garantiza

| Regla | Comportamiento |
|-------|----------------|
| Sin claves | Se rechaza cualquier campo tipo `key`/`token`/`secret`/`password`, campos desconocidos y modelos con forma de clave (`sk-…`). Los errores no repiten lo recibido. |
| URL | `https://` (o `http://` solo hacia localhost), sin usuario/contraseña, sin `#` ni parámetros `?…` (ahí viajan claves). Solo con `custom`. |
| Destino remoto | Un `custom` remoto recibe `OPENAI_API_KEY`. El panel muestra un aviso con el origen y exige **escribir ese origen exacto**; el servidor lo valida en el cuerpo (`confirm_origin`) y lo guarda. Cambiar a otro host pide una confirmación nueva. Un override remoto sin esa confirmación **falla cerrado**. `assistant.json` conserva su contrato anterior. |
| Fallo cerrado | Un override ilegible o inválido impide arrancar el asistente (nunca cae en otro proveedor). |
| Guardados fallidos | No cambian el override anterior, `assistant.json` ni dejan temporales. |
| Propiedad del fichero | **Heredar** y **Guardar** solo operan sobre un fichero con la marca `managed_by: "kioku-ui"`. Uno hecho a mano o un enlace simbólico responde 409 y no se toca. |
| Estado seguro | El panel muestra el nombre de la variable de clave y *de dónde sale* (`~/.hermes/.env` o entorno), nunca su valor; del destino solo el origen. |

## API (rol completo)

| Petición | Efecto |
|----------|--------|
| `GET /api/assistant/model` | Estado: `override`, `effective` (con `source`), `credentials`, `providers`, `apiModes`, `error`, `readiness`. |
| `PUT /api/assistant/model` `{ provider, model?, base_url?, api_mode?, confirm_origin? }` | Valida y guarda; devuelve el estado nuevo. |
| `PUT /api/assistant/model` `{ "inherit": true }` | Quita el override propio; devuelve el estado nuevo. |

Se exige la clave completa de Kioku **antes** de leer o escribir nada: el rol móvil y el token Bearer de sesión del asistente no sirven (403/401, sin metadatos). La lista blanca del móvil sigue cerrada para esta ruta. Errores: 400 entrada inválida, 409 fichero ajeno, 503 si el motor no ofrece gestión (p. ej. el motor de pruebas `KIOKU_ASSISTANT_FAKE=1`) o no hay asistente.

## Estado honesto

La pestaña **Estado** informa de que Kioku responde y de qué requisitos se **detectan** (binarios y credenciales presentes). **No es una prueba de ejecución**: no lanza Hermes ni Docker ni envía nada a un modelo; solo una pregunta real lo confirma. La compatibilidad real con Mac/Docker/iPhone sigue siendo una prueba externa aparte.

## iPhone

La pestaña **iPhone** repite el flujo existente: `kioku pair` (la dirección con la clave del móvil la imprime la terminal; el panel no la muestra), Safari → Compartir → «Añadir a pantalla de inicio» y `kioku pair --revoke` para desemparejar. No genera QR ni enlaces.

## Fuera de alcance

Introducir o guardar claves, editar rutas o comandos, instalar software, llamar a Docker y cualquier edición desde el móvil.
