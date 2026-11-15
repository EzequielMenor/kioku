import AppKit
import KiokuKit
import SwiftUI

/// Kioku.app: menú en la barra superior, Kio flotando, su conversación y la ventana de Kioku.
/// El daemon es aparte (launchd o arrancado a mano); la app solo se conecta a él por 127.0.0.1.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var paths: KiokuPaths!
    var model: AppModel!
    var kio: KioController!
    var conversation: ConversationController!
    var workspace: WorkspaceWindow!
    var setup: SetupModel!
    var cli: KiokuCLI?
    var statusItem: NSStatusItem?
    var hotKey: HotKey?
    var setupWindow: NSWindow?
    private var smoke: SmokeDriver?
    private var signals: [DispatchSourceSignal] = []
    private var fromLogin = false
    private var setupShownOnce = false

    nonisolated override init() { super.init() }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        fromLogin = args.contains("--login")
        paths = KiokuPaths(home: KiokuPaths.resolveHome())

        // Una sola Kio por bóveda: un segundo arranque (launchd al iniciar sesión, `kioku companion`…) se retira.
        if let other = paths.otherInstance() {
            NSLog("Kioku ya está en marcha (pid \(other)); este arranque se retira.")
            exit(0)
        }
        paths.writePid()
        installSignals()

        cli = KiokuCLI.bundled(home: paths.home)
        model = AppModel(paths: paths)
        setup = SetupModel(paths: paths, cli: cli, app: model)
        workspace = WorkspaceWindow(paths: paths)
        workspace.onVisibilityChange = { [weak self] visible in self?.dock(workspace: visible) }
        workspace.onProblem = { [weak self] text in self?.model.store.report(text); self?.showSetup() }

        let spec = loadSpec()
        kio = KioController(model: model, spec: spec)
        conversation = ConversationController(model: model, actions: PanelActions(
            close: { [weak self] in self?.closePanel() },
            hideKio: { [weak self] in self?.closePanel(); self?.model.store.setMode("hidden") },
            openKioku: { [weak self] in self?.closePanel(); self?.showWorkspace(route: "/asistente") }
        ))
        kio.onClick = { [weak self] in self?.togglePanel() }
        kio.onMoved = { [weak self] in guard let self else { return }; self.conversation.reposition(near: self.kio) }

        model.onStoreChange = { [weak self] in self?.storeChanged() }
        model.store.onOtherEvent = { [weak self] e in
            // «Abrir en Kioku» desde Kio, la CLI o la web: la ventana nativa se encarga.
            if e["kind"].string == "navigate" { self?.showWorkspace(route: e["route"].string) }
        }

        if !paths.looksLikeObsidianVault { try? paths.ensureCompanionKey() }
        model.start()
        kio.update()
        buildStatusItem()
        hotKey = HotKey { [weak self] in self?.togglePanel() }
        smoke = SmokeDriver(app: self)

        // Primer vistazo: si falta lo imprescindible, la configuración; si no, y la abriste tú, la ventana de Kioku.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.firstLook() }
    }

    private func firstLook() {
        if paths.looksLikeObsidianVault || paths.runtime() == nil || !UserDefaults.standard.bool(forKey: "setupSeen") {
            showSetup()
            UserDefaults.standard.set(true, forKey: "setupSeen")
        } else if !fromLogin && ProcessInfo.processInfo.environment["KIOKU_MAC_SMOKE_DIR"] == nil {
            showWorkspace(route: nil)
        }
    }

    private func loadSpec() -> CharacterSpec {
        var candidates: [URL] = []
        if let r = Bundle.main.url(forResource: "character", withExtension: "json") { candidates.append(r) }
        if let e = ProcessInfo.processInfo.environment["KIOKU_CHARACTER"] { candidates.append(URL(fileURLWithPath: e)) }
        if let main = cli?.main { candidates.append(main.deletingLastPathComponent().appendingPathComponent("../../companion/character.json").standardizedFileURL) }
        for c in candidates { if let s = try? CharacterSpec(contentsOf: c) { return s } }
        // Último recurso (no debería pasar en Kioku.app): la especificación mínima embebida.
        return try! CharacterSpec(json: JSON.parse(Self.fallbackSpec)!)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWorkspace(route: nil)
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        model?.stop()
        paths?.removePidIfMine()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    // ───────── señales (mismo contrato que el overlay de Linux) ─────────

    private func installSignals() {
        for (sig, action) in [(SIGUSR1, { [weak self] in self?.togglePanel() }), (SIGTERM, { NSApp.terminate(nil) }), (SIGUSR2, { [weak self] in self?.showWorkspace(route: nil) })] as [(Int32, () -> Void)] {
            signal(sig, SIG_IGN)
            let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            src.setEventHandler { Task { @MainActor in action() } }
            src.resume()
            signals.append(src)
        }
    }

    // ───────── Kio y su panel ─────────

    private func storeChanged() {
        kio.update()
        // Oculto o con Kioku delante: el panel se va con él.
        if conversation.isOpen && !kio.visible { closePanel() }
        statusItem?.button?.toolTip = "Kioku · \(model.statusText)"
    }

    func togglePanel() { conversation.isOpen ? closePanel() : openPanel() }

    func openPanel() {
        if model.store.companion.mode == "hidden" { model.store.setMode("active") }
        if !kio.visible {
            // Con Kioku delante, Kio se retira: hablarle es abrir su panel igualmente, junto a la esquina.
            kio.update()
        }
        conversation.open(near: kio)
        kio.update()
    }

    func closePanel() {
        conversation.close()
        kio.update()
    }

    // ───────── ventanas ─────────

    func showWorkspace(route: String?) {
        workspace.show(route: route)
    }

    func showSetup() {
        if setupWindow == nil {
            let host = NSHostingView(rootView: SetupView(setup: setup, app: model, onDone: { [weak self] in self?.setupWindow?.performClose(nil) },
                                                          onOpenKioku: { [weak self] in self?.setupWindow?.performClose(nil); self?.showWorkspace(route: nil) }))
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 520), styleMask: [.titled, .closable], backing: .buffered, defer: false)
            w.title = "Kioku · Estado y configuración"
            w.contentView = host
            w.isReleasedWhenClosed = false
            w.center()
            NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.dock(setup: false) }
            }
            setupWindow = w
        }
        setupShownOnce = true
        dock(setup: true)
        setup.refresh()
        NSApp.activate(ignoringOtherApps: true)
        setupWindow?.makeKeyAndOrderFront(nil)
    }

    /// En el Dock solo mientras hay una ventana de verdad abierta; si no, vive en la barra de menús.
    /// Quien avisa pasa su estado: durante `windowWillClose` la ventana aún cuenta como visible.
    private func dock(workspace ws: Bool? = nil, setup su: Bool? = nil) {
        let anyWindow = (ws ?? workspace.isOpen) || (su ?? (setupWindow?.isVisible ?? false))
        NSApp.setActivationPolicy(anyWindow ? .regular : .accessory)
    }

    static func relaunch() {
        let path = Bundle.main.bundleURL.path
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", "sleep 1; /usr/bin/open -n \"$0\"", path]
        try? p.run()
        NSApp.terminate(nil)
    }

    // ───────── barra de menús ─────────

    private func buildStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = KioPainter.menuBarIcon()
        item.button?.toolTip = "Kioku"
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        statusItem = item
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let s = model.store
        let header = NSMenuItem(title: s.connected ? "Kio · \(model.statusText)" : "Kio · sin conexión con Kioku", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        if let chip = model.modelChip {
            let m = NSMenuItem(title: "Modelo: \(chip.text)", action: nil, keyEquivalent: "")
            m.isEnabled = false
            menu.addItem(m)
        }
        menu.addItem(.separator())
        add(menu, "Abrir Kioku", #selector(menuOpenKioku), "o")
        let talk = add(menu, conversation.isOpen ? "Cerrar la conversación" : "Hablar con Kio", #selector(menuTogglePanel), "k")
        talk.keyEquivalentModifierMask = [.command, .option]
        add(menu, s.companion.mode == "hidden" ? "Mostrar a Kio" : "Ocultar a Kio", #selector(menuToggleHidden), "")
        add(menu, "Modo concentración", #selector(menuToggleFocus), "").state = s.companion.mode == "focus" ? .on : .off
        menu.addItem(.separator())
        add(menu, "Abrir en el navegador", #selector(menuOpenBrowser), "")
        add(menu, "Estado y configuración…", #selector(menuSetup), ",")
        add(menu, "Iniciar con macOS", #selector(menuToggleLogin), "").state = setup.daemonAgent.loaded && setup.appAgent.installed ? .on : .off
        menu.addItem(.separator())
        add(menu, "Salir de Kioku (el daemon sigue en marcha)", #selector(menuQuit), "q")
        setup.refresh()
    }

    @discardableResult
    private func add(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        menu.addItem(item)
        return item
    }

    @objc private func menuOpenKioku() { showWorkspace(route: nil) }
    @objc private func menuTogglePanel() { togglePanel() }
    @objc private func menuToggleHidden() { model.store.setMode(model.store.companion.mode == "hidden" ? "active" : "hidden") }
    @objc private func menuToggleFocus() { model.store.setMode(model.store.companion.mode == "focus" ? "active" : "focus") }
    @objc private func menuSetup() { showSetup() }
    @objc private func menuQuit() { NSApp.terminate(nil) }

    @objc private func menuOpenBrowser() {
        guard let rt = paths.runtime(), let key = paths.fullKeyValue(),
              let url = URL(string: KiokuPaths.loginURL(base: "http://127.0.0.1:\(rt.port)", key: key, route: "/#/hoy")) else { showSetup(); return }
        NSWorkspace.shared.open(url)
    }

    @objc private func menuToggleLogin() {
        if setup.daemonAgent.loaded && setup.appAgent.installed { setup.uninstallLaunchd() }
        else if setup.legacy.isEmpty { setup.installLaunchd(replaceLegacy: false) }
        else { showSetup() }  // sustituir un arranque antiguo se confirma en la ventana
    }

    static let fallbackSpec = ##"{"body":{"inset":0.07,"radius":0.26},"eyes":{"gap":0.34,"y":0.47,"w":0.15,"h":0.25,"travel":0.07},"blink":{"every":4.2,"jitter":2.6,"duration":0.14},"ease":9,"palette":{"dark":{"accent":"#7f9bd6","ink":"#0c1220","good":"#8fb573","bad":"#e8786c","warn":"#d8a657","muted":"#5b574f","paper":"#ebe6dc"},"light":{"accent":"#2f4b8a","ink":"#ffffff","good":"#4c7a32","bad":"#b3342b","warn":"#b07a1e","muted":"#a39c8d","paper":"#1f1b16"}},"states":{"idle":{"open":1,"arc":0,"tilt":0,"raise":0,"look":[0,0],"motion":"breathe","badge":null,"tone":"accent","body":"accent","blink":true},"quiet":{"open":0.14,"arc":0,"tilt":0,"raise":0,"look":[0,0.2],"motion":"none","badge":null,"tone":"muted","body":"muted","blink":false}}}"##
}
