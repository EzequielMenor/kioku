import AppKit
import KiokuKit
import SwiftUI

/// Comprobaciones y pasos de la configuración inicial (y de «Estado y configuración…» más tarde).
/// Nada se instala ni se cambia sin que pulses su botón; lo delicado (sustituir un arranque antiguo) pide confirmación.
@MainActor
final class SetupModel: ObservableObject {
    struct Agent: Equatable { var installed = false; var loaded = false }
    struct Legacy: Equatable, Identifiable { let label: String; let path: String; let loaded: Bool; var id: String { label } }

    let paths: KiokuPaths
    let cli: KiokuCLI?
    let app: AppModel
    @Published var checking = false
    @Published var daemonAgent = Agent()
    @Published var appAgent = Agent()
    @Published var legacy: [Legacy] = []
    @Published var launchdError: String? = nil
    @Published var companionRole: Bool? = nil
    @Published var ollama: Ollama.Probe? = nil
    @Published var pulling: Ollama.PullProgress? = nil
    @Published var pullError: String? = nil
    @Published var busy: String? = nil
    @Published var log: String = ""
    private var pull: Ollama.Pull? = nil

    let model = Ollama.defaultModel

    init(paths: KiokuPaths, cli: KiokuCLI?, app: AppModel) {
        self.paths = paths
        self.cli = cli
        self.app = app
    }

    var bundlePath: String? { Bundle.main.bundleURL.pathExtension == "app" ? Bundle.main.bundleURL.path : nil }
    var daemonRunning: Bool { paths.runtime() != nil }
    var hasModel: Bool { Ollama.has(model, in: ollama?.models ?? []) }
    var kiokuUsesModel: Bool {
        guard let e = app.store.engine else { return false }
        return e.provider == "ollama" && e.model == model && e.local
    }
    /// Lo imprescindible para usar Kio a diario.
    var essentialsOK: Bool { !paths.looksLikeObsidianVault && daemonRunning && companionRole == true }
    var everythingOK: Bool { essentialsOK && daemonAgent.loaded && appAgent.installed && legacy.isEmpty && hasModel && kiokuUsesModel }

    func refresh() {
        checking = true
        var pending = 3
        let done = { [weak self] in pending -= 1; if pending == 0 { self?.checking = false } }
        if let cli {
            cli.run(["service", "status", "--json"]) { [weak self] code, out in
                guard let self else { return }
                if code == 0, let j = JSON.parse(out.split(separator: "\n").last.map(String.init) ?? "") {
                    self.daemonAgent = Agent(installed: j["daemon"]["installed"].bool, loaded: j["daemon"]["loaded"].bool)
                    self.appAgent = Agent(installed: j["app"]["installed"].bool, loaded: j["app"]["loaded"].bool)
                    self.legacy = j["legacy"].array.map { Legacy(label: $0["label"].string ?? "", path: $0["path"].string ?? "", loaded: $0["loaded"].bool) }
                    self.launchdError = nil
                } else {
                    self.launchdError = out.isEmpty ? "No pude consultar launchd" : out
                }
                done()
            }
        } else {
            launchdError = "Esta copia no incluye la CLI de Kioku (¿se ejecuta fuera de Kioku.app?)."
            done()
        }
        if daemonRunning {
            app.client.get("/api/session", timeout: 4) { [weak self] r in
                guard let self else { return }
                if case .success(let j) = r { self.companionRole = j["role"].string == "companion" } else { self.companionRole = false }
                done()
            }
        } else { companionRole = nil; done() }
        Ollama.probe { [weak self] p in self?.ollama = p; done() }
    }

