import AppKit
import KiokuKit
import SwiftUI

/// Rectángulo con un radio por esquina (macOS 13 no tiene `UnevenRoundedRectangle`).
struct BubbleShape: Shape {
    var tl: CGFloat, tr: CGFloat, br: CGFloat, bl: CGFloat
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX + tl, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX - tr, y: r.minY))
        p.addArc(center: CGPoint(x: r.maxX - tr, y: r.minY + tr), radius: tr, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - br))
        p.addArc(center: CGPoint(x: r.maxX - br, y: r.maxY - br), radius: br, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        p.addLine(to: CGPoint(x: r.minX + bl, y: r.maxY))
        p.addArc(center: CGPoint(x: r.minX + bl, y: r.maxY - bl), radius: bl, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + tl))
        p.addArc(center: CGPoint(x: r.minX + tl, y: r.minY + tl), radius: tl, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        p.closeSubpath()
        return p
    }
}

enum KioButtonKind { case normal, primary, danger, icon, iconOn, mini }

struct KioButtonStyle: ButtonStyle {
    let kind: KioButtonKind
    let pal: Palette
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        let label = configuration.label
            .font(.system(size: kind == .mini ? 12 : kind == .icon || kind == .iconOn ? 13 : 13, weight: kind == .primary || kind == .danger ? .semibold : .regular))
            .padding(.horizontal, kind == .icon || kind == .iconOn ? 6 : kind == .mini ? 8 : 11)
            .padding(.vertical, kind == .icon || kind == .iconOn ? 4 : kind == .mini ? 2 : 4)
        let fg: Color, bg: Color, border: Color
        switch kind {
        case .primary: (fg, bg, border) = (pal.accentFg, pal.accent, pal.accent)
        case .danger: (fg, bg, border) = (pal.accentFg, pal.bad, pal.bad)
        case .icon: (fg, bg, border) = (pal.fg2, pressed ? pal.hover : .clear, .clear)
        case .iconOn: (fg, bg, border) = (pal.accent, pal.accentSoft, .clear)
        default: (fg, bg, border) = (pal.fg, pressed ? pal.hover : pal.raised, pal.line2)
        }
        return label.foregroundColor(fg)
            .background(RoundedRectangle(cornerRadius: 6).fill(bg))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(border, lineWidth: 1))
            .opacity(enabled ? (pressed ? 0.85 : 1) : 0.5)
            .contentShape(Rectangle())
    }
}

/// Acciones de la cabecera del panel que dependen de la app (ventanas), no del daemon.
struct PanelActions {
    var close: () -> Void
    var hideKio: () -> Void
    var openKioku: () -> Void
}

struct ConversationView: View {
    @ObservedObject var model: AppModel
    let actions: PanelActions
    @Environment(\.colorScheme) private var scheme
    @State private var text = ""
    @State private var lastListening: TimeInterval = 0
    @State private var focusToken = 0

