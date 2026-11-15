import XCTest
@testable import KiokuKit

/// Daemon simulado: responde síncronamente como lo haría el de verdad (mismo doble que `test_overlay.py`).
@MainActor
final class FakeAPI: KiokuAPI {
    var calls: [(String, String, [String: Any]?)] = []
    var fail: String? = nil
    var state: [String: Any] = [
        "agent": ["state": "idle", "label": NSNull(), "busy": false, "awaiting": [String]()],
        "companion": ["mode": "active", "conversation": "c1", "overlay": NSNull(), "quiet": false, "focusSession": false, "webForeground": false],
        "engine": ["provider": "ollama", "model": "qwen3.5:9b", "local": true],
    ]
    var conversation: [String: Any] = ["id": "c1", "messages": [[String: Any]]()]
    var holdConversation = false
    var held: [() -> Void] = []

    func request(_ method: String, _ path: String, body: [String: Any]?, timeout: TimeInterval,
                 completion: @escaping (Result<JSON, KiokuError>) -> Void) {
        calls.append((method, path, body))
        if let fail { completion(.failure(KiokuError(fail))); return }
        switch (method, path) {
        case ("GET", "/api/assistant/state"): completion(.success(JSON(any: state)))
        case ("GET", "/api/assistant/conversation"):
            let snapshot = JSON(any: conversation)
            if holdConversation { held.append { completion(.success(snapshot)) } } else { completion(.success(snapshot)) }
        case ("GET", "/api/assistant/status"): completion(.success(JSON(any: ["ok": true])))
        case ("POST", "/api/assistant/companion"):
            var c = state["companion"] as! [String: Any]
            for (k, v) in body ?? [:] { c[k] = v }
            state["companion"] = c
            completion(.success(JSON(any: c)))
        case ("POST", "/api/assistant/conversation/new"):
            conversation = ["id": "c2", "messages": [[String: Any]]()]
            completion(.success(JSON(any: ["id": "c2"])))
        case ("POST", let p) where p.hasPrefix("/api/proposals/"): completion(.success(JSON(any: ["status": "applied"])))
        case ("POST", _): completion(.success(.object([:])))
        default: completion(.failure(KiokuError("404", status: 404)))
        }
    }

    func posted(_ path: String) -> [[String: Any]?] { calls.filter { $0.0 == "POST" && $0.1 == path }.map { $0.2 } }
}

@MainActor
final class StoreTests: XCTestCase {
    func make() -> (CompanionStore, FakeAPI, () -> Int) {
        let api = FakeAPI()
        let s = CompanionStore(api: api)
        var n = 0
        s.onChange = { n += 1 }
        return (s, api, { n })
    }

    func ev(_ o: [String: Any]) -> JSON { JSON(any: o) }

    func testLoadsOnConnectAndMirrorsTheDaemon() {
        let (s, _, notes) = make()
        XCTAssertFalse(s.ready)
        s.onStatus(true)
        XCTAssertTrue(s.ready && s.connected)
        XCTAssertEqual(s.conversation, "c1")
        XCTAssertEqual(s.engine?.model, "qwen3.5:9b")
        XCTAssertEqual(s.engine?.local, true)
        XCTAssertGreaterThan(notes(), 0)
    }

    func testEventsDriveStateStreamAndMessages() {
        let (s, _, _) = make()
        s.onStatus(true)
        s.onEvent(ev(["kind": "assistant.message", "conversation": "c1", "message": ["id": "u1", "role": "user", "text": "hola"]]))
        s.onEvent(ev(["kind": "assistant.state", "agent": ["state": "thinking", "label": "Pensando…", "busy": true]]))
        s.onEvent(ev(["kind": "assistant.delta", "conversation": "c1", "text": "Bue"]))
        s.onEvent(ev(["kind": "assistant.delta", "conversation": "c1", "text": "nas"]))
        s.onEvent(ev(["kind": "assistant.delta", "conversation": "otra", "text": "ruido"]))
        XCTAssertEqual(s.streaming, "Buenas")
        s.onEvent(ev(["kind": "assistant.delta", "conversation": "c1", "reset": true]))
        XCTAssertEqual(s.streaming, "")
        s.onEvent(ev(["kind": "assistant.delta", "conversation": "c1", "text": "Buenas"]))
        let answer: [String: Any] = ["kind": "assistant.message", "conversation": "c1", "message": ["id": "a1", "role": "assistant", "text": "Buenas"]]
        s.onEvent(ev(answer))
        s.onEvent(ev(answer))
        s.onEvent(ev(["kind": "assistant.message", "conversation": "otra", "message": ["id": "x", "role": "assistant", "text": "no"]]))
        XCTAssertEqual(s.messages.map(\.id), ["u1", "a1"])
        XCTAssertEqual(s.streaming, "")
        s.onEvent(ev(["kind": "assistant.state", "agent": ["state": "success", "label": "Hecho", "busy": false]]))
        XCTAssertEqual(s.agent.state, "success")
    }

