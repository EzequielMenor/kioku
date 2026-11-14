// Kio, el personaje del compañero: pinta en un canvas lo que dice `companion/character.json`.
// El mismo algoritmo (mismos parámetros, mismos tiempos) está portado a Cairo en `companion/overlay/face.py`
// para el escritorio: si cambias uno, cambia el otro. Solo usa primitivas que existen en ambos (arcos, líneas, rellenos).
import spec from "../../companion/character.json" with { type: "json" };

export type FaceState = keyof typeof spec.states;
export type Palette = { accent: string; ink: string; good: string; bad: string; warn: string; muted: string; paper: string };
type StateSpec = { open: number; arc: number; tilt: number; raise: number; look: number[]; motion: string; badge: string | null; tone: string; body: string; blink: boolean };

const STATES = spec.states as Record<string, StateSpec>;
export const FACE_STATES = Object.keys(STATES) as FaceState[];
export const CHARACTER_NAME = spec.name;

/** Parámetros numéricos que se interpolan entre estados (lo demás cambia de golpe). */
interface Pose { open: number; arc: number; tilt: number; raise: number; lookX: number; lookY: number; mix: number[] }

const hex = (c: string): number[] => {
  const h = c.replace("#", "");
  const v = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
};
const rgb = (c: number[], a = 1) => `rgba(${c.map((x) => Math.round(x)).join(",")},${a})`;

export interface Face {
  set(state: FaceState): void;
  /** Dibuja un fotograma en el instante `t` (segundos). Sin `t` usa el reloj propio. */
  draw(t?: number): void;
  start(): void;
  stop(): void;
}

export function poseTarget(state: FaceState, palette: Palette): Pose {
  const s = STATES[state];
  return { open: s.open, arc: s.arc, tilt: s.tilt, raise: s.raise, lookX: s.look[0], lookY: s.look[1], mix: hex(palette[s.body as keyof Palette]) };
}

/** Transformación del cuerpo según el movimiento del estado: [dx, dy, escalaX, escalaY] en fracciones del lado. */
export function motion(name: string, t: number, since: number): number[] {
  const tau = t - since;
  switch (name) {
    case "breathe": return [0, 0, 1, 1 + 0.014 * Math.sin(t * 1.7)];
    case "lean": return [0, -0.02, 1.03, 1.03 + 0.008 * Math.sin(t * 3)];
    case "orbit": return [0, 0.006 * Math.sin(t * 2.4), 1, 1];
    case "talk": return [0, -0.012 * Math.abs(Math.sin(t * 7)), 1, 1];
    case "nudge": { const p = (tau % 2.6) / 0.36; return [0, p < 1 ? -0.06 * Math.sin(p * Math.PI) : 0, 1, 1]; }
    case "bounce": return [0, -0.13 * Math.abs(Math.sin(tau * 8)) * Math.exp(-tau * 2.6), 1, 1];
    case "shake": return [0.06 * Math.sin(tau * 38) * Math.exp(-tau * 4.5), 0, 1, 1];
    default: return [0, 0, 1, 1];
  }
}

