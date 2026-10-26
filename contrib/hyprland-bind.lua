-- Añade esto TÚ a ~/.config/hypr/bindings.lua (JARVIS no modifica tu configuración).
-- Hyprland ≥0.55 usa Lua. SUPER+N y SUPER+ALT+N estaban libres en Omarchy al escribir esto:
-- comprueba con `omarchy menu keybindings --print` y, si chocan, haz hl.unbind(...) antes.
o.bind("SUPER + N", "JARVIS Quick", "/ruta/a/Jarvis/bin/jarvis quick")
o.bind("SUPER + ALT + N", "JARVIS Workspace", "/ruta/a/Jarvis/bin/jarvis open")
