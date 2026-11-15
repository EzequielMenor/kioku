"""Geometría del compañero de escritorio: dónde va cada cosa, en píxeles lógicos del monitor. Sin GTK.

El personaje se guarda como márgenes desde la esquina inferior derecha (igual que `overlay` en el daemon), así que
sobrevive a cambios de resolución sin salirse de la pantalla.
"""

CHAR = 64          # lado del personaje
CHAR_QUIET = 40    # en concentración
PAD_RATIO = 0.14   # aire alrededor del personaje para el rebote y la insignia
DEFAULT_MARGIN = 24
DRAG_THRESHOLD = 6
PANEL_W, PANEL_H = 380, 540
GAP = 8
TOP_GUARD = 36     # no tapar la barra superior


def pad(size):
    return round(size * PAD_RATIO)


def box(size):
    """Lado de la zona de dibujo del personaje (personaje + aire)."""
    return size + 2 * pad(size)


def clamp(v, lo, hi):
    return max(lo, min(hi if hi >= lo else lo, v))


def clamp_margins(x, y, mon_w, mon_h, size=CHAR):
    """Márgenes válidos: el personaje completo queda dentro del monitor."""
    b = box(size)
    return int(clamp(round(x), 0, mon_w - b)), int(clamp(round(y), 0, mon_h - b))


def box_origin(mx, my, mon_w, mon_h, size=CHAR):
    """Esquina superior izquierda de la zona del personaje, en coordenadas del monitor."""
    b = box(size)
    return mon_w - mx - b, mon_h - my - b


def margins_from_origin(ox, oy, mon_w, mon_h, size=CHAR):
    b = box(size)
    return clamp_margins(mon_w - ox - b, mon_h - oy - b, mon_w, mon_h, size)


def drag_origin(start_ox, start_oy, dx, dy, mon_w, mon_h, size=CHAR):
    """Posición del personaje mientras se arrastra, sin dejar que salga del monitor."""
    b = box(size)
    return clamp(start_ox + dx, 0, mon_w - b), clamp(start_oy + dy, 0, mon_h - b)


def is_drag(dx, dy):
    return dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD


def body_rects(size, ox=0, oy=0, inset=0.07, radius=0.26):
    """Zona que recibe clics: el cuerpo redondeado del personaje, aproximado con tres bandas.

    Lo demás (las esquinas, el aire de alrededor) es transparente también para el ratón.
    """
    p = pad(size)
    i = size * inset
    side = size - 2 * i
    r = side * radius
    x, y = ox + p + i, oy + p + i
    cut = r * 0.3  # en la banda extrema el cuerpo ya ocupa casi todo el ancho
    return [
        (round(x + cut), round(y), round(side - 2 * cut), round(r)),
        (round(x), round(y + r), round(side), round(side - 2 * r)),
        (round(x + cut), round(y + side - r), round(side - 2 * cut), round(r)),
    ]


def hit(rects, px, py):
    return any(x <= px < x + w and y <= py < y + h for x, y, w, h in rects)


def panel_size(mon_w, mon_h):
    return min(PANEL_W, mon_w - 2 * GAP), max(240, min(PANEL_H, mon_h - TOP_GUARD - 2 * GAP - box(CHAR)))


def panel_origin(char_x, char_y, char_side, mon_w, mon_h, pw, ph):
    """Dónde abrir el panel: encima del personaje; si no cabe, debajo; si tampoco, a un lado. Siempre dentro del monitor."""
    x = clamp(char_x + char_side - pw, GAP, mon_w - pw - GAP)
    above = char_y - GAP - ph
    if above >= TOP_GUARD:
        return int(x), int(above)
    below = char_y + char_side + GAP
    if below + ph <= mon_h - GAP:
        return int(x), int(below)
    y = clamp(char_y + char_side - ph, TOP_GUARD, mon_h - ph - GAP)
    left = char_x - GAP - pw
    return int(left if left >= GAP else min(char_x + char_side + GAP, mon_w - pw - GAP)), int(y)


def to_margins(x, y, w, h, mon_w, mon_h):
    """De esquina superior izquierda a márgenes (derecho, inferior) para anclar abajo a la derecha."""
    return int(mon_w - x - w), int(mon_h - y - h)
