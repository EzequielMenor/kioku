// Popover accesible anclado a un elemento: diálogo no modal bajo el ancla, dentro de la ventana. Esc y clic fuera lo cierran,
// el foco entra en el primer campo, Tab queda atrapado dentro y al cerrar el foco vuelve al ancla.
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

const FOCUSABLE = "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])";
const MARGIN = 8;

export function Popover({ anchor, label, onClose, children }: { anchor: HTMLElement | null; label: string; onClose(): void; children: ComponentChildren }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = () => {
    const el = box.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(MARGIN, Math.min(a.left, innerWidth - w - MARGIN));
    const below = a.bottom + 4;
    const top = below + h > innerHeight - MARGIN && a.top - 4 - h >= MARGIN ? a.top - 4 - h : Math.max(MARGIN, Math.min(below, innerHeight - h - MARGIN));
    setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
  };

  useLayoutEffect(place, [anchor, children]);
  useEffect(() => {
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => { removeEventListener("resize", place); removeEventListener("scroll", place, true); };
  }, [anchor]);

  // Foco: entra en el primer campo y, al cerrar, vuelve al ancla (salvo que el usuario ya haya movido el foco a otra parte).
  useEffect(() => {
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      const cur = document.activeElement;
      if (anchor?.isConnected && (!cur || cur === document.body || box.current?.contains(cur) || !cur.isConnected)) anchor.focus();
    };
  }, [anchor]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || box.current?.contains(t) || anchor?.contains(t)) return;
      if (t.closest?.("[role=alertdialog], .scrim")) return; // los diálogos de confirmación que abre el propio menú
      close.current();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(); } };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", down, true); document.removeEventListener("keydown", esc); };
  }, [anchor]);

  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation(); // los atajos globales de la app no deben dispararse con el menú abierto
    if (e.key === "Escape") { e.preventDefault(); close.current(); return; }
    if (e.key !== "Tab" || !box.current) return;
    const els = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.hasAttribute("disabled"));
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === first || !box.current.contains(cur))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (cur === last || !box.current.contains(cur))) { e.preventDefault(); first.focus(); }
  };

  return (
    <div class="popover" role="dialog" aria-label={label} ref={box} onKeyDown={onKey}
      style={pos ? `top:${pos.top}px;left:${pos.left}px` : "top:0;left:0"}>
      {children}
    </div>
  );
}
