"""Kio en Cairo: el mismo personaje que pinta la web (web/src/companion-face.ts), leído de companion/character.json.

Es un port línea a línea del dibujo en canvas: mismos parámetros, mismos tiempos. Si cambias uno, cambia el otro.
"""
import json
import math
import os
import random

SPEC_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "character.json")


def load_spec(path=SPEC_PATH):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _hex(c):
    h = c.lstrip("#")
    if len(h) == 3:
        h = "".join(x + x for x in h)
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def motion(name, t, since):
    """Transformación del cuerpo: (dx, dy, sx, sy) en fracciones del lado."""
    tau = t - since
    if name == "breathe":
        return 0, 0, 1, 1 + 0.014 * math.sin(t * 1.7)
    if name == "lean":
        return 0, -0.02, 1.03, 1.03 + 0.008 * math.sin(t * 3)
    if name == "orbit":
        return 0, 0.006 * math.sin(t * 2.4), 1, 1
    if name == "talk":
        return 0, -0.012 * abs(math.sin(t * 7)), 1, 1
    if name == "nudge":
        p = (tau % 2.6) / 0.36
        return 0, (-0.06 * math.sin(p * math.pi) if p < 1 else 0), 1, 1
    if name == "bounce":
        return 0, -0.13 * abs(math.sin(tau * 8)) * math.exp(-tau * 2.6), 1, 1
    if name == "shake":
        return 0.06 * math.sin(tau * 38) * math.exp(-tau * 4.5), 0, 1, 1
    return 0, 0, 1, 1


