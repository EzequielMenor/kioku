import XCTest
@testable import KiokuKit

final class SealTests: XCTestCase {
    func testSealMatchesTheWebPath() throws {
        let ts = try String(contentsOf: repoRoot.appendingPathComponent("web/src/seal.ts"), encoding: .utf8)
        XCTAssertTrue(ts.contains("\"\(Seal.pathData)\""), "Seal.pathData debe ser idéntico a SEAL_PATH de web/src/seal.ts")
    }

    func testParserBuildsTheGlyphInsideTheSealBox() throws {
        let box = Seal.glyph.boundingBoxOfPath
        XCTAssertFalse(Seal.glyph.isEmpty)
        // el path acaba con un «M» suelto fuera del carácter; el cuerpo del 記 queda dentro del sello
        XCTAssertTrue(Seal.box.insetBy(dx: -1, dy: -9).contains(box), "\(box)")
        XCTAssertTrue(Seal.glyph.contains(CGPoint(x: 35, y: 29.4)), "trazo de la «言»")
    }

    func testParserRejectsUnsupportedCommands() {
        XCTAssertNil(Seal.parse("M0 0 Q1 1 2 2"))
        XCTAssertNotNil(Seal.parse("M0 0L10 0L10 10Z"))
    }
}
