import AppKit
import KiokuKit

// `Kioku --render-iconset DIR`: dibuja el icono de la app (el sello 記) y termina (lo usa la construcción de Kioku.app).
// Un segundo argumento (la ruta de character.json, que pasaba la construcción cuando el icono era Kio) se ignora.
if let i = CommandLine.arguments.firstIndex(of: "--render-iconset"), i + 1 < CommandLine.arguments.count {
    let dir = URL(fileURLWithPath: CommandLine.arguments[i + 1])
    do {
        try IconRenderer.render(into: dir)
        exit(0)
    } catch {
        FileHandle.standardError.write(Data("No pude dibujar el icono: \(error)\n".utf8))
        exit(1)
    }
}

// `Kioku --render-menubar FILE.png`: la plantilla de la barra de menús ampliada (comprobación visual).
if let i = CommandLine.arguments.firstIndex(of: "--render-menubar"), i + 1 < CommandLine.arguments.count {
    do {
        try SealPainter.writeMenuBarPreview(to: URL(fileURLWithPath: CommandLine.arguments[i + 1]))
        exit(0)
    } catch {
        FileHandle.standardError.write(Data("No pude dibujar la plantilla: \(error)\n".utf8))
        exit(1)
    }
}

// Kioku para macOS. Arranca como app de la barra de menús (sin icono en el Dock hasta abrir una ventana).
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
