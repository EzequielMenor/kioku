# UI/UX

## Principios visuales
- Minimalista, denso en información útil, silencioso. Una sola acción primaria por pantalla.
- Tema oscuro por defecto con soporte claro (`prefers-color-scheme`); tokens en `:root`. Tipografía del sistema + monoespaciada para el editor. Sin animaciones decorativas (solo transiciones ≤120 ms de estado).
- Mouse opcional: todo es alcanzable por teclado y se anuncia en un pie de atajos contextual.

## Estructura del Workspace
```
┌────────────┬───────────────────────────────────────────┬──────────────┐
│ ◉ Hoy      │  (vista principal)                        │ Contexto     │
│ ✉ Bandeja 3│                                           │  Backlinks   │
│ ▣ Proyectos│                                           │  Enlaces     │
│ ☐ Tareas   │                                           │  Propiedades │
│ ✎ Notas    │                                           │              │
│ ☼ Diario   │                                           │              │
├────────────┴───────────────────────────────────────────┴──────────────┤
│ ● Foco: «Cablear watcher» · Kioku · 23:41          [Terminar] ⌃K     │
└───────────────────────────────────────────────────────────────────────┘
```
La barra inferior de foco solo existe durante una sesión. El panel derecho se oculta con `Ctrl+\`.

## Pantalla "Hoy"
1. **Empieza por** (tarjeta grande): título, razones en chips ("vence hoy", "en curso"), `Enter` = empezar foco.
2. **Alternativas** (2 líneas, colapsables).
3. **Retomar**: hasta 3 tarjetas de proyecto con *Lo dejaste en / Decidiste / Falta* y botón *Continuar*.
4. **Bandeja** (contador + las 3 últimas) y **Propuestas** (si hay).
Si no hay nada: estado vacío con un único botón "Capturar algo" (`c`).

## Quick (ventana flotante)
- 640×(auto) px, centrada, sin decoración, esquinas redondeadas, un `input` de 18 px y una lista de resultados/ayuda debajo. Fondo opaco (sin blur: rendimiento en WebKit/Chromium sobre Intel iGPU).
- Pista inferior cambia según el prefijo (`t` tarea · `d` decisión · `/` buscar).
- Esc cierra; el texto no enviado se conserva 60 s.

## Teclado (v1)
| Tecla | Acción |
|---|---|
| `Ctrl+K` | Paleta: buscar + comandos |
| `g h` / `g b` / `g p` / `g t` / `g n` / `g d` | Ir a Hoy / Bandeja / Proyectos / Tareas / Notas / Diario |
| `c` | Captura (abre Quick embebido) |
| `f` | Empezar/terminar foco |
| `j`/`k`, `Enter`, `x`, `e` | Moverse, abrir, descartar/hecho, editar en listas |
| `Ctrl+S` | Guardar (también autoguardado a 800 ms) |
| `[[` | Autocompletar enlace en el editor |
| `Ctrl+\` | Mostrar/ocultar panel de contexto |
| `?` | Ayuda de atajos |

## Editor
CodeMirror 6 en modo Markdown: resaltado de sintaxis, `[[` con autocompletado y clic/`Ctrl+Enter` para seguir enlaces, listas y casillas `- [ ]`, plegado por encabezado. Edita **el archivo real**; no hay "vista previa" separada en v1 (la decoración en línea de títulos/énfasis hace de preview ligero). Frontmatter se edita en un panel de propiedades tipado, no a mano (aunque el texto puro sigue accesible).

## Accesibilidad
Contraste AA en ambos temas, foco visible siempre, roles ARIA en lista/diálogo, respeta `prefers-reduced-motion`.

## Contenido y tono (UX copy)
Español, directo, sin exclamaciones ni mascota. Verbos en infinitivo en botones ("Empezar foco"). Errores dicen qué pasó y qué hacer ("No se pudo guardar: el archivo cambió fuera de Kioku. Ver diferencias").
