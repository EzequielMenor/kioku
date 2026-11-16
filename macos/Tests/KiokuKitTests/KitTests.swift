import XCTest
@testable import KiokuKit

/// `companion/character.json` del repositorio: la misma fuente que la web y el overlay de Linux.
let repoRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
let characterURL = repoRoot.appendingPathComponent("companion/character.json")

final class GeometryTests: XCTestCase {
    func testMarginsKeepTheWholeCharacterOnScreen() {
        let b = Geometry.box(Geometry.char)
        XCTAssertEqual(b, 82)
        let m = Geometry.clampMargins(x: 5000, y: -40, w: 1440, h: 875)
        XCTAssertEqual(m.x, 1440 - b)
        XCTAssertEqual(m.y, 0)
    }

    func testOriginAndMarginsAreInverse() {
        let o = Geometry.boxOrigin(mx: 24, my: 30, w: 1440, h: 875)
        let m = Geometry.marginsFromOrigin(ox: o.x, oy: o.y, w: 1440, h: 875)
        XCTAssertEqual(m.x, 24)
        XCTAssertEqual(m.y, 30)
    }

    func testDragFollowsThePointerButNeverLeavesTheScreen() {
        let o = Geometry.dragOrigin(startX: 100, startY: 100, dx: -500, dy: 2000, w: 1440, h: 875)
        XCTAssertEqual(o.x, 0)
        XCTAssertEqual(o.y, 875 - Geometry.box(Geometry.char))
        XCTAssertFalse(Geometry.isDrag(dx: 3, dy: 4))
        XCTAssertTrue(Geometry.isDrag(dx: 6, dy: 4))
    }

    func testOnlyTheBodyTakesClicks() {
        let r = Geometry.bodyRects(size: 64)
        let center = Geometry.box(64) / 2
        XCTAssertTrue(Geometry.hit(r, center, center))
        XCTAssertFalse(Geometry.hit(r, 1, 1), "las esquinas y el aire dejan pasar el clic")
        XCTAssertFalse(Geometry.hit(r, Geometry.box(64) - 1, center))
    }

    func testPanelOpensNextToTheCharacterAndInsideTheScreen() {
        let (pw, ph) = Geometry.panelSize(w: 1440, h: 875)
        XCTAssertEqual(pw, 380)
        XCTAssertEqual(ph, 540)
        let o = Geometry.boxOrigin(mx: 24, my: 24, w: 1440, h: 875)
        let p = Geometry.panelOrigin(charX: o.x, charY: o.y, charSide: Geometry.box(64), w: 1440, h: 875, pw: pw, ph: ph)
        XCTAssertLessThan(p.y + ph, o.y, "encima del personaje")
        XCTAssertLessThanOrEqual(p.x + pw, 1440 - Geometry.gap)
        let top = Geometry.panelOrigin(charX: 600, charY: 10, charSide: 82, w: 1440, h: 875, pw: pw, ph: ph)
        XCTAssertGreaterThan(top.y, 10 + 82, "si no cabe encima, debajo")
    }

    func testPanelFitsSmallScreens() {
        let (pw, ph) = Geometry.panelSize(w: 360, h: 400)
        XCTAssertEqual(pw, 360 - 2 * Geometry.gap)
        XCTAssertGreaterThanOrEqual(ph, 240)
        let p = Geometry.panelOrigin(charX: 200, charY: 200, charSide: 82, w: 360, h: 400, pw: pw, ph: ph)
        XCTAssertGreaterThanOrEqual(p.x, 0)
        XCTAssertLessThanOrEqual(p.y + ph, 400)
    }
}

final class FaceTests: XCTestCase {
    func spec() throws -> CharacterSpec { try CharacterSpec(contentsOf: characterURL) }

    func testEveryStateHasAFrameInBothThemes() throws {
        let s = try spec()
        XCTAssertEqual(Set(s.states.keys), ["idle", "listening", "thinking", "responding", "awaiting_confirmation", "success", "error", "quiet"])
        for theme in ["dark", "light"] {
            let face = Face(spec: s, theme: theme, random: { 0.5 })
            for name in s.states.keys {
                face.set(name, t: 1)
                let f = face.frame(size: 64, t: 1.5)
                XCTAssertEqual(f.eyes.count, 2)
                XCTAssertTrue(f.eyes.allSatisfy { $0.h >= 64 * 0.03 && $0.w > 0 })
                XCTAssertEqual(f.badge, s.states[name]!.badge)
            }
        }
    }

