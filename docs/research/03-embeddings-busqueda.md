# Búsqueda: FTS5 frente a búsqueda híbrida con embeddings locales

Fecha: 2026-11-18. Objetivo: decidir si Kioku necesita embeddings (búsqueda semántica) en el Mac mini M4 de 16 GB, o si
basta con mejorar la búsqueda de texto completo (SQLite FTS5) que ya tiene.

**Decisión: no se añaden embeddings en esta versión.** Se corrige la búsqueda FTS5, que era la causa real de los fallos.
Los embeddings quedan documentados como mejora opcional para más adelante (ver «Cuándo merecería la pena»).

## El problema encontrado

Con el modelo real (qwen3.5:9b), Kio respondía «no tengo ningún registro sobre tus alergias» o «no hay notas sobre el
fontanero», aunque las notas existían. La causa: `Index.search` exigía que **todas** las palabras aparecieran en la
nota (AND implícito de FTS5). Kio busca con palabras clave como «fontanero cocina precio». La nota dice «Fontanero
Ramón: 1.850 €», pero no contiene la palabra «precio», así que la búsqueda devolvía cero resultados.

## Corrección aplicada (sin modelos nuevos)

En `src/core/index.ts`:

1. Las palabras vacías del español («a», «qué», «el», «soy», «tengo»…) no cuentan para buscar.
2. Primero salen las notas que contienen **todas** las palabras, como antes.
3. Si no llegan al límite, la lista se completa con las notas que contienen **alguna**. Se ordenan por bm25, que premia a
   las que tienen más palabras, y siempre quedan por debajo de las anteriores.

## Cómo se midió

- Corpus: 40 notas personales realistas en español (casa, salud, hijos, finanzas, trabajo, recetas, viajes, fe,
  mascota…). 32 preguntas, cada una con su nota correcta.
- Cada pregunta en dos formas:
  - **natural**: «¿Cuándo tengo que pasar la ITV?»;
  - **palabras clave**: «ITV coche». Es como busca Kio; lo comprobamos en los registros de la prueba real.
- Métricas: R@1 (la nota correcta sale primera), R@5 (sale entre las cinco primeras) y MRR.
- FTS5: el índice real de Kioku (`Kioku.open` + `Index.search`), no una imitación.
- Vectores: transformers.js (ONNX, q8) en CPU, en Omarchy (i7-4770HQ). La calidad del ranking depende del modelo, no
  del motor. En el Mac, el mismo modelo correría en Ollama con Metal.
- Híbrida: fusión por rangos recíprocos (RRF, k=60) de FTS5-OR y vectores.

## Resultados

| Variante | Natural R@1 | Natural R@5 | Clave R@1 | Clave R@5 |
|---|---|---|---|---|
| FTS5 de antes (AND) | 0,00 | 0,00 | 0,47 | 0,47 |
| **FTS5 corregido (Kioku ahora)** | **0,72** | **0,88** | **0,94** | **1,00** |
| Vectores, multilingual-e5-small (118M) | 0,94 | 0,97 | 0,97 | 1,00 |
| Híbrida, e5-small | 0,88 | 0,97 | 1,00 | 1,00 |
| Vectores, EmbeddingGemma 300M | 0,97 | 1,00 | 1,00 | 1,00 |
| Híbrida, EmbeddingGemma | 0,88 | 1,00 | 0,97 | 1,00 |

Coste medido en CPU (i7 de 2014). En el M4 con Metal será bastante menor:

| Modelo | Carga | Indexar 40 notas | Por consulta |
|---|---|---|---|
| multilingual-e5-small q8 | 2–16 s | 1–3 s | 10–23 ms |
| EmbeddingGemma 300M q8 | 32 s | 23 s | 576 ms |

Lo que FTS5 corregido todavía no encuentra con preguntas naturales: «¿Cuándo tengo que pasar la ITV?» (la nota dice
«inspección técnica»), «la clave para entrar al **edificio** de mi madre» (la nota dice «portal») y «¿qué hago si **se
va internet**?» (la nota habla de «router» y «wifi»). Son sinónimos, justo donde ayudan los vectores.

## Por qué no se implementa ahora

- La diferencia grande (de 0,47 a 1,00 con palabras clave, y de 0,00 a 0,88 con preguntas naturales) la da la
  corrección de FTS5, que no tiene coste: ni modelo, ni memoria, ni indexado aparte.
- Kio busca con palabras clave y, si no encuentra, reformula. Con palabras clave, FTS5 corregido ya está en R@5 = 1,00.
- Los embeddings añaden un segundo modelo en Ollama (≈0,3–0,6 GB, además de los 6,6 GB de qwen3.5:9b con 16k de
  contexto), un índice de vectores que hay que mantener al día con cada edición, y que la búsqueda dependa de que
  Ollama esté encendido. Va contra la prioridad de sencillez.
- Límites de la medición: corpus pequeño, y las palabras clave las escribí yo conociendo las notas, lo que favorece a
  FTS5. Las preguntas naturales no tienen ese sesgo.

## Cuándo merecería la pena (y cómo)

Si con el uso real se ve que el buscador (Ctrl K) o Kio fallan por sinónimos («ITV» frente a «inspección técnica»):

1. Modelo: `embeddinggemma` (300M, multilingüe, en la biblioteca de Ollama) o `qwen3-embedding:0.6b`. Ambos caben
   sin problema junto a qwen3.5:9b en 16 GB.
2. Diseño mínimo: tabla `note_vectors(path, hash, vector)` en el índice derivado. Se rellena en segundo plano solo
   cuando Ollama responde. Búsqueda = FTS5 primero y, si hay vectores, fusión RRF. Sin Ollama, todo sigue funcionando
   con FTS5.
3. Volver a pasar esta misma evaluación (el script y el corpus están descritos arriba) con preguntas reales del uso
   diario antes de activarlo por defecto.
