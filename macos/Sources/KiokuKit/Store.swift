import Foundation

/// Textos y estados del personaje: mismos que `companion/overlay/store.py` y la web.
public enum KioText {
    public static let name = "Kio"
    public static let state: [String: String] = [
        "idle": "Listo", "listening": "Te escucho", "thinking": "Pensando…", "responding": "Respondiendo…",
        "awaiting_confirmation": "Espera tu decisión", "success": "Hecho", "error": "Algo falló", "quiet": "En concentración",
    ]
    public static let peekStates: Set<String> = ["awaiting_confirmation", "error", "thinking", "responding"]
}

public struct Agent: Equatable {
    public var state = "idle"
    public var label: String? = nil
    public var busy = false
    public var awaiting: [String] = []
    public init() {}
    public init(_ j: JSON) {
        state = j["state"].string ?? "idle"
        label = j["label"].string
        busy = j["busy"].bool
        awaiting = j["awaiting"].array.compactMap { $0.string }
    }
}

public struct CompanionView: Equatable {
    public var mode = "active"
    public var conversation = ""
    public var overlay: (x: Int, y: Int)? = nil
    public var quiet = false
    public var focusSession = false
    public var webForeground = false
    public init() {}
    public init(_ j: JSON) {
        mode = j["mode"].string ?? "active"
        conversation = j["conversation"].string ?? ""
        if let x = j["overlay"]["x"].int, let y = j["overlay"]["y"].int { overlay = (x, y) }
        quiet = j["quiet"].bool
        focusSession = j["focusSession"].bool
        webForeground = j["webForeground"].bool
    }
    public static func == (a: CompanionView, b: CompanionView) -> Bool {
        a.mode == b.mode && a.conversation == b.conversation && a.overlay?.x == b.overlay?.x && a.overlay?.y == b.overlay?.y
            && a.quiet == b.quiet && a.focusSession == b.focusSession && a.webForeground == b.webForeground
    }
}

public struct EngineInfo: Equatable {
    public var provider: String?
    public var model: String?
    public var local: Bool
    public init?(_ j: JSON) {
        guard j.object != nil else { return nil }
        provider = j["provider"].string
        model = j["model"].string
        local = j["local"].bool
    }
}

public struct ActionRecord: Equatable, Identifiable {
    public let id: String
    public let summary: String
    public let undone: Bool
}

public struct ProposalOp: Equatable {
    public let raw: JSON
    public var text: String { Proposals.opText(raw) }
}

public struct Proposal: Equatable, Identifiable {
    public let id: String
    public let title: String
    public let rationale: String
    public let status: String
    public let ops: [ProposalOp]
    public var pending: Bool { status == "pending" }
    public var risky: Bool { ops.contains { Proposals.riskyOps.contains($0.raw["op"].string ?? "") } }
}

public struct Message: Equatable, Identifiable {
    public let id: String
    public let role: String
    public let text: String
    public let error: Bool
    public let reads: [String]
    public let actions: [ActionRecord]
    public let proposals: [Proposal]

    public init(_ j: JSON) {
        id = j["id"].string ?? UUID().uuidString
        role = j["role"].string == "assistant" ? "assistant" : "user"
        text = j["text"].string ?? ""
        error = j["error"].bool
        reads = j["reads"].array.compactMap { $0.string }
        actions = j["actions"].array.compactMap { a in
            a["id"].string.map { ActionRecord(id: $0, summary: a["summary"].string ?? "", undone: a["undone"].bool) }
        }
        proposals = j["proposals"].array.compactMap { p in
            p["id"].string.map { Proposal(id: $0, title: p["title"].string ?? "", rationale: p["rationale"].string ?? "",
                                          status: p["status"].string ?? "", ops: p["ops"].array.map { ProposalOp(raw: $0) }) }
        }
    }

    /// «Leyó 2 notas: A, B»
    public var readsText: String? {
        guard !reads.isEmpty else { return nil }
        let names = reads.prefix(3).map { (($0 as NSString).lastPathComponent as NSString).deletingPathExtension }.joined(separator: ", ")
        return "Leyó \(reads.count) \(reads.count == 1 ? "nota" : "notas"): \(names)\(reads.count > 3 ? "…" : "")"
    }
}

public enum Proposals {
    /// Borrar, mover o reemplazar contenido pide una segunda confirmación antes de aplicar.
    public static let riskyOps: Set<String> = ["trash", "move", "update"]

