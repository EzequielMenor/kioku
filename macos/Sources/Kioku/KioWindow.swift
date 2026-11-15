import AppKit
import KiokuKit
import SwiftUI

/// Panel transparente, sin marco y que nunca activa la app: Kio flota sobre las ventanas sin robar el foco.
final class FloatingPanel: NSPanel {
    var allowsKey = false
    override var canBecomeKey: Bool { allowsKey }
    override var canBecomeMain: Bool { false }

    init(size: NSSize, allowsKey: Bool = false) {
        self.allowsKey = allowsKey
        super.init(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .floating
        // En todos los escritorios (Spaces) y fuera del ciclo de ventanas. Sin `.fullScreenAuxiliary`: con una app a
        // pantalla completa queda debajo (no tapa vídeos ni juegos) y reaparece al salir.
        collectionBehavior = [.canJoinAllSpaces, .ignoresCycle]
        hidesOnDeactivate = false
        isMovableByWindowBackground = false
        isReleasedWhenClosed = false
        animationBehavior = .none
    }
}

/// Pinta un fotograma de Kio con CoreGraphics (eje y hacia abajo, igual que el canvas y Cairo).
enum KioPainter {
    static func cg(_ c: RGB, _ a: Double = 1) -> CGColor { CGColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: a) }

    static func roundRect(_ ctx: CGContext, _ x: Double, _ y: Double, _ w: Double, _ h: Double, _ r: Double) {
        let rr = min(r, w / 2, h / 2)
        ctx.addPath(CGPath(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerWidth: rr, cornerHeight: rr, transform: nil))
    }

    static func circle(_ ctx: CGContext, _ x: Double, _ y: Double, _ r: Double) {
        ctx.addArc(center: CGPoint(x: x, y: y), radius: r, startAngle: 0, endAngle: .pi * 2, clockwise: false)
    }

    static func draw(_ f: FaceFrame, in ctx: CGContext) {
        let S = f.size
        ctx.saveGState()
        ctx.translateBy(x: S / 2 + f.dx * S, y: S - f.inset + f.dy * S)
        ctx.scaleBy(x: f.sx, y: f.sy)
        ctx.translateBy(x: -S / 2, y: -(S - f.inset))
        ctx.setFillColor(cg(f.body))
        roundRect(ctx, f.inset, f.inset, f.side, f.side, f.cornerRadius)
        ctx.fillPath()
        for e in f.eyes {
            ctx.saveGState()
            ctx.translateBy(x: e.cx, y: e.cy)
            ctx.rotate(by: e.rotation)
            ctx.setFillColor(cg(f.ink))
            ctx.setStrokeColor(cg(f.ink))
            if e.arc {
                ctx.setLineWidth(f.eyeLineWidth)
                ctx.setLineCap(.round)
                ctx.addArc(center: CGPoint(x: 0, y: S * 0.045), radius: e.w * 0.62, startAngle: .pi * 1.12, endAngle: .pi * 1.88, clockwise: false)
                ctx.strokePath()
            } else {
                roundRect(ctx, -e.w / 2, -e.h / 2, e.w, e.h, e.w / 2)
                ctx.fillPath()
            }
            ctx.restoreGState()
        }
        ctx.restoreGState()
        if let badge = f.badge { drawBadge(badge, ctx, S, f.badgeTime, f.badgeTone, f.ink) }
    }

