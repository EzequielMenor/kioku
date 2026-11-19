# Kioku para iPhone

Este proyecto SwiftUI es la base de la app nativa. Por ahora solo muestra el estado **Sin conexión**: no usa la red, no lee la bóveda ni pide credenciales.

## Probar en el simulador

1. Abrí `ios/Kioku.xcodeproj` en Xcode 15 o posterior.
2. Seleccioná el esquema **Kioku** y un simulador de iPhone con iOS 17 o posterior.
3. Pulsá **Run** (⌘R).

Para comprobar solo la compilación, desde la raíz del repositorio:

```sh
bash ios/check-app.sh
```

La comprobación crea y verifica `ios/.build/Build/Products/Debug-iphonesimulator/Kioku.app`, sin cuenta de desarrollador ni firma de distribución. No arranca el simulador.

El alcance de la primera versión está en [el plan de iOS y Mac](../odd/tasks/kioku-native-apple.md).
