// Medidas de la pantalla para diagnosticar problemas de altura en iOS (PWA instalada vs. Safari); se muestran en «Más».
export interface ScreenSnapshot {
  inner: [number, number];
  screen: [number, number];
  visual: [number, number] | null;
  safeTop: number;
  safeBottom: number;
  standalone: boolean;
}

const px = ([w, h]: [number, number]) => `${Math.round(w)}×${Math.round(h)}`;

export function formatScreen(s: ScreenSnapshot): string {
  return [
    `ventana ${px(s.inner)}`,
    `pantalla ${px(s.screen)}`,
    ...(s.visual ? [`visual ${px(s.visual)}`] : []),
    `área segura ↑${Math.round(s.safeTop)} ↓${Math.round(s.safeBottom)}`,
    s.standalone ? "app instalada" : "navegador",
  ].join(" · ");
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
    standalone: matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true,
  };
}
