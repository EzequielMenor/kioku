#!/usr/bin/env python3
"""Kioku Companion en el escritorio: Kio flotando sobre tus ventanas (GTK4 + Layer Shell, pensado para Hyprland/Omarchy).

Es otra vista del mismo agente que vive dentro de Kioku: conversación, estado y ajustes están en el daemon
(`store.py` los refleja) y aquí solo se pintan. Tres superficies de capa:

  · personaje  pequeña, anclada abajo a la derecha; solo el cuerpo de Kio recibe clics, lo demás los deja pasar.
  · panel      la conversación por texto; se abre junto al personaje y solo él pide teclado (a demanda).
  · lienzo     a pantalla completa y transparente al ratón; existe solo mientras arrastras a Kio, para moverlo
               sin saltos (la superficie pequeña no se mueve hasta que lo sueltas).

Se lanza con `kioku companion`. Señales: SIGTERM/SIGINT salen · SIGUSR1 abre o cierra el panel.
"""
import json
import os
import signal
import sys
import time
from ctypes import CDLL

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# gtk4-layer-shell tiene que cargarse antes que libwayland-client para poder envolver sus superficies.
for _lib in ("libgtk4-layer-shell.so.0", "libgtk4-layer-shell.so"):
    try:
        CDLL(_lib)
        break
    except OSError:
        continue

import gi  # noqa: E402

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
gi.require_version("Gtk4LayerShell", "1.0")
import cairo  # noqa: E402
from gi.repository import Gdk, Gio, GLib, Gtk, Pango  # noqa: E402
from gi.repository import Gtk4LayerShell as LayerShell  # noqa: E402

import geometry as G  # noqa: E402
from client import Client, in_thread  # noqa: E402
from face import Face, load_spec  # noqa: E402
from store import (PEEK_STATES, STATE_TEXT, Store, face_state, messages_signature, op_text,  # noqa: E402
                   proposal_status_text, risky)

NAME = "Kio"
PID_FILE = "companion-overlay.pid"
PREFS_FILE = "companion-overlay.json"

THEMES = {
    "dark": {"surface": "#181714", "raised": "#1e1c19", "hover": "#211f1b", "line": "#2a2723", "line2": "#36322c",
             "fg": "#ebe6dc", "fg2": "#bdb6a8", "muted": "#8b8478", "accent": "#7f9bd6", "accent_fg": "#0c1220",
             "accent_soft": "rgba(127,155,214,.13)", "bad": "#e8786c", "good": "#8fb573",
             "warn_bg": "rgba(216,166,87,.10)", "warn_line": "rgba(216,166,87,.38)"},
    "light": {"surface": "#fbf8f1", "raised": "#fbf8f1", "hover": "#ebe4d4", "line": "#e2dacb", "line2": "#d4cab6",
              "fg": "#1f1b16", "fg2": "#4d463b", "muted": "#6c6558", "accent": "#2f4b8a", "accent_fg": "#ffffff",
              "accent_soft": "rgba(47,75,138,.09)", "bad": "#b3342b", "good": "#4c7a32",
              "warn_bg": "#f6ead0", "warn_line": "#dfc27f"},
}

