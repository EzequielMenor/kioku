import CoreGraphics
import Foundation

/// El sello 記 de Kioku: el mismo trazado que `web/src/seal.ts` (`SEAL_PATH`, Noto Serif CJK, OFL), en una caja de 100 × 100
/// con el sello propiamente dicho en 12..88. Si cambias uno, cambia el otro (lo comprueba `SealTests`).
public enum Seal {
    /// Datos del path SVG del carácter, idénticos a `SEAL_PATH`.
    public static let pathData =
        "M27.79 28.68L28.21 30.23L44.98 30.23C45.73 30.23 46.32 29.97 46.42 29.38C44.5 27.55 41.29 25.04 41.29 25.04L38.44 28.68ZM27.63 42.44L28.06 43.99L44.98 43.99C45.73 43.99 46.27 43.73 46.42 43.14C44.55 41.37 41.5 38.96 41.5 38.96L38.77 42.44ZM27.63 49.4L28.06 50.91L44.98 50.91C45.73 50.91 46.27 50.63 46.42 50.1C44.55 48.33 41.5 45.93 41.5 45.93L38.77 49.4ZM25.06 35.53L25.49 37.04L47.87 37.04C48.62 37.04 49.15 36.77 49.32 36.18C47.33 34.36 44.12 31.84 44.12 31.84L41.29 35.53ZM39.35 57.6L39.35 69.27L33.52 69.27L33.52 57.6ZM27.9 56.09L27.9 75L28.71 75C31.06 75 33.52 73.72 33.52 73.18L33.52 70.77L39.35 70.77L39.35 74.14L40.33 74.14C42.3 74.14 45.08 72.91 45.14 72.48L45.14 58.46C46.11 58.24 46.8 57.81 47.12 57.43L41.5 53.15L38.82 56.09L33.74 56.09L27.9 53.74ZM49.42 46.24L49.42 68.26C49.42 72.7 50.87 73.77 56.6 73.77L62.71 73.77C72.29 73.77 74.91 72.65 74.91 70.02C74.91 68.89 74.43 68.2 72.66 67.5L72.51 59.74L71.91 59.74C70.9 63.33 69.99 66.16 69.4 67.18C68.97 67.78 68.65 67.93 67.89 67.98C67.04 68.09 65.33 68.09 63.29 68.09L57.83 68.09C55.9 68.09 55.53 67.78 55.53 66.8L55.53 47.75L65.49 47.75L65.49 50.42L66.56 50.42C68.6 50.42 71.6 49.14 71.65 48.71L71.65 31.63C72.77 31.41 73.47 30.98 73.85 30.55L67.84 26L65.01 29.11L49 29.11L49.48 30.66L65.49 30.66L65.49 46.24L56.28 46.24L49.42 43.62ZM23.56 8.55"
    /// Caja del cuadrado del sello dentro de la de 100 × 100 (el carácter queda dentro).
    public static let box = CGRect(x: 12, y: 12, width: 76, height: 76)
    /// Radio de las esquinas del sello en la web (`rx="9"` sobre 76).
    public static let cornerRatio: CGFloat = 9 / 76

    /// El carácter como CGPath, en coordenadas SVG (y hacia abajo): dibújalo en un contexto con y invertida.
    public static let glyph: CGPath = parse(pathData) ?? CGMutablePath()

    /// Parser mínimo de path SVG: solo los comandos absolutos que usa el sello (M, L, C, Z). Con cualquier otro devuelve nil.
    public static func parse(_ d: String) -> CGPath? {
        let path = CGMutablePath()
        var tokens: [String] = []
        var cur = ""
        func flush() { if !cur.isEmpty { tokens.append(cur); cur = "" } }
        for ch in d {
            if ch.isLetter { flush(); tokens.append(String(ch)) }
            else if ch == " " || ch == "," { flush() }
            else if ch == "-" { flush(); cur = "-" }
            else { cur.append(ch) }
        }
        flush()
        var i = 0
        var cmd = ""
        var started = false
        func num() -> CGFloat? {
            guard i < tokens.count, let v = Double(tokens[i]) else { return nil }
            i += 1
            return CGFloat(v)
        }
        func pt() -> CGPoint? {
            guard let x = num(), let y = num() else { return nil }
            return CGPoint(x: x, y: y)
        }
        while i < tokens.count {
            if tokens[i].count == 1, let c = tokens[i].first, c.isLetter { cmd = tokens[i]; i += 1; if cmd == "Z" { path.closeSubpath(); started = false; continue } }
            switch cmd {
            case "M": guard let p = pt() else { return nil }; path.move(to: p); started = true; cmd = "L"
            case "L": guard started, let p = pt() else { return nil }; path.addLine(to: p)
            case "C": guard started, let a = pt(), let b = pt(), let c = pt() else { return nil }; path.addCurve(to: c, control1: a, control2: b)
            default: return nil
            }
        }
        return path
    }
}