    private func runCLI(_ what: String, _ args: [String], then: (() -> Void)? = nil) {
        guard let cli else { log = "No hay CLI de Kioku en esta copia."; return }
        busy = what
        cli.run(args) { [weak self] code, out in
            guard let self else { return }
            self.busy = nil
            self.log = out
            if code == 0 { then?() }
            // El daemon tarda un momento en anotar su puerto: se vuelve a mirar en breve.
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.refresh() }
        }
    }

    /// Arranque con macOS: daemon (siempre en marcha) y esta app al iniciar sesión.
    func installLaunchd(replaceLegacy: Bool) {
        var args = ["service", "install", "--no-start-app"]
        if let b = bundlePath { args += ["--app", b] }
        if replaceLegacy { args.append("--replace-legacy") }
        runCLI("Activando el arranque con macOS…", args)
    }

    func uninstallLaunchd() { runCLI("Quitando el arranque con macOS…", ["service", "uninstall"]) }

    func startDaemonOnce() {
        guard let cli else { return }
        do {
            try cli.spawnDaemon(log: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Kioku/daemon.log"))
            busy = "Arrancando Kioku…"
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in self?.busy = nil; self?.refresh() }
        } catch { log = "No pude arrancar el daemon: \(error.localizedDescription)" }
    }

    func useModel() { runCLI("Configurando \(model)…", ["assistant", "model", "ollama", model]) { [weak self] in self?.app.store.load() } }

    func pullModel() {
        pullError = nil
        let p = Ollama.Pull()
        pull = p
        pulling = Ollama.PullProgress(line: .object(["status": .string("Empezando…")]))
        p.start(model: model, onProgress: { [weak self] pr in self?.pulling = pr }, onDone: { [weak self] err in
            guard let self else { return }
            self.pulling = nil
            self.pullError = err
            self.pull = nil
            self.refresh()
        })
    }

    func cancelPull() { pull?.cancel() }

    func chooseVault() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.directoryURL = paths.home
        panel.prompt = "Usar esta carpeta"
        panel.message = "Carpeta de tu bóveda de Kioku"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try KiokuPaths.saveHome(url)
            log = "Bóveda: \(url.path). Kioku se reinicia para usarla (si usas el arranque con macOS, vuelve a activarlo)."
            AppDelegate.relaunch()
        } catch { log = "No pude guardar la bóveda: \(error.localizedDescription)" }
    }
}

