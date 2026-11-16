import Foundation

/// Kio en números: port línea a línea de `companion/overlay/face.py` (y de `web/src/companion-face.ts`), leído de
/// `companion/character.json`. Calcula cada fotograma; la app solo lo pinta con CoreGraphics. Si cambias uno, cambia el otro.
public struct RGB: Equatable {
    public var r, g, b: Double
    public init(_ r: Double, _ g: Double, _ b: Double) { self.r = r; self.g = g; self.b = b }
    public init(hex: String) {
        var h = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        let v = UInt32(h, radix: 16) ?? 0
        self.init(Double((v >> 16) & 0xff) / 255, Double((v >> 8) & 0xff) / 255, Double(v & 0xff) / 255)
    }
}

public struct CharacterSpec {
    public struct State {
        public let open, arc, tilt, raise: Double
        public let look: (Double, Double)
        public let motion: String
        public let badge: String?
        public let tone: String
        public let body: String
        public let blink: Bool
    }
    public let inset, radius: Double
    public let eyeGap, eyeY, eyeW, eyeH, travel: Double
    public let blinkEvery, blinkJitter, blinkDuration: Double
    public let ease: Double
    public let palettes: [String: [String: String]]
    public let states: [String: State]

    public init(json j: JSON) throws {
        guard let states = j["states"].object, !states.isEmpty else { throw KiokuError("character.json sin estados") }
        inset = j["body"]["inset"].double ?? 0.07
        radius = j["body"]["radius"].double ?? 0.26
        eyeGap = j["eyes"]["gap"].double ?? 0.34
        eyeY = j["eyes"]["y"].double ?? 0.47
        eyeW = j["eyes"]["w"].double ?? 0.15
        eyeH = j["eyes"]["h"].double ?? 0.25
        travel = j["eyes"]["travel"].double ?? 0.07
        blinkEvery = j["blink"]["every"].double ?? 4.2
        blinkJitter = j["blink"]["jitter"].double ?? 2.6
        blinkDuration = j["blink"]["duration"].double ?? 0.14
        ease = j["ease"].double ?? 9
        palettes = (j["palette"].object ?? [:]).mapValues { ($0.object ?? [:]).compactMapValues { $0.string } }
        var out: [String: State] = [:]
        for (name, s) in states {
            out[name] = State(open: s["open"].double ?? 1, arc: s["arc"].double ?? 0, tilt: s["tilt"].double ?? 0, raise: s["raise"].double ?? 0,
                              look: (s["look"][0].double ?? 0, s["look"][1].double ?? 0), motion: s["motion"].string ?? "none",
                              badge: s["badge"].string, tone: s["tone"].string ?? "accent", body: s["body"].string ?? "accent", blink: s["blink"].bool)
        }
        self.states = out
    }

    public init(contentsOf url: URL) throws {
        guard let j = JSON.parse(try Data(contentsOf: url)) else { throw KiokuError("character.json no es JSON") }
        try self.init(json: j)
    }

    public func color(_ name: String, theme: String) -> RGB {
        RGB(hex: palettes[theme]?[name] ?? palettes["dark"]?[name] ?? "#7f9bd6")
    }
}

/// Transformación del cuerpo: (dx, dy, sx, sy) en fracciones del lado.
public func kioMotion(_ name: String, t: Double, since: Double) -> (dx: Double, dy: Double, sx: Double, sy: Double) {
    let tau = t - since
    switch name {
    case "breathe": return (0, 0, 1, 1 + 0.014 * sin(t * 1.7))
    case "lean": return (0, -0.02, 1.03, 1.03 + 0.008 * sin(t * 3))
    case "orbit": return (0, 0.006 * sin(t * 2.4), 1, 1)
    case "talk": return (0, -0.012 * abs(sin(t * 7)), 1, 1)
    case "nudge":
        let p = tau.truncatingRemainder(dividingBy: 2.6) / 0.36
        return (0, p < 1 ? -0.06 * sin(p * .pi) : 0, 1, 1)
    case "bounce": return (0, -0.13 * abs(sin(tau * 8)) * exp(-tau * 2.6), 1, 1)
    case "shake": return (0.06 * sin(tau * 38) * exp(-tau * 4.5), 0, 1, 1)
    default: return (0, 0, 1, 1)
    }
}

/// Lo que hay que pintar en un fotograma, en píxeles de un lienzo de lado `size` con el eje y hacia abajo.
public struct FaceFrame {
    public struct Eye { public let cx, cy, w, h, rotation: Double; public let arc: Bool }
    public let size: Double
    public let body: RGB
    public let ink: RGB
    /// Transformación del cuerpo alrededor de su base: traslación (dx, dy) y escala (sx, sy).
    public let dx, dy, sx, sy: Double
    public let inset, side, cornerRadius: Double
    public let eyes: [Eye]
    public let eyeLineWidth: Double
    public let badge: String?
    public let badgeTone: RGB
    public let badgeTime: Double
}