CSS = """
window.kio-window {{ background: none; }}
.kio-peek {{ background: {raised}; background-image: none; color: {fg2}; border: 1px solid {line2}; border-radius: 10px 10px 2px 10px;
  padding: 6px 12px; font-size: 12.5px; box-shadow: none; min-height: 0; margin: 0 6px 10px 0; }}
.kio-peek:hover {{ background: {hover}; color: {fg}; }}
.kio-peek.warn {{ border-color: {warn_line}; color: {fg}; }}
.kio-peek.bad {{ border-color: {bad}; color: {bad}; }}
.kio-panel {{ background: {surface}; color: {fg}; border: 1px solid {line2}; border-radius: 12px; font-size: 13.5px; }}
.kio-panel label {{ color: inherit; }}
.kio-head {{ background: {raised}; border-bottom: 1px solid {line}; border-radius: 12px 12px 0 0; padding: 8px 8px 8px 14px; }}
.kio-name {{ font-weight: 700; font-size: 15px; }}
.kio-panel .kio-status, .kio-panel .kio-muted {{ color: {muted}; font-size: 11.5px; }}
.kio-panel .kio-chip {{ font-size: 10.5px; color: {fg2}; border: 1px solid {line2}; border-radius: 999px; padding: 1px 8px; }}
.kio-panel .kio-chip.bad {{ color: {bad}; border-color: {bad}; }}
.kio-panel button {{ background: {raised}; background-image: none; color: {fg}; border: 1px solid {line2}; border-radius: 6px;
  padding: 4px 11px; min-height: 0; min-width: 0; box-shadow: none; text-shadow: none; outline-offset: 1px; }}
.kio-panel button:hover {{ background: {hover}; }}
.kio-panel button:disabled {{ opacity: .5; }}
.kio-panel button.primary {{ background: {accent}; color: {accent_fg}; border-color: {accent}; font-weight: 600; }}
.kio-panel button.danger {{ background: {bad}; color: {accent_fg}; border-color: {bad}; font-weight: 600; }}
.kio-panel button.kio-icon {{ border: none; background: none; color: {fg2}; padding: 3px 7px; font-size: 15px; }}
.kio-panel button.kio-icon:hover {{ background: {hover}; color: {fg}; }}
.kio-panel button.kio-icon.on {{ color: {accent}; background: {accent_soft}; }}
.kio-panel button.mini {{ padding: 2px 8px; font-size: 12px; }}
.kio-body {{ padding: 12px 12px 6px; }}
.bubble {{ padding: 8px 11px; border-radius: 10px; }}
.bubble.user {{ background: {accent_soft}; border-radius: 10px 10px 2px 10px; }}
.bubble.assistant {{ background: {raised}; border: 1px solid {line}; border-radius: 10px 10px 10px 2px; }}
.bubble.error {{ border-color: {bad}; color: {bad}; }}
.bubble.live {{ color: {fg2}; }}
.kio-action {{ border-top: 1px solid {line}; margin-top: 7px; padding-top: 6px; font-size: 12px; color: {fg2}; }}
.kio-proposal {{ margin-top: 8px; padding: 9px 10px; border-radius: 8px; border: 1px solid {warn_line}; background: {warn_bg}; font-size: 13px; }}
.kio-proposal.done {{ border-color: {line}; background: none; opacity: .75; }}
.kio-panel .kio-eyebrow {{ font-size: 10.5px; letter-spacing: .08em; color: {muted}; }}
.kio-notice {{ border: 1px solid {warn_line}; background: {warn_bg}; border-radius: 8px; padding: 9px 11px; font-size: 13px; color: {fg2}; }}
.kio-notice.bad {{ border-color: {bad}; color: {bad}; background: none; }}
.kio-composer {{ border-top: 1px solid {line}; padding: 8px 10px 10px; }}
.kio-input {{ border: 1px solid {line2}; border-radius: 8px; background: {raised}; padding: 4px 8px; }}
.kio-input:focus-within {{ border-color: {accent}; }}
.kio-panel textview, .kio-panel textview text {{ background: none; color: {fg}; caret-color: {accent}; }}
.kio-panel .kio-placeholder {{ color: {muted}; }}
.kio-panel scrolledwindow undershoot, .kio-panel scrolledwindow overshoot {{ background: none; box-shadow: none; }}
"""


try:  # PyGObject ≥ 3.52 lo mueve a GLibUnix
    from gi.repository import GLibUnix
    unix_signal_add = GLibUnix.signal_add
except (ImportError, AttributeError):
    unix_signal_add = GLib.unix_signal_add


def detect_theme():
    forced = os.environ.get("KIOKU_COMPANION_THEME")
    if forced in THEMES:
        return forced
    try:
        source = Gio.SettingsSchemaSource.get_default()
        if source and source.lookup("org.gnome.desktop.interface", True):
            if Gio.Settings.new("org.gnome.desktop.interface").get_string("color-scheme") == "prefer-light":
                return "light"
    except GLib.Error:
        pass
    return "dark"


def label(text="", css=None, wrap=False, selectable=False, ellipsize=False):
    w = Gtk.Label(label=text, xalign=0)
    w.set_halign(Gtk.Align.FILL)
    if wrap:
        w.set_wrap(True)
        w.set_wrap_mode(Pango.WrapMode.WORD_CHAR)
    if ellipsize:
        w.set_ellipsize(Pango.EllipsizeMode.END)
    if selectable:
        w.set_selectable(True)
    for c in (css or "").split():
        w.add_css_class(c)
    return w


def button(text, tip=None, css=None, on=None):
    b = Gtk.Button(label=text)
    if tip:
        b.set_tooltip_text(tip)
    for c in (css or "").split():
        b.add_css_class(c)
    if on:
        b.connect("clicked", lambda *_: on())
    return b


def clear(box):
    child = box.get_first_child()
    while child:
        nxt = child.get_next_sibling()
        box.remove(child)
        child = nxt


