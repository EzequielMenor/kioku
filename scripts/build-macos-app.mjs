#!/usr/bin/env node
// Construcción local: no descarga, instala ni ejecuta el runtime de otro sistema.
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { DEFAULT_REF, DEFAULT_REPO, readBuildInfo } from "../src/server/build-info.ts";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
try {
  const USAGE = "Uso: node scripts/build-macos-app.mjs --node RUNTIME_MAC_NODE24 --output DESTINO/Kioku.app [--kio BINARIO_SWIFT [--icon Kioku.icns]]";
  if (args.length === 1 && args[0] === "--help") {
    console.log(USAGE + "\nCrea una aplicación sin firmar para pruebas locales. No descarga ni instala software. Requiere npm run build:web previo y Node de macOS arm64 o x64.\nCon --kio (el ejecutable de macos/, compilado con swift build) la app es la nativa: Kio flotando, su conversación, la ventana de Kioku y el menú en la barra superior. Sin él, abre Kioku en el navegador.");
    process.exit(0);
  }
  if (args.length < 4 || args.length % 2 !== 0 || args[0] !== "--node" || args[2] !== "--output") throw new Error(USAGE);
  const extra = {};
  for (let i = 4; i < args.length; i += 2) {
    if (!["--kio", "--icon"].includes(args[i]) || extra[args[i]]) throw new Error(USAGE);
    extra[args[i]] = path.resolve(args[i + 1]);
  }
  if (extra["--icon"] && !extra["--kio"]) throw new Error("--icon solo tiene sentido con --kio");
  const runtime = path.resolve(args[1]);
  const out = path.resolve(args[3]);
  const kio = extra["--kio"];
  if (kio) {
    if (!lstatSync(kio).isFile()) throw new Error("--kio debe ser el ejecutable de Kio (fichero regular).");
    const head = readFileSync(kio).subarray(0, 8);
    const magic = head.length >= 8 ? head.readUInt32LE(0) : 0;
    // Mach-O de 64 bits (arm64/x64) o binario universal (FAT, big endian).
    if (!(magic === 0xfeedfacf && [0x01000007, 0x0100000c].includes(head.readUInt32LE(4))) && head.readUInt32BE(0) !== 0xcafebabe) throw new Error("--kio debe ser un ejecutable Mach-O de macOS.");
  }
  if (!out.endsWith(".app")) throw new Error("El destino debe terminar en .app");
  if (existsSync(out)) throw new Error("El destino ya existe; no se sobrescribe.");
  if (!lstatSync(runtime).isFile()) throw new Error("El runtime debe ser un fichero regular Mach-O.");
  const bytes = readFileSync(runtime);
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf || ![0x01000007, 0x0100000c].includes(bytes.readUInt32LE(4)) || bytes.readUInt32LE(12) !== 2) throw new Error("Se necesita un ejecutable Mach-O de macOS arm64 o x64.");
  for (const input of ["dist/web/index.html", "dist/web/app.js", "src/cli/main.ts", "node_modules/yaml/package.json", ...(kio ? ["companion/character.json"] : [])]) {
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
  const info = readBuildInfo(root, { inDocker: false });
  const envCommit = process.env.KIOKU_BUILD_COMMIT ?? "";
  const commit = /^[0-9a-f]{40}$/i.test(envCommit) ? envCommit.toLowerCase() : info.commit;
  const ref = process.env.KIOKU_BUILD_REF || info.ref || DEFAULT_REF;
  const repo = process.env.KIOKU_BUILD_REPO || info.repo || DEFAULT_REPO;
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ type: "module", private: true, version: info.version }));
  writeFileSync(path.join(app, "build-info.json"), JSON.stringify({
    version: info.version,
    commit,
    ref,
    repo,
    channel: "macos-app",
    installedAt: new Date().toISOString(),
  }));
  copyFileSync(path.join(root, "scripts/native-macos.mjs"), path.join(app, "scripts/native-macos.mjs"));
  copyFileSync(path.join(root, "LICENSE"), path.join(contents, "Resources", "LICENSE"));
  const launcher = path.join(contents, "MacOS", "Kioku");
  if (kio) {
    // App nativa: menú en la barra superior (LSUIElement), Kio flotando y la ventana de Kioku.
    const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version ?? "0";
    const icon = extra["--icon"];
    writeFileSync(path.join(contents, "Info.plist"), '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>' +
      '<key>CFBundleName</key><string>Kioku</string><key>CFBundleDisplayName</key><string>Kioku</string><key>CFBundleIdentifier</key><string>local.kioku.app</string>' +
      '<key>CFBundleExecutable</key><string>Kioku</string><key>CFBundlePackageType</key><string>APPL</string>' +
      `<key>CFBundleVersion</key><string>${version}</string><key>CFBundleShortVersionString</key><string>${version}</string>` +
      (icon ? '<key>CFBundleIconFile</key><string>Kioku</string>' : "") +
      '<key>LSMinimumSystemVersion</key><string>13.0</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/>' +
      '<key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>' +
      // Solo habla con el daemon y con Ollama en 127.0.0.1 por http.
      '<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>' +
      '</dict></plist>\n');
    copyFileSync(kio, launcher);
    copyFileSync(path.join(root, "companion", "character.json"), path.join(contents, "Resources", "character.json"));
    if (icon) copyFileSync(icon, path.join(contents, "Resources", "Kioku.icns"));
  } else {
    writeFileSync(path.join(contents, "Info.plist"), '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleName</key><string>Kioku</string><key>CFBundleIdentifier</key><string>local.kioku.workspace</string><key>CFBundleExecutable</key><string>Kioku</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>13.5</string></dict></plist>\n');
    writeFileSync(launcher, '#!/bin/bash\nset -euo pipefail\ncontents="$(cd -- "$(dirname -- "$0")/.." && pwd)"\nexec "$contents/Resources/runtime/node" --no-warnings "$contents/Resources/app/scripts/native-macos.mjs"\n');
  }
  chmodSync(launcher, 0o755);
  // Permisos estándar (nunca 0700 heredados de carpetas temporales): legibles para Finder y LaunchServices.
  const executables = new Set([launcher, path.join(contents, "Resources", "runtime", "node")]);
  const normalizeModes = (p) => {
    const st = lstatSync(p);
    if (st.isDirectory()) {
      chmodSync(p, 0o755);
      for (const entry of readdirSync(p)) normalizeModes(path.join(p, entry));
    } else if (st.isFile()) {
      chmodSync(p, executables.has(p) ? 0o755 : 0o644);
    }
  };
  normalizeModes(out);
  console.log("Aplicación sin firmar creada: " + out + (kio ? " (nativa, con Kio)" : "") + "\nLa cabecera Mach-O no demuestra versión ni compatibilidad: valida el arranque en un Mac antes de distribuir.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