    func testColorsComeFromTheSharedPalette() throws {
        let s = try spec()
        XCTAssertEqual(s.color("accent", theme: "dark"), RGB(hex: "#7f9bd6"))
        XCTAssertEqual(s.color("bad", theme: "light"), RGB(hex: "#b3342b"))
        let face = Face(spec: s, reducedMotion: true)
        face.set("error", t: 0)
        XCTAssertEqual(face.frame(size: 64, t: 0).body, RGB(hex: "#e8786c"), "el cuerpo se tiñe al fallar")
    }

    func testPoseEasesTowardsTheNewState() throws {
        let face = Face(spec: try spec(), random: { 0.5 })
        _ = face.frame(size: 64, t: 1)
        face.set("error", t: 1)
        let mid = face.frame(size: 64, t: 1.05).body
        let bad = RGB(hex: "#e8786c"), accent = RGB(hex: "#7f9bd6")
        XCTAssertNotEqual(mid, bad, "no salta de golpe")
        XCTAssertGreaterThan(mid.r, accent.r)
        var last = mid
        for i in 1...60 { last = face.frame(size: 64, t: 1.05 + Double(i) * 0.05).body }
        XCTAssertEqual(last.r, bad.r, accuracy: 0.01)
    }

    func testQuietIsStillAndIdleBreathesSlowly() throws {
        let face = Face(spec: try spec())
        XCTAssertTrue(face.animated)
        XCTAssertEqual(face.interval, 0.08, accuracy: 0.001)
        face.set("quiet", t: 0)
        XCTAssertFalse(face.animated)
        face.set("thinking", t: 0)
        XCTAssertEqual(face.interval, 0.033, accuracy: 0.001)
        let reduced = Face(spec: try spec(), reducedMotion: true)
        XCTAssertFalse(reduced.animated, "con «reducir movimiento» no hay animación")
    }

    func testBlinkClosesTheEyesBriefly() throws {
        let face = Face(spec: try spec(), random: { 0.5 })  // primer parpadeo a los 3 s
        let open = face.frame(size: 100, t: 2.9).eyes[0].h
        _ = face.frame(size: 100, t: 3.01)                      // empieza el parpadeo
        let closed = face.frame(size: 100, t: 3.01 + 0.07).eyes[0].h  // a mitad: casi cerrados
        XCTAssertLessThan(closed, open * 0.5)
        let reopened = face.frame(size: 100, t: 3.4).eyes[0].h
        XCTAssertEqual(reopened, open, accuracy: 1)
    }

    func testMotionsSettle() {
        XCTAssertEqual(kioMotion("bounce", t: 10, since: 0).dy, 0, accuracy: 1e-6)
        XCTAssertEqual(kioMotion("shake", t: 10, since: 0).dx, 0, accuracy: 1e-6)
        XCTAssertEqual(kioMotion("none", t: 1, since: 0).sx, 1)
    }
}

final class PathsTests: XCTestCase {
    var dir: URL!
    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("kioku-kit-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func testHomeComesFromEnvThenAppConfigThenDocuments() throws {
        XCTAssertEqual(KiokuPaths.resolveHome(env: ["KIOKU_HOME": "/tmp/v"], userHome: dir).path, "/tmp/v")
        XCTAssertEqual(KiokuPaths.resolveHome(env: [:], userHome: dir).path, dir.appendingPathComponent("Documents/Kioku").path)
        try KiokuPaths.saveHome(URL(fileURLWithPath: "/Volumes/Datos/Kioku"), userHome: dir)
        XCTAssertEqual(KiokuPaths.resolveHome(env: [:], userHome: dir).path, "/Volumes/Datos/Kioku")
    }

    func testRuntimeOnlyCountsIfTheDaemonIsAlive() throws {
        let p = KiokuPaths(home: dir)
        XCTAssertNil(p.runtime())
        try FileManager.default.createDirectory(at: p.internalDir, withIntermediateDirectories: true)
        try #"{"pid": 4242, "port": 47800}"#.write(to: p.runtime, atomically: true, encoding: .utf8)
        XCTAssertEqual(p.runtime(alive: { _ in true }), KiokuPaths.Runtime(pid: 4242, port: 47800))
        XCTAssertNil(p.runtime(alive: { _ in false }), "un pid muerto no da puerto aunque alguien escuche")
        try #"{"pid": 1, "port": 99999}"#.write(to: p.runtime, atomically: true, encoding: .utf8)
        XCTAssertNil(p.runtime(alive: { _ in true }))
    }

