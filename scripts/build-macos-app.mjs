#!/usr/bin/env node
// Construcción local: no descarga, instala ni ejecuta el runtime de otro sistema.
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
try {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Uso: node scripts/build-macos-app.mjs --node RUNTIME_MAC_NODE24 --output DESTINO/Kioku.app\nCrea una aplicación sin firmar para pruebas locales. No descarga ni instala software. Requiere npm run build:web previo y Node de macOS arm64 o x64.");
    process.exit(0);
  }
  if (args.length !== 4 || args[0] !== "--node" || args[2] !== "--output") throw new Error("Uso: node scripts/build-macos-app.mjs --node RUNTIME_MAC_NODE24 --output DESTINO/Kioku.app");
  const runtime = path.resolve(args[1]);
  const out = path.resolve(args[3]);
  if (!out.endsWith(".app")) throw new Error("El destino debe terminar en .app");
  if (existsSync(out)) throw new Error("El destino ya existe; no se sobrescribe.");
  if (!lstatSync(runtime).isFile()) throw new Error("El runtime debe ser un fichero regular Mach-O.");
  const bytes = readFileSync(runtime);
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf || ![0x01000007, 0x0100000c].includes(bytes.readUInt32LE(4)) || bytes.readUInt32LE(12) !== 2) throw new Error("Se necesita un ejecutable Mach-O de macOS arm64 o x64.");
  for (const input of ["dist/web/index.html", "dist/web/app.js", "src/cli/main.ts", "node_modules/yaml/package.json"]) {
    if (!existsSync(path.join(root, input))) throw new Error("Falta " + input + "; instala las dependencias y ejecuta npm run build:web.");
  }
  // Resolver padres existentes impide ocultar un destino recursivo detrás de un enlace.
  const canonical = (p) => existsSync(p) ? realpathSync(p) : path.join(canonical(path.dirname(p)), path.basename(p));
  const target = canonical(out);
  const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);
  for (const source of ["src", "dist/web", "node_modules/yaml", "scripts"]) {
    if (inside(target, canonical(path.join(root, source)))) throw new Error("El destino no puede estar dentro de las fuentes del paquete.");
  }
  const regularTree = (p) => {
    const stat = lstatSync(p);
    if (stat.isSymbolicLink()) throw new Error("No se empaqueta ningún enlace simbólico: " + path.relative(root, p));
    if (stat.isDirectory()) for (const entry of readdirSync(p)) regularTree(path.join(p, entry));
    else if (!stat.isFile()) throw new Error("Solo se empaquetan ficheros regulares.");
  };
  for (const source of ["src", "dist/web", "node_modules/yaml", "scripts/native-macos.mjs", "LICENSE"]) regularTree(path.join(root, source));
  const contents = path.join(out, "Contents");
  const app = path.join(contents, "Resources", "app");
  mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  mkdirSync(path.join(contents, "Resources", "runtime"), { recursive: true });
  mkdirSync(path.join(app, "scripts"), { recursive: true });
  copyFileSync(runtime, path.join(contents, "Resources", "runtime", "node"));
  chmodSync(path.join(contents, "Resources", "runtime", "node"), 0o755);
  // Superficies explícitas: nunca copiar checkout, datos, entorno ni todo node_modules.
  for (const name of ["src", "dist/web", "node_modules/yaml"]) {
    cpSync(path.join(root, name), path.join(app, name), { recursive: true, dereference: false });
  }
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ type: "module", private: true }));
  copyFileSync(path.join(root, "scripts/native-macos.mjs"), path.join(app, "scripts/native-macos.mjs"));
  copyFileSync(path.join(root, "LICENSE"), path.join(contents, "Resources", "LICENSE"));
  writeFileSync(path.join(contents, "Info.plist"), '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleName</key><string>Kioku</string><key>CFBundleIdentifier</key><string>local.kioku.workspace</string><key>CFBundleExecutable</key><string>Kioku</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>13.5</string></dict></plist>\n');
  const launcher = path.join(contents, "MacOS", "Kioku");
  writeFileSync(launcher, '#!/bin/bash\nset -euo pipefail\ncontents="$(cd -- "$(dirname -- "$0")/.." && pwd)"\nexec "$contents/Resources/runtime/node" --no-warnings "$contents/Resources/app/scripts/native-macos.mjs"\n');
  chmodSync(launcher, 0o755);
  console.log("Aplicación sin firmar creada: " + out + "\nLa cabecera Mach-O no demuestra versión ni compatibilidad: valida el arranque en un Mac antes de distribuir.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