    func testSwitchingConversationReloadsIt() {
        let (s, api, _) = make()
        s.onStatus(true)
        api.conversation = ["id": "c9", "messages": [["id": "m", "role": "user", "text": "x"]]]
        s.onEvent(ev(["kind": "assistant.companion", "companion": ["mode": "focus", "conversation": "c9", "quiet": true]]))
        XCTAssertEqual(s.conversation, "c9")
        XCTAssertEqual(s.messages.count, 1)
        XCTAssertEqual(s.companion.mode, "focus")
        XCTAssertEqual(s.faceState, "quiet")
    }

    func testResolvedProposalsRefreshTheButtons() {
        let (s, api, _) = make()
        api.conversation = ["id": "c1", "messages": [["id": "a", "role": "assistant", "text": "t", "proposals": [["id": "P", "status": "pending", "ops": [["op": "trash", "path": "Bandeja/x.md"]]]]]]]
        s.onStatus(true)
        XCTAssertTrue(s.messages[0].proposals[0].pending)
        XCTAssertTrue(s.messages[0].proposals[0].risky)
        api.conversation = ["id": "c1", "messages": [["id": "a", "role": "assistant", "text": "t", "proposals": [["id": "P", "status": "applied", "ops": [[String: Any]]()]]]]]
        s.onEvent(ev(["kind": "proposals"]))
        XCTAssertEqual(s.messages[0].proposals[0].status, "applied")
    }

    func testLosingTheDaemonNeverLeavesItThinking() {
        let (s, api, _) = make()
        s.onStatus(true)
        s.onEvent(ev(["kind": "assistant.state", "agent": ["state": "thinking", "label": "Pensando…", "busy": true]]))
        s.onEvent(ev(["kind": "assistant.delta", "conversation": "c1", "text": "a medias"]))
        s.onStatus(false)
        XCTAssertFalse(s.connected)
        XCTAssertEqual(s.agent.state, "idle")
        XCTAssertFalse(s.agent.busy)
        XCTAssertEqual(s.streaming, "")
        XCTAssertEqual(s.faceState, "quiet")
        api.state["agent"] = ["state": "awaiting_confirmation", "label": "Una propuesta espera tu decisión", "busy": false, "awaiting": ["P"]]
        s.onStatus(true)
        XCTAssertEqual(s.agent.state, "awaiting_confirmation")
        XCTAssertEqual(s.agent.awaiting, ["P"])
    }

    func testSendReportsFailuresThatAreNotPartOfTheConversation() {
        let (s, api, _) = make()
        s.onStatus(true)
        s.send("  hola  ")
        let asked = api.posted("/api/assistant/ask")
        XCTAssertEqual(asked.count, 1)
        XCTAssertEqual(asked[0]?["message"] as? String, "hola")
        XCTAssertEqual(asked[0]?["surface"] as? String, "desktop")
        XCTAssertFalse(s.sending)
        api.fail = "El asistente no está disponible"
        s.send("otra")
        XCTAssertEqual(s.problem, "El asistente no está disponible")
        s.dismissProblem()
        XCTAssertNil(s.problem)
        let n = api.calls.count
        s.send("   ")
        XCTAssertEqual(api.calls.count, n, "un mensaje vacío no se envía")
    }

    func testActionsGoToTheAllowedRoutes() {
        let (s, api, _) = make()
        s.onStatus(true)
        s.setMode("focus")
        XCTAssertEqual(s.companion.mode, "focus")
        s.setOverlay(x: 645, y: 404)
        let overlay = api.posted("/api/assistant/companion").last??["overlay"] as? [String: Int]
        XCTAssertEqual(overlay?["x"], 645)
        XCTAssertEqual(overlay?["y"], 404)
        s.newConversation()
        XCTAssertEqual(s.conversation, "c2")
        s.undo("U1")
        s.decide("P1", "apply")
        s.decide("P2", "reject")
        s.decide("P3", "rm -rf")
        s.cancel()
        s.listening(true)
        s.openKioku()
        let paths = Set(api.calls.filter { $0.0 == "POST" }.map { $0.1 })
        for expected in ["/api/assistant/undo", "/api/proposals/P1/apply", "/api/proposals/P2/reject", "/api/assistant/cancel", "/api/assistant/listening", "/api/desktop/open"] {
            XCTAssertTrue(paths.contains(expected), expected)
        }
        XCTAssertFalse(paths.contains { $0.contains("P3") }, "solo apply o reject")
    }