    static func drawBadge(_ kind: String, _ ctx: CGContext, _ S: Double, _ t: Double, _ tone: RGB, _ ink: RGB) {
        ctx.saveGState()
        defer { ctx.restoreGState() }
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        if kind == "wave" {
            for i in 0..<2 {
                let phase = (t * 1.6 + Double(i) * 0.5).truncatingRemainder(dividingBy: 1)
                ctx.setStrokeColor(cg(tone, 0.25 + 0.75 * (1 - phase)))
                ctx.setLineWidth(S * 0.035)
                ctx.addArc(center: CGPoint(x: S * 0.9, y: S * 0.5), radius: S * (0.08 + 0.07 * Double(i) + 0.03 * phase), startAngle: -0.7, endAngle: 0.7, clockwise: false)
                ctx.strokePath()
            }
            return
        }
        let cx = S * 0.83, cy = S * 0.17, r = S * 0.155
        let pulse = kind == "question" ? 1 + 0.07 * sin(t * 4) : 1
        ctx.setFillColor(cg(tone))
        circle(ctx, cx, cy, r * pulse)
        ctx.fillPath()
        ctx.setLineWidth(S * 0.04)
        if kind == "dots" {
            for i in 0..<3 {
                ctx.setFillColor(cg(ink, 0.35 + 0.65 * max(0, sin(t * 5 - Double(i) * 0.9))))
                circle(ctx, cx + Double(i - 1) * r * 0.5, cy, r * 0.15)
                ctx.fillPath()
            }
            return
        }
        ctx.setStrokeColor(cg(ink))
        ctx.setFillColor(cg(ink))
        switch kind {
        case "check":
            ctx.move(to: CGPoint(x: cx - r * 0.45, y: cy + r * 0.02))
            ctx.addLine(to: CGPoint(x: cx - r * 0.1, y: cy + r * 0.36))
            ctx.addLine(to: CGPoint(x: cx + r * 0.48, y: cy - r * 0.32))
            ctx.strokePath()
        case "alert":
            ctx.move(to: CGPoint(x: cx, y: cy - r * 0.5))
            ctx.addLine(to: CGPoint(x: cx, y: cy + r * 0.1))
            ctx.strokePath()
            circle(ctx, cx, cy + r * 0.46, r * 0.09)
            ctx.fillPath()
        case "question":
            ctx.addArc(center: CGPoint(x: cx, y: cy - r * 0.2), radius: r * 0.28, startAngle: .pi * 1.05, endAngle: .pi * 2.45, clockwise: false)
            ctx.addLine(to: CGPoint(x: cx, y: cy + r * 0.2))
            ctx.strokePath()
            circle(ctx, cx, cy + r * 0.5, r * 0.09)
            ctx.fillPath()
        default: break
        }
    }

    /// Icono de la barra de menús: el cuerpo de Kio con los ojos huecos (plantilla: macOS lo tiñe).
    static func menuBarIcon() -> NSImage {
        let img = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { rect in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }
            let S = rect.width
            ctx.setFillColor(.black)
            roundRect(ctx, S * 0.08, S * 0.08, S * 0.84, S * 0.84, S * 0.84 * 0.26)
            ctx.fillPath()
            ctx.setBlendMode(.clear)
            for s in [-1.0, 1.0] {
                let cx = S / 2 + s * S * 0.17
                roundRect(ctx, cx - S * 0.075, S * 0.47 - S * 0.125, S * 0.15, S * 0.25, S * 0.075)
            }
            ctx.fillPath()
            return true
        }
        img.isTemplate = true
        return img
    }
}

/// La vista de Kio: dibuja, recibe solo los clics sobre su cuerpo y gestiona clic, arrastre y clic derecho.
final class KioView: NSView {
    let face: Face
    var charSize: Double = Geometry.char
    var onClick: () -> Void = {}
    var onRightClick: () -> Void = {}
    var onDragStart: () -> Void = {}
    var onDrag: (_ dx: Double, _ dy: Double) -> Void = { _, _ in }
    var onDragEnd: () -> Void = {}
    private var downAt: NSPoint? = nil
    private var dragging = false
    private var timer: Timer? = nil
    private var awakeUntil = 0.0

    init(face: Face) {
        self.face = face
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = .clear
    }
    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    static var now: Double { ProcessInfo.processInfo.systemUptime }

    func setState(_ s: String) {
        if face.set(s, t: KioView.now) { wake() }
    }

    /// Repinta con la cadencia del estado; tras un cambio sigue un momento aunque esté quieto (para la transición).
    func wake() {
        awakeUntil = KioView.now + 1.2
        schedule()
    }

