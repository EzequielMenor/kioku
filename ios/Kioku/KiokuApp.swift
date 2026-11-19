import SwiftUI

@main
struct KiokuApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                ContentUnavailableView(
                    "Sin conexión",
                    systemImage: "externaldrive.badge.xmark",
                    description: Text("Esta versión de Kioku todavía no se conecta a un servidor.")
                )
                .navigationTitle("Kioku")
            }
        }
    }
}
