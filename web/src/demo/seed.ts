// Datos de ejemplo para el modo Demo interactivo (Vercel / portfolio).
// Fechas relativas al día actual para que «Hoy», «Tareas» y «Calendario» siempre tengan sentido.
import { addDays, localDate } from "../../../src/core/dates.ts";
import { renderNote } from "../../../src/core/markdown.ts";
import type { Proposal } from "../../../src/core/proposals.ts";
import type { UndoRecord } from "../../../src/assistant/undo.ts";

export interface DemoState {
  version: number;
  seedDate: string;
  files: Record<string, { text: string; mtime: number }>;
  trash: Record<string, { text: string; mtime: number }>;
  focus: {
    active: boolean;
    id?: string;
    startedAt?: string;
    taskPath?: string | null;
    taskTitle?: string | null;
    projectPath?: string | null;
    projectTitle?: string | null;
  };
  proposals: Proposal[];
  actions: UndoRecord[];
  memories: { path: string; text: string }[];
}

export function simpleHash(text: string): string {
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export function buildSeedState(now = new Date()): DemoState {
  const today = localDate(now);
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const inTwoDays = addDays(today, 2);
  const inFourDays = addDays(today, 4);
  const baseTime = now.getTime();
  const files: Record<string, { text: string; mtime: number }> = {};

  let offset = 0;
  const put = (path: string, fm: Record<string, unknown>, body: string, ageMinutes = 0) => {
    offset += 1;
    const mtime = baseTime - ageMinutes * 60_000 - offset * 1000;
    const fullFm = {
      id: `01DEMO${String(offset).padStart(4, "0")}`,
      ...fm,
      created: new Date(mtime).toISOString(),
    };
    files[path] = { text: renderNote(fullFm, body), mtime };
  };

  // ── Áreas ──
  put("Areas/Trabajo.md", { type: "area", title: "Trabajo", color: "#7f9bd6" }, "# Trabajo\n\nProyectos principales, lanzamientos y producto.\n", 240);
  put("Areas/Ingeniería.md", { type: "area", title: "Ingeniería", color: "#8fb573" }, "# Ingeniería\n\nArquitectura de sistemas, lecturas técnicas y aprendizaje.\n", 300);
  put("Areas/Personal.md", { type: "area", title: "Personal", color: "#d2c3a3" }, "# Personal\n\nRutinas, lecturas y organización diaria.\n", 360);

  // ── Proyectos ──
  put(
    "Proyectos/Lanzamiento de Kioku Cloud.md",
    { type: "project", title: "Lanzamiento de Kioku Cloud", status: "active", aliases: ["Kioku Cloud", "Cloud"] },
    `# Lanzamiento de Kioku Cloud\n\n## Objetivo\n\nKioku funciona hoy **100 % local y gratis** en tu portátil. **Kioku Cloud** es solo una idea planificada (sin servicio alojado, precios ni cuentas) para quien quisiera sincronizar escritorio y móvil sin configurar daemons ni Tailscale.\n\nRelacionado con [[Filosofía Local-First]], [[Arquitectura de índices derivados]] y [[Sincronización móvil y PWA]].\n\n## Decisiones\n\n- ${yesterday} — Los archivos Markdown siguen siendo la única fuente de verdad también si algún día existe un servidor alojado (idea, sin implementar)\n- ${yesterday} — Demo interactiva 100 % en el navegador para el portfolio en Vercel sin coste de servidor\n- ${today} — Si Kioku Cloud llega a existir, aislar cada cuenta en su propio directorio (solo diseño, sin implementar)\n\n## Bitácora\n\n- ${yesterday} 18:40 — Terminado el motor de bases de datos sobre frontmatter YAML y el calendario de bloques\n- ${today} 09:20 — Lista la demo interactiva con datos de prueba; falta revisar la guía de instalación\n`,
    15,
  );

  put(
    "Proyectos/Portfolio y Marca Personal.md",
    { type: "project", title: "Portfolio y Marca Personal", status: "active", aliases: ["Portfolio", "Web"] },
    `# Portfolio y Marca Personal\n\n## Objetivo\n\nPublicar casos de estudio interactivos donde cualquiera pueda probar los proyectos reales en el navegador antes de instalarlos o leer el código.\n\nEnlaza con [[Sistema visual Tinta y Papel]] y [[Lanzamiento de Kioku Cloud]].\n\n## Decisiones\n\n- ${yesterday} — Usar tipografía Shippori Mincho empaquetada en local sin peticiones a Google Fonts\n- ${today} — Incluir enlace directo desde el portfolio a la demo viva de Kioku en Vercel\n\n## Bitácora\n\n- ${yesterday} 20:15 — Maquetada la comparativa entre instalación local y servidor alojado\n`,
    90,
  );

  put(
    "Proyectos/Laboratorio de Sistemas Local-First.md",
    { type: "project", title: "Laboratorio de Sistemas Local-First", status: "paused", aliases: ["Laboratorio"] },
    `# Laboratorio de Sistemas Local-First\n\n## Objetivo\n\nNotas de investigación sobre índices SQLite FTS5, resolución de conflictos por hash y jaulas de seguridad para agentes de IA.\n\nConsulta [[Arquitectura de índices derivados]], [[Seguridad del asistente en jaula]] y [[Lecturas de ingeniería]].\n\n## Decisiones\n\n- ${yesterday} — Priorizar operaciones deterministas con hash base frente a CRDTs complejos para mantener Markdown limpio\n\n## Bitácora\n\n- ${yesterday} 12:00 — Documentadas las pruebas de reconstrucción del índice desde cero\n`,
    1800,
  );

  // ── Tareas ──
  put(
    "Tareas/Publicar demo interactiva en Vercel y enlazarla en el portfolio.md",
    {
      type: "task",
      title: "Publicar demo interactiva en Vercel y enlazarla en el portfolio",
      status: "doing",
      priority: 1,
      due: today,
      estimate: 45,
      project: "[[Proyectos/Lanzamiento de Kioku Cloud]]",
      area: "[[Areas/Trabajo]]",
    },
    "# Publicar demo interactiva en Vercel y enlazarla en el portfolio\n\nComprobar que todas las vistas (Hoy, Proyectos, Calendario, Bases, Grafo y Asistente) responden al instante con datos de ejemplo y que el botón de restaurar devuelve el estado inicial.\n",
    10,
  );

  put(
    "Tareas/Redactar guía paso a paso de instalación local y servicio systemd.md",
    {
      type: "task",
      title: "Redactar guía paso a paso de instalación local y servicio systemd",
      status: "todo",
      priority: 1,
      due: today,
      estimate: 30,
      project: "[[Proyectos/Lanzamiento de Kioku Cloud]]",
      area: "[[Areas/Trabajo]]",
    },
    "# Redactar guía paso a paso de instalación local y servicio systemd\n\nDocumentar los comandos `kioku open`, `kioku add`, `kioku service install` y `kioku pair` en la portada.\n",
    25,
  );

  put(
    "Tareas/Definir contenedores por usuario y backups automáticos para Kioku Cloud.md",
    {
      type: "task",
      title: "Definir contenedores por usuario y backups automáticos para Kioku Cloud",
      status: "todo",
      priority: 2,
      due: tomorrow,
      estimate: 60,
      project: "[[Proyectos/Lanzamiento de Kioku Cloud]]",
      area: "[[Areas/Ingeniería]]",
    },
    "# Definir contenedores por usuario y backups automáticos para Kioku Cloud\n\nBorrador de diseño de una posible Kioku Cloud, aún sin implementar: un vault aislado por cuenta que se pueda descargar entero.\n",
    40,
  );

  put(
    "Tareas/Revisar contraste del tema claro papel en el grafo de notas.md",
    {
      type: "task",
      title: "Revisar contraste del tema claro papel en el grafo de notas",
      status: "todo",
      priority: 2,
      due: yesterday,
      estimate: 25,
      project: "[[Proyectos/Portfolio y Marca Personal]]",
      area: "[[Areas/Trabajo]]",
    },
    "# Revisar contraste del tema claro papel en el grafo de notas\n\nVerificar que los colores `--t-project`, `--t-task` y `--t-note` en [[Sistema visual Tinta y Papel]] mantienen buena legibilidad.\n",
    120,
  );

  put(
    "Tareas/Grabar vídeo corto mostrando captura rápida y aprobación de propuestas.md",
    {
      type: "task",
      title: "Grabar vídeo corto mostrando captura rápida y aprobación de propuestas",
      status: "todo",
      priority: 3,
      due: inTwoDays,
      estimate: 40,
      project: "[[Proyectos/Portfolio y Marca Personal]]",
      area: "[[Areas/Trabajo]]",
    },
    "# Grabar vídeo corto mostrando captura rápida y aprobación de propuestas\n\nEnseñar cómo una captura en Bandeja pasa por Propuestas antes de tocar cualquier archivo.\n",
    180,
  );

  put(
    "Tareas/Empaquetar tipografía Shippori Mincho sin peticiones externas.md",
    {
      type: "task",
      title: "Empaquetar tipografía Shippori Mincho sin peticiones externas",
      status: "done",
      done_at: new Date(baseTime - 3600_000 * 5).toISOString(),
      priority: 1,
      due: yesterday,
      estimate: 30,
      project: "[[Proyectos/Portfolio y Marca Personal]]",
      area: "[[Areas/Ingeniería]]",
    },
    "# Empaquetar tipografía Shippori Mincho sin peticiones externas\n\nServida desde `/fonts/` para que la PWA funcione 100 % sin conexión.\n",
    300,
  );

  // ── Bandeja (Capturas sin procesar) ──
  put(
    "Bandeja/Estudiar un posible cobro para Kioku Cloud.md",
    { type: "capture", title: "Estudiar un posible cobro para Kioku Cloud" },
    "Idea para más adelante: si Kioku Cloud llega a existir, estudiar cómo cobrarla. Sin proveedor ni precio definidos.\n",
    20,
  );

  put(
    "Bandeja/Idea de plantilla de base de datos para seguimiento de hábitos.md",
    { type: "capture", title: "Idea de plantilla de base de datos para seguimiento de hábitos" },
    "Añadir una cuarta plantilla en Bases además de Tareas, Proyectos y Libros para registrar lecturas y hábitos semanales.\n",
    55,
  );

  // ── Notas interconectadas (para el Grafo y el Editor) ──
  put(
    "Notas/Filosofía Local-First.md",
    { type: "note", title: "Filosofía Local-First", tags: ["arquitectura", "diseño", "local-first"] },
    `# Filosofía Local-First\n\nEn **Kioku**, tus pensamientos no viven encerrados en un formato propietario ni en una base de datos opaca:\n\n1. **Archivos Markdown reales**: cada nota, tarea, proyecto, bloque de calendario o base de datos es un archivo \`.md\` legible y compatible con Obsidian.\n2. **Índice SQLite derivable**: véase [[Arquitectura de índices derivados]]. Si borras \`.kioku/index.db\`, se reconstruye entero desde los archivos.\n3. **IA transparente y con aprobación**: véase [[Seguridad del asistente en jaula]]. Nada se mueve ni se sobrescribe en silencio.\n4. **Diseño sobrio sin red**: véase [[Sistema visual Tinta y Papel]] y [[Sincronización móvil y PWA]].\n\nEste mismo núcleo impulsa tanto la versión local como [[Lanzamiento de Kioku Cloud]].\n`,
    60,
  );

  put(
    "Notas/Arquitectura de índices derivados.md",
    { type: "note", title: "Arquitectura de índices derivados", tags: ["arquitectura", "sqlite", "fts5"] },
    `# Arquitectura de índices derivados\n\nKioku utiliza \`node:sqlite\` con **FTS5** (\`unicode61 remove_diacritics 2\`) para búsquedas instantáneas en español con y sin tildes.\n\n- **Verdad única**: los archivos \`.md\` del disco ([[Filosofía Local-First]]).\n- **Consultas de bases de datos**: las vistas de tabla, tablero y lista se calculan sobre el frontmatter YAML de las notas sin migraciones rígidas.\n- **Detección de conflictos**: cada escritura verifica el hash SHA-256 base del archivo para convivir con editores externos.\n\nDocumentado dentro de [[Laboratorio de Sistemas Local-First]].\n`,
    110,
  );

  put(
    "Notas/Sistema visual Tinta y Papel.md",
    { type: "note", title: "Sistema visual Tinta y Papel", tags: ["diseño", "ui", "tipografía"] },
    `# Sistema visual Tinta y Papel\n\nLa interfaz de Kioku está inspirada en un cuaderno japonés de trabajo:\n\n- **Dos temas de primera clase**: *Tinta* (oscuro cálido \`#0f0e0c\`) y *Papel* (claro editorial \`#f6f1e7\`), con un único color de acento índigo (藍).\n- **Tipografía local**: títulos en *Shippori Mincho* empaquetada en el propio build; cero llamadas a CDN externos.\n- **Sello 記**: trazos vectoriales puros en SVG.\n\nAplicado también en la portada de [[Portfolio y Marca Personal]].\n`,
    140,
  );

  put(
    "Notas/Seguridad del asistente en jaula.md",
    { type: "note", title: "Seguridad del asistente en jaula", tags: ["ia", "seguridad", "arquitectura"] },
    `# Seguridad del asistente en jaula\n\nEl asistente de Kioku nunca tiene acceso directo a tu sistema de archivos:\n\n- Corre aislado en una jaula (\`bwrap\` o contenedor sin montar la bóveda).\n- Solo puede invocar herramientas acotadas vía MCP con un token efímero por sesión.\n- **Tres niveles impuestos por el servidor**:\n  1. **Lectura** (máximo 5 notas por consulta, respetando carpetas excluidas).\n  2. **Acciones ligeras reversibles** (con registro de *Deshacer* instantáneo).\n  3. **Propuestas con hash**: mover, organizar o tocar varias notas genera siempre una propuesta que tú apruebas en la pestaña **Propuestas**.\n\nMás contexto en [[Filosofía Local-First]] y [[Laboratorio de Sistemas Local-First]].\n`,
    200,
  );

  put(
    "Notas/Sincronización móvil y PWA.md",
    { type: "note", title: "Sincronización móvil y PWA", tags: ["móvil", "pwa", "offline"] },
    `# Sincronización móvil y PWA\n\nKioku funciona en el móvil o iPad como una PWA instalable con **réplica en IndexedDB** y cola de capturas sin conexión:\n\n- En modo local, se empareja mediante \`kioku pair\` sobre Tailscale con una credencial limitada y revocable al instante.\n- Las carpetas privadas (\`.kioku/mobile.json\`) se filtran en el servidor y nunca viajan al teléfono.\n- Una posible **[[Lanzamiento de Kioku Cloud]]** (planificada, no disponible) evitaría configurar redes y daemons.\n`,
    220,
  );

  put(
    "Notas/Lecturas de ingeniería.md",
    { type: "note", title: "Lecturas de ingeniería", tags: ["lecturas", "ingeniería"] },
    `# Lecturas de ingeniería\n\nNotas conectadas con la base de datos de **Libros** y con [[Laboratorio de Sistemas Local-First]]:\n\n- [[Diseñando aplicaciones intensivas en datos]] — referencia clave para índices derivados y logs append-only.\n- [[El programador pragmático]] — diseño ortogonal y herramientas en texto plano.\n- [[Sistemas operativos en tres piezas fáciles]] — base para aislamiento de procesos y virtualización.\n`,
    260,
  );

  // ── Libros (filas de la base de datos Bases/Biblioteca técnica.md) ──
  put(
    "Libros/Diseñando aplicaciones intensivas en datos.md",
    {
      type: "note",
      title: "Diseñando aplicaciones intensivas en datos",
      Autor: "Martin Kleppmann",
      Estado: "Leído",
      Nota: 5,
      tags: ["libros", "sistemas"],
    },
    "# Diseñando aplicaciones intensivas en datos\n\nCapítulos clave sobre almacenamiento orientado a logs, índices secundarios derivados y replicación. Inspira directamente [[Arquitectura de índices derivados]].\n",
    400,
  );

  put(
    "Libros/El programador pragmático.md",
    {
      type: "note",
      title: "El programador pragmático",
      Autor: "David Thomas, Andrew Hunt",
      Estado: "Leído",
      Nota: 5,
      tags: ["libros", "ingeniería"],
    },
    "# El programador pragmático\n\nEl poder del texto plano: por qué guardar el conocimiento en Markdown ([[Filosofía Local-First]]) garantiza que tus notas sobrevivan a cualquier herramienta.\n",
    450,
  );

  put(
    "Libros/Sistemas operativos en tres piezas fáciles.md",
    {
      type: "note",
      title: "Sistemas operativos en tres piezas fáciles",
      Autor: "Remzi y Andrea Arpaci-Dusseau",
      Estado: "Leyendo",
      Nota: 5,
      tags: ["libros", "sistemas"],
    },
    "# Sistemas operativos en tres piezas fáciles\n\nVirtualización, concurrencia y persistencia: lectura de apoyo para [[Seguridad del asistente en jaula]] y [[Lecturas de ingeniería]].\n",
    500,
  );

  put(
    "Libros/Filosofía del diseño de software.md",
    {
      type: "note",
      title: "Filosofía del diseño de software",
      Autor: "John Ousterhout",
      Estado: "Quiero leer",
      Nota: 4,
      tags: ["libros", "diseño"],
    },
    "# Filosofía del diseño de software\n\nMódulos profundos con interfaces sencillas: el principio detrás de la fachada `Kioku`.\n",
    540,
  );

  // ── Bases de datos (`Bases/*.md`) ──
  put(
    "Bases/Biblioteca técnica.md",
    {
      type: "database",
      title: "Biblioteca técnica",
      source: { folder: "Libros/" },
      properties: {
        Estado: { type: "select", options: ["Quiero leer", "Leyendo", "Leído"] },
        Autor: { type: "text" },
        Nota: { type: "number" },
      },
      views: [
        { name: "Tabla", kind: "table", columns: ["title", "Estado", "Autor", "Nota"], filter: [], sort: [{ prop: "Nota", dir: "desc" }], group: null },
        { name: "Por estado", kind: "board", columns: ["title", "Autor", "Nota"], filter: [], sort: [], group: "Estado" },
        { name: "Lista", kind: "list", columns: ["title", "Estado", "Autor"], filter: [], sort: [], group: null },
      ],
    },
    "# Biblioteca técnica\n\nBase de datos sobre la carpeta `Libros/`. Puedes cambiar de vista entre **Tabla**, **Por estado (Tablero Kanban)** y **Lista**, editar cualquier celda o añadir filas nuevas.\n",
    320,
  );

  put(
    "Bases/Mapa de tareas.md",
    {
      type: "database",
      title: "Mapa de tareas",
      source: { type: "task" },
      properties: {
        status: { type: "select", options: ["todo", "doing", "done", "dropped"] },
        due: { type: "date" },
        priority: { type: "number" },
        estimate: { type: "number" },
      },
      views: [
        { name: "Tablero", kind: "board", columns: ["title", "due", "priority"], filter: [], sort: [{ prop: "priority", dir: "asc" }], group: "status" },
        { name: "Tabla", kind: "table", columns: ["title", "status", "due", "priority", "estimate"], filter: [], sort: [{ prop: "due", dir: "asc" }], group: null },
      ],
    },
    "# Mapa de tareas\n\nVista de base de datos sobre todas las notas con `type: task`.\n",
    330,
  );

  // ── Calendario (`Calendario/*.md`) ──
  put(
    "Calendario/bloque-demo-vercel.md",
    {
      type: "block",
      title: "Publicar demo interactiva en Vercel y enlazarla en el portfolio",
      kind: "block",
      start: `${today}T09:30`,
      end: `${today}T10:45`,
      task: "[[Tareas/Publicar demo interactiva en Vercel y enlazarla en el portfolio]]",
      project: "[[Proyectos/Lanzamiento de Kioku Cloud]]",
      area: "[[Areas/Trabajo]]",
    },
    "# Publicar demo interactiva en Vercel y enlazarla en el portfolio\n",
    35,
  );

  put(
    "Calendario/evento-revision-arquitectura.md",
    {
      type: "block",
      title: "Revisión de arquitectura: Kioku Cloud multi-tenant",
      kind: "event",
      start: `${today}T11:30`,
      end: `${today}T12:15`,
      area: "[[Areas/Ingeniería]]",
    },
    "# Revisión de arquitectura: Kioku Cloud multi-tenant\n",
    50,
  );

  put(
    "Calendario/bloque-guia-instalacion.md",
    {
      type: "block",
      title: "Redactar guía paso a paso de instalación local y servicio systemd",
      kind: "block",
      start: `${today}T16:00`,
      end: `${today}T17:00`,
      task: "[[Tareas/Redactar guía paso a paso de instalación local y servicio systemd]]",
      project: "[[Proyectos/Lanzamiento de Kioku Cloud]]",
      area: "[[Areas/Trabajo]]",
    },
    "# Redactar guía paso a paso de instalación local y servicio systemd\n",
    65,
  );

  put(
    "Calendario/bloque-contenedores-cloud.md",
    {
      type: "block",
      title: "Definir contenedores por usuario y backups automáticos",
      kind: "block",
      start: `${tomorrow}T10:00`,
      end: `${tomorrow}T11:30`,
      task: "[[Tareas/Definir contenedores por usuario y backups automáticos para Kioku Cloud]]",
      project: "[[Proyectos/Lanzamiento de Kioku Cloud]]",
      area: "[[Areas/Ingeniería]]",
    },
    "# Definir contenedores por usuario y backups automáticos\n",
    75,
  );

  // ── Diario de hoy ──
  put(
    `Diario/${today}.md`,
    {
      type: "journal",
      title: today,
      focus: ["[[Proyectos/Lanzamiento de Kioku Cloud]]"],
    },
    `# ${today}\n\n- Preparando el despliegue en Vercel con datos de prueba interactivos para el portfolio.\n- Revisando el flujo de instalación local y la idea de **Kioku Cloud** (planificada).\n- Idea: enlazar [[Filosofía Local-First]] desde la guía de bienvenida.\n`,
    5,
  );

  // ── Propuestas iniciales pendientes ──
  const capPath = "Bandeja/Estudiar un posible cobro para Kioku Cloud.md";
  const capHash = simpleHash(files[capPath].text);
  const proposals: Proposal[] = [
    {
      id: "prop-demo-1",
      createdAt: new Date(baseTime - 1200_000).toISOString(),
      source: "rules",
      status: "pending",
      key: `triage:${capPath}`,
      title: "Convertir en tarea de «Lanzamiento de Kioku Cloud»: Estudiar un posible cobro para Kioku Cloud",
      rationale: "Empieza con un verbo de acción («Estudiar») y menciona «Kioku Cloud».",
      ops: [
        {
          op: "setProp",
          path: capPath,
          before: capHash,
          props: { type: "task", status: "todo", project: "[[Lanzamiento de Kioku Cloud]]", due: inFourDays },
        },
        {
          op: "move",
          from: capPath,
          to: "Tareas/Estudiar un posible cobro para Kioku Cloud.md",
          before: capHash,
        },
      ],
    },
  ];

  // ── Historial de acción reversible del asistente ──
  const actions: UndoRecord[] = [
    {
      id: "undo-demo-1",
      ts: new Date(baseTime - 2400_000).toISOString(),
      sessionId: "demo-session",
      tool: "set_props",
      summary: "Prioridad P1 asignada a «Publicar demo interactiva en Vercel y enlazarla en el portfolio»",
      files: [],
    },
  ];

  const memories = [
    {
      path: "preferencias-trabajo.md",
      text: "Prefiere bloques de foco de 45–60 minutos por la mañana para tareas de arquitectura y dejar revisiones de diseño para después de comer.",
    },
    {
      path: "stack-kioku.md",
      text: "Kioku mantiene los archivos Markdown como única fuente de verdad; la demo de Vercel corre 100 % en el navegador y Kioku Cloud es solo una idea planificada.",
    },
  ];

  return {
    version: 1,
    seedDate: today,
    files,
    trash: {},
    focus: { active: false },
    proposals,
    actions,
    memories,
  };
}
