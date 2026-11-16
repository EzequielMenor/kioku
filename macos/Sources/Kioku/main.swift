import AppKit
import KiokuKit

// `Kioku --render-iconset DIR`: dibuja el icono de la app y termina (lo usa la construcción de Kioku.app).
if let i = CommandLine.arguments.firstIndex(of: "--render-iconset"), i + 1 < CommandLine.arguments.count {
    let dir = URL(fileURLWithPath: CommandLine.arguments[i + 1])
    let specPath = CommandLine.arguments.count > i + 2 ? CommandLine.arguments[i + 2] : "companion/character.json"
    do {
        try IconRenderer.render(spec: try CharacterSpec(contentsOf: URL(fileURLWithPath: specPath)), into: dir)
        exit(0)
    } catch {
        FileHandle.standardError.write(Data("No pude dibujar el icono: \(error)\n".utf8))
        exit(1)
    }
}

// Kioku para macOS. Arranca como app de la barra de menús (sin icono en el Dock hasta abrir una ventana).
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