class Face:
    def __init__(self, spec=None, theme="dark", reduced_motion=False):
        self.spec = spec or load_spec()
        self.palette = self.spec["palette"][theme]
        self.reduced = reduced_motion
        self.state = "idle"
        self.since = 0.0
        self.pose = None
        self.last = 0.0
        self.next_blink = 2 + random.random() * 2
        self.blink_at = -1.0

    def set(self, state, t):
        if state != self.state and state in self.spec["states"]:
            self.state = state
            self.since = t
            return True
        return False

    def animated(self):
        """¿Necesita fotogramas continuos? En concentración se queda quieto."""
        return not self.reduced and self.spec["states"][self.state]["motion"] != "none"

    def interval_ms(self):
        """Cadencia de repintado: el reposo respira despacio; los estados activos, fluido."""
        return 80 if self.state == "idle" else 33

    def _target(self):
        s = self.spec["states"][self.state]
        return {"open": s["open"], "arc": s["arc"], "tilt": s["tilt"], "raise": s["raise"],
                "lookX": s["look"][0], "lookY": s["look"][1], "mix": _hex(self.palette[s["body"]])}

    @staticmethod
    def _round_rect(cr, x, y, w, h, r):
        rr = min(r, w / 2, h / 2)
        cr.new_sub_path()
        cr.arc(x + w - rr, y + rr, rr, -math.pi / 2, 0)
        cr.arc(x + w - rr, y + h - rr, rr, 0, math.pi / 2)
        cr.arc(x + rr, y + h - rr, rr, math.pi / 2, math.pi)
        cr.arc(x + rr, y + rr, rr, math.pi, math.pi * 1.5)
        cr.close_path()

    def _badge(self, cr, kind, S, t, tone, ink):
        import cairo
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        cr.set_line_join(cairo.LINE_JOIN_ROUND)
        if kind == "wave":
            for i in range(2):
                phase = (t * 1.6 + i * 0.5) % 1
                cr.set_source_rgba(*tone, 0.25 + 0.75 * (1 - phase))
                cr.set_line_width(S * 0.035)
                cr.new_path()
                cr.arc(S * 0.9, S * 0.5, S * (0.08 + 0.07 * i + 0.03 * phase), -0.7, 0.7)
                cr.stroke()
            return
        cx, cy, r = S * 0.83, S * 0.17, S * 0.155
        pulse = 1 + 0.07 * math.sin(t * 4) if kind == "question" else 1
        cr.set_source_rgb(*tone)
        cr.new_path()
        cr.arc(cx, cy, r * pulse, 0, math.pi * 2)
        cr.fill()
        cr.set_line_width(S * 0.04)
        if kind == "dots":
            for i in range(3):
                cr.set_source_rgba(*ink, 0.35 + 0.65 * max(0, math.sin(t * 5 - i * 0.9)))
                cr.new_path()
                cr.arc(cx + (i - 1) * r * 0.5, cy, r * 0.15, 0, math.pi * 2)
                cr.fill()
            return
        cr.set_source_rgb(*ink)
        cr.new_path()
        if kind == "check":
            cr.move_to(cx - r * 0.45, cy + r * 0.02)
            cr.line_to(cx - r * 0.1, cy + r * 0.36)
            cr.line_to(cx + r * 0.48, cy - r * 0.32)
            cr.stroke()
        elif kind == "alert":
            cr.move_to(cx, cy - r * 0.5)
            cr.line_to(cx, cy + r * 0.1)
            cr.stroke()
            cr.arc(cx, cy + r * 0.46, r * 0.09, 0, math.pi * 2)
            cr.fill()
        elif kind == "question":
            cr.arc(cx, cy - r * 0.2, r * 0.28, math.pi * 1.05, math.pi * 2.45)
            cr.line_to(cx, cy + r * 0.2)
            cr.stroke()
            cr.arc(cx, cy + r * 0.5, r * 0.09, 0, math.pi * 2)
            cr.fill()

    def draw(self, cr, S, t):
        """Pinta un fotograma de lado S (píxeles lógicos) en el instante t (segundos)."""
        import cairo
        spec = self.spec
        sp = spec["states"][self.state]
        target = self._target()
        dt = min(0.1, max(0.0, t - self.last)) if self.last else 0.0
        self.last = t
        if self.pose is None or self.reduced:
            self.pose = target
        else:
            k = 1 - math.exp(-spec["ease"] * dt)
            p = self.pose
            self.pose = {key: (p[key] + (target[key] - p[key]) * k) for key in ("open", "arc", "tilt", "raise", "lookX", "lookY")}
            self.pose["mix"] = [c + (target["mix"][i] - c) * k for i, c in enumerate(p["mix"])]
        pose = self.pose

        lid = 1.0
        if sp["blink"] and not self.reduced:
            if self.blink_at < 0 and t > self.next_blink:
                self.blink_at = t
            if self.blink_at >= 0:
                p = (t - self.blink_at) / spec["blink"]["duration"]
                if p >= 1:
                    self.blink_at = -1.0
                    self.next_blink = t + spec["blink"]["every"] + (random.random() - 0.5) * spec["blink"]["jitter"]
                else:
                    lid = 0.12 + 0.88 * abs(math.cos(p * math.pi))
        else:
            self.blink_at = -1.0

        dx, dy, sx, sy = (0, 0, 1, 1) if self.reduced else motion(sp["motion"], t, self.since)
        look_x, look_y, open_ = pose["lookX"], pose["lookY"], pose["open"]
        if not self.reduced:
            if sp["motion"] == "orbit":
                look_x = math.cos(t * 2.4) * 0.6
                look_y = -0.55 + math.sin(t * 2.4) * 0.3
            if sp["motion"] == "talk":
                open_ *= 1 + 0.1 * math.sin(t * 9)
            if sp["motion"] == "breathe":
                look_x += 0.35 * math.sin(t * 0.37) * max(0, math.sin(t * 0.11))

        cr.save()
        inset = S * spec["body"]["inset"]
        side = S - inset * 2
        cr.translate(S / 2 + dx * S, S - inset + dy * S)
        cr.scale(sx, sy)
        cr.translate(-S / 2, -(S - inset))
        cr.set_source_rgb(*pose["mix"])
        self._round_rect(cr, inset, inset, side, side, side * spec["body"]["radius"])
        cr.fill()

        e = spec["eyes"]
        ink = _hex(self.palette["ink"])
        ew = S * e["w"]
        eh = max(S * 0.03, S * e["h"] * open_ * lid)
        cy = S * e["y"] + look_y * S * e["travel"]
        for side2 in (-1, 1):
            cx = S / 2 + side2 * (S * e["gap"]) / 2 + look_x * S * e["travel"]
            ey = cy - (pose["raise"] * S if side2 == 1 else 0)
            cr.save()
            cr.translate(cx, ey)
            cr.rotate(side2 * pose["tilt"])
            cr.set_source_rgb(*ink)
            if pose["arc"] > 0.5:
                cr.set_line_width(S * 0.055)
                cr.set_line_cap(cairo.LINE_CAP_ROUND)
                cr.new_path()
                cr.arc(0, S * 0.045, ew * 0.62, math.pi * 1.12, math.pi * 1.88)
                cr.stroke()
            else:
                self._round_rect(cr, -ew / 2, -eh / 2, ew, eh, ew / 2)
                cr.fill()
            cr.restore()
        cr.restore()
        if sp["badge"]:
            self._badge(cr, sp["badge"], S, 0.3 if self.reduced else t, _hex(self.palette[sp["tone"]]), ink)


def render_png(path, state="idle", size=128, t=1.0, theme="dark"):
    """Renderiza un estado a PNG (para pruebas y documentación), sin abrir ninguna ventana."""
    import cairo
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    face = Face(theme=theme)
    face.set(state, 0.0)
    face.draw(cairo.Context(surface), size, t)
    surface.write_to_png(path)


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    for name in load_spec()["states"]:
        render_png(os.path.join(out, f"kio-{name}.png"), name)
        print("ok", name)