    private func schedule() {
        timer?.invalidate()
        let t = Timer(timeInterval: face.interval, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func tick() {
        needsDisplay = true
        if !face.animated && KioView.now > awakeUntil { timer?.invalidate(); timer = nil; return }
        if let t = timer, abs(t.timeInterval - face.interval) > 0.001 { schedule() }
    }

    func stop() { timer?.invalidate(); timer = nil }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        let p = Geometry.pad(charSize)
        ctx.translateBy(x: p, y: p)
        KioPainter.draw(face.frame(size: charSize, t: KioView.now), in: ctx)
    }

    private func bodyContains(_ local: NSPoint) -> Bool {
        Geometry.hit(Geometry.bodyRects(size: charSize, inset: face.spec.inset, radius: face.spec.radius), local.x, local.y)
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        return bodyContains(local) ? self : nil
    }

    override func mouseDown(with event: NSEvent) {
        downAt = NSEvent.mouseLocation
        dragging = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let start = downAt else { return }
        let cur = NSEvent.mouseLocation
        let dx = cur.x - start.x, dy = -(cur.y - start.y)  // a coordenadas con y hacia abajo
        if !dragging && Geometry.isDrag(dx: dx, dy: dy) { dragging = true; onDragStart() }
        if dragging { onDrag(dx, dy) }
    }

    override func mouseUp(with event: NSEvent) {
        defer { downAt = nil; dragging = false }
        if dragging { onDragEnd() } else if downAt != nil { onClick() }
    }

    override func rightMouseDown(with event: NSEvent) { onRightClick() }
}

/// El aviso corto que asoma junto a Kio con el panel cerrado (solo si hay algo que atender).
struct PeekView: View {
    let text: String
    let tone: String   // "", "warn", "bad"
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let pal = Palette.of(scheme)
        Button(action: action) {
            Text(text)
                .font(.system(size: 12.5))
                .lineLimit(1)
                .foregroundColor(tone == "bad" ? pal.bad : tone == "warn" ? pal.fg : pal.fg2)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(BubbleShape(tl: 10, tr: 10, br: 2, bl: 10).fill(pal.raised))
                .overlay(BubbleShape(tl: 10, tr: 10, br: 2, bl: 10)
                    .stroke(tone == "bad" ? pal.bad : tone == "warn" ? pal.warnLine : pal.line2, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .fixedSize()
        .padding(2)
    }
}

/// Kio en el escritorio: su panel, el aviso y la posición (márgenes desde la esquina inferior derecha, en el daemon).
@MainActor
final class KioController {
    let model: AppModel
    let panel: FloatingPanel
    let view: KioView
    let peek: FloatingPanel
    private var peekHost: NSHostingView<PeekView>?
    private(set) var visible = false
    private var dragStart: (x: Double, y: Double)? = nil
    private var dragMargins: (x: Double, y: Double)? = nil
    var onClick: () -> Void = {}
    var onMoved: () -> Void = {}
    private(set) var peekText: String? = nil

    init(model: AppModel, spec: CharacterSpec) {
        self.model = model
        view = KioView(face: Face(spec: spec, theme: Appearance.theme, reducedMotion: Appearance.reduceMotion))
        let b = Geometry.box(Geometry.char)
        panel = FloatingPanel(size: NSSize(width: b, height: b))
        panel.contentView = view
        peek = FloatingPanel(size: NSSize(width: 160, height: 32))
        view.onClick = { [weak self] in self?.onClick() }
        view.onRightClick = { [weak self] in
            guard let self else { return }
            self.model.store.setMode(self.model.store.companion.mode == "focus" ? "active" : "focus")
        }
        view.onDragStart = { [weak self] in
            guard let self else { return }
            let o = self.origin()
            self.dragStart = (o.x, o.y)
        }
        view.onDrag = { [weak self] dx, dy in self?.drag(dx, dy) }
        view.onDragEnd = { [weak self] in
            guard let self, let m = self.dragMargins else { return }
            self.dragStart = nil
            self.dragMargins = nil
            self.model.store.setOverlay(x: Int(m.x), y: Int(m.y))
        }
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.update() }
        }
        DistributedNotificationCenter.default().addObserver(forName: Notification.Name("AppleInterfaceThemeChangedNotification"), object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.view.face.theme = Appearance.theme
                self.view.wake()
            }
        }
    }

