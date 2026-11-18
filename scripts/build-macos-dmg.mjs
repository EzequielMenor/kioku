import { spawnSync } from "node:child_process";
import { linkSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const usage = "Uso: node scripts/build-macos-dmg.mjs RUTA/Kioku.app RUTA/Kioku.dmg";

function statIfPresent(path) {
  return lstatSync(path, { throwIfNoEntry: false });
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr?.trim();
    const reason = result.signal ? `por señal ${result.signal}` : `con código ${result.status}`;
    throw new Error(`${command} terminó ${reason}.${detail ? ` ${detail}` : ""}`);
  }
}

function build(source, destination) {
  const app = resolve(source);
  const output = resolve(destination);
  if (basename(app) !== "Kioku.app" || !statIfPresent(app)?.isDirectory()
      || !statIfPresent(join(app, "Contents", "Info.plist"))?.isFile()) {
    throw new Error("La entrada debe ser un bundle Kioku.app construido.");
  }
  if (!output.endsWith(".dmg")) throw new Error("El destino debe terminar en .dmg.");
  if (statIfPresent(output)) throw new Error(`el destino ya existe: ${output}`);
  if (process.platform !== "darwin") throw new Error("Hace falta macOS para crear la imagen.");

  const parent = realpathSync(dirname(output));
  const fromApp = relative(realpathSync(app), parent);
  if (!isAbsolute(fromApp) && fromApp.split(sep)[0] !== "..") {
    throw new Error("El destino debe quedar fuera de Kioku.app.");
  }

  // Keep the image on the destination volume: publishing via a hard link
  // is atomic and refuses to replace anything created during the build.
  const work = mkdtempSync(join(parent, ".kioku-dmg-"));
  try {
    const staging = join(work, "staging");
    const image = join(work, "Kioku.dmg");
    mkdirSync(staging);
    run("ditto", [app, join(staging, "Kioku.app")]);
    symlinkSync("/Applications", join(staging, "Applications"));
    run("hdiutil", ["create", "-quiet", "-volname", "Kioku", "-srcfolder", staging, "-format", "UDZO", image]);
    linkSync(image, join(parent, basename(output)));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  process.stdout.write(`Imagen creada: ${output}\n`);
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  process.stdout.write(`${usage}\n`);
} else if (args.length !== 2 || args.some((arg) => !arg || arg.startsWith("--"))) {
  process.stderr.write(`${usage}\n`);
  process.exitCode = 1;
} else {
  try {
    build(...args);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
