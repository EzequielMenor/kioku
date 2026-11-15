import AppKit
import Combine
import KiokuKit
import SwiftUI

/// Estado observable de la app: envuelve el espejo del daemon (`CompanionStore`) para SwiftUI y guarda lo poco que es
/// solo de esta interfaz (aviso de privacidad aceptado, propuestas armadas para la segunda confirmación).
@MainActor
final class AppModel: ObservableObject {
    let paths: KiokuPaths
    let client: KiokuClient
    let store: CompanionStore
    @Published private(set) var tick = 0
    /// Últimos estados por los que pasó Kio (para la prueba de humo, que muestrea cada medio segundo).
    private(set) var faceHistory: [String] = []
    @Published var acknowledged: Bool
    /// Propuestas con «Confirmar: aplicar» armado (borrar, mover o reemplazar piden dos pulsaciones).
    @Published var confirming: Set<String> = []
    @Published var panelOpen = false

    /// Avisos para el resto de la app (ventanas, menú) cuando cambia algo del daemon.
    var onStoreChange: () -> Void = {}

    init(paths: KiokuPaths) {
        self.paths = paths
        client = KiokuClient(paths: paths)
        store = CompanionStore(api: client)
        acknowledged = paths.privacyAcknowledged()
        store.onChange = { [weak self] in
            guard let self else { return }
            self.tick &+= 1
            let face = self.store.faceState
            if self.faceHistory.last != face { self.faceHistory.append(face); if self.faceHistory.count > 40 { self.faceHistory.removeFirst() } }
            self.onStoreChange()
        }
    }

    func start() {
        client.startEvents(onEvent: { [weak self] e in self?.store.onEvent(e) },
                           onStatus: { [weak self] ok in self?.store.onStatus(ok) })
    }

    func stop() { client.stopEvents() }

    func acknowledge() {
        paths.acknowledgePrivacy()
        acknowledged = true
    }

    var canSend: Bool { acknowledged && store.connected && store.ready && !store.busy }

    var statusText: String {
        guard store.connected else { return "Sin conexión" }
        return store.agent.label ?? KioText.state[store.faceState] ?? ""
    }

    var modelChip: (text: String, local: Bool)? {
        guard let e = store.engine, let model = e.model else { return nil }
        return ("\(e.local ? "local" : "remoto") · \(model)", e.local)
    }

    func decide(_ p: Proposal, _ what: String) {
        if what == "apply" && p.risky && !confirming.contains(p.id) {
            confirming.insert(p.id)
            return
        }
        confirming.remove(p.id)
        store.decide(p.id, what)
    }
}

/// Colores de la interfaz de Kio (los mismos que el overlay de Linux y la web).
struct Palette {
    let surface, raised, hover, line, line2, fg, fg2, muted, accent, accentFg, accentSoft, bad, good, warnBg, warnLine: Color

    static func hex(_ h: String, _ a: Double = 1) -> Color {
        let c = RGB(hex: h)
        return Color(.sRGB, red: c.r, green: c.g, blue: c.b, opacity: a)
    }

    static let dark = Palette(
        surface: hex("#181714"), raised: hex("#1e1c19"), hover: hex("#211f1b"), line: hex("#2a2723"), line2: hex("#36322c"),
        fg: hex("#ebe6dc"), fg2: hex("#bdb6a8"), muted: hex("#8b8478"), accent: hex("#7f9bd6"), accentFg: hex("#0c1220"),
        accentSoft: hex("#7f9bd6", 0.13), bad: hex("#e8786c"), good: hex("#8fb573"), warnBg: hex("#d8a657", 0.10), warnLine: hex("#d8a657", 0.38))
    static let light = Palette(
        surface: hex("#fbf8f1"), raised: hex("#fbf8f1"), hover: hex("#ebe4d4"), line: hex("#e2dacb"), line2: hex("#d4cab6"),
        fg: hex("#1f1b16"), fg2: hex("#4d463b"), muted: hex("#6c6558"), accent: hex("#2f4b8a"), accentFg: hex("#ffffff"),
        accentSoft: hex("#2f4b8a", 0.09), bad: hex("#b3342b"), good: hex("#4c7a32"), warnBg: hex("#f6ead0"), warnLine: hex("#dfc27f"))

    static func of(_ scheme: ColorScheme) -> Palette { scheme == .dark ? dark : light }
}

enum Appearance {
    static var theme: String {
        NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? "dark" : "light"
    }
    static var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
}
