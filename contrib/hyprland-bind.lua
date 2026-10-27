-- Cambia /ruta/a/Kioku por la carpeta donde clonaste el repositorio.
-- Añade esto TÚ a ~/.config/hypr/bindings.lua (Kioku no modifica tu configuración).
-- Hyprland ≥0.55 usa Lua. SUPER+N y SUPER+ALT+N estaban libres en Omarchy al escribir esto:
-- comprueba con `omarchy menu keybindings --print` y, si chocan, haz hl.unbind(...) antes.
o.bind("SUPER + N", "Kioku Quick", "/ruta/a/Kioku/bin/kioku quick")
o.bind("SUPER + ALT + N", "Kioku Workspace", "/ruta/a/Kioku/bin/kioku open")