    public static func opText(_ op: JSON) -> String {
        let path = op["path"].string ?? ""
        switch op["op"].string ?? "" {
        case "create": return "Crear \(path)"
        case "update": return "Reemplazar el contenido de \(path)"
        case "move": return "Mover \(op["from"].string ?? "") → \(op["to"].string ?? "")"
        case "trash": return "Mover a la papelera \(path)"
        case "setProp":
            let props = (op["props"].object ?? [:]).sorted { $0.key < $1.key }
                .map { "\($0.key) → \($0.value.isNull ? "(quitar)" : $0.value.compact)" }.joined(separator: ", ")
            return "Cambiar propiedades de \(path): \(props)"
        case let other: return other
        }
    }

    public static func statusText(_ status: String) -> String {
        ["pending": "Necesita tu confirmación", "applied": "Aplicada", "rejected": "Descartada"][status] ?? "No se pudo aplicar"
    }
}

/// Estado que pinta el personaje: el del agente, salvo en concentración o sin daemon, donde descansa.
public func faceState(agent: Agent, quiet: Bool, connected: Bool = true) -> String {
    if !connected { return "quiet" }
    if quiet && ["idle", "success", "listening"].contains(agent.state) { return "quiet" }
    return agent.state
}

/// Espejo de lo que tiene el daemon, sin nada propio: mismo contrato que `web/src/companion-store.ts` y
/// `companion/overlay/store.py` (carga por HTTP y cambios por el flujo de eventos `assistant.*`).
@MainActor
public final class CompanionStore {
    public private(set) var ready = false
    public private(set) var connected = false
    public private(set) var agent = Agent()
    public private(set) var companion = CompanionView()
    public private(set) var engine: EngineInfo? = nil
    /// Disponibilidad del asistente: ok y motivo.
    public private(set) var status: (ok: Bool, reason: String?)? = nil
    public private(set) var conversation = ""
    public private(set) var messages: [Message] = []
    public private(set) var streaming = ""
    public private(set) var sending = false
    public private(set) var problem: String? = nil

    private let api: KiokuAPI
    public var onChange: () -> Void = {}
    /// Otras órdenes del daemon que interesan a la app (p. ej. `navigate`, para abrir la ventana de Kioku).
    public var onOtherEvent: (JSON) -> Void = { _ in }

    public init(api: KiokuAPI) { self.api = api }

    private func changed() { onChange() }

    public var faceState: String { KiokuKit.faceState(agent: agent, quiet: companion.quiet, connected: connected) }
    public var busy: Bool { agent.busy || sending }

    // ───────── carga ─────────

    private func loadConversation(_ done: @escaping (Bool) -> Void = { _ in }) {
        api.get("/api/assistant/conversation") { [weak self] r in
            guard let self else { return }
            if case .success(let c) = r {
                self.conversation = c["id"].string ?? ""
                self.messages = c["messages"].array.map(Message.init)
                self.streaming = ""
                self.changed()
                done(true)
            } else { done(false) }
        }
    }

    /// Estado completo desde el daemon (sin daemon o sin permiso, el personaje descansa).
    public func load(_ done: @escaping (Bool) -> Void = { _ in }) {
        api.get("/api/assistant/state") { [weak self] r in
            guard let self else { return }
            switch r {
            case .failure(let e):
                self.problem = e.message
                self.changed()
                done(false)
            case .success(let s):
                self.loadConversation { ok in
                    guard ok else { done(false); return }
                    self.api.get("/api/assistant/status") { st in
                        if case .success(let j) = st { self.status = (j["ok"].bool, j["reason"].string) } else { self.status = nil }
                        self.ready = true
                        self.agent = s["agent"].isNull ? Agent() : Agent(s["agent"])
                        self.companion = s["companion"].isNull ? CompanionView() : CompanionView(s["companion"])
                        self.engine = EngineInfo(s["engine"])
                        self.problem = nil
                        self.changed()
                        done(true)
                    }
                }
            }
        }
    }

    // ───────── flujo de eventos ─────────

    /// Conexión o corte del flujo. Al (re)conectar se recarga todo: pudo cambiar mientras no se oía.
    public func onStatus(_ isConnected: Bool) {
        let was = connected
        if isConnected {
            connected = true
            changed()
            load()
        } else if was || !ready {
            // Sin daemon no hay consulta en curso que valga: nada de «Pensando…» colgado.
            connected = false
            streaming = ""
            sending = false
            agent.busy = false
            agent.state = "idle"
            agent.label = nil
            changed()
        }
    }

