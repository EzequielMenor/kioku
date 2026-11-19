import Foundation

/// Dónde vive cada cosa. Mismo contrato que la CLI (`src/cli/desktop.ts`) y el overlay de Linux (`client.py`).
public struct KiokuPaths {
    public let home: URL
    public init(home: URL) { self.home = home.standardizedFileURL }

    public var internalDir: URL { home.appendingPathComponent(".kioku", isDirectory: true) }
    public func file(_ name: String) -> URL { internalDir.appendingPathComponent(name) }
    public var runtime: URL { file("runtime.json") }
    public var companionKey: URL { file("secret-companion") }
    public var fullKey: URL { file("secret") }
    public var pidFile: URL { file("companion-overlay.pid") }
    /// Preferencias del compañero que comparte con el de Linux (de momento, el aviso de privacidad aceptado).
    public var prefs: URL { file("companion-overlay.json") }

    /// Bóveda: `KIOKU_HOME`, la elegida en la app (`~/Library/Application Support/Kioku/app.json`) o `~/Documents/Kioku`.
    public static func resolveHome(env: [String: String] = ProcessInfo.processInfo.environment,
                                   userHome: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        if let h = env["KIOKU_HOME"], !h.isEmpty { return URL(fileURLWithPath: (h as NSString).expandingTildeInPath) }
        if let data = try? Data(contentsOf: appConfig(userHome: userHome)), let h = JSON.parse(data)?["home"].string, !h.isEmpty {
            return URL(fileURLWithPath: (h as NSString).expandingTildeInPath)
        }
        return userHome.appendingPathComponent("Documents/Kioku", isDirectory: true)
    }

    public static func appSupport(userHome: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        userHome.appendingPathComponent("Library/Application Support/Kioku", isDirectory: true)
    }

    public static func appConfig(userHome: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        appSupport(userHome: userHome).appendingPathComponent("app.json")
    }