    private var pal: Palette { Palette.of(scheme) }
    private var s: CompanionStore { model.store }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(pal.line).frame(height: 1)
            messages
            Rectangle().fill(pal.line).frame(height: 1)
            composer
        }
        .foregroundColor(pal.fg)
        .font(.system(size: 13.5))
        .background(RoundedRectangle(cornerRadius: 12).fill(pal.surface))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(pal.line2, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .onChange(of: model.panelOpen) { open in if open { focusToken += 1 } else { listening(false) } }
    }

    // ───────── cabecera ─────────

    private var header: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(KioText.name).font(.system(size: 15, weight: .bold))
                    if let chip = model.modelChip {
                        Text(chip.text)
                            .font(.system(size: 10.5))
                            .foregroundColor(chip.local ? pal.fg2 : pal.bad)
                            .padding(.horizontal, 8).padding(.vertical, 1)
                            .overlay(Capsule().stroke(chip.local ? pal.line2 : pal.bad, lineWidth: 1))
                            .help(chip.local ? "El modelo corre en tus equipos: tus notas no salen de ellos" : "Proveedor remoto: el texto de las notas que lea sale de tu equipo")
                    }
                }
                Text(model.statusText).font(.system(size: 11.5)).foregroundColor(pal.muted).lineLimit(1)
            }
            Spacer(minLength: 4)
            iconButton("plus", "Nueva conversación", enabled: s.connected && !s.busy) { s.newConversation() }
            iconButton("circle.lefthalf.filled", s.companion.mode == "focus" ? "Salir de concentración" : "Modo concentración", on: s.companion.mode == "focus") {
                s.setMode(s.companion.mode == "focus" ? "active" : "focus")
            }
            iconButton("arrow.up.left.and.arrow.down.right", "Abrir la conversación completa en Kioku") { actions.openKioku() }
            iconButton("chevron.down", "Ocultar a Kio (vuelve desde el menú de Kioku)") { actions.hideKio() }
            iconButton("xmark", "Cerrar (Esc)") { actions.close() }
        }
        .padding(.leading, 14).padding(.trailing, 8).padding(.vertical, 8)
        .background(pal.raised)
    }

    private func iconButton(_ symbol: String, _ tip: String, on: Bool = false, enabled: Bool = true, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).frame(width: 16, height: 16) }
            .buttonStyle(KioButtonStyle(kind: on ? .iconOn : .icon, pal: pal))
            .disabled(!enabled)
            .help(tip)
            .accessibilityLabel(tip)
    }

    // ───────── conversación ─────────

    private var messages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    notices
                    if model.acknowledged && s.messages.isEmpty && !s.busy {
                        Text("Pregúntame por tus notas, tareas o proyectos, o pídeme que cree o actualice algo.")
                            .font(.system(size: 12.5)).foregroundColor(pal.muted)
                    }
                    ForEach(s.messages) { m in bubble(m) }
                    if s.busy { live }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: model.tick) { _ in withAnimation(.easeOut(duration: 0.12)) { proxy.scrollTo("end", anchor: .bottom) } }
            .onAppear { proxy.scrollTo("end", anchor: .bottom) }
        }
    }

    @ViewBuilder private var notices: some View {
        if !s.connected {
            notice(s.problem ?? "Sin conexión con Kioku. Se reconectará solo cuando el daemon vuelva.", bad: true)
        } else {
            if let st = s.status, !st.ok { notice("El asistente no está disponible: \(st.reason ?? "sin motivo")", bad: true) }
            if let p = s.problem { notice(p, bad: true, action: ("Vale", { s.dismissProblem() })) }
        }
        if !model.acknowledged {
            let where_ = model.modelChip.map { " (\($0.text.replacingOccurrences(of: " · ", with: ": ")))" } ?? ""
            notice("Para responder, \(KioText.name) lee las notas que necesita con las herramientas de Kioku y envía ese texto al modelo configurado\(where_). Lo pequeño lo hace solo, con Deshacer; borrar, mover o tocar muchas notas te lo propone antes.",
                   action: ("Entendido", { model.acknowledge(); focusToken += 1 }))
        }
    }

    private func notice(_ text: String, bad: Bool = false, action: (String, () -> Void)? = nil) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(text).font(.system(size: 13)).foregroundColor(bad ? pal.bad : pal.fg2).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let action { Button(action.0, action: action.1).buttonStyle(KioButtonStyle(kind: .mini, pal: pal)) }
        }
        .padding(.horizontal, 11).padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 8).fill(bad ? Color.clear : pal.warnBg))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(bad ? pal.bad : pal.warnLine, lineWidth: 1))
    }

    private func bubble(_ m: Message) -> some View {
        let user = m.role == "user"
        let content = VStack(alignment: .leading, spacing: 4) {
            Text(m.text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                .foregroundColor(m.error ? pal.bad : pal.fg)
            if let reads = m.readsText { Text(reads).font(.system(size: 11.5)).foregroundColor(pal.muted) }
            ForEach(m.actions) { a in
                VStack(spacing: 0) {
                    Rectangle().fill(pal.line).frame(height: 1).padding(.bottom, 6)
                    HStack(alignment: .top, spacing: 8) {
                        Text(a.summary).font(.system(size: 12)).foregroundColor(pal.fg2).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        Button(a.undone ? "Deshecho" : "Deshacer") { s.undo(a.id) }
                            .buttonStyle(KioButtonStyle(kind: .mini, pal: pal)).disabled(a.undone)
                    }
                }.padding(.top, 3)
            }
            ForEach(m.proposals) { p in proposal(p) }
        }
        .padding(.horizontal, 11).padding(.vertical, 8)
        .background(BubbleShape(tl: 10, tr: 10, br: user ? 2 : 10, bl: user ? 10 : 2).fill(user ? pal.accentSoft : pal.raised))
        .overlay(BubbleShape(tl: 10, tr: 10, br: user ? 2 : 10, bl: user ? 10 : 2).stroke(user ? Color.clear : (m.error ? pal.bad : pal.line), lineWidth: 1))
        return HStack(spacing: 0) {
            if user { Spacer(minLength: 28) }
            content
            if !user { Spacer(minLength: 8) }
        }
    }

    private func proposal(_ p: Proposal) -> some View {
        let armed = model.confirming.contains(p.id)
        return VStack(alignment: .leading, spacing: 3) {
            Text(Proposals.statusText(p.status).uppercased()).font(.system(size: 10.5)).kerning(0.8).foregroundColor(pal.muted)
            Text(p.title).font(.system(size: 13, weight: .bold)).fixedSize(horizontal: false, vertical: true)
            if !p.rationale.isEmpty { Text(p.rationale).font(.system(size: 12)).foregroundColor(pal.muted).fixedSize(horizontal: false, vertical: true) }
            DisclosureGroup("\(p.ops.count) \(p.ops.count == 1 ? "cambio" : "cambios")") {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(p.ops.enumerated()), id: \.offset) { _, op in
                        Text("· \(op.text)").font(.system(size: 12)).fixedSize(horizontal: false, vertical: true)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            .font(.system(size: 12))
            if p.pending {
                HStack(spacing: 8) {
                    Button(armed ? "Confirmar: aplicar" : "Aplicar") { model.decide(p, "apply") }
                        .buttonStyle(KioButtonStyle(kind: armed ? .danger : .primary, pal: pal))
                    Button("Descartar") { model.decide(p, "reject") }
                        .buttonStyle(KioButtonStyle(kind: .normal, pal: pal))
                }
                .disabled(s.busy)
                .padding(.top, 4)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 8).fill(p.pending ? pal.warnBg : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(p.pending ? pal.warnLine : pal.line, lineWidth: 1))
        .opacity(p.pending ? 1 : 0.75)
        .padding(.top, 5)
    }

    private var live: some View {
        HStack(spacing: 0) {
            Text(s.streaming.isEmpty ? "···  \(s.agent.label ?? "Pensando…")" : "\(s.streaming) ▍")
                .foregroundColor(pal.fg2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 11).padding(.vertical, 8)
                .background(BubbleShape(tl: 10, tr: 10, br: 10, bl: 2).fill(pal.raised))
                .overlay(BubbleShape(tl: 10, tr: 10, br: 10, bl: 2).stroke(pal.line, lineWidth: 1))
            Spacer(minLength: 8)
        }
    }

    // ───────── escribir ─────────

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            ZStack(alignment: .topLeading) {
                ComposerField(text: $text, enabled: model.acknowledged && s.connected, focusToken: focusToken,
                              textColor: NSColor(pal.fg), caretColor: NSColor(pal.accent),
                              onSubmit: send, onEscape: actions.close, onChange: { listening(!$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) })
                    .frame(minHeight: 22, maxHeight: 110)
                if text.isEmpty {
                    Text(model.acknowledged ? "Escribe a Kio…  (Enter envía)" : "Acepta el aviso para empezar")
                        .foregroundColor(pal.muted).padding(.leading, 5).padding(.top, 2).allowsHitTesting(false)
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 8).fill(pal.raised))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(pal.line2, lineWidth: 1))
            Button(s.agent.busy ? "Detener" : "Enviar") { s.agent.busy ? s.cancel() : send() }
                .buttonStyle(KioButtonStyle(kind: s.agent.busy ? .normal : .primary, pal: pal))
                .disabled(!(s.agent.busy || (model.canSend && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)))
        }
        .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 10)
    }

    private func send() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, model.canSend else { return }
        text = ""
        listening(false)
        s.send(t)
    }

    /// El agente «escucha» mientras escribes. Se limita para no mandar una petición por tecla.
    private func listening(_ active: Bool) {
        let now = ProcessInfo.processInfo.systemUptime
        if active && now - lastListening < 2.5 { return }
        if !active && lastListening == 0 { return }
        lastListening = active ? now : 0
        s.listening(active)
    }
}

