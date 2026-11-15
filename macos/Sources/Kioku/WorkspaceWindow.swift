import AppKit
import KiokuKit
import WebKit

/// La ventana de Kioku: la interfaz web del daemon local dentro de una ventana nativa (con su Kio integrado).
/// Usa la clave completa solo para iniciar sesión, igual que `kioku open`; el resto de la app usa la del compañero.
@MainActor
final class WorkspaceWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private let paths: KiokuPaths
    private(set) var window: NSWindow?
    private(set) var webView: WKWebView?
    var onVisibilityChange: (Bool) -> Void = { _ in }
    var onProblem: (String) -> Void = { _ in }

    init(paths: KiokuPaths) { self.paths = paths }

    var isOpen: Bool { window?.isVisible ?? false }
    /// URL actual sin la clave (para informes y pruebas).
    var currentURL: String? {
        guard let u = webView?.url, var c = URLComponents(url: u, resolvingAgainstBaseURL: false) else { return nil }
        c.queryItems = c.queryItems?.filter { $0.name != "k" }
        if c.queryItems?.isEmpty == true { c.queryItems = nil }
        return c.string
    }

    /// Abre (o trae al frente) la ventana. Con una ruta y la ventana ya cargada, la propia página navega por el
    /// evento `navigate` del daemon; aquí solo se enfoca.
    func show(route: String? = nil) {
        if let w = window, webView?.url != nil {
            if !w.isVisible { onVisibilityChange(true) }
            NSApp.activate(ignoringOtherApps: true)
            w.makeKeyAndOrderFront(nil)
            return
        }
        guard let rt = paths.runtime() else { onProblem("Kioku no está en marcha todavía: arráncalo desde «Estado y configuración…»."); return }
        guard let key = paths.fullKeyValue() else { onProblem("No encuentro la clave local de Kioku (.kioku/secret)."); return }
        let r = route ?? "/hoy"
        guard let url = URL(string: KiokuPaths.loginURL(base: "http://127.0.0.1:\(rt.port)", key: key, route: "/#" + (r.hasPrefix("/") ? r : "/" + r))) else { return }
        let w = window ?? makeWindow()
        onVisibilityChange(true)
        webView?.load(URLRequest(url: url))
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }

    private func makeWindow() -> NSWindow {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 820), configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.setValue(false, forKey: "drawsBackground")
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        w.title = "Kioku"
        w.titlebarAppearsTransparent = true
        w.isReleasedWhenClosed = false
        w.minSize = NSSize(width: 720, height: 480)
        w.contentView = web
        w.delegate = self
        w.center()
        w.setFrameAutosaveName("KiokuWorkspace")
        window = w
        webView = web
        return w
    }

    func reload() { webView?.reload() }

    func windowWillClose(_ notification: Notification) { onVisibilityChange(false) }

    // Solo el daemon local se abre aquí; cualquier otro enlace va al navegador.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        let local = url.host == "127.0.0.1" || url.host == "localhost"
        if local || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { decisionHandler(.allow); return }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        onProblem("No pude abrir Kioku: \(error.localizedDescription)")
    }

    /// Captura de la página (para la verificación automática).
    func snapshot(_ done: @escaping (NSImage?) -> Void) {
        guard let web = webView else { done(nil); return }
        web.takeSnapshot(with: nil) { image, _ in done(image) }
    }
}
