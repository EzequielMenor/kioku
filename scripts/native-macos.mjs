// Entrada de la aplicación Mac; no modifica la instalación Docker ni configura la red.
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { ensureDaemon, loginUrl } from "../src/cli/desktop.ts";
import { readKey } from "../src/server/key.ts";

try {
  if (process.platform !== "darwin") throw new Error("Esta aplicación requiere macOS.");
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("El runtime incluido debe ser Node.js 24 o superior.");
  // Instancia nueva e independiente. No reutilizar ~/Documents/Kioku ni el volumen Docker.
  const home = path.join(os.homedir(), "Library", "Application Support", "Kioku", "Workspace");
  process.env.KIOKU_HOME = home;
  const base = await ensureDaemon(home);
  const key = readKey(home);
  if (!key) throw new Error("No se pudo obtener la credencial local de Kioku.");
  // Salud pública no acredita identidad: comprobar autenticación antes de abrir una URL con clave.
  const check = await fetch(base + "/api/today", { headers: { "x-kioku-key": key }, redirect: "error", signal: AbortSignal.timeout(3000) });
  if (!check.ok) throw new Error("El servicio local no reconoce esta instancia. No se abre el navegador.");
  const opened = spawnSync("/usr/bin/open", [loginUrl(base, key, "/#/conexiones")], { stdio: "ignore" });
  if (opened.status !== 0) throw new Error("No se pudo abrir el navegador.");
} catch (e) {
  // Mensaje fijo: no pasar rutas, claves ni errores de subprocess a AppleScript.
  console.error("Kioku no pudo abrirse: " + e.message);
  if (process.platform === "darwin") spawnSync("/usr/bin/osascript", ["-e", 'display alert "Kioku no pudo abrirse" message "Comprueba que el runtime sea Node 24 para este Mac y que no haya otra instancia incompatible. No se ha migrado tu instalación anterior." as critical'], { stdio: "ignore" });
  process.exitCode = 1;
}