public final class Face {
    public let spec: CharacterSpec
    public var theme: String
    public var reducedMotion: Bool
    public private(set) var state = "idle"
    private var since = 0.0
    private var pose: [String: Double]? = nil
    private var mix: RGB? = nil
    private var last = 0.0
    private var nextBlink: Double
    private var blinkAt = -1.0
    private let random: () -> Double

    public init(spec: CharacterSpec, theme: String = "dark", reducedMotion: Bool = false, random: @escaping () -> Double = { Double.random(in: 0..<1) }) {
        self.spec = spec
        self.theme = theme
        self.reducedMotion = reducedMotion
        self.random = random
        nextBlink = 2 + random() * 2
    }

    @discardableResult
    public func set(_ newState: String, t: Double) -> Bool {
        guard newState != state, spec.states[newState] != nil else { return false }
        state = newState
        since = t
        return true
    }

    /// ¿Necesita fotogramas continuos? En concentración se queda quieto.
    public var animated: Bool { !reducedMotion && (spec.states[state]?.motion ?? "none") != "none" }
    /// Cadencia de repintado: el reposo respira despacio; los estados activos, fluido.
    public var interval: TimeInterval { state == "idle" ? 0.08 : 0.033 }

    public func frame(size S: Double, t: Double) -> FaceFrame {
        let sp = spec.states[state] ?? spec.states["idle"]!
        let target: [String: Double] = ["open": sp.open, "arc": sp.arc, "tilt": sp.tilt, "raise": sp.raise, "lookX": sp.look.0, "lookY": sp.look.1]
        let targetMix = spec.color(sp.body, theme: theme)
        let dt = last > 0 ? min(0.1, max(0, t - last)) : 0
        last = t
        if pose == nil || reducedMotion {
            pose = target
            mix = targetMix
        } else if var p = pose, let m = mix {
            let k = 1 - exp(-spec.ease * dt)
            for (key, v) in target { p[key] = (p[key] ?? v) + (v - (p[key] ?? v)) * k }
            pose = p
            mix = RGB(m.r + (targetMix.r - m.r) * k, m.g + (targetMix.g - m.g) * k, m.b + (targetMix.b - m.b) * k)
        }
        let p = pose!

        var lid = 1.0
        if sp.blink && !reducedMotion {
            if blinkAt < 0 && t > nextBlink { blinkAt = t }
            if blinkAt >= 0 {
                let q = (t - blinkAt) / spec.blinkDuration
                if q >= 1 {
                    blinkAt = -1
                    nextBlink = t + spec.blinkEvery + (random() - 0.5) * spec.blinkJitter
                } else {
                    lid = 0.12 + 0.88 * abs(cos(q * .pi))
                }
            }
        } else {
            blinkAt = -1
        }

        let mo = reducedMotion ? (dx: 0.0, dy: 0.0, sx: 1.0, sy: 1.0) : kioMotion(sp.motion, t: t, since: since)
        var lookX = p["lookX"]!, lookY = p["lookY"]!, open = p["open"]!
        if !reducedMotion {
            if sp.motion == "orbit" { lookX = cos(t * 2.4) * 0.6; lookY = -0.55 + sin(t * 2.4) * 0.3 }
            if sp.motion == "talk" { open *= 1 + 0.1 * sin(t * 9) }
            if sp.motion == "breathe" { lookX += 0.35 * sin(t * 0.37) * max(0, sin(t * 0.11)) }
        }

        let inset = S * spec.inset
        let side = S - inset * 2
        let ew = S * spec.eyeW
        let eh = max(S * 0.03, S * spec.eyeH * open * lid)
        let cy = S * spec.eyeY + lookY * S * spec.travel
        let eyes = [-1.0, 1.0].map { s -> FaceFrame.Eye in
            let cx = S / 2 + s * (S * spec.eyeGap) / 2 + lookX * S * spec.travel
            let ey = cy - (s == 1 ? p["raise"]! * S : 0)
            return FaceFrame.Eye(cx: cx, cy: ey, w: ew, h: eh, rotation: s * p["tilt"]!, arc: p["arc"]! > 0.5)
        }
        return FaceFrame(size: S, body: mix!, ink: spec.color("ink", theme: theme), dx: mo.dx, dy: mo.dy, sx: mo.sx, sy: mo.sy,
                         inset: inset, side: side, cornerRadius: side * spec.radius, eyes: eyes, eyeLineWidth: S * 0.055,
                         badge: sp.badge, badgeTone: spec.color(sp.tone, theme: theme), badgeTime: reducedMotion ? 0.3 : t)
    }
}
