// swift-tools-version:5.9
// Kioku para macOS: la app de escritorio con Kio. `KiokuKit` es la lógica sin interfaz (cliente del daemon, estado
// compartido, geometría y el dibujo de Kio en números); `Kioku` es la app AppKit/SwiftUI que la pinta.
import PackageDescription

let package = Package(
    name: "KiokuMac",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "Kioku", targets: ["Kioku"])],
    targets: [
        .target(name: "KiokuKit"),
        .executableTarget(
            name: "Kioku",
            dependencies: ["KiokuKit"],
            linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("WebKit"), .linkedFramework("Carbon")]
        ),
        .testTarget(name: "KiokuKitTests", dependencies: ["KiokuKit"]),
    ]
)
