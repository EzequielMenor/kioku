import Foundation

/// Geometría del compañero (port de `companion/overlay/geometry.py`). Coordenadas lógicas con origen ARRIBA a la
/// izquierda del área útil de la pantalla (`visibleFrame`, sin barra de menús ni Dock); la app las convierte a AppKit.
/// La posición se guarda como márgenes desde la esquina inferior derecha (igual que `overlay` en el daemon), así que
/// sobrevive a cambios de resolución sin salirse de la pantalla.
public enum Geometry {
    public static let char = 64.0
    public static let charQuiet = 40.0
    public static let padRatio = 0.14
    public static let defaultMargin = 24.0
    public static let dragThreshold = 6.0
    public static let panelW = 380.0, panelH = 540.0
    public static let gap = 8.0
    public static let topGuard = 8.0

    public static func pad(_ size: Double) -> Double { (size * padRatio).rounded() }
    /// Lado de la zona de dibujo del personaje (personaje + aire).
    public static func box(_ size: Double) -> Double { size + 2 * pad(size) }

    public static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { max(lo, min(hi >= lo ? hi : lo, v)) }

    /// Márgenes válidos: el personaje completo queda dentro de la pantalla.
    public static func clampMargins(x: Double, y: Double, w: Double, h: Double, size: Double = char) -> (x: Double, y: Double) {
        let b = box(size)
        return (clamp(x.rounded(), 0, w - b), clamp(y.rounded(), 0, h - b))
    }

    /// Esquina superior izquierda de la zona del personaje.
    public static func boxOrigin(mx: Double, my: Double, w: Double, h: Double, size: Double = char) -> (x: Double, y: Double) {
        let b = box(size)
        return (w - mx - b, h - my - b)
    }

    public static func marginsFromOrigin(ox: Double, oy: Double, w: Double, h: Double, size: Double = char) -> (x: Double, y: Double) {
        let b = box(size)
        return clampMargins(x: w - ox - b, y: h - oy - b, w: w, h: h, size: size)
    }

    /// Posición mientras se arrastra, sin dejar que salga de la pantalla.
    public static func dragOrigin(startX: Double, startY: Double, dx: Double, dy: Double, w: Double, h: Double, size: Double = char) -> (x: Double, y: Double) {
        let b = box(size)
        return (clamp(startX + dx, 0, w - b), clamp(startY + dy, 0, h - b))
    }

    public static func isDrag(dx: Double, dy: Double) -> Bool { dx * dx + dy * dy > dragThreshold * dragThreshold }

    public struct Rect: Equatable { public let x, y, w, h: Double }

    /// Zona que recibe clics: el cuerpo redondeado, aproximado con tres bandas (relativas a la zona del personaje).
    public static func bodyRects(size: Double, inset: Double = 0.07, radius: Double = 0.26) -> [Rect] {
        let p = pad(size), i = size * inset, side = size - 2 * i, r = side * radius
        let x = p + i, y = p + i, cut = r * 0.3
        return [
            Rect(x: (x + cut).rounded(), y: y.rounded(), w: (side - 2 * cut).rounded(), h: r.rounded()),
            Rect(x: x.rounded(), y: (y + r).rounded(), w: side.rounded(), h: (side - 2 * r).rounded()),
            Rect(x: (x + cut).rounded(), y: (y + side - r).rounded(), w: (side - 2 * cut).rounded(), h: r.rounded()),
        ]
    }

    public static func hit(_ rects: [Rect], _ px: Double, _ py: Double) -> Bool {
        rects.contains { px >= $0.x && px < $0.x + $0.w && py >= $0.y && py < $0.y + $0.h }
    }

    public static func panelSize(w: Double, h: Double) -> (w: Double, h: Double) {
        (min(panelW, w - 2 * gap), max(240, min(panelH, h - topGuard - 2 * gap - box(char))))
    }

    /// Dónde abrir el panel: encima del personaje; si no cabe, debajo; si tampoco, a un lado. Siempre dentro.
    public static func panelOrigin(charX: Double, charY: Double, charSide: Double, w: Double, h: Double, pw: Double, ph: Double) -> (x: Double, y: Double) {
        let x = clamp(charX + charSide - pw, gap, w - pw - gap)
        let above = charY - gap - ph
        if above >= topGuard { return (x, above) }
        let below = charY + charSide + gap
        if below + ph <= h - gap { return (x, below) }
        let y = clamp(charY + charSide - ph, topGuard, h - ph - gap)
        let left = charX - gap - pw
        return (left >= gap ? left : min(charX + charSide + gap, w - pw - gap), y)
    }

    /// Aviso corto junto al personaje: a su izquierda, alineado con su parte alta.
    public static func peekOrigin(charX: Double, charY: Double, charSide: Double, w: Double, pw: Double, ph: Double) -> (x: Double, y: Double) {
        let left = charX - pw + 4
        let x = left >= gap ? left : min(charX + charSide - 4, w - pw - gap)
        return (x, max(0, charY + charSide * 0.12 - ph / 2))
    }
}
