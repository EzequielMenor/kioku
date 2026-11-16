import AppKit
import KiokuKit

/// Verificación automática en un macOS real (CI): con `KIOKU_MAC_SMOKE_DIR`, la app escribe su estado en
/// `report.json` y ejecuta órdenes que dejan en `cmd/*.json` (abrir el panel, enviar, aplicar, capturas…).
/// Sin esa variable no hace nada. Las capturas salen de las propias vistas: no necesitan permiso de grabación.
@MainActor
final class SmokeDriver {
    let dir: URL
    weak var app: AppDelegate?
    private var timer: Timer?
    private var seq = 0

    init?(app: AppDelegate) {
        guard let d = ProcessInfo.processInfo.environment["KIOKU_MAC_SMOKE_DIR"], !d.isEmpty else { return nil }
        dir = URL(fileURLWithPath: d)
        self.app = app
        try? FileManager.default.createDirectory(at: dir.appendingPathComponent("cmd"), withIntermediateDirectories: true)
        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in Task { @MainActor in self?.tick() } }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func tick() {
        seq += 1
        if seq % 2 == 0 { writeReport() }
        let cmdDir = dir.appendingPathComponent("cmd")
        guard let files = try? FileManager.default.contentsOfDirectory(atPath: cmdDir.path).filter({ $0.hasSuffix(".json") }).sorted(),
              let first = files.first else { return }
        let url = cmdDir.appendingPathComponent(first)
        let cmd = (try? Data(contentsOf: url)).flatMap { JSON.parse($0) } ?? .null
        try? FileManager.default.removeItem(at: url)
        run(cmd, name: (first as NSString).deletingPathExtension)
    }

    private func run(_ c: JSON, name: String) {
        guard let app else { return }
        let m: AppModel = app.model
        var result = "ok"
        switch c["do"].string ?? "" {
        case "open": app.openPanel()
        case "close": app.closePanel()
        case "ack": m.acknowledge()
        case "send": m.store.send(c["text"].string ?? "")
        case "decide":
            if let p = m.store.messages.flatMap(\.proposals).first(where: \.pending) {
                m.decide(p, c["what"].string ?? "apply")
                result = "decided \(p.id) armed=\(m.confirming.contains(p.id))"
            } else { result = "no pending proposal" }
        case "undo":
            if let a = m.store.messages.flatMap(\.actions).first(where: { !$0.undone }) { m.store.undo(a.id); result = "undo \(a.id)" } else { result = "no action" }
        case "mode": m.store.setMode(c["mode"].string ?? "active")
        case "workspace": app.showWorkspace(route: c["route"].string)
        case "closeWorkspace": app.workspace.window?.performClose(nil)
        case "setup": app.showSetup()
        case "closeSetup": app.setupWindow?.performClose(nil)
        case "snapshot": snapshot(c["name"].string ?? name)
        case "quit": NSApp.terminate(nil)
        default: result = "unknown"
        }
        try? "\(result)\n".write(to: dir.appendingPathComponent("cmd-\(name).done"), atomically: true, encoding: .utf8)
    }

    private func save(_ view: NSView, _ file: String) {
        guard view.bounds.width > 0, view.bounds.height > 0, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent(file))
    }

    private func snapshot(_ name: String) {
        guard let app else { return }
        if let v = app.kio.panel.contentView, app.kio.panel.isVisible { save(v, "\(name)-kio.png") }
        if let v = app.kio.peek.contentView, app.kio.peek.isVisible { save(v, "\(name)-peek.png") }
        if let v = app.conversation.panel.contentView, app.conversation.isOpen { save(v, "\(name)-panel.png") }
        if let v = app.setupWindow?.contentView, app.setupWindow?.isVisible == true { save(v, "\(name)-setup.png") }
        if app.workspace.isOpen {
            app.workspace.snapshot { [dir] image in
                guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return }
                try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("\(name)-workspace.png"))
            }
        }
    }

    private func rect(_ r: NSRect) -> [Double] { [r.minX, r.minY, r.width, r.height] }
    private func opt(_ v: Any?) -> Any { v ?? NSNull() }

    func writeReport() {
        guard let app else { return }
        let s = app.model.store
        let kio = app.kio.panel
        let report: [String: Any] = [
            "pid": Int(getpid()),
            "connected": s.connected, "ready": s.ready,
            "faceState": s.faceState, "faceHistory": app.model.faceHistory, "agentState": s.agent.state, "agentLabel": opt(s.agent.label), "busy": s.busy,
            "mode": s.companion.mode, "quiet": s.companion.quiet, "webForeground": s.companion.webForeground,
            "overlay": opt(s.companion.overlay.map { [$0.x, $0.y] }),
            "kioVisible": kio.isVisible, "kioFrame": rect(kio.frame), "kioLevel": kio.level.rawValue,
            "kioAllSpaces": kio.collectionBehavior.contains(.canJoinAllSpaces),
            "kioFullScreenAux": kio.collectionBehavior.contains(.fullScreenAuxiliary),
            "kioCanBecomeKey": kio.canBecomeKey, "kioIgnoresMouse": kio.ignoresMouseEvents,
            "screen": rect(app.kio.area),
            "panelOpen": app.conversation.isOpen, "panelFrame": rect(app.conversation.panel.frame), "panelIsKey": app.conversation.panel.isKeyWindow,
            "appActive": NSApp.isActive, "activationPolicy": NSApp.activationPolicy().rawValue,
            "peekVisible": app.kio.peek.isVisible, "peekText": opt(app.kio.peekText),
            "messages": s.messages.count, "lastAssistant": opt(s.messages.last(where: { $0.role == "assistant" })?.text),
            "pendingProposals": s.messages.flatMap(\.proposals).filter(\.pending).count,
            "undoable": s.messages.flatMap(\.actions).filter { !$0.undone }.count,
            "problem": opt(s.problem), "acknowledged": app.model.acknowledged,
            "engine": opt(s.engine.map { ["provider": opt($0.provider), "model": opt($0.model), "local": $0.local] as [String: Any] }),
            "workspaceOpen": app.workspace.isOpen, "workspaceURL": opt(app.workspace.currentURL),
            "setupOpen": app.setupWindow?.isVisible ?? false,
            "statusItem": app.statusItem?.button != nil,
            "hotKey": app.hotKey != nil,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: dir.appendingPathComponent("report.json"), options: .atomic)
        }
    }
}
