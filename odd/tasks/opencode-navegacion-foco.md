# OpenCode Go, navegación y foco

ProjectOS no está disponible en esta sesión. Avance registrado en el repositorio.

- OpenCode Go aparece en el selector del asistente. El motor nativo usa el catálogo y el endpoint de inferencia oficiales. Los envíos HTTPS a `opencode.ai` incluyen `x-opencode-session` estable por conversación, también con un endpoint personalizado.
- Proyectos tiene entrada en el lateral de escritorio y en «Más» en móvil. Tareas mantiene el mismo ancho en Lista, Tabla y Tablero. Notas, Sin organizar y Grafo comparten ancho y alineación.
- Calendario prescinde del panel de tareas pendientes. Las actividades conservan el enlace a tareas y la opción de programarlas desde un hueco. Bases conserva las altas al pie de las vistas.
- El foco resuelve la ruta actual mediante el identificador de la nota. Kioku registra el destino de los renombrados también para sesiones antiguas y notas sin identificador. Si una ruta anterior ya no existe y no hay forma de resolverla, se puede terminar el foco sin intentar abrirla.
- `npm test` con Node 24: 849 aprobadas, 44 omitidas, 0 fallidas. `npm run typecheck` y `git diff --check` correctos. Chromium confirmó tamaños y posición a 640, 1100 y 1520 píxeles sobre el CSS actual. La conexión se probó con respuestas simuladas. La aplicación instalada y el paquete web previo no se actualizaron.
