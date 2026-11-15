import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Lo que el estado necesita del daemon. La app usa `KiokuClient`; las pruebas, un doble.
@MainActor
public protocol KiokuAPI: AnyObject {
    func request(_ method: String, _ path: String, body: [String: Any]?, timeout: TimeInterval,
                 completion: @escaping (Result<JSON, KiokuError>) -> Void)
}

public extension KiokuAPI {
    func get(_ path: String, timeout: TimeInterval = 15, completion: @escaping (Result<JSON, KiokuError>) -> Void) {
        request("GET", path, body: nil, timeout: timeout, completion: completion)
    }
    func post(_ path: String, _ body: [String: Any]? = nil, timeout: TimeInterval = 15, completion: @escaping (Result<JSON, KiokuError>) -> Void) {
        request("POST", path, body: body ?? [:], timeout: timeout, completion: completion)
    }
}

/// Divide un flujo de bytes en líneas (SSE del daemon y progreso NDJSON de Ollama).
public struct LineSplitter {
    private var buffer = Data()
    public init() {}
    public mutating func push(_ chunk: Data) -> [Data] {
        buffer.append(chunk)
        var lines: [Data] = []
        while let nl = buffer.firstIndex(of: 0x0A) {
            var line = buffer[buffer.startIndex..<nl]
            if line.last == 0x0D { line = line.dropLast() }
            lines.append(Data(line))
            buffer.removeSubrange(buffer.startIndex...nl)
        }
        return lines
    }
}

/// Evento del flujo SSE: solo interesan las líneas `data:` con JSON.
public enum SSE {
    public static func event(from line: Data) -> JSON? {
        guard line.starts(with: Array("data:".utf8)) else { return nil }
        return JSON.parse(line.dropFirst(5))
    }
}

/// Petición HTTP en streaming: entrega líneas a medida que llegan y avisa al terminar.
final class LineStream: NSObject, URLSessionDataDelegate {
    private var splitter = LineSplitter()
    private let onResponse: (Int) -> Bool
    private let onLine: (Data) -> Void
    private let onEnd: (Error?) -> Void
    private(set) var task: URLSessionDataTask?
    private var session: URLSession?

    init(request: URLRequest, idleTimeout: TimeInterval, onResponse: @escaping (Int) -> Bool,
         onLine: @escaping (Data) -> Void, onEnd: @escaping (Error?) -> Void) {
        self.onResponse = onResponse
        self.onLine = onLine
        self.onEnd = onEnd
        super.init()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = idleTimeout   // sin bytes en este tiempo, se corta (el daemon late cada 25 s)
        config.timeoutIntervalForResource = 7 * 24 * 3600
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.connectionProxyDictionary = [:]           // siempre directo a 127.0.0.1
        let s = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        session = s
        task = s.dataTask(with: request)
        task?.resume()
    }

    func cancel() { task?.cancel(); session?.invalidateAndCancel() }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void) {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        completionHandler(onResponse(status) ? .allow : .cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        for line in splitter.push(data) { onLine(line) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        onEnd(error)
        session.finishTasksAndInvalidate()
    }
}

/// Cliente del daemon local con la credencial limitada del compañero. Solo habla con 127.0.0.1.
@MainActor
public final class KiokuClient: KiokuAPI {
    public let paths: KiokuPaths
    private let session: URLSession
    private var events: LineStream?
    private var stopped = true
    private var delay: TimeInterval = 0.5
    private var generation = 0

    public init(paths: KiokuPaths) {
        self.paths = paths
        let config = URLSessionConfiguration.ephemeral
        config.connectionProxyDictionary = [:]
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: config)
    }

    public var baseURL: String? { paths.runtime().map { "http://127.0.0.1:\($0.port)" } }

    private func prepare(_ method: String, _ path: String, timeout: TimeInterval) -> Result<URLRequest, KiokuError> {
        guard let rt = paths.runtime() else { return .failure(KiokuError("Kioku no está en marcha")) }
        guard let key = paths.companionKeyValue() else { return .failure(KiokuError("Falta la credencial del compañero")) }
        guard let url = URL(string: "http://127.0.0.1:\(rt.port)\(path)") else { return .failure(KiokuError("Ruta no válida")) }
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = method
        req.setValue(key, forHTTPHeaderField: "x-kioku-key")
        return .success(req)
    }

    public func request(_ method: String, _ path: String, body: [String: Any]?, timeout: TimeInterval,
                        completion: @escaping (Result<JSON, KiokuError>) -> Void) {
        var req: URLRequest
        switch prepare(method, path, timeout: timeout) {
        case .failure(let e): completion(.failure(e)); return
        case .success(let r): req = r
        }
        if method != "GET" {
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: body ?? [:])
        }
        session.dataTask(with: req) { data, response, error in
            let result: Result<JSON, KiokuError>
            if let error {
                result = .failure(KiokuError("Sin conexión con Kioku (\((error as NSError).localizedDescription))"))
            } else {
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let json = data.flatMap { JSON.parse($0) } ?? .object([:])
                if status == 401 {
                    result = .failure(KiokuError("Kioku no reconoce la credencial del compañero: reinicia el daemon o vuelve a abrir Kioku", status: 401))
                } else if status >= 400 {
                    result = .failure(KiokuError(json["error"].string ?? "Kioku respondió \(status)", status: status))
                } else {
                    result = .success(json)
                }
            }
            Task { @MainActor in completion(result) }
        }.resume()
    }

    /// Flujo de eventos con reconexión (0,5 → 8 s). `onStatus(true|false)` avisa de si hay daemon.
    public func startEvents(onEvent: @escaping (JSON) -> Void, onStatus: @escaping (Bool) -> Void) {
        stopped = false
        connect(onEvent: onEvent, onStatus: onStatus)
    }

    public func stopEvents() {
        stopped = true
        generation += 1
        events?.cancel()
        events = nil
    }

    private func connect(onEvent: @escaping (JSON) -> Void, onStatus: @escaping (Bool) -> Void) {
        guard !stopped else { return }
        generation += 1
        let gen = generation
        let retry: () -> Void = { [weak self] in
            guard let self, !self.stopped, gen == self.generation else { return }
            onStatus(false)
            let wait = self.delay
            self.delay = min(self.delay * 2, 8)
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
                Task { @MainActor in
                    guard let self, gen == self.generation else { return }
                    self.connect(onEvent: onEvent, onStatus: onStatus)
                }
            }
        }
        guard case .success(var req) = prepare("GET", "/api/events", timeout: 40) else { retry(); return }
        req.setValue("text/event-stream", forHTTPHeaderField: "accept")
        events = LineStream(request: req, idleTimeout: 40, onResponse: { status in
            let ok = status == 200
            Task { @MainActor [weak self] in
                guard let self, gen == self.generation else { return }
                if ok { self.delay = 0.5; onStatus(true) }
            }
            return ok
        }, onLine: { line in
            guard let e = SSE.event(from: line) else { return }
            Task { @MainActor [weak self] in
                guard let self, gen == self.generation else { return }
                onEvent(e)
            }
        }, onEnd: { _ in
            Task { @MainActor in retry() }
        })
    }
}
