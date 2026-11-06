// Portada de presentación, guía de instalación local, nota sobre Kioku Cloud (planificado) + barra superior del modo Demo.
import { useState } from "preact/hooks";
import { SEAL_PATH } from "./seal.ts";

const Seal = () => (
  <svg class="seal" viewBox="12 12 76 76" aria-hidden="true">
    <rect x="12" y="12" width="76" height="76" rx="9" />
    <path d={SEAL_PATH} />
  </svg>
);

const DEMO_TOUR: { title: string; badge: string; desc: string; route: string }[] = [
  {
    title: "Hoy y sesiones de Foco",
    badge: "Priorización explicable",
    desc: "Sugiere el siguiente paso explicando el porqué (fecha límite, prioridad, proyecto activo) y guarda checkpoints para retomar donde lo dejaste.",
    route: "/hoy",
  },
  {
    title: "Proyectos con contexto vivo",
    badge: "Decisiones + Bitácora",
    desc: "Cada proyecto reúne su objetivo, decisiones tomadas, último checkpoint, tareas abiertas y el payload exacto que vería una IA.",
    route: "/proyecto/Proyectos/Lanzamiento de Kioku Cloud.md",
  },
  {
    title: "Calendario de bloques y huecos",
    badge: "Día y Semana",
    desc: "Planifica bloques de trabajo y eventos sobre notas Markdown. Terminar un bloque y completar una tarea son acciones independientes.",
    route: "/calendario",
  },
  {
    title: "Bases de datos sobre Markdown",
    badge: "Tabla · Tablero · Lista",
    desc: "Vistas tipo Notion calculadas al vuelo sobre el frontmatter YAML de tus notas, sin bases de datos propietarias.",
    route: "/bases/Bases/Biblioteca técnica.md",
  },
  {
    title: "Grafo interactivo de notas",
    badge: "Enlaces [[wikilink]]",
    desc: "Visualiza cómo se conectan tus ideas, proyectos y lecturas en un motor de fuerzas propio sobre canvas.",
    route: "/grafo",
  },
  {
    title: "Asistente y Propuestas con hash",
    badge: "Cero cambios silenciosos",
    desc: "Todo cambio estructural pasa por propuestas verificadas por hash. Lo automático tiene siempre botón Deshacer.",
    route: "/propuestas",
  },
];

const INSTALL_STEPS: { step: string; title: string; desc: string; cmd: string }[] = [
  {
    step: "01",
    title: "Clona el repositorio y construye la interfaz",
    desc: "Requiere Node.js 24+ (ejecuta TypeScript nativo en el daemon sin pasos de compilación pesados).",
    cmd: "git clone https://github.com/EzequielMenor/kioku.git\ncd kioku\nnpm install && npm run build:web",
  },
  {
    step: "02",
    title: "Abre el espacio de trabajo o captura desde la terminal",
    desc: "El daemon arranca en 127.0.0.1 y crea tu bóveda de archivos Markdown en ~/Documents/Kioku (configurable con KIOKU_HOME).",
    cmd: "./bin/kioku open\n./bin/kioku add \"t Revisar arquitectura !mañana @Kioku p1\"",
  },
  {
    step: "03",
    title: "Opcional: servicio automático y móvil con Tailscale",
    desc: "Activa el arranque con tu sesión de usuario o genera un enlace con credencial limitada y revocable para tu móvil o iPad.",
    cmd: "./bin/kioku service install\n./bin/kioku pair",
  },
  {
    step: "04",
    title: "Opcional: importa tus notas desde Obsidian",
    desc: "Copia de solo lectura a Notas/Importado/ con informe de enlaces rotos. Tu bóveda original de Obsidian no se modifica nunca.",
    cmd: "./bin/kioku import-obsidian ~/Documentos/MiVaultObsidian --yes",
  },
];

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div class="landing-code">
      <pre><code>{code}</code></pre>
      <button type="button" class="mini copy-btn" onClick={copy}>{copied ? "✓ Copiado" : "Copiar"}</button>
    </div>
  );
}

export function DemoBar({ onReset, onLanding }: { onReset(): void; onLanding(): void }) {
  return (
    <div class="demobar" role="region" aria-label="Modo demostración">
      <span class="demobar-badge">Modo demo</span>
      <span class="demobar-text">Estás probando Kioku en vivo con datos de ejemplo guardados solo en tu navegador.</span>
      <div class="demobar-actions">
        <button type="button" class="mini" onClick={onReset}>Restaurar datos de prueba</button>
        <button type="button" class="mini accent-btn" onClick={onLanding}>Cómo instalar →</button>
      </div>
    </div>
  );
}