    public static func saveHome(_ home: URL, userHome: URL = FileManager.default.homeDirectoryForCurrentUser) throws {
        let url = appConfig(userHome: userHome)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: ["home": home.path], options: [.prettyPrinted])
        try data.write(to: url, options: .atomic)
    }

    /// Una carpeta de Obsidian sin marcar no se adopta como bóveda (igual que `guardHome` de la CLI).
    public var looksLikeObsidianVault: Bool {
        let fm = FileManager.default
        return fm.fileExists(atPath: home.appendingPathComponent(".obsidian").path) && !fm.fileExists(atPath: internalDir.path)
    }

    /// Comprueba por metadatos (`lstat`, sin leer ni disparar descargas) si un archivo está desalojado en iCloud Drive (`SF_DATALESS`).
    public static func isDataless(_ url: URL) -> Bool {
        #if canImport(Darwin)
        var st = stat()
        guard lstat(url.path, &st) == 0 else { return false }
        let sfDataless: UInt32 = 0x40000000
        return (st.st_flags & sfDataless) != 0
        #else
        return false
        #endif
    }

    /// Verdadero si algún archivo clave de la bóveda está marcado como `dataless` por iCloud Drive.
    public var hasCloudEvictedFiles: Bool {
        let candidates = [home, internalDir, file("assistant-model.json"), file("assistant.json"), file("secret"), file("secret-companion")]
        return candidates.contains(where: KiokuPaths.isDataless)
    }

    // ───────── daemon en marcha ─────────

    public struct Runtime: Equatable { public let pid: Int32; public let port: Int }

    /// Puerto del daemon en marcha (se relee siempre). Solo vale si el proceso que lo anotó sigue vivo: si el daemon
    /// murió sin limpiar, otro programa podría escuchar en ese puerto y no se le entrega ninguna credencial.
    public func runtime(alive: (Int32) -> Bool = KiokuPaths.processAlive) -> Runtime? {
        guard let data = try? Data(contentsOf: runtime), let j = JSON.parse(data),
              let port = j["port"].int, port > 0, port < 65536 else { return nil }
        let pid = Int32(j["pid"].int ?? 0)
        if pid > 0 && !alive(pid) { return nil }
        return Runtime(pid: pid, port: port)
    }

    public static func processAlive(_ pid: Int32) -> Bool {
        if pid <= 0 { return false }
        return kill(pid, 0) == 0 || errno == EPERM
    }

    // ───────── credenciales ─────────

    static func readKey(_ url: URL) -> String? {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let k = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return isKey(k) ? k : nil
    }

    public static func isKey(_ k: String) -> Bool {
        k.count == 64 && k.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) }
    }

    /// Credencial limitada del compañero (conversar, ver el estado, confirmar). Nunca la clave completa.
    public func companionKeyValue() -> String? { KiokuPaths.readKey(companionKey) }

    /// La crea si no existe, como `loadOrCreateCompanionKey` (0600). El daemon la relee en cada petición.
    @discardableResult
    public func ensureCompanionKey() throws -> String {
        if let k = companionKeyValue() { return k }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytesShim.fill(&bytes) else { throw KiokuError("No pude generar la credencial del compañero") }
        let key = bytes.map { String(format: "%02x", $0) }.joined()
        try FileManager.default.createDirectory(at: internalDir, withIntermediateDirectories: true)
        let fd = open(companionKey.path, O_WRONLY | O_CREAT | O_TRUNC, 0o600)
        guard fd >= 0 else { throw KiokuError("No pude escribir \(companionKey.path)") }
        let line = Array((key + "\n").utf8)
        let written = line.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
        fchmod(fd, 0o600)
        close(fd)
        guard written == line.count else { throw KiokuError("No pude escribir \(companionKey.path)") }
        return key
    }

    /// Clave completa: solo para abrir la interfaz web de Kioku en su ventana (lo mismo que hace `kioku open`).
    public func fullKeyValue() -> String? { KiokuPaths.readKey(fullKey) }

    /// URL de acceso: la clave viaja en `?k=` (el daemon la cambia por una cookie y redirige).
    public static func loginURL(base: String, key: String?, route: String) -> String {
        guard let key else { return base + route }
        if let hash = route.firstIndex(of: "#") {
            let pathPart = String(route[..<hash]), fragment = String(route[hash...])
            return base + pathPart + "?k=" + key + fragment
        }
        return base + route + "?k=" + key
    }

    // ───────── preferencias compartidas con el overlay de Linux ─────────

    public func privacyAcknowledged() -> Bool {
        guard let data = try? Data(contentsOf: prefs) else { return false }
        return JSON.parse(data)?["ack"].bool ?? false
    }

    public func acknowledgePrivacy() {
        var obj: [String: Any] = [:]
        if let data = try? Data(contentsOf: prefs), let o = JSON.parse(data)?.object { obj = o.mapValues { $0.any } }
        obj["ack"] = true
        try? FileManager.default.createDirectory(at: internalDir, withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: prefs, options: .atomic)
        }
    }

    // ───────── una sola instancia ─────────

    /// Pid del Kio que ya está en marcha para esta bóveda (otro proceso), o nil.
    public func otherInstance(me: Int32 = getpid(), alive: (Int32) -> Bool = KiokuPaths.processAlive) -> Int32? {
        guard let raw = try? String(contentsOf: pidFile, encoding: .utf8), let pid = Int32(raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              pid > 0, pid != me, alive(pid) else { return nil }
        return pid
    }

    public func writePid(_ pid: Int32 = getpid()) {
        try? FileManager.default.createDirectory(at: internalDir, withIntermediateDirectories: true)
        try? "\(pid)\n".write(to: pidFile, atomically: true, encoding: .utf8)
    }

    public func removePidIfMine(_ pid: Int32 = getpid()) {
        guard let raw = try? String(contentsOf: pidFile, encoding: .utf8), raw.trimmingCharacters(in: .whitespacesAndNewlines) == "\(pid)" else { return }
        try? FileManager.default.removeItem(at: pidFile)
    }
}

public struct KiokuError: Error, CustomStringConvertible, Equatable {
    public let message: String
    /// Código HTTP, o nil si ni siquiera hubo conexión.
    public let status: Int?
    public init(_ message: String, status: Int? = nil) { self.message = message; self.status = status }
    public var description: String { message }
}

/// `SecRandomCopyBytes` vive en Security; aquí basta con /dev/urandom (también disponible en las pruebas).
enum SecRandomCopyBytesShim {
    static func fill(_ bytes: inout [UInt8]) -> Bool {
        guard let fh = FileHandle(forReadingAtPath: "/dev/urandom") else { return false }
        defer { try? fh.close() }
        let data = fh.readData(ofLength: bytes.count)
        guard data.count == bytes.count else { return false }
        bytes = [UInt8](data)
        return true
    }
}
