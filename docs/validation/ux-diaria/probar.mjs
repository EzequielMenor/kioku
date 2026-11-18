// Laboratorio del recorrido diario. Node 24+, después de «npm run build:web».
import { existsSync } from "node:fs";
import path from "node:path";
import { Kioku } from "../../../src/core/kioku.ts";
import { startServer } from "../../../src/server/server.ts";
import { loadOrCreateKey, loadOrCreateMobileKey } from "../../../src/server/key.ts";
import { tmpVault } from "../../../test/helpers.ts";

const webDir = path.resolve(import.meta.dirname, "../../../dist/web");
if (!existsSync(path.join(webDir, "app.js"))) throw new Error("Ejecuta npm run build:web primero.");
const vault = tmpVault();
process.env.KIOKU_HOME = vault.root;
const j = await Kioku.open({ root: vault.root });
try {
  const key = loadOrCreateKey(vault.root);
  const srv = await startServer(j, { key, port: 0, webDir });
  try {
    console.log("Bóveda temporal:", vault.root);
    console.log("Escritorio:", srv.url + "/?k=" + key + "#/hoy");
    console.log("Rol móvil (otra ventana privada):", srv.url + "/?k=" + loadOrCreateMobileKey(vault.root) + "#/hoy");
    console.log("Ctrl+C cierra el laboratorio y borra su bóveda temporal.");
    await new Promise(resolve => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } finally { await srv.close(); }
} finally { j.close(); vault.cleanup(); }