struct SetupView: View {
    @ObservedObject var setup: SetupModel
    @ObservedObject var app: AppModel
    var onDone: () -> Void
    var onOpenKioku: () -> Void
    @State private var confirmLegacy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Kioku en este Mac").font(.title2.bold())
                    Text("Tu segundo cerebro local, con Kio flotando en el escritorio y el asistente en tu Ollama.").foregroundColor(.secondary)
                }
            }
            Divider()
            row(ok: !setup.paths.looksLikeObsidianVault, title: "Bóveda", detail: setup.paths.looksLikeObsidianVault
                ? "\(setup.paths.home.path) parece una bóveda de Obsidian: Kioku no la usa para no modificarla. Elige otra e impórtala con kioku import-obsidian."
                : setup.paths.home.path) {
                Button("Cambiar…") { setup.chooseVault() }
            }
            row(ok: setup.daemonAgent.loaded && setup.appAgent.installed && setup.legacy.isEmpty, title: "Arranque con macOS",
                detail: launchdDetail) {
                if !setup.legacy.isEmpty {
                    Button("Sustituir…") { confirmLegacy = true }
                } else if !(setup.daemonAgent.loaded && setup.appAgent.installed) {
                    Button("Activar") { setup.installLaunchd(replaceLegacy: false) }.keyboardShortcut(.defaultAction)
                }
            }
            row(ok: setup.daemonRunning && setup.companionRole == true, title: "Kioku (daemon local)", detail: daemonDetail) {
                if !setup.daemonRunning && setup.legacy.isEmpty { Button("Arrancar solo ahora") { setup.startDaemonOnce() } }
            }
            row(ok: setup.hasModel, title: "Ollama con \(setup.model)", detail: ollamaDetail) {
                if setup.ollama == .unreachable {
                    Button("Descargar Ollama") { NSWorkspace.shared.open(URL(string: "https://ollama.com/download")!) }
                } else if setup.ollama?.reachable == true && !setup.hasModel {
                    if setup.pulling != nil { Button("Cancelar") { setup.cancelPull() } } else { Button("Descargar el modelo") { setup.pullModel() } }
                }
            }
            if let p = setup.pulling {
                ProgressView(value: p.fraction ?? 0) { Text(p.status).font(.caption) }.padding(.leading, 28)
            }
            row(ok: setup.kiokuUsesModel, title: "Asistente", detail: assistantDetail) {
                if !setup.kiokuUsesModel && setup.daemonRunning { Button("Usar \(setup.model)") { setup.useModel() } }
            }
            if let busy = setup.busy { HStack { ProgressView().controlSize(.small); Text(busy) } }
            if !setup.log.isEmpty {
                ScrollView { Text(setup.log).font(.system(size: 11, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                    .frame(maxHeight: 90)
                    .padding(8).background(RoundedRectangle(cornerRadius: 6).fill(Color.secondary.opacity(0.08)))
            }
            Divider()
            HStack {
                Text("⌥⌘K abre la conversación con Kio. Clic derecho sobre Kio: concentración.").font(.caption).foregroundColor(.secondary)
                Spacer()
                Button("Comprobar") { setup.refresh() }.disabled(setup.checking)
                Button("Abrir Kioku") { onOpenKioku() }.disabled(!setup.essentialsOK)
                Button("Listo") { onDone() }.keyboardShortcut(setup.everythingOK ? KeyboardShortcut.defaultAction : KeyboardShortcut.cancelAction)
            }
        }
        .padding(20)
        .frame(width: 600)
        .onAppear { setup.refresh() }
        .alert("¿Sustituir el arranque antiguo de Kioku?", isPresented: $confirmLegacy) {
            Button("Sustituir", role: .destructive) { setup.installLaunchd(replaceLegacy: true) }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text("\(setup.legacy.map(\.label).joined(separator: ", ")) arranca otra versión de Kioku sobre la misma bóveda. Se detendrá y su plist se guardará en ~/Library/Application Support/Kioku/legacy/ para poder volver atrás. Tus notas no se tocan. Usará el mismo puerto (47800), así que tailscale serve y el móvil siguen funcionando.")
        }
    }

    private var launchdDetail: String {
        if let e = setup.launchdError { return e }
        if !setup.legacy.isEmpty { return "Ya arranca otra instalación de Kioku: \(setup.legacy.map { $0.label + ($0.loaded ? " (en marcha)" : "") }.joined(separator: ", ")). Sustitúyela para usar esta versión." }
        let d = setup.daemonAgent.loaded ? "el daemon arranca con tu sesión y se relanza si cae" : "el daemon no arranca solo"
        let a = setup.appAgent.installed ? "Kio aparece al iniciar sesión" : "Kio no se abre solo"
        return "\(d); \(a)."
    }

    private var daemonDetail: String {
        guard let rt = setup.paths.runtime() else { return "No está en marcha." }
        switch setup.companionRole {
        case true?: return "En marcha en 127.0.0.1:\(rt.port), conectado con Kio."
        case false?: return "En marcha en 127.0.0.1:\(rt.port), pero no reconoce a Kio: es de una versión anterior. Sustituye el arranque antiguo o reinícialo."
        case nil: return "En marcha en 127.0.0.1:\(rt.port)."
        }
    }

    private var ollamaDetail: String {
        switch setup.ollama {
        case nil: return "Comprobando…"
        case .unreachable?: return "No responde en 127.0.0.1:11434. Instala Ollama (o ábrelo) y pulsa Comprobar."
        case .ready(let models)?:
            if setup.hasModel { return "Listo en 127.0.0.1:11434." }
            if let e = setup.pullError { return "La descarga falló: \(e)" }
            return "Ollama responde, pero falta \(setup.model) (unos 6 GB). Modelos: \(models.isEmpty ? "ninguno" : models.joined(separator: ", "))."
        }
    }

    private var assistantDetail: String {
        guard let e = app.store.engine, let m = e.model else { return setup.daemonRunning ? "Sin modelo configurado todavía." : "Arranca Kioku para comprobarlo." }
        return "\(e.local ? "Local" : "Remoto") · \(e.provider ?? "?") · \(m)\(setup.kiokuUsesModel ? ": el texto de tus notas no sale del Mac." : "")"
    }

    private func row<Accessory: View>(ok: Bool, title: String, detail: String, @ViewBuilder accessory: () -> Accessory) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: ok ? "checkmark.circle.fill" : "circle.dashed")
                .foregroundColor(ok ? .green : .secondary).font(.system(size: 16))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(detail).font(.callout).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
            }
            Spacer(minLength: 8)
            accessory()
        }
    }
}