    var screen: NSScreen { NSScreen.main ?? NSScreen.screens.first! }
    var area: NSRect { screen.visibleFrame }
    var size: Double { model.store.companion.quiet && !model.panelOpen ? Geometry.charQuiet : Geometry.char }

    var margins: (x: Double, y: Double) {
        if let m = dragMargins { return m }
        let o = model.store.companion.overlay
        return Geometry.clampMargins(x: Double(o?.x ?? Int(Geometry.defaultMargin)), y: Double(o?.y ?? Int(Geometry.defaultMargin)),
                                     w: area.width, h: area.height, size: size)
    }

    /// Esquina superior izquierda de la zona de Kio, en coordenadas con y hacia abajo dentro del área útil.
    func origin() -> (x: Double, y: Double) {
        let m = margins
        return Geometry.boxOrigin(mx: m.x, my: m.y, w: area.width, h: area.height, size: size)
    }

    /// De coordenadas con y hacia abajo (área útil) a un marco de AppKit.
    func appKitRect(x: Double, y: Double, w: Double, h: Double) -> NSRect {
        NSRect(x: area.minX + x, y: area.maxY - y - h, width: w, height: h)
    }

    var charRect: NSRect { panel.frame }

    private func drag(_ dx: Double, _ dy: Double) {
        guard let s = dragStart else { return }
        let o = Geometry.dragOrigin(startX: s.x, startY: s.y, dx: dx, dy: dy, w: area.width, h: area.height, size: size)
        dragMargins = Geometry.marginsFromOrigin(ox: o.x, oy: o.y, w: area.width, h: area.height, size: size)
        place()
        onMoved()
    }

    private func place() {
        let b = Geometry.box(size)
        let o = origin()
        view.charSize = size
        panel.setFrame(appKitRect(x: o.x, y: o.y, w: b, h: b), display: true)
    }

    /// Lo que se ve, según el daemon: modo, concentración, Kioku en primer plano, conexión.
    func update() {
        let s = model.store
        let show = s.companion.mode != "hidden" && !s.companion.webForeground
        view.setState(s.faceState)
        view.toolTip = s.connected ? "\(KioText.name) · \(model.statusText)" : "\(KioText.name) · sin conexión con Kioku (se reconecta solo)"
        place()
        if show != visible {
            visible = show
            if show { panel.orderFrontRegardless(); view.wake() } else { panel.orderOut(nil); view.stop() }
        }
        updatePeek()
    }

    private func updatePeek() {
        let s = model.store
        let state = s.faceState
        let wanted = visible && !model.panelOpen && s.connected && KioText.peekStates.contains(state) && !(s.companion.quiet && ["thinking", "responding"].contains(state))
        guard wanted else { peekText = nil; peek.orderOut(nil); return }
        let text = state == "awaiting_confirmation" ? "Una propuesta espera tu decisión" : (s.agent.label ?? KioText.state[state] ?? "")
        let tone = state == "error" ? "bad" : state == "awaiting_confirmation" ? "warn" : ""
        peekText = text
        let view = PeekView(text: text.count > 48 ? String(text.prefix(47)) + "…" : text, tone: tone) { [weak self] in self?.onClick() }
        if let host = peekHost { host.rootView = view } else { let h = NSHostingView(rootView: view); peekHost = h; peek.contentView = h }
        let fit = peekHost!.fittingSize
        let o = origin()
        let p = Geometry.peekOrigin(charX: o.x, charY: o.y, charSide: Geometry.box(size), w: area.width, pw: fit.width, ph: fit.height)
        peek.setFrame(appKitRect(x: p.x, y: p.y, w: fit.width, h: fit.height), display: true)
        peek.orderFrontRegardless()
    }
}
