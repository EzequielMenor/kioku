// Medidas de la pantalla para diagnosticar problemas de altura en iOS (PWA instalada vs. Safari); se muestran en «Más».
export interface ScreenSnapshot {
  inner: [number, number];
  screen: [number, number];
  visual: [number, number] | null;
  safeTop: number;
  safeBottom: number;
  standalone: boolean;
  /** Altura en px de 100lvh y 100vh según el navegador (0 si no entiende la unidad). */
  units?: { lvh: number; vh: number };
  /** Altura que `watchAppHeight` ha aplicado (`--app-h`) y dónde acaba la barra inferior; null si no hay. */
  layout?: { appH: number | null; navBottom: number | null };
}

const px = ([w, h]: [number, number]) => `${Math.round(w)}×${Math.round(h)}`;

export function formatScreen(s: ScreenSnapshot): string {
  return [
    `ventana ${px(s.inner)}`,
    `pantalla ${px(s.screen)}`,
    ...(s.visual ? [`visual ${px(s.visual)}`] : []),
    `área segura ↑${Math.round(s.safeTop)} ↓${Math.round(s.safeBottom)}`,
    s.standalone ? "app instalada" : "navegador",
    ...(s.units ? [`lvh ${Math.round(s.units.lvh)} · vh ${Math.round(s.units.vh)}`] : []),
    ...(s.layout ? [`app-h ${s.layout.appH === null ? "sin" : Math.round(s.layout.appH)} · barra ↓${s.layout.navBottom === null ? "sin" : Math.round(s.layout.navBottom)}`] : []),
  ].join(" · ");
}

/**
 * Altura a la que anclar la app, o null si no hay que tocar nada. En la PWA instalada de iOS la ventana
 * (`innerHeight`) puede quedarse más corta que la pantalla y deja una franja bajo la barra inferior; si el
 * propio navegador declara una altura mayor (lvh/vh) se usa esa, sin pasar nunca de la pantalla.
 * En una pestaña de Safari lvh incluye la barra del navegador, así que ahí no se usa.
 */
export function appHeight(m: { standalone: boolean; inner: number; screen: number; lvh: number; vh: number }): number | null {
  if (!m.standalone) return null;
  const h = Math.min(Math.max(m.lvh, m.vh), m.screen);
  return h > m.inner ? Math.round(h) : null;
}

function isStandalone(): boolean {
  return matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Altura en px que el navegador da a una unidad CSS de viewport (0 si no la entiende). */
function unitHeight(unit: string): number {
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:100${unit}`;
  document.body.appendChild(probe);
  const h = probe.offsetHeight;
  probe.remove();
  return h;
}

/** Mantiene `--app-h` (altura de la app en móvil) al día; la hoja de estilos la usa en `.shell`. */
export function watchAppHeight(): void {
  const apply = () => {
    const h = appHeight({ standalone: isStandalone(), inner: window.innerHeight, screen: Math.max(screen.width, screen.height), lvh: unitHeight("lvh"), vh: unitHeight("vh") });
    const root = document.documentElement.style;
    if (h) root.setProperty("--app-h", `${h}px`); else root.removeProperty("--app-h");
  };
  apply();
  addEventListener("resize", apply);
  addEventListener("orientationchange", apply);
}

/** Lee las medidas del navegador; las áreas seguras se miden con un elemento sonda porque `env()` solo existe en CSS. */
export function readScreen(): ScreenSnapshot {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const safeTop = parseFloat(cs.paddingTop) || 0, safeBottom = parseFloat(cs.paddingBottom) || 0;
  probe.remove();
  const vv = window.visualViewport;
  return {
    inner: [window.innerWidth, window.innerHeight],
    screen: [screen.width, screen.height],
    visual: vv ? [vv.width, vv.height] : null,
    safeTop,
    safeBottom,
    standalone: isStandalone(),
    units: { lvh: unitHeight("lvh"), vh: unitHeight("vh") },
    layout: {
      appH: parseFloat(document.documentElement.style.getPropertyValue("--app-h")) || null,
      navBottom: document.querySelector(".bottomnav")?.getBoundingClientRect().bottom ?? null,
    },
  };
}