export function LandingView({
  theme,
  setTheme,
  onStartDemo,
}: {
  theme: string;
  setTheme(t: string): void;
  onStartDemo(route?: string): void;
}) {
  const [cloudModal, setCloudModal] = useState(false);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div class="landing">
      <header class="landing-nav">
        <div class="landing-nav-inner">
          <a href="#/inicio" class="brand landing-brand"><Seal />Kioku</a>
          <nav class="landing-links" aria-label="Secciones de la portada">
            <button type="button" class="link" onClick={() => scrollTo("explorar")}>Explorar demo</button>
            <button type="button" class="link" onClick={() => scrollTo("instalar")}>Instalación local</button>
            <button type="button" class="link" onClick={() => scrollTo("cloud")}>Kioku Cloud</button>
          </nav>
          <div class="landing-cta-group">
            <button
              type="button"
              class="mini"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Cambiar tema visual"
            >
              Tema: {theme === "light" ? "papel (claro)" : "tinta (oscuro)"}
            </button>
            <button type="button" class="primary" onClick={() => onStartDemo("/hoy")}>
              Probar demo en vivo →
            </button>
          </div>
        </div>
      </header>

      <main class="landing-main">
        {/* ── Hero ── */}
        <section class="landing-hero">
          <div class="eyebrow">Segundo cerebro local-first · Markdown + SQLite FTS5 + IA con aprobación</div>
          <h1 class="landing-title">Tus ideas, proyectos y calendario en archivos Markdown que te pertenecen.</h1>
          <p class="landing-lead">
            <strong>Kioku (記)</strong> une la rapidez de captura en texto plano con vistas de bases de datos, calendario de bloques,
            grafo de enlaces y un asistente aislado que <em>jamás</em> modifica tus notas en silencio. Pruébalo ahora mismo en tu
            navegador con datos de ejemplo o instálalo gratis en tu máquina. Un servicio alojado, <strong>Kioku Cloud</strong>, es solo una idea
            planificada: hoy no existe.
          </p>
          <div class="landing-hero-btns">
            <button type="button" class="primary btn-lg" onClick={() => onStartDemo("/hoy")}>
              Probar demo interactiva (con datos de prueba) →
            </button>
            <button type="button" class="btn-lg" onClick={() => scrollTo("instalar")}>
              Instalar gratis en mi equipo
            </button>
            <button type="button" class="btn-lg" onClick={() => scrollTo("cloud")}>
              Sobre Kioku Cloud (planificado)
            </button>
          </div>
          <div class="landing-QuickPills">
            <span class="muted small">Saltar directo a una vista de la demo:</span>
            <button type="button" class="pill accent" onClick={() => onStartDemo("/hoy")}>Hoy y Foco</button>
            <button type="button" class="pill" onClick={() => onStartDemo("/calendario")}>Calendario</button>
            <button type="button" class="pill" onClick={() => onStartDemo("/bases/Bases/Biblioteca técnica.md")}>Bases (Tabla / Kanban)</button>
            <button type="button" class="pill" onClick={() => onStartDemo("/grafo")}>Grafo de notas</button>
            <button type="button" class="pill" onClick={() => onStartDemo("/asistente")}>Asistente IA</button>
            <button type="button" class="pill" onClick={() => onStartDemo("/propuestas")}>Propuestas</button>
          </div>
        </section>

        {/* ── Explorar vistas de la Demo ── */}
        <section id="explorar" class="landing-section">
          <div class="eyebrow">Demo 100 % funcional en el navegador</div>
          <h2>Haz clic en cualquier módulo para probarlo con datos de ejemplo</h2>
          <p class="muted">
            En la demo puedes crear tareas, editar notas en CodeMirror 6, arrastrar tarjetas en el tablero Kanban, programar bloques en el
            calendario y aprobar propuestas. Tus pruebas se guardan en tu propio navegador sin afectar a otros visitantes.
          </p>
          <div class="landing-grid">
            {DEMO_TOUR.map((item) => (
              <article key={item.route} class="card landing-card" onClick={() => onStartDemo(item.route)}>
                <div class="row" style="margin-top:0;justify-content:space-between">
                  <span class="chip accent">{item.badge}</span>
                  <span class="muted small">Abrir en demo →</span>
                </div>
                <h3>{item.title}</h3>
                <p class="muted">{item.desc}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Guía de instalación local ── */}
        <section id="instalar" class="landing-section">
          <div class="eyebrow">Open Source · Licencia MIT · 100 % Local</div>
          <h2>Cómo instalar Kioku en tu equipo</h2>
          <p class="muted">
            Si prefieres llevar tus notas en tu propio disco duro sin depender de ningún servidor externo, puedes instalar Kioku gratis en
            menos de dos minutos.
          </p>
          <div class="landing-steps">
            {INSTALL_STEPS.map((s) => (
              <div key={s.step} class="card landing-step">
                <div class="landing-step-head">
                  <span class="step-num">{s.step}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p class="muted small">{s.desc}</p>
                  </div>
                </div>
                <CopyCode code={s.cmd} />
              </div>
            ))}
          </div>
        </section>

        {/* ── Kioku Cloud (planificado) ── */}
        <section id="cloud" class="landing-section">
          <div class="eyebrow">Planificado · aún no disponible</div>
          <h2>Kioku Cloud: una idea, no un servicio</h2>
          <p class="muted">
            Hoy Kioku solo se usa en tu propio equipo o en esta demo del navegador. No hay servicio alojado, ni cuentas, ni planes de
            pago. Si algún día existe, tu bóveda seguirá siendo una carpeta de archivos Markdown estándar.
          </p>

          <div class="pricing-grid">
            <div class="card pricing-card">
              <div class="eyebrow">Disponible hoy</div>
              <h3>Kioku en tu equipo</h3>
              <div class="price-tag">Gratis <span class="muted small">· código abierto (MIT)</span></div>
              <p class="muted small">Ideal si usas Linux o macOS y quieres ejecutar el daemon en tu propio portátil o servidor casero.</p>
              <ul class="pricing-list">
                <li>✓ Archivos <code>.md</code> e índice SQLite FTS5 en tu disco</li>
                <li>✓ Todas las vistas: Hoy, Proyectos, Tareas, Calendario, Bases y Grafo</li>
                <li>✓ Captura rápida (<code>kioku quick</code> / <code>kioku add</code>)</li>
                <li>✓ Conecta tu propio modelo local (Ollama) o tu clave de API</li>
                <li>✓ Acceso desde el móvil con tu propia cuenta de Tailscale mientras tu ordenador esté encendido</li>
              </ul>
              <div class="row">
                <button type="button" onClick={() => scrollTo("instalar")}>Ver comandos de instalación</button>
                <button type="button" class="subtle" onClick={() => onStartDemo("/hoy")}>Probar demo</button>
              </div>
            </div>

            <div class="card pricing-card featured">
              <div class="row" style="margin-top:0;justify-content:space-between">
                <div class="eyebrow" style="color:var(--accent);margin:0">Servidor alojado · sin instalar nada</div>
                <span class="chip accent">Planificado</span>
              </div>
              <h3>Kioku Cloud</h3>
              <p class="muted small">
                Idea en estudio: un servidor alojado por terceros para entrar desde cualquier dispositivo sin instalar nada. Sin fecha, sin precio y sin
                lista de espera.
              </p>
              <ul class="pricing-list">
                <li>· No hay servicio alojado disponible</li>
                <li>· No hay cuentas, planes ni cobros</li>
                <li>· Esta página no recoge correos ni datos tuyos</li>
              </ul>
              <div class="row">
                <button type="button" onClick={() => setCloudModal(true)}>Más información</button>
                <button type="button" class="primary" onClick={() => onStartDemo("/hoy")}>Probar la demo</button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer class="landing-footer">
        <div class="landing-nav-inner">
          <div class="muted small">
            <strong>Kioku (記)</strong> — Segundo cerebro local-first en Markdown · Diseño «Tinta y Papel»
          </div>
          <div class="row" style="margin:0">
            <button type="button" class="link small" onClick={() => onStartDemo("/hoy")}>Abrir demo interactiva</button>
            <span class="muted">·</span>
            <button type="button" class="link small" onClick={() => scrollTo("instalar")}>Instalar</button>
            <span class="muted">·</span>
            <button type="button" class="link small" onClick={() => scrollTo("cloud")}>Kioku Cloud</button>
          </div>
        </div>
      </footer>

      {cloudModal && (
        <div class="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setCloudModal(false); }}>
          <div class="modal" role="dialog" aria-modal="true" aria-label="Sobre Kioku Cloud">
            <h2>Kioku Cloud está planificado</h2>
            <p>Todavía no existe ningún servicio alojado: no hay cuentas, planes ni cobros que contratar.</p>
            <p class="muted small">
              Esta página no recoge tu correo ni ningún otro dato, y no hay lista de espera. Mientras tanto puedes probar todas las
              funciones en el modo demo (los datos se quedan en tu navegador) o instalar Kioku en tu equipo.
            </p>
            <div class="row end">
              <button type="button" onClick={() => setCloudModal(false)}>Cerrar</button>
              <button type="button" class="primary" onClick={() => { setCloudModal(false); onStartDemo("/hoy"); }}>Ir a la demo interactiva →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
