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
  /** Dónde acaba la barra inferior (px desde arriba); null si no hay. */
  navBottom?: number | null;
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
    ...(s.navBottom !== undefined ? [`barra ↓${s.navBottom === null ? "sin" : Math.round(s.navBottom)}`] : []),
  ].join(" · ");
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
    navBottom: document.querySelector(".bottomnav")?.getBoundingClientRect().bottom ?? null,
  };
}
