import Carbon

/// Atajo global ⌥⌘K (conversación con Kio). `RegisterEventHotKey` no necesita permisos de accesibilidad.
final class HotKey {
    private static var action: (() -> Void)?
    private var ref: EventHotKeyRef?
    private var handler: EventHandlerRef?

    init?(keyCode: UInt32 = UInt32(kVK_ANSI_K), modifiers: UInt32 = UInt32(cmdKey | optionKey), action: @escaping () -> Void) {
        HotKey.action = action
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let installed = InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            DispatchQueue.main.async { HotKey.action?() }
            return noErr
        }, 1, &spec, nil, &handler)
        let id = EventHotKeyID(signature: OSType(0x4B494F4B), id: 1)  // 'KIOK'
        let registered = RegisterEventHotKey(keyCode, modifiers, id, GetApplicationEventTarget(), 0, &ref)
        if installed != noErr || registered != noErr { return nil }
    }

    deinit {
        if let ref { UnregisterEventHotKey(ref) }
        if let handler { RemoveEventHandler(handler) }
    }
}