class Companion(Gtk.Application):
    def __init__(self, home=None):
        super().__init__(application_id="dev.kioku.Companion", flags=Gio.ApplicationFlags.NON_UNIQUE)
        self.client = Client(home)
        self.store = Store(self.client, notify=self._notify)
        self.t0 = time.monotonic()
        self.theme = detect_theme()
        self.face = None
        self.win = self.area = self.peek = None
        self.panel = None
        self.canvas = self.canvas_area = None
        self.size = G.CHAR
        self.margins = (G.DEFAULT_MARGIN, G.DEFAULT_MARGIN)
        self.open = False
        self.hover = False
        self.pressed = False
        self.dragging = False
        self.drag_origin = (0, 0)   # esquina del personaje al empezar a arrastrar
        self.drag_pos = (0, 0)      # y ahora mismo
        self._render_pending = False
        self._ack_btn = None
        self._notice_btn = None
        self._nsig = None
        self._blank = False
        self._timer = 0
        self._settle_until = 0.0
        self._offline_seen = False
        self._sig = None
        self._stick = True
        self._last_listening = 0.0
        self._confirming = {}
        self.stop = __import__("threading").Event()
        self.prefs = self._read_prefs()

    # ───────── ficheros locales ─────────

    def _path(self, name):
        return os.path.join(self.client.home, ".kioku", name)

    def _read_prefs(self):
        try:
            with open(self._path(PREFS_FILE), encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save_prefs(self):
        try:
            with open(self._path(PREFS_FILE), "w", encoding="utf-8") as f:
                json.dump(self.prefs, f)
        except OSError:
            pass

    # ───────── arranque ─────────

    def do_activate(self):
        if self.win:
            return
        self.hold()
        reduced = not Gtk.Settings.get_default().get_property("gtk-enable-animations")
        self.face = Face(load_spec(), theme=self.theme, reduced_motion=reduced)
        self._apply_css()
        self._build_character()
        for sig, fn in ((signal.SIGTERM, self._quit), (signal.SIGINT, self._quit), (signal.SIGUSR1, self._signal_toggle)):
            unix_signal_add(GLib.PRIORITY_DEFAULT, sig, fn)
        in_thread(self.client.events, self.store.on_event, self._on_status, self.stop)

    def _apply_css(self):
        provider = Gtk.CssProvider()
        provider.load_from_data(CSS.format(**THEMES[self.theme]).encode())
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_USER)

    def _layer(self, win, namespace, layer, keyboard=LayerShell.KeyboardMode.NONE):
        LayerShell.init_for_window(win)
        LayerShell.set_namespace(win, namespace)
        LayerShell.set_layer(win, layer)
        LayerShell.set_keyboard_mode(win, keyboard)
        # -1: las medidas son respecto al monitor entero, sin descontar barras: así las coordenadas son absolutas.
        LayerShell.set_exclusive_zone(win, -1)
        win.set_decorated(False)
        win.add_css_class("kio-window")

    @staticmethod
    def _anchor_corner(win, right, bottom):
        for edge in (LayerShell.Edge.RIGHT, LayerShell.Edge.BOTTOM):
            LayerShell.set_anchor(win, edge, True)
        LayerShell.set_margin(win, LayerShell.Edge.RIGHT, int(right))
        LayerShell.set_margin(win, LayerShell.Edge.BOTTOM, int(bottom))

    def _build_character(self):
        self.win = Gtk.Window(application=self, title="Kioku Companion")
        # Capa «top»: por encima de las ventanas normales y por debajo de las que están a pantalla completa.
        self._layer(self.win, "kioku-companion", LayerShell.Layer.TOP)
        self._anchor_corner(self.win, *self.margins)

        # Todo se alinea abajo a la derecha: aunque la superficie cambie de tamaño, Kio no se mueve de su esquina.
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        row.set_halign(Gtk.Align.END)
        row.set_valign(Gtk.Align.END)
        self.peek = button("", css="kio-peek", on=lambda: self.set_open(True))
        self.peek.set_valign(Gtk.Align.END)
        self.peek.set_visible(False)
        self.peek.get_child().set_ellipsize(Pango.EllipsizeMode.END)
        self.peek.get_child().set_max_width_chars(36)
        row.append(self.peek)

        self.area = Gtk.DrawingArea()
        self.area.set_content_width(G.box(self.size))
        self.area.set_content_height(G.box(self.size))
        self.area.set_halign(Gtk.Align.END)
        self.area.set_valign(Gtk.Align.END)
        self.area.set_draw_func(self._draw_character)
        self.area.set_cursor(Gdk.Cursor.new_from_name("pointer"))
        row.append(self.area)
        self.win.set_child(row)

        drag = Gtk.GestureDrag()
        drag.set_button(1)
        drag.connect("drag-begin", self._drag_begin)
        drag.connect("drag-update", self._drag_update)
        drag.connect("drag-end", self._drag_end)
        self.area.add_controller(drag)
        right = Gtk.GestureClick()
        right.set_button(3)
        right.connect("released", lambda *_: self._toggle_focus())
        self.area.add_controller(right)
        motion = Gtk.EventControllerMotion()
        motion.connect("enter", lambda *_: self._set_hover(True))
        motion.connect("leave", lambda *_: self._set_hover(False))
        self.area.add_controller(motion)

        self.win.connect("map", lambda *_: GLib.idle_add(self._after_map))

    def _after_map(self):
        surface = self.win.get_surface()
        if surface and not getattr(self, "_layout_hooked", False):
            self._layout_hooked = True
            surface.connect("layout", lambda *_: self._update_input_region())
        self._update_input_region()
        self._apply_margins(*self.margins)
        return False

    # ───────── monitor y regiones ─────────

    def monitor_size(self):
        display = Gdk.Display.get_default()
        monitor = None
        surface = self.win.get_surface() if self.win else None
        if surface:
            monitor = display.get_monitor_at_surface(surface)
        if not monitor:
            monitors = display.get_monitors()
            monitor = monitors.get_item(0) if monitors.get_n_items() else None
        if not monitor:
            return 1920, 1080
        g = monitor.get_geometry()
        return g.width, g.height

    def _area_origin(self):
        ok, bounds = self.area.compute_bounds(self.win)
        return (bounds.origin.x, bounds.origin.y) if ok else (0, 0)

    def _input_rects(self):
        """Rectángulos de la superficie del personaje que reciben clics (lo demás los deja pasar)."""
        ox, oy = self._area_origin()
        rects = G.body_rects(self.size, ox, oy)
        if self.peek.get_visible():
            ok, b = self.peek.compute_bounds(self.win)
            if ok:
                rects.append((round(b.origin.x), round(b.origin.y), round(b.size.width), round(b.size.height)))
        return rects

    def _update_input_region(self):
        surface = self.win.get_surface() if self.win else None
        if not surface:
            return
        region = cairo.Region()
        for x, y, w, h in self._input_rects():
            if w > 0 and h > 0:
                region.union(cairo.RectangleInt(int(x), int(y), int(w), int(h)))
        surface.set_input_region(region)
        self.win.queue_draw()

    def _fit(self):
        """La superficie se ciñe a su contenido (GTK no encoge sola una ventana que ya creció)."""
        self.win.set_default_size(-1, -1)
        self.win.queue_resize()

    def _apply_margins(self, x, y):
        mw, mh = self.monitor_size()
        self.margins = G.clamp_margins(x, y, mw, mh, self.size)
        self._anchor_corner(self.win, *self.margins)
        if self.open and self.panel:
            self._place_panel()

    def char_origin(self):
        mw, mh = self.monitor_size()
        return G.box_origin(*self.margins, mw, mh, self.size)

    # ───────── dibujo y animación ─────────

    def now(self):
        return time.monotonic() - self.t0

    def _alpha(self, s=None):
        s = s or self.store.snapshot()
        if self.hover or self.open or self.dragging:
            return 1.0
        if not (s["connected"] and s["ready"]):
            return 0.5
        return 0.6 if s["companion"].get("quiet") else 1.0

    def _paint(self, cr, ox, oy):
        p = G.pad(self.size)
        alpha = self._alpha()
        cr.save()
        cr.translate(ox + p, oy + p)
        if alpha < 1:
            cr.push_group()
            self.face.draw(cr, self.size, self.now())
            cr.pop_group_to_source()
            cr.paint_with_alpha(alpha)
        else:
            self.face.draw(cr, self.size, self.now())
        cr.restore()

    def _draw_character(self, _area, cr, _w, _h):
        if not self._blank:  # durante el arrastre a Kio lo pinta el lienzo
            self._paint(cr, 0, 0)

    def _draw_canvas(self, _area, cr, _w, _h):
        self._paint(cr, *self.drag_pos)

    def _queue(self):
        if self.dragging and self.canvas_area:
            self.canvas_area.queue_draw()
        if self.area:
            self.area.queue_draw()

    def _animating(self):
        if not (self.win and self.win.get_visible()):
            return False
        return self.face.animated() or self.now() < self._settle_until

    def _tick(self):
        self._timer = 0
        if self._animating():
            self._queue()
            self._timer = GLib.timeout_add(self.face.interval_ms() if self.now() >= self._settle_until else 33, self._tick)
        return False

    def _ensure_tick(self):
        if not self._timer and self._animating():
            self._timer = GLib.timeout_add(16, self._tick)

    def _set_hover(self, v):
        if self.hover != v:
            self.hover = v
            self._queue()

    # ───────── arrastre ─────────

    def _drag_begin(self, *_):
        self.pressed = True

    def _ensure_canvas(self):
        if self.canvas:
            return
        self.canvas = Gtk.Window(application=self, title="Kioku Companion (arrastre)")
        self._layer(self.canvas, "kioku-companion-drag", LayerShell.Layer.OVERLAY)
        for edge in (LayerShell.Edge.LEFT, LayerShell.Edge.RIGHT, LayerShell.Edge.TOP, LayerShell.Edge.BOTTOM):
            LayerShell.set_anchor(self.canvas, edge, True)
        self.canvas_area = Gtk.DrawingArea()
        self.canvas_area.set_hexpand(True)
        self.canvas_area.set_vexpand(True)
        self.canvas_area.set_draw_func(self._draw_canvas)
        self.canvas.set_child(self.canvas_area)

        def passthrough(*_):
            surface = self.canvas.get_surface()
            if surface:
                surface.set_input_region(cairo.Region())  # vacío: el lienzo nunca intercepta el ratón
        self.canvas.connect("map", passthrough)
        self.canvas.connect("realize", passthrough)

    def _drag_update(self, _gesture, dx, dy):
        if not self.dragging:
            if not G.is_drag(dx, dy):
                return
            self.dragging = True
            self.drag_origin = self.char_origin()
            self.drag_pos = self.drag_origin
            if self.open:
                self._reopen = True
                self.set_open(False)
            self.peek.set_visible(False)
            self._ensure_canvas()
            self.canvas.present()
            # La superficie pequeña se queda quieta (así las coordenadas del gesto no cambian) y se apaga
            # en cuanto el lienzo ha pintado a Kio en el mismo sitio.
            GLib.timeout_add(60, self._hide_small)
            self._ensure_tick()
        mw, mh = self.monitor_size()
        self.drag_pos = G.drag_origin(*self.drag_origin, dx, dy, mw, mh, self.size)
        self.canvas_area.queue_draw()

    def _hide_small(self):
        if self.dragging:
            self._blank = True
            self.area.queue_draw()
        return False

    def _drag_end(self, _gesture, dx, dy):
        self.pressed = False
        if not self.dragging:
            if not G.is_drag(dx, dy):
                self.set_open(not self.open)
            return
        mw, mh = self.monitor_size()
        x, y = G.margins_from_origin(*self.drag_pos, mw, mh, self.size)
        self._apply_margins(x, y)
        self.drag_pos = self.char_origin()
        self.canvas_area.queue_draw()
        in_thread(self.store.set_overlay, x, y)
        # Relevo sin parpadeo: primero se mueve la superficie pequeña (aún apagada), luego se enciende y, con
        # las dos pintando lo mismo en el mismo sitio, se retira el lienzo.
        GLib.timeout_add(90, self._drop_show_small)

    def _drop_show_small(self):
        self._blank = False
        self.area.queue_draw()
        GLib.timeout_add(70, self._drop_finish)
        return False

    def _drop_finish(self):
        self.dragging = False
        if self.canvas:
            self.canvas.set_visible(False)
        if getattr(self, "_reopen", False):
            self._reopen = False
            self.set_open(True)
        self._render()
        return False

    # ───────── panel ─────────

    def _build_panel(self):
        self.panel = Gtk.Window(application=self, title="Kio")
        self._layer(self.panel, "kioku-companion-panel", LayerShell.Layer.TOP, LayerShell.KeyboardMode.ON_DEMAND)
        root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        root.add_css_class("kio-panel")
        root.set_overflow(Gtk.Overflow.HIDDEN)
        self.panel_root = root

        head = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=4)
        head.add_css_class("kio-head")
        title = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        title.append(label(NAME, "kio-name"))
        self.status_label = label("", "kio-status", ellipsize=True)
        self.status_label.set_max_width_chars(22)
        title.append(self.status_label)
        head.append(title)
        self.chip = label("", "kio-chip", ellipsize=True)
        self.chip.set_max_width_chars(20)
        self.chip.set_valign(Gtk.Align.CENTER)
        self.chip.set_margin_start(6)
        head.append(self.chip)
        spacer = Gtk.Box()
        spacer.set_hexpand(True)
        head.append(spacer)
        self.new_btn = button("＋", "Nueva conversación", "kio-icon", lambda: in_thread(self.store.new_conversation))
        self.focus_btn = button("◐", "Modo concentración: mínimo y en silencio", "kio-icon", self._toggle_focus)
        head.append(self.new_btn)
        head.append(self.focus_btn)
        head.append(button("⤢", "Abrir la conversación completa en Kioku", "kio-icon", self._open_kioku))
        head.append(button("⌄", "Ocultar a Kio (vuelve con «kioku companion toggle» o desde Kioku)", "kio-icon", lambda: self._set_mode("hidden")))
        head.append(button("×", "Cerrar (Esc)", "kio-icon", lambda: self.set_open(False)))
        root.append(head)

        self.scroll = Gtk.ScrolledWindow()
        self.scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        self.scroll.set_vexpand(True)
        self.body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=9)
        self.body.add_css_class("kio-body")
        self.notices = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        self.messages = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=9)
        self.live = label("", "bubble assistant live", wrap=True)
        self.live_row = self._side(self.live, False)
        self.live_row.set_visible(False)
        self.body.append(self.messages)
        self.body.append(self.live_row)
        self.body.append(self.notices)
        self.scroll.set_child(self.body)
        # Sin esto, al enfocar un texto seleccionable la lista saltaría hasta él.
        self.scroll.get_child().set_scroll_to_focus(False)
        adj = self.scroll.get_vadjustment()
        adj.connect("value-changed", self._on_scroll)
        adj.connect("changed", self._on_scroll_range)
        root.append(self.scroll)

        composer = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        composer.add_css_class("kio-composer")
        self.input = Gtk.TextView()
        self.input.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        self.input.set_accepts_tab(False)
        self.input.get_buffer().connect("changed", self._on_typing)
        keys = Gtk.EventControllerKey()
        keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        keys.connect("key-pressed", self._on_input_key)
        self.input.add_controller(keys)
        input_scroll = Gtk.ScrolledWindow()
        input_scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.EXTERNAL)
        input_scroll.set_propagate_natural_height(True)
        input_scroll.set_max_content_height(84)
        input_scroll.set_child(self.input)
        self.placeholder = label("", "kio-placeholder")
        self.placeholder.set_can_target(False)
        self.placeholder.set_valign(Gtk.Align.START)
        overlay = Gtk.Overlay()
        overlay.set_child(input_scroll)
        overlay.add_overlay(self.placeholder)
        overlay.add_css_class("kio-input")
        overlay.set_hexpand(True)
        composer.append(overlay)
        self.send_btn = button("Enviar", css="primary", on=self._send_or_stop)
        self.send_btn.set_valign(Gtk.Align.END)
        composer.append(self.send_btn)
        root.append(composer)
        self.panel.set_child(root)

        esc = Gtk.EventControllerKey()
        esc.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        esc.connect("key-pressed", lambda _c, keyval, *_: (self.set_open(False), True)[1] if keyval == Gdk.KEY_Escape else False)
        self.panel.add_controller(esc)

    def _place_panel(self):
        mw, mh = self.monitor_size()
        pw, ph = G.panel_size(mw, mh)
        self.panel_root.set_size_request(pw, ph)
        self.panel.set_default_size(pw, ph)
        cx, cy = self.char_origin()
        x, y = G.panel_origin(cx, cy, G.box(self.size), mw, mh, pw, ph)
        self.panel_rect = (x, y, pw, ph)
        self._anchor_corner(self.panel, *G.to_margins(x, y, pw, ph, mw, mh))

    def set_open(self, v):
        v = bool(v) and self.win is not None and self.win.get_visible() and not self.dragging
        if v == self.open:
            return
        self.open = v
        if v:
            if not self.panel:
                self._build_panel()
            self._sig = self._nsig = None
            self._stick = True
            self._render()          # el personaje recupera su tamaño normal antes de colocar el panel
            self._place_panel()
            self._focus_panel()     # antes de mostrarlo: si no, GTK enfoca (y selecciona) el primer texto
            self.panel.present()
            self._focus_panel()
            for delay in (40, 160):
                GLib.timeout_add(delay, self._scroll_bottom)
        else:
            if self.panel:
                self.panel.set_visible(False)
            self._listening(False)
            self._render()

    def _focus_panel(self):
        """El teclado va a donde toca: al aviso pendiente o, ya aceptado, al cuadro de texto."""
        if self.prefs.get("ack"):
            self.input.grab_focus()
        elif self._ack_btn:
            self._ack_btn.grab_focus()

    def _on_scroll(self, adj):
        self._stick = adj.get_value() >= adj.get_upper() - adj.get_page_size() - 24

    def _on_scroll_range(self, adj):
        if self._stick:
            adj.set_value(adj.get_upper() - adj.get_page_size())

    def _scroll_bottom(self):
        if self.open and self._stick:
            adj = self.scroll.get_vadjustment()
            adj.set_value(adj.get_upper() - adj.get_page_size())
        return False

    def _text(self):
        buf = self.input.get_buffer()
        return buf.get_text(buf.get_start_iter(), buf.get_end_iter(), False)

    def _on_input_key(self, _ctrl, keyval, _code, state):
        if keyval in (Gdk.KEY_Return, Gdk.KEY_KP_Enter, Gdk.KEY_ISO_Enter) and not state & Gdk.ModifierType.SHIFT_MASK:
            self._send()
            return True
        return False

    def _on_typing(self, *_):
        text = self._text()
        self.placeholder.set_visible(text == "")
        self._listening(text.strip() != "")
        self._sync_send()

    def _listening(self, active):
        """El agente «escucha» mientras escribes. Se limita para no mandar una petición por tecla."""
        now = time.monotonic()
        if active and now - self._last_listening < 2.5:
            return
        if not active and not self._last_listening:
            return
        self._last_listening = now if active else 0.0
        in_thread(self.store.listening, active)

    def _can_send(self, s):
        return bool(self.prefs.get("ack")) and s["connected"] and s["ready"] and not (s["agent"].get("busy") or s["sending"])

    def _sync_send(self, s=None):
        s = s or self.store.snapshot()
        busy = bool(s["agent"].get("busy"))
        self.send_btn.set_label("Detener" if busy else "Enviar")
        (self.send_btn.remove_css_class if busy else self.send_btn.add_css_class)("primary")
        self.send_btn.set_sensitive(busy or (self._can_send(s) and self._text().strip() != ""))

    def _send(self):
        s = self.store.snapshot()
        text = self._text().strip()
        if not text or not self._can_send(s):
            return
        self.input.get_buffer().set_text("")
        self._listening(False)
        self._stick = True
        in_thread(self.store.send, text)

    def _send_or_stop(self):
        if self.store.snapshot()["agent"].get("busy"):
            in_thread(self.store.cancel)
        else:
            self._send()

    # ───────── acciones ─────────

    def _set_mode(self, mode):
        in_thread(self.store.set_mode, mode)

    def _toggle_focus(self):
        self._set_mode("active" if self.store.snapshot()["companion"].get("mode") == "focus" else "focus")

    def _open_kioku(self):
        self.set_open(False)
        in_thread(self.store.open_kioku, "/asistente")

    def _ack(self):
        self.prefs["ack"] = True
        self._save_prefs()
        self._sig = None
        self._render()
        self.input.grab_focus()

    def _decide(self, proposal, what):
        pid = proposal.get("id")
        if what == "apply" and risky(proposal) and not self._confirming.get(pid):
            # Segunda pulsación para lo que borra, mueve o reemplaza: la primera solo arma la confirmación.
            self._confirming[pid] = True
            self._sig = None
            self._render()
            GLib.timeout_add_seconds(6, self._disarm, pid)
            return
        self._confirming.pop(pid, None)
        in_thread(self.store.decide, pid, what)

    def _disarm(self, pid):
        if self._confirming.pop(pid, None):
            self._sig = None
            self._render()
        return False

    # ───────── pintar el estado ─────────

    def _notify(self):
        if not self._render_pending:
            self._render_pending = True
            GLib.idle_add(self._render)

    def _on_status(self, connected):
        if not connected:
            self._offline_seen = True
        self.store.on_status(connected)

    def _render(self):
        self._render_pending = False
        if not self.win:
            return False
        s = self.store.snapshot()
        comp = s["companion"]
        online = s["connected"] and s["ready"]
        quiet = bool(comp.get("quiet"))
        fs = face_state(s["agent"], quiet, online)

        # Visible salvo en modo oculto o con Kioku delante (allí manda el personaje integrado).
        known = s["ready"] or self._offline_seen
        visible = known and not (online and (comp.get("mode") == "hidden" or comp.get("webForeground")))
        if not visible and self.open:
            self.open = False
            if self.panel:
                self.panel.set_visible(False)
        if visible != self.win.get_visible():
            self.win.set_visible(visible)
        if not visible:
            return False

        if self.face.set(fs, self.now()):
            self._settle_until = self.now() + 0.9
        if not (self.pressed or self.dragging):
            size = G.CHAR_QUIET if quiet and online and not self.open else G.CHAR
            if size != self.size:
                self.size = size
                self.area.set_content_width(G.box(size))
                self.area.set_content_height(G.box(size))
                self._fit()
            text = s["agent"].get("label") or STATE_TEXT.get(fs, "")
            show_peek = online and not self.open and not quiet and fs in PEEK_STATES and self.char_origin()[0] > 300
            self.peek.set_label(text)
            for cls, on in (("warn", fs == "awaiting_confirmation"), ("bad", fs == "error")):
                (self.peek.add_css_class if on else self.peek.remove_css_class)(cls)
            if show_peek != self.peek.get_visible():
                self.peek.set_visible(show_peek)
                self._fit()
            ov = comp.get("overlay") if online else None
            target = (ov["x"], ov["y"]) if ov else self.margins
            mw, mh = self.monitor_size()
            if G.clamp_margins(*target, mw, mh, self.size) != self.margins:
                self._apply_margins(*target)
            self.area.set_tooltip_text(f"{NAME} · {text}" if online else f"{NAME} · sin conexión con Kioku (se reconecta solo)")
            GLib.idle_add(self._update_input_region)
        self._queue()
        self._ensure_tick()
        if self.open and self.panel:
            self._render_panel(s, fs, online)
        return False

    def _notice(self, text, css="", action=None):
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        row.add_css_class("kio-notice")
        for c in css.split():
            row.add_css_class(c)
        lab = label(text, wrap=True)
        lab.set_hexpand(True)
        row.append(lab)
        if action:
            b = button(action[0], css="mini", on=action[1])
            b.set_valign(Gtk.Align.START)
            row.append(b)
            self._notice_btn = b
        return row

    def _render_panel(self, s, fs, online):
        agent, engine = s["agent"], s["engine"] or {}
        busy = bool(agent.get("busy") or s["sending"])
        ack = bool(self.prefs.get("ack"))
        self.status_label.set_label((agent.get("label") or STATE_TEXT.get(fs, "")) if online else "Sin conexión")
        model = engine.get("model")
        self.chip.set_visible(bool(model))
        if model:
            local = bool(engine.get("local"))
            self.chip.set_label(f"{'local' if local else 'remoto'} · {model}")
            (self.chip.remove_css_class if local else self.chip.add_css_class)("bad")
            self.chip.set_tooltip_text("El modelo corre en tus equipos: tus notas no salen de ellos" if local
                                       else "Proveedor remoto: el texto de las notas que lea sale de tu equipo")
        focus = s["companion"].get("mode") == "focus"
        (self.focus_btn.add_css_class if focus else self.focus_btn.remove_css_class)("on")
        self.new_btn.set_sensitive(online and not busy)

        sig = (messages_signature(s), ack, busy, tuple(sorted(self._confirming)))
        if sig != self._sig:
            self._sig = sig
            clear(self.messages)
            if ack and not s["msgs"] and not busy:
                self.messages.append(label("Pregúntame por tus notas, tareas o proyectos, o pídeme que cree o actualice algo.", "kio-muted", wrap=True))
            for m in s["msgs"]:
                self.messages.append(self._message(m, busy))

        if busy:
            self.live.set_label(f"{s['streaming']} ▍" if s["streaming"] else f"···  {agent.get('label') or 'Pensando…'}")
        self.live_row.set_visible(busy)

        status = s["status"] or {}
        nsig = (online, s["problem"], status.get("ok", True), status.get("reason"), ack, model, engine.get("local"))
        if nsig != self._nsig:
            self._nsig = nsig
            self._render_notices(s, online, ack, engine, model)

        self.input.set_sensitive(ack and online)
        self.placeholder.set_label("Escribe a Kio…  (Enter envía)" if ack else "Acepta el aviso para empezar")
        self.placeholder.set_visible(self._text() == "")
        self._sync_send(s)

    def _render_notices(self, s, online, ack, engine, model):
        clear(self.notices)
        if not online:
            self.notices.append(self._notice(s["problem"] or "Sin conexión con Kioku. Se reconectará solo cuando el daemon vuelva.", "bad"))
        else:
            status = s["status"]
            if status and not status.get("ok"):
                self.notices.append(self._notice(f"El asistente no está disponible: {status.get('reason') or 'sin motivo'}", "bad"))
            if s["problem"]:
                self.notices.append(self._notice(s["problem"], "bad", ("Vale", self.store.dismiss_problem)))
        self._ack_btn = None
        if not ack:
            where = f" ({'local' if engine.get('local') else 'remoto'}: {model})" if model else ""
            self.notices.append(self._notice(
                f"Para responder, {NAME} lee las notas que necesita con las herramientas de Kioku y envía ese texto al modelo configurado{where}. "
                "Lo pequeño lo hace solo, con Deshacer; borrar, mover o tocar muchas notas te lo propone antes.", action=("Entendido", self._ack)))
            self._ack_btn = self._notice_btn
        if self.open and not ack and self._ack_btn:
            self._ack_btn.grab_focus()

    @staticmethod
    def _side(bubble, right):
        """Burbuja pegada a un lado. Va en una fila con un hueco elástico en vez de alinearla con `halign`:
        así GTK mide y reparte el ancho con la misma cuenta y el texto largo no se sale de su caja."""
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        gap = Gtk.Box()
        gap.set_hexpand(True)
        gap.set_size_request(28 if right else 8, -1)
        for w in ((gap, bubble) if right else (bubble, gap)):
            row.append(w)
        return row

    def _message(self, m, busy):
        role = "assistant" if m.get("role") == "assistant" else "user"
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        box.add_css_class("bubble")
        box.add_css_class(role)
        if m.get("error"):
            box.add_css_class("error")
        box.append(label(m.get("text") or "", wrap=True, selectable=True))
        reads = m.get("reads") or []
        if reads:
            names = ", ".join(os.path.splitext(os.path.basename(p))[0] for p in reads[:3])
            box.append(label(f"Leyó {len(reads)} {'nota' if len(reads) == 1 else 'notas'}: {names}{'…' if len(reads) > 3 else ''}", "kio-muted", wrap=True))
        for a in m.get("actions") or []:
            row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
            row.add_css_class("kio-action")
            summary = label(a.get("summary") or "", wrap=True)
            summary.set_hexpand(True)
            row.append(summary)
            undone = bool(a.get("undone"))
            b = button("Deshecho" if undone else "Deshacer", css="mini", on=lambda aid=a.get("id"): in_thread(self.store.undo, aid))
            b.set_sensitive(not undone)
            b.set_valign(Gtk.Align.START)
            row.append(b)
            box.append(row)
        for p in m.get("proposals") or []:
            box.append(self._proposal(p, busy))
        return self._side(box, role == "user")

    def _proposal(self, p, busy):
        done = p.get("status") != "pending"
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=3)
        box.add_css_class("kio-proposal")
        if done:
            box.add_css_class("done")
        box.append(label(proposal_status_text(p.get("status")).upper(), "kio-eyebrow"))
        title = label(p.get("title") or "", wrap=True)
        title.set_markup(f"<b>{GLib.markup_escape_text(p.get('title') or '')}</b>")
        box.append(title)
        if p.get("rationale"):
            box.append(label(p["rationale"], "kio-muted", wrap=True))
        ops = p.get("ops") or []
        expander = Gtk.Expander(label=f"{len(ops)} {'cambio' if len(ops) == 1 else 'cambios'}")
        lines = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        for op in ops:
            lines.append(label(f"· {op_text(op)}", wrap=True))
        expander.set_child(lines)
        expander.set_expanded(len(ops) <= 3 and not done)
        box.append(expander)
        if not done:
            row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
            row.set_margin_top(4)
            armed = bool(self._confirming.get(p.get("id")))
            apply_btn = button("Confirmar: aplicar" if armed else "Aplicar", css="danger" if armed else "primary", on=lambda: self._decide(p, "apply"))
            reject_btn = button("Descartar", on=lambda: self._decide(p, "reject"))
            for b in (apply_btn, reject_btn):
                b.set_sensitive(not busy)
                row.append(b)
            box.append(row)
        return box

    # ───────── señales ─────────

    def _signal_toggle(self):
        self.set_open(not self.open)
        return True

    def _quit(self):
        self.stop.set()
        self.quit()
        return False