/// Cuadro de texto: Enter envía, Mayús+Enter salta de línea, Esc cierra el panel.
struct ComposerField: NSViewRepresentable {
    @Binding var text: String
    var enabled: Bool
    var focusToken: Int
    var textColor: NSColor
    var caretColor: NSColor
    var onSubmit: () -> Void
    var onEscape: () -> Void
    var onChange: (String) -> Void

    final class SubmitTextView: NSTextView {
        var onSubmit: () -> Void = {}
        var onEscape: () -> Void = {}
        override func keyDown(with event: NSEvent) {
            let enter = event.keyCode == 36 || event.keyCode == 76
            if enter && !event.modifierFlags.contains(.shift) && !hasMarkedText() { onSubmit(); return }
            if event.keyCode == 53 { onEscape(); return }
            super.keyDown(with: event)
        }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ComposerField
        var lastToken = -1
        init(_ p: ComposerField) { parent = p }
        func textDidChange(_ n: Notification) {
            guard let tv = n.object as? NSTextView else { return }
            parent.text = tv.string
            parent.onChange(tv.string)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.borderType = .noBorder
        let tv = SubmitTextView()
        tv.delegate = context.coordinator
        tv.isRichText = false
        tv.allowsUndo = true
        tv.drawsBackground = false
        tv.font = .systemFont(ofSize: 13.5)
        tv.textContainerInset = NSSize(width: 0, height: 2)
        tv.isVerticallyResizable = true
        tv.isHorizontallyResizable = false
        tv.autoresizingMask = [.width]
        tv.textContainer?.widthTracksTextView = true
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.setAccessibilityLabel("Mensaje para Kio")
        scroll.documentView = tv
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let tv = scroll.documentView as? SubmitTextView else { return }
        if tv.string != text { tv.string = text }
        tv.isEditable = enabled
        tv.isSelectable = enabled
        tv.textColor = textColor
        tv.insertionPointColor = caretColor
        tv.onSubmit = onSubmit
        tv.onEscape = onEscape
        if context.coordinator.lastToken != focusToken {
            context.coordinator.lastToken = focusToken
            DispatchQueue.main.async { tv.window?.makeFirstResponder(tv) }
        }
    }
}

/// El panel de conversación: flota junto a Kio y pide el teclado solo al abrirlo.
@MainActor
final class ConversationController {
    let model: AppModel
    let panel: FloatingPanel
    private let host: NSHostingView<ConversationView>

    init(model: AppModel, actions: PanelActions) {
        self.model = model
        let p = FloatingPanel(size: NSSize(width: Geometry.panelW, height: Geometry.panelH), allowsKey: true)
        p.hasShadow = true
        p.becomesKeyOnlyIfNeeded = false
        let h = NSHostingView(rootView: ConversationView(model: model, actions: actions))
        p.contentView = h
        panel = p
        host = h
    }

    var isOpen: Bool { panel.isVisible }

    func open(near kio: KioController) {
        let area = kio.area
        let size = Geometry.panelSize(w: area.width, h: area.height)
        let o = kio.origin()
        let p = Geometry.panelOrigin(charX: o.x, charY: o.y, charSide: Geometry.box(kio.size), w: area.width, h: area.height, pw: size.w, ph: size.h)
        panel.setFrame(kio.appKitRect(x: p.x, y: p.y, w: size.w, h: size.h), display: true)
        model.panelOpen = true
        panel.orderFrontRegardless()
        panel.makeKey()
    }

    func reposition(near kio: KioController) { if isOpen { open(near: kio) } }

    func close() {
        model.panelOpen = false
        panel.orderOut(nil)
    }
}