    public func onEvent(_ e: JSON) {
        switch e["kind"].string ?? "" {
        case "assistant.state":
            guard !e["agent"].isNull else { return }
            agent = Agent(e["agent"])
            if !agent.busy { streaming = "" }
            changed()
        case "assistant.companion":
            guard !e["companion"].isNull else { return }
            companion = CompanionView(e["companion"])
            changed()
            if companion.conversation != conversation { loadConversation() }
        case "assistant.delta":
            guard e["conversation"].string == conversation else { return }
            streaming = e["reset"].bool ? "" : streaming + (e["text"].string ?? "")
            changed()
        case "assistant.message":
            guard e["conversation"].string == conversation, !e["message"].isNull else { return }
            let m = Message(e["message"])
            if messages.contains(where: { $0.id == m.id }) { return }
            messages.append(m)
            if m.role == "assistant" { streaming = "" } else { sending = false }
            changed()
        case "proposals", "note", "delete":
            // Una propuesta se resolvió o una acción se deshizo: los botones de los mensajes deben reflejarlo.
            if messages.contains(where: { !$0.proposals.isEmpty || !$0.actions.isEmpty }) { loadConversation() }
        default:
            onOtherEvent(e)
        }
    }

    // ───────── acciones ─────────

    private func attempt(_ method: String, _ path: String, _ body: [String: Any]? = nil, timeout: TimeInterval = 15,
                         then: @escaping (JSON) -> Void = { _ in }) {
        api.request(method, path, body: method == "GET" ? nil : (body ?? [:]), timeout: timeout) { [weak self] r in
            switch r {
            case .success(let j): then(j)
            case .failure(let e): self?.problem = e.message; self?.changed()
            }
        }
    }

    public func send(_ text: String) {
        let m = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !m.isEmpty, !sending else { return }
        sending = true
        problem = nil
        changed()
        // Una consulta puede tardar minutos (modelo local): el progreso llega por eventos, no por esta respuesta.
        api.post("/api/assistant/ask", ["message": m, "surface": "desktop"], timeout: 900) { [weak self] r in
            guard let self else { return }
            if case .failure(let e) = r {
                // Los fallos de una consulta ya abierta llegan como mensaje de la conversación; aquí solo los previos.
                if !self.messages.contains(where: { $0.error && $0.text == e.message }) { self.problem = e.message }
            }
            self.sending = false
            self.changed()
        }
    }

    public func cancel() { attempt("POST", "/api/assistant/cancel") }
    public func newConversation() { attempt("POST", "/api/assistant/conversation/new") { [weak self] _ in self?.loadConversation() } }

    public func setMode(_ mode: String) {
        attempt("POST", "/api/assistant/companion", ["mode": mode]) { [weak self] v in
            guard let self, v.object != nil else { return }
            self.companion = CompanionView(v)
            self.changed()
        }
    }

    public func setOverlay(x: Int, y: Int) {
        attempt("POST", "/api/assistant/companion", ["overlay": ["x": x, "y": y]]) { [weak self] v in
            guard let self, v.object != nil else { return }
            self.companion = CompanionView(v)
            self.changed()
        }
    }

    public func listening(_ active: Bool) {
        api.post("/api/assistant/listening", ["active": active], timeout: 5) { _ in }
    }

    public func undo(_ actionId: String) { attempt("POST", "/api/assistant/undo", ["id": actionId]) { [weak self] _ in self?.loadConversation() } }

    /// Aplica o descarta una propuesta (`what`: apply | reject).
    public func decide(_ proposalId: String, _ what: String) {
        guard what == "apply" || what == "reject" else { return }
        attempt("POST", "/api/proposals/\(proposalId)/\(what)") { [weak self] r in
            guard let self else { return }
            if r["status"].string == "failed" { self.problem = r["error"].string ?? "No se pudo aplicar la propuesta."; self.changed() }
            self.loadConversation()
        }
    }

    public func openKioku(route: String = "/asistente") { attempt("POST", "/api/desktop/open", ["route": route]) }
    public func dismissProblem() { problem = nil; changed() }
    public func report(_ text: String?) { problem = text; changed() }
}
