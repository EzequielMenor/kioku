# El recorrido diario de Kioku

El sprint parte de `a104155`. El commit funcional es `f619049` en `feat/ux-captura-diaria`. Las capturas son de Kioku servido en loopback con una bóveda temporal inicialmente vacía y sin motor de IA. Se usaron dos sesiones de Chromium, una de escritorio a 1280 × 800 y otra con el rol móvil y viewport táctil de 390 × 844.

| Recorrido | Antes | Después |
| --- | --- | --- |
| Primer uso | «Hoy» decía que «Llamar a Ana mañana» crearía una tarea con fecha mientras el propio formulario indicaba que Kio estaba desconectado. | «Hoy» enlaza con Sin organizar. «Crear una tarea» abre la captura con Tarea seleccionada y funciona sin modelo. |
| Captura | En escritorio solo se podía guardar pulsando Intro. En móvil, «Más» ofrecía Buscar y carecía de acceso a Capturar. | «Más → Capturar» y el acceso de escritorio abren el mismo formulario. Permite elegir Idea, Tarea, Nota o Decisión, cambiar el destino y guardar o cancelar. Si el servidor rechaza el guardado, el texto sigue disponible para corregirlo. |
| Búsqueda | Después de encontrar «Huerto de invierno», un fallo HTTP 503 al buscar «mandarina» dejaba la nota anterior disponible para abrir. | Al cambiar de consulta desaparece el resultado previo. La paleta comunica la espera, ofrece Reintentar si falla y distingue la búsqueda completada sin coincidencias. |

## Capturas comparativas

Cada pareja muestra el mismo punto del recorrido. Para abrir la captura móvil del antes hubo que enviar el atajo de teclado al navegador.

| Pantalla | Escritorio | Móvil |
| --- | --- | --- |
| Hoy | [Antes](antes-escritorio-hoy.png) · [Después](despues-escritorio-hoy.png) | [Antes](antes-movil-hoy.png) · [Después](despues-movil-hoy.png) |
| Captura de una idea | [Antes](antes-escritorio-captura.png) · [Después](despues-escritorio-captura.png) | [Antes](antes-movil-captura.png) · [Después](despues-movil-captura.png) |
| Buscar tras un fallo | [Antes](antes-escritorio-buscar.png) · [Después](despues-escritorio-buscar.png) | [Antes](antes-movil-buscar.png) · [Después](despues-movil-buscar.png) |
| Menú Más | | [Antes](antes-movil-mas.png) · [Después](despues-movil-mas.png) |

## Probar con una bóveda desechable

Desde la raíz del worktree, con Node 24 o posterior y las dependencias locales instaladas, ejecuta lo siguiente.

```sh
npm run build:web
node docs/validation/ux-diaria/probar.mjs
```

El lanzador muestra dos enlaces locales con claves temporales. Abre el enlace móvil en un perfil separado o una ventana privada para conservar la sesión de escritorio. En las herramientas de desarrollo, elige un viewport de 390 × 844. Ctrl+C cierra el servidor y elimina su bóveda de pruebas.

1. En «Hoy», guarda «Huerto de invierno» en la caja principal. Abre «Sin organizar», pulsa «→ Nota» y búscala con el botón Buscar o con Ctrl+K. En móvil encontrarás Buscar en Más.
2. Vuelve a «Hoy», pulsa «Crear una tarea» y escribe «Preparar el semillero». Comprueba que Tarea está seleccionada. Guarda y abre «Tareas». Márcala como hecha y pulsa «Deshacer» en el aviso.
3. En móvil, abre «Más → Capturar». Escribe «Calendario de siembra», cambia de Tarea a Nota y guarda. Para probar la cola, corta la red **después de abrir la sesión móvil** y antes de guardar. Al restablecerla, busca la nota.
4. Para reproducir automáticamente el fallo de búsqueda, la recuperación y la sincronización móvil, ejecuta las regresiones de navegador con el build generado.

```sh
node --test test/daily-flow-browser.test.ts
```

## Evidencia y alcance

- En la versión inicial fallaron las tres regresiones de navegador. En el commit funcional pasaron las tres. El caso móvil también verifica que la nota llega a la bóveda con el título y tipo elegidos después de recuperar la conexión.
- Dos recorridos en Chromium con clics e introducción de texto comprobaron guardar una idea, convertirla en nota y encontrarla, convertir otra idea en tarea, completarla y deshacer hasta que el estado en la bóveda volvió a pendiente. Un rechazo HTTP 422 mantuvo el texto en el formulario. Reintentar con el prefijo `n` creó una nota. El 422 y el 503 se indujeron en el cliente para comprobar sus estados de error.
- En la rama del sprint, `npm run build:web` y `npm run typecheck` finalizaron con código 0. `npm test` registró **853 aprobadas, 0 fallidas y 4 omitidas** de 857. Dos requieren macOS y otras dos requieren la combinación de bwrap y Hermes.
- La integración avanzó a `53efb40` durante el sprint. En una copia temporal de ese commit, el parche de producto y pruebas se aplicó con todos los cambios de Claude presentes. El build, los tipos y las tres regresiones de navegador pasaron también allí. La suite completa se ejecutó en la rama del sprint.
- Las pruebas móviles usaron Chromium con el rol móvil real. Quedan fuera de la comprobación Safari/iOS físico, el teclado virtual del dispositivo, la ventana Quick nativa y la experiencia con un modelo real conectado.
- ProjectOS devolvió HTTP 403 por token inválido o revocado al intentar consultar `next_work` del proyecto JARV. La evidencia queda en los commits locales, pendiente de asociarla al issue correspondiente cuando se recupere el acceso.

## Integración posterior

Cuando acordéis la integración con Claude, cread una rama de revisión desde la punta vigente de `integration/kioku-cierre`. Incorporad allí `f619049` y, para conservar esta guía y sus imágenes, el commit de documentación que le sigue en `feat/ux-captura-diaria`. Si la integración ha vuelto a avanzar, revisad especialmente `web/src/app.tsx` y `web/src/app.css`. Repetid el build antes de las pruebas del navegador, además del typecheck y la suite completa.