    func testCompanionKeyIsCreatedOnceAndPrivate() throws {
        let p = KiokuPaths(home: dir)
        XCTAssertNil(p.companionKeyValue())
        let k = try p.ensureCompanionKey()
        XCTAssertTrue(KiokuPaths.isKey(k))
        XCTAssertEqual(try p.ensureCompanionKey(), k, "estable")
        let mode = try FileManager.default.attributesOfItem(atPath: p.companionKey.path)[.posixPermissions] as? Int
        XCTAssertEqual(mode, 0o600)
        XCTAssertNil(p.fullKeyValue(), "la clave completa no se crea desde aquí")
    }

    func testLoginURLKeepsTheRouteAfterTheKey() {
        XCTAssertEqual(KiokuPaths.loginURL(base: "http://127.0.0.1:47800", key: "k", route: "/#/hoy"), "http://127.0.0.1:47800/?k=k#/hoy")
        XCTAssertEqual(KiokuPaths.loginURL(base: "http://127.0.0.1:47800", key: nil, route: "/#/hoy"), "http://127.0.0.1:47800/#/hoy")
    }

    func testPrivacyAckIsSharedWithTheLinuxOverlay() throws {
        let p = KiokuPaths(home: dir)
        try FileManager.default.createDirectory(at: p.internalDir, withIntermediateDirectories: true)
        try #"{"otra": 1}"#.write(to: p.prefs, atomically: true, encoding: .utf8)
        XCTAssertFalse(p.privacyAcknowledged())
        p.acknowledgePrivacy()
        XCTAssertTrue(p.privacyAcknowledged())
        XCTAssertEqual(JSON.parse(try Data(contentsOf: p.prefs))?["otra"].int, 1, "no pisa lo demás")
    }

    func testOnlyOneKioPerVault() {
        let p = KiokuPaths(home: dir)
        XCTAssertNil(p.otherInstance())
        p.writePid(777)
        XCTAssertEqual(p.otherInstance(me: 1, alive: { $0 == 777 }), 777)
        XCTAssertNil(p.otherInstance(me: 1, alive: { _ in false }))
        p.removePidIfMine(1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: p.pidFile.path), "solo borra su propio pid")
        p.removePidIfMine(777)
        XCTAssertFalse(FileManager.default.fileExists(atPath: p.pidFile.path))
    }

    func testObsidianVaultIsNotAdopted() throws {
        let p = KiokuPaths(home: dir)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent(".obsidian"), withIntermediateDirectories: true)
        XCTAssertTrue(p.looksLikeObsidianVault)
        try FileManager.default.createDirectory(at: p.internalDir, withIntermediateDirectories: true)
        XCTAssertFalse(p.looksLikeObsidianVault)
    }
}

final class StreamTests: XCTestCase {
    func testLinesAreSplitAcrossChunks() {
        var s = LineSplitter()
        XCTAssertEqual(s.push(Data("data: {\"kind\":".utf8)), [])
        let lines = s.push(Data("\"x\"}\r\n\n: latido\n".utf8))
        XCTAssertEqual(lines.map { String(decoding: $0, as: UTF8.self) }, ["data: {\"kind\":\"x\"}", "", ": latido"])
        XCTAssertEqual(SSE.event(from: lines[0])?["kind"].string, "x")
        XCTAssertNil(SSE.event(from: lines[2]))
    }

    func testJSONBooleansAndNumbersStayApart() {
        let j = JSON.parse(#"{"a": true, "b": 1, "c": 0, "d": false, "e": null}"#)!
        XCTAssertEqual(j["a"], .bool(true))
        XCTAssertEqual(j["b"], .number(1))
        XCTAssertEqual(j["c"], .number(0))
        XCTAssertFalse(j["d"].bool)
        XCTAssertTrue(j["e"].isNull)
        XCTAssertTrue(j["nada"]["más"].isNull)
    }

    func testOllamaModelMatching() {
        let tags = JSON.parse(#"{"models":[{"name":"qwen3.5:9b","model":"qwen3.5:9b"},{"name":"llama3:latest"}]}"#)!
        let models = Ollama.models(fromTags: tags)
        XCTAssertTrue(Ollama.has("qwen3.5:9b", in: models))
        XCTAssertTrue(Ollama.has("llama3", in: models))
        XCTAssertFalse(Ollama.has("qwen3.5:27b", in: models))
        XCTAssertEqual(Ollama.defaultModel, "qwen3.5:9b")
        let p = Ollama.PullProgress(line: JSON.parse(#"{"status":"pulling","total":200,"completed":50}"#)!)
        XCTAssertEqual(p.fraction, 0.25)
    }
}
