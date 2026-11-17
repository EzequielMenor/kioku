# Puesta en marcha: Mac mini como servidor, bóveda limpia y clientes

Esta guía pone en marcha la versión de cierre (`integration/kioku-cierre`) en el Mac mini. El Mac mini empieza con una
bóveda vacía. Omarchy y el iPhone pasan a ser clientes suyos.

**No se borra nada.** Las bóvedas de prueba se renombran y quedan como respaldo. Si algo falla, se vuelve atrás
deshaciendo cada cambio de nombre.

Requisitos: en el Mac mini, Ollama con `qwen3.5:9b` y Tailscale. En Omarchy y el iPhone, Tailscale con la misma
cuenta.

## 0. Antes de empezar: publicar la rama

El instalador de macOS descarga el código de GitHub, así que la rama tiene que estar publicada. Esto lo decides tú.
Hay dos formas:

- fusionarla en `main` y hacer push (después, el instalador no necesita `KIOKU_REF`), o
- hacer push solo de la rama `integration/kioku-cierre` e instalar con `KIOKU_REF=integration/kioku-cierre`.

## 1. Mac mini: localizar la bóveda actual

```bash
kioku service status                                   # muestra el agente activo
plutil -p ~/Library/LaunchAgents/local.kioku.daemon.plist | grep KIOKU_HOME
```

Si no aparece `KIOKU_HOME`, la bóveda es la de por defecto, `~/Documents/Kioku`. En los pasos siguientes, `VIEJA` es
esa carpeta.

## 2. Mac mini: respaldo y bóveda limpia

```bash
kioku service uninstall                                 # para el daemon (no toca datos)
mv "VIEJA" ~/Documents/Kioku-pruebas-2026-11            # la bóveda de pruebas queda como respaldo, intacta
```

`.kioku/` (claves, conversaciones e índice) va dentro de la bóveda y se queda con el respaldo. La bóveda nueva tendrá
claves nuevas, así que el iPhone habrá que volver a emparejarlo (paso 5).

## 3. Mac mini: instalar la versión de cierre

```bash
KIOKU_REF=integration/kioku-cierre ./Instalar\ Kioku.command   # o sin KIOKU_REF si ya está en main
```

La app anterior se aparta como `Kioku.app.anterior-FECHA`, no se borra. Al abrir Kioku.app, en **Estado y
configuración**:

1. Bóveda: `~/Documents/Kioku` (se crea vacía).
2. Arranque con macOS: «Activar».
3. Ollama: debe responder con `qwen3.5:9b`.
4. Asistente: «Usar qwen3.5:9b».

Después, en **Ajustes → Conexión y dispositivos**, «Activar acceso privado». Así se publica
`https://<mac>.ts.net` en el HTTPS 443 de Tailscale, sin tocar otras publicaciones tuyas (por ejemplo, la del 8443).

## 4. Omarchy: de servidor a cliente

```bash
systemctl --user stop kioku.service
systemctl --user disable kioku.service                  # no arranca más; la unidad sigue ahí para volver atrás
```

La bóveda de Omarchy no se toca: queda donde está, como respaldo. Para usar Kioku, abre `https://<mac>.ts.net` en
Chromium e instálalo como aplicación (menú ⋮ → «Instalar Kioku»). La clave de acceso está en el Mac mini, en
**Ajustes → Conexión y dispositivos**.

Para volver atrás: `systemctl --user enable --now kioku.service`.

## 5. iPhone

En el Mac mini, en **Ajustes → Conexión y dispositivos → Añadir dispositivo**, abre en el iPhone el código o el enlace que
aparece. Después, en Safari: Compartir → «Añadir a pantalla de inicio».

## 6. Comprobación (la haces tú, a mano)

- [ ] En Hoy, escribe «comprar pan mañana». Kio crea la tarea y aparece «Deshacer».
- [ ] Escribe una idea suelta. Se guarda como nota con título y etiquetas.
- [ ] Pregunta «¿qué tengo esta semana?». Kio responde.
- [ ] Desconecta Ollama (sal de su app) y escribe algo. Se guarda en «Sin organizar». Vuelve a abrir Ollama: en
  menos de un par de minutos, Kio lo ordena solo y aparece en «Lo último que ha hecho Kio».
- [ ] En Bases, crea una base con la plantilla «Hábitos». Marca hoy con un toque, en Hoy o en la base.
- [ ] Crea otra con la plantilla «Lectura de la Biblia». Dile a Kio «he leído Juan 3».
- [ ] Desde Omarchy y desde el iPhone ves las mismas notas y tareas.

## Volver atrás por completo

```bash
kioku service uninstall
mv ~/Documents/Kioku ~/Documents/Kioku-cierre-descartada
mv ~/Documents/Kioku-pruebas-2026-11 "VIEJA"
mv ~/Applications/Kioku.app ~/Applications/Kioku.app.cierre
mv ~/Applications/Kioku.app.anterior-FECHA ~/Applications/Kioku.app
open ~/Applications/Kioku.app                           # Estado y configuración → Activar
```

Y en Omarchy: `systemctl --user enable --now kioku.service`.