def pid_alive(pid):
    """¿Sigue vivo ese proceso y es un compañero de Kioku? (el pid pudo reutilizarse)."""
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return b"kioku_companion.py" in f.read()
    except OSError:
        return False


def main(argv):
    # Hasta que la ventana instala sus manejadores, una señal de control temprana no debe matar el proceso.
    for sig in (signal.SIGUSR1, signal.SIGUSR2):
        signal.signal(sig, signal.SIG_IGN)
    if "--check" in argv:
        # Comprobación previa para la CLI: bibliotecas presentes y compositor con wlr-layer-shell.
        if not Gtk.init_check():
            print("sin sesión gráfica (¿WAYLAND_DISPLAY?)")
            return 3
        if not LayerShell.is_supported():
            print("el compositor no ofrece wlr-layer-shell")
            return 4
        print("ok")
        return 0

    client = Client()
    pid_path = os.path.join(client.home, ".kioku", PID_FILE)
    try:
        with open(pid_path, encoding="utf-8") as f:
            other = int(f.read().strip() or 0)
    except (OSError, ValueError):
        other = 0
    if other and other != os.getpid() and pid_alive(other):
        print(f"Kio ya está en marcha (pid {other})")
        return 0
    if not Gtk.init_check() or not LayerShell.is_supported():
        print("kioku companion: hace falta una sesión Wayland con wlr-layer-shell (Hyprland, Sway…)", file=sys.stderr)
        return 4
    os.makedirs(os.path.dirname(pid_path), exist_ok=True)
    with open(pid_path, "w", encoding="utf-8") as f:
        f.write(f"{os.getpid()}\n")
    try:
        return Companion(client.home).run([])
    finally:
        try:
            with open(pid_path, encoding="utf-8") as f:
                mine = f.read().strip() == str(os.getpid())
            if mine:
                os.unlink(pid_path)
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
