import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Ollama local del Mac: ¿responde?, ¿tiene el modelo?, y descarga del modelo cuando lo pides tú.
/// Kioku no instala Ollama: si no está, la app lo dice y enlaza su descarga.
public enum Ollama {
    public static let defaultModel = "qwen3.5:9b"
    public static let base = URL(string: "http://127.0.0.1:11434")!

    public enum Probe: Equatable {
        case unreachable
        case ready(models: [String])
        public var reachable: Bool { if case .ready = self { return true }; return false }
        public var models: [String] { if case .ready(let m) = self { return m }; return [] }
    }

    /// `qwen3.5:9b` coincide con `qwen3.5:9b`; un nombre sin etiqueta coincide con `:latest`.
    public static func has(_ model: String, in models: [String]) -> Bool {
        let want = model.contains(":") ? model : model + ":latest"
        return models.contains { $0 == want || $0 == model }
    }

    public static func models(fromTags j: JSON) -> [String] {
        j["models"].array.compactMap { $0["name"].string ?? $0["model"].string }
    }

    public static func probe(base: URL = base, completion: @escaping (Probe) -> Void) {
        var req = URLRequest(url: base.appendingPathComponent("api/tags"), timeoutInterval: 3)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: req) { data, response, error in
            let ok = error == nil && (response as? HTTPURLResponse)?.statusCode == 200
            let result: Probe = ok ? .ready(models: models(fromTags: data.flatMap { JSON.parse($0) } ?? .null)) : .unreachable
            DispatchQueue.main.async { completion(result) }
        }.resume()
    }

    /// Progreso de `/api/pull` (NDJSON): texto de estado y fracción si se conoce.
    public struct PullProgress: Equatable {
        public let status: String
        public let fraction: Double?
        public let error: String?
        public init(line: JSON) {
            status = line["status"].string ?? ""
            if let total = line["total"].double, total > 0, let done = line["completed"].double { fraction = min(1, done / total) } else { fraction = nil }
            error = line["error"].string
        }
    }

    public final class Pull {
        private var stream: LineStream?
        public init() {}
        public func start(model: String, base: URL = Ollama.base, onProgress: @escaping (PullProgress) -> Void, onDone: @escaping (String?) -> Void) {
            var req = URLRequest(url: base.appendingPathComponent("api/pull"), timeoutInterval: 120)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["model": model, "stream": true])
            var failure: String? = nil
            stream = LineStream(request: req, idleTimeout: 120, onResponse: { status in
                if status != 200 { failure = "Ollama respondió \(status)" }
                return status == 200
            }, onLine: { line in
                guard let j = JSON.parse(line) else { return }
                let p = PullProgress(line: j)
                if let e = p.error { failure = e }
                DispatchQueue.main.async { onProgress(p) }
            }, onEnd: { error in
                let message = failure ?? error.map { ($0 as NSError).localizedDescription }
                DispatchQueue.main.async { onDone(message) }
            })
        }
        public func cancel() { stream?.cancel() }
    }
}

/// La CLI de Kioku incluida en la app (`Contents/Resources/runtime/node` + `app/src/cli/main.ts`): la app la usa para
/// lo que ya resuelve Node (arranque con launchd, elegir el modelo), sin duplicar esa lógica en Swift.
public struct KiokuCLI {
    public let node: URL
    public let main: URL
    public let home: URL

    public init(node: URL, main: URL, home: URL) { self.node = node; self.main = main; self.home = home }

    /// La de esta app, o la indicada en `KIOKU_NODE`/`KIOKU_MAIN` (desarrollo).
    public static func bundled(home: URL, bundle: URL = Bundle.main.bundleURL, env: [String: String] = ProcessInfo.processInfo.environment) -> KiokuCLI? {
        let fm = FileManager.default
        if let n = env["KIOKU_NODE"], let m = env["KIOKU_MAIN"], fm.isExecutableFile(atPath: n), fm.fileExists(atPath: m) {
            return KiokuCLI(node: URL(fileURLWithPath: n), main: URL(fileURLWithPath: m), home: home)
        }
        let res = bundle.appendingPathComponent("Contents/Resources")
        let node = res.appendingPathComponent("runtime/node"), main = res.appendingPathComponent("app/src/cli/main.ts")
        guard fm.isExecutableFile(atPath: node.path), fm.fileExists(atPath: main.path) else { return nil }
        return KiokuCLI(node: node, main: main, home: home)
    }

    public func environment(_ base: [String: String] = ProcessInfo.processInfo.environment) -> [String: String] {
        var env = base
        env["KIOKU_HOME"] = home.path
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        env["NODE_NO_WARNINGS"] = "1"
        return env
    }

    /// Ejecuta `kioku <args>` en segundo plano y devuelve (código, salida combinada) en el hilo principal.
    public func run(_ args: [String], completion: @escaping (Int32, String) -> Void) {
        let p = Process()
        p.executableURL = node
        p.arguments = ["--no-warnings", main.path] + args
        p.environment = environment()
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        p.standardInput = FileHandle.nullDevice
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try p.run()
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                p.waitUntilExit()
                let out = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                DispatchQueue.main.async { completion(p.terminationStatus, out) }
            } catch {
                DispatchQueue.main.async { completion(-1, "No pude ejecutar la CLI de Kioku: \(error.localizedDescription)") }
            }
        }
    }

    /// Arranca el daemon desacoplado de la app (si la cierras, sigue). Para cuando no se usa launchd.
    public func spawnDaemon(log: URL) throws {
        try FileManager.default.createDirectory(at: log.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
        let handle = try FileHandle(forWritingTo: log)
        handle.seekToEndOfFile()
        let p = Process()
        p.executableURL = node
        p.arguments = ["--no-warnings", main.path, "daemon"]
        var env = environment()
        env["KIOKU_PORT"] = env["KIOKU_PORT"] ?? "47800"
        p.environment = env
        p.standardOutput = handle
        p.standardError = handle
        p.standardInput = FileHandle.nullDevice
        try p.run()
    }
}
