import AppKit
import KiokuKit

/// El sello 記 como icono: la misma marca que la web (`Seal` en web/src/app.tsx y el favicon). El cuadrado redondeado
/// índigo lleva el carácter en el color del fondo; en la barra de menús es una plantilla monocroma con el carácter hueco.
enum SealPainter {
    static let indigo = CGColor(srgbRed: 0x7f / 255, green: 0x9b / 255, blue: 0xd6 / 255, alpha: 1) // --accent (tema oscuro)
    static let ink = CGColor(srgbRed: 0x0f / 255, green: 0x0e / 255, blue: 0x0c / 255, alpha: 1)    // --bg (tema oscuro)

    /// Coloca el carácter dentro de `rect` (la caja del sello, 12..88 del lienzo de 100). El contexto debe tener y hacia abajo.
    /// `zoom` agranda el carácter respecto a su caja (en tamaños pequeños los trazos finos pierden nitidez).
    static func addGlyph(to ctx: CGContext, in rect: CGRect, zoom: CGFloat = 1) {
        let k = rect.width / Seal.box.width
        var t = CGAffineTransform(translationX: rect.midX, y: rect.midY)
            .scaledBy(x: k * zoom, y: k * zoom)
            .translatedBy(x: -Seal.box.midX, y: -Seal.box.midY)
        if let p = Seal.glyph.copy(using: &t) { ctx.addPath(p) }
    }

    /// Un icono de app de `px` píxeles: rejilla de macOS (cuadrado de 824/1024 con esquinas de 185/1024), índigo con el 記 en tinta.
    static func drawAppIcon(in ctx: CGContext, px: Int) {
        let S = CGFloat(px)
        let inset = S * 100 / 1024, side = S * 824 / 1024
        let tile = CGRect(x: inset, y: inset, width: side, height: side)
        ctx.addPath(CGPath(roundedRect: tile, cornerWidth: S * 185 / 1024, cornerHeight: S * 185 / 1024, transform: nil))
        ctx.setFillColor(indigo)
        ctx.fillPath()
        addGlyph(to: ctx, in: tile, zoom: 0.96)
        ctx.setFillColor(ink)
        ctx.fillPath()
    }

    /// Icono de la barra de menús (18 pt): plantilla (macOS la tiñe); el sello relleno con el carácter hueco.
    static func menuBarIcon(side: CGFloat = 18) -> NSImage {
        let img = NSImage(size: NSSize(width: side, height: side), flipped: true) { rect in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }
            drawMenuBar(in: ctx, rect: rect)
            return true
        }
        img.isTemplate = true
        return img
    }

    static func drawMenuBar(in ctx: CGContext, rect: CGRect) {
        let r = rect.insetBy(dx: rect.width * 0.06, dy: rect.height * 0.06)
        ctx.setFillColor(.black)
        ctx.addPath(CGPath(roundedRect: r, cornerWidth: r.width * 0.2, cornerHeight: r.width * 0.2, transform: nil))
        ctx.fillPath()
        ctx.setBlendMode(.clear)
        addGlyph(to: ctx, in: r, zoom: 1.12)
        ctx.fillPath()
        ctx.setBlendMode(.normal)
    }

    /// PNG de la plantilla de la barra de menús a `scale` veces su tamaño, negro sobre blanco (comprobación visual: `--render-menubar`).
    static func writeMenuBarPreview(to url: URL, scale: Int = 8) throws {
        let side = 18 * scale
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4,
                                         hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let gc = NSGraphicsContext(bitmapImageRep: rep) else { throw KiokuError("No pude crear el lienzo") }
        let ctx = gc.cgContext
        ctx.setFillColor(.white)
        ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))
        ctx.translateBy(x: 0, y: CGFloat(side))
        ctx.scaleBy(x: 1, y: -1)
        ctx.beginTransparencyLayer(auxiliaryInfo: nil)
        ctx.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
        drawMenuBar(in: ctx, rect: CGRect(x: 0, y: 0, width: 18, height: 18))
        ctx.endTransparencyLayer()
        gc.flushGraphics()
        guard let png = rep.representation(using: .png, properties: [:]) else { throw KiokuError("No pude codificar el PNG") }
        try png.write(to: url)
    }
}

/// Icono de la app. Lo genera el propio ejecutable (`Kioku --render-iconset DIR`) al construir la app; `iconutil` lo convierte en .icns.
enum IconRenderer {
    static let sizes: [(String, Int)] = [
        ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64), ("icon_128x128", 128),
        ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512), ("icon_512x512", 512), ("icon_512x512@2x", 1024),
    ]

    static func render(into dir: URL) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for (name, px) in sizes {
            guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
                  let gc = NSGraphicsContext(bitmapImageRep: rep) else { throw KiokuError("No pude crear el lienzo del icono") }
            let ctx = gc.cgContext
            ctx.translateBy(x: 0, y: CGFloat(px))
            ctx.scaleBy(x: 1, y: -1)
            SealPainter.drawAppIcon(in: ctx, px: px)
            gc.flushGraphics()
            guard let png = rep.representation(using: .png, properties: [:]) else { throw KiokuError("No pude codificar el icono") }
            try png.write(to: dir.appendingPathComponent("\(name).png"))
        }
    }
}