    func testOtherEventsReachTheApp() {
        let (s, _, _) = make()
        var seen: [String] = []
        s.onOtherEvent = { seen.append($0["route"].string ?? "") }
        s.onEvent(ev(["kind": "navigate", "route": "/asistente"]))
        XCTAssertEqual(seen, ["/asistente"])
    }

    func testFaceStateRestsInFocusModeUnlessSomethingNeedsYou() {
        func agent(_ st: String) -> Agent { var a = Agent(); a.state = st; return a }
        for st in ["idle", "success", "listening"] { XCTAssertEqual(faceState(agent: agent(st), quiet: true), "quiet") }
        for st in ["thinking", "responding", "awaiting_confirmation", "error"] {
            XCTAssertEqual(faceState(agent: agent(st), quiet: true), st)
            XCTAssertEqual(faceState(agent: agent(st), quiet: false), st)
            XCTAssertEqual(faceState(agent: agent(st), quiet: false, connected: false), "quiet")
        }
        XCTAssertFalse(KioText.peekStates.contains("idle"))
    }

    func testUndoneIsTheDaemonsTimestamp() {
        let m = Message(JSON(any: ["id": "m", "role": "assistant", "text": "",
                                   "actions": [["id": "a1", "summary": "x", "undone": "2026-11-15T10:00:00Z"], ["id": "a2", "summary": "y"]]]))
        XCTAssertEqual(m.actions.map(\.undone), [true, false])
    }

    func testAStaleReloadNeverDropsAMessageThatArrivedMeanwhile() {
        let (s, api, _) = make()
        let action: [String: Any] = ["id": "a1", "summary": "Crear tarea"]
        let first: [String: Any] = ["id": "m1", "role": "assistant", "text": "hecho", "actions": [action]]
        api.conversation = ["id": "c1", "messages": [first]]
        s.onStatus(true)
        XCTAssertEqual(s.messages.count, 1)
        // A mitad de turno llega «proposals» (recarga), y la respuesta se graba y llega antes que esa recarga.
        api.holdConversation = true
        s.onEvent(ev(["kind": "proposals"]))
        let reply: [String: Any] = ["id": "m2", "role": "assistant", "text": "te dejo una propuesta",
                                    "proposals": [["id": "p1", "title": "Descartar", "status": "pending", "ops": [["op": "trash", "path": "Bandeja/x.md"]]]]]
        api.conversation = ["id": "c1", "messages": [first, reply]]
        s.onEvent(ev(["kind": "assistant.message", "conversation": "c1", "message": reply]))
        XCTAssertEqual(s.messages.count, 2)
        api.holdConversation = false
        let stale = api.held; api.held = []
        stale.forEach { $0() }
        XCTAssertEqual(s.messages.map(\.id), ["m1", "m2"])
        XCTAssertEqual(s.messages.flatMap(\.proposals).filter(\.pending).count, 1)
    }

    func testProposalTexts() {
        XCTAssertEqual(Proposals.opText(JSON(any: ["op": "trash", "path": "Bandeja/x.md"])), "Mover a la papelera Bandeja/x.md")
        XCTAssertEqual(Proposals.opText(JSON(any: ["op": "move", "from": "a.md", "to": "b.md"])), "Mover a.md → b.md")
        XCTAssertEqual(Proposals.opText(JSON(any: ["op": "setProp", "path": "t.md", "props": ["estado": "hecho", "x": NSNull(), "n": 3]])),
                       "Cambiar propiedades de t.md: estado → \"hecho\", n → 3, x → (quitar)")
        XCTAssertEqual(Proposals.statusText("pending"), "Necesita tu confirmación")
        XCTAssertEqual(Proposals.statusText("failed"), "No se pudo aplicar")
        let m = Message(JSON(any: ["id": "a", "role": "assistant", "text": "t", "reads": ["Notas/Uno.md", "Notas/Dos.md", "Tres.md", "Cuatro.md"]]))
        XCTAssertEqual(m.readsText, "Leyó 4 notas: Uno, Dos, Tres…")
    }
}