export function createFace(canvas: HTMLCanvasElement, o: { palette(): Palette; reducedMotion?: boolean }): Face {
  const ctx = canvas.getContext("2d")!;
  let state: FaceState = "idle";
  let since = 0;
  let pose: Pose | null = null;
  let last = 0;
  let raf = 0;
  let nextBlink = 2 + Math.random() * 2;
  let blinkAt = -1;
  const now = () => performance.now() / 1000;

  function roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
    ctx.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
    ctx.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
    ctx.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
    ctx.closePath();
  }

  function badge(kind: string, S: number, t: number, tone: string, ink: string): void {
    if (kind === "wave") {
      // Dos arcos a la derecha: está escuchando.
      ctx.strokeStyle = tone;
      ctx.lineCap = "round";
      for (let i = 0; i < 2; i++) {
        const phase = (t * 1.6 + i * 0.5) % 1;
        ctx.globalAlpha = 0.25 + 0.75 * (1 - phase);
        ctx.lineWidth = S * 0.035;
        ctx.beginPath();
        ctx.arc(S * 0.9, S * 0.5, S * (0.08 + 0.07 * i + 0.03 * phase), -0.7, 0.7);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    const cx = S * 0.83, cy = S * 0.17, r = S * 0.155;
    const pulse = kind === "question" ? 1 + 0.07 * Math.sin(t * 4) : 1;
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.arc(cx, cy, r * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = S * 0.04;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (kind === "dots") {
      for (let i = 0; i < 3; i++) {
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 5 - i * 0.9));
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(cx + (i - 1) * r * 0.5, cy, r * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (kind === "check") {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.45, cy + r * 0.02);
      ctx.lineTo(cx - r * 0.1, cy + r * 0.36);
      ctx.lineTo(cx + r * 0.48, cy - r * 0.32);
      ctx.stroke();
    } else if (kind === "alert") {
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.5);
      ctx.lineTo(cx, cy + r * 0.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.46, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "question") {
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.2, r * 0.28, Math.PI * 1.05, Math.PI * 2.45);
      ctx.lineTo(cx, cy + r * 0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.5, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw(tIn?: number): void {
    const t = tIn ?? now();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const css = canvas.clientWidth || canvas.width / dpr || 64;
    if (canvas.width !== Math.round(css * dpr)) { canvas.width = canvas.height = Math.round(css * dpr); }
    const S = canvas.width;
    const pal = o.palette();
    const sp = STATES[state];
    const target = poseTarget(state, pal);
    const dt = last ? Math.min(0.1, Math.max(0, t - last)) : 0;
    last = t;
    if (!pose || o.reducedMotion) pose = target;
    else {
      const k = 1 - Math.exp(-spec.ease * dt);
      const mixTo = (a: number, b: number) => a + (b - a) * k;
      pose = {
        open: mixTo(pose.open, target.open), arc: mixTo(pose.arc, target.arc), tilt: mixTo(pose.tilt, target.tilt), raise: mixTo(pose.raise, target.raise),
        lookX: mixTo(pose.lookX, target.lookX), lookY: mixTo(pose.lookY, target.lookY), mix: pose.mix.map((c, i) => mixTo(c, target.mix[i])),
      };
    }
    // Parpadeo.
    let lid = 1;
    if (sp.blink && !o.reducedMotion) {
      if (blinkAt < 0 && t > nextBlink) blinkAt = t;
      if (blinkAt >= 0) {
        const p = (t - blinkAt) / spec.blink.duration;
        if (p >= 1) { blinkAt = -1; nextBlink = t + spec.blink.every + (Math.random() - 0.5) * spec.blink.jitter; }
        else lid = 0.12 + 0.88 * Math.abs(Math.cos(p * Math.PI));
      }
    } else blinkAt = -1;

    const [dx, dy, sx, sy] = o.reducedMotion ? [0, 0, 1, 1] : motion(sp.motion, t, since);
    let lookX = pose.lookX, lookY = pose.lookY, open = pose.open;
    if (!o.reducedMotion) {
      if (sp.motion === "orbit") { lookX = Math.cos(t * 2.4) * 0.6; lookY = -0.55 + Math.sin(t * 2.4) * 0.3; }
      if (sp.motion === "talk") open *= 1 + 0.1 * Math.sin(t * 9);
      if (sp.motion === "breathe") lookX += 0.35 * Math.sin(t * 0.37) * Math.max(0, Math.sin(t * 0.11));
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    // Cuerpo: el sello (cuadrado redondeado), apoyado en su base al respirar.
    const inset = S * spec.body.inset;
    const side = S - inset * 2;
    ctx.translate(S / 2 + dx * S, S - inset + dy * S);
    ctx.scale(sx, sy);
    ctx.translate(-S / 2, -(S - inset));
    ctx.fillStyle = rgb(pose.mix);
    roundRect(inset, inset, side, side, side * spec.body.radius);
    ctx.fill();

    // Ojos.
    const e = spec.eyes;
    const ink = pal.ink;
    const ew = S * e.w;
    const eh = Math.max(S * 0.03, S * e.h * open * lid);
    const cy = S * e.y + lookY * S * e.travel;
    for (const side2 of [-1, 1]) {
      const cx = S / 2 + side2 * (S * e.gap) / 2 + lookX * S * e.travel;
      const ey = cy - (side2 === 1 ? pose.raise * S : 0);
      ctx.save();
      ctx.translate(cx, ey);
      ctx.rotate(side2 * pose.tilt);
      if (pose.arc > 0.5) {
        // Ojos sonrientes: un arco hacia arriba.
        ctx.strokeStyle = ink;
        ctx.lineWidth = S * 0.055;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, S * 0.045, ew * 0.62, Math.PI * 1.12, Math.PI * 1.88);
        ctx.stroke();
      } else {
        ctx.fillStyle = ink;
        roundRect(-ew / 2, -eh / 2, ew, eh, ew / 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
    if (sp.badge) badge(sp.badge, S, o.reducedMotion ? 0.3 : t, pal[sp.tone as keyof Palette], pal.ink);
  }

  const loop = () => { draw(); raf = requestAnimationFrame(loop); };
  return {
    set(next) { if (next !== state && STATES[next]) { state = next; since = now(); if (o.reducedMotion || !raf) draw(); } },
    draw,
    start() { if (o.reducedMotion) { draw(); return; } if (!raf) raf = requestAnimationFrame(loop); },
    stop() { cancelAnimationFrame(raf); raf = 0; },
  };
}

/** Paleta del personaje según el tema activo de Kioku. */
export function themePalette(): Palette {
  const theme = document.documentElement.dataset.theme ?? "dark";
  const light = theme === "light" || (theme === "auto" && matchMedia("(prefers-color-scheme: light)").matches);
  return (light ? spec.palette.light : spec.palette.dark) as Palette;
}
