import AppKit
import KiokuKit

/// Icono de la app: Kio en reposo sobre un cuadrado redondeado (rejilla de iconos de macOS). Lo genera el propio
/// ejecutable (`Kioku --render-iconset DIR`) al construir la app; `iconutil` lo convierte en .icns.
enum IconRenderer {
    static let sizes: [(String, Int)] = [
        ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64), ("icon_128x128", 128),
        ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512), ("icon_512x512", 512), ("icon_512x512@2x", 1024),
    ]

    static func render(spec: CharacterSpec, into dir: URL) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for (name, px) in sizes {
            guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
                  let gc = NSGraphicsContext(bitmapImageRep: rep) else { throw KiokuError("No pude crear el lienzo del icono") }
            let ctx = gc.cgContext
            let S = Double(px)
            ctx.translateBy(x: 0, y: S)
            ctx.scaleBy(x: 1, y: -1)
            // Cuadrado del icono: 824/1024 del lienzo, esquinas de 185/1024 (rejilla de macOS).
            let inset = S * 100 / 1024, side = S * 824 / 1024
            ctx.addPath(CGPath(roundedRect: CGRect(x: inset, y: inset, width: side, height: side), cornerWidth: S * 185 / 1024, cornerHeight: S * 185 / 1024, transform: nil))
            ctx.setFillColor(CGColor(srgbRed: 0x18 / 255, green: 0x17 / 255, blue: 0x14 / 255, alpha: 1))
            ctx.fillPath()
            let face = Face(spec: spec, theme: "dark", reducedMotion: true)
            let kio = side * 0.72
            ctx.translateBy(x: (S - kio) / 2, y: (S - kio) / 2 + S * 0.01)
            KioPainter.draw(face.frame(size: kio, t: 1), in: ctx)
            gc.flushGraphics()
            guard let png = rep.representation(using: .png, properties: [:]) else { throw KiokuError("No pude codificar el icono") }
            try png.write(to: dir.appendingPathComponent("\(name).png"))
        }
    }
}
