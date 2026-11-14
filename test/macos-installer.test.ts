import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Estas pruebas ejecutan los scripts públicos tal cual. Solo se simulan las herramientas externas (uname, curl, open,
// el Node y npm descargados, el builder del código descargado) con scripts mínimos en un PATH desechable.

const PINNED = "8580f9b89b4860d1406a5f79cd03551df85b2972";
const rootInstaller = path.resolve("Instalar Kioku.command");
const scriptInstaller = path.resolve("scripts/install-macos.command");
const NODE_LICENSE = "Node.js is licensed for use as follows: LICENCIA SINTETICA\n";
const sh = (body: string) => "#!/bin/sh\n" + body;

const FAKES: Record<string, string> = {
  uname: sh('case "$1" in -s) echo "${FAKE_UNAME_S:-Darwin}";; -m) echo "${FAKE_UNAME_M:-arm64}";; esac\n'),
  // Checksum real: /usr/bin/shasum en macOS; en Linux vive en core_perl en algunas distribuciones.
  shasum: sh('for t in /usr/bin/shasum /usr/bin/core_perl/shasum; do [ -x "$t" ] && exec "$t" "$@"; done\necho "shasum no disponible" >&2; exit 127\n'),
  open: sh('echo "open $*" >> "$FAKE_LOG"\necho "NODE_COMPILE_CACHE=[$NODE_COMPILE_CACHE] npm_config_cache=[$npm_config_cache] PATH=$PATH" > "$FAKE_LOG.openenv"\n[ -z "$FAKE_OPEN_FAIL" ]\n'),
  // mktemp de macOS (BSD): sin plantilla no usa el TMPDIR del llamador, sino un directorio propio del usuario.
  mktemp: sh('if [ "$#" -eq 1 ] && [ "$1" = -d ]; then exec /usr/bin/mktemp -d "$FAKE_IMPLICIT_TMP/tmp.XXXXXXXX"; fi\nexec /usr/bin/mktemp "$@"\n'),
  xattr: sh('echo "PROHIBIDO xattr $*" >> "$FAKE_LOG"\n'),
  sudo: sh('echo "PROHIBIDO sudo $*" >> "$FAKE_LOG"\n'),
  mv: sh(`case "$1" in
  *Kioku-instalacion*/Kioku.app) [ -n "$FAKE_MV_FAIL" ] && exit 1;;
  */Applications/Kioku.app) [ "$FAKE_MV_FAIL" = backup ] && exit 1;;
  *.anterior-*) [ "$FAKE_MV_FAIL" = restore ] && exit 1;;
esac
PATH=/usr/bin:/bin mv "$@" || exit $?
# Simula una interrupción justo después de que un mv termine bien (el instalador la atiende al volver de mv).
case "$FAKE_MV_TERM:$1" in backup:*/Applications/Kioku.app|place:*Kioku-instalacion*/Kioku.app) kill -TERM "$PPID";; esac
`),
  curl: sh(`out=""; url=""
while [ "$#" -gt 0 ]; do case "$1" in -o) out="$2"; shift;; https://*) url="$1";; esac; shift; done
echo "curl $url" >> "$FAKE_LOG"
case "$url" in
  */SHASUMS256.txt) [ "$FAKE_CURL_FAIL" = shasums ] && exit 22; src=SHASUMS256.txt;;
  https://nodejs.org/*) [ "$FAKE_CURL_FAIL" = node ] && exit 22; src="\${url##*/}";;
  https://codeload.github.com/*) [ "$FAKE_CURL_FAIL" = source ] && exit 22; src=source.tar.gz;;
  *) exit 6;;
esac
cp "$FAKE_SERVE/$src" "$out"
[ "$FAKE_CORRUPT" = 1 ] && case "$src" in node-*) echo corrupto >> "$out";; esac
exit 0
`),
};
// Lo que "descarga" el instalador: un Node falso con licencia y npm, y un código fuente con un builder mínimo.
const FAKE_NODE = sh('[ "$1" = --version ] && { echo "${FAKE_NODE_VERSION:-v24.1.0}"; exit 0; }\nexec "$FAKE_REAL_NODE" "$@"\n');
// Como el npm real, activa la caché de compilación de Node (en TMPDIR salvo que NODE_COMPILE_CACHE la redirija).
const FAKE_NPM = sh('echo "npm $* cache=$npm_config_cache cwd=$(basename "$(pwd)")" >> "$FAKE_LOG"\n[ "$1" = ci ] && "$FAKE_REAL_NODE" -e \'require("node:module").enableCompileCache()\'\n[ "$FAKE_NPM_FAIL" != "$1" ]\n');
const FAKE_BUILDER = `import { chmodSync, copyFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
const [, runtime, , out] = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, "builder out=" + out + "\\n");
if (process.env.FAKE_BUILD_FAIL || existsSync(out)) { console.error("builder simulado: error"); process.exit(1); }
mkdirSync(out + "/Contents/MacOS", { recursive: true });
mkdirSync(out + "/Contents/Resources/runtime", { recursive: true });
writeFileSync(out + "/Contents/MacOS/Kioku", "#!/bin/sh\\necho nueva\\n"); chmodSync(out + "/Contents/MacOS/Kioku", 0o755);
copyFileSync(runtime, out + "/Contents/Resources/runtime/node"); chmodSync(out + "/Contents/Resources/runtime/node", 0o755);
writeFileSync(out + "/Contents/Resources/version.txt", "nueva\\n");
`;

type Tree = Record<string, string>;
// Fotografía de un árbol (ficheros, directorios y enlaces) para comprobar que nada cambió.
const snapshot = (dir: string, out: Tree = {}): Tree => {
  if (!lstatOrNull(dir)) return out;
  for (const e of readdirSync(dir).sort()) {
    const p = path.join(dir, e);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) out[p] = "-> " + readlinkSync(p);
    else if (st.isDirectory()) { out[p] = "dir"; snapshot(p, out); } else out[p] = readFileSync(p, "utf8");
  }
  return out;
};
function lstatOrNull(p: string) { try { return lstatSync(p); } catch { return null; } }
const write = (file: string, text: string, mode = 0o644) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); chmodSync(file, mode); };

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "kioku-installer-")));
  const home = path.join(root, "home"), tmp = path.join(root, "tmp"), bin = path.join(root, "bin"), serve = path.join(root, "serve");
  const log = path.join(root, "calls.log");
  const spaced = path.join(root, "Carpeta con espacios");
  const apps = path.join(home, "Applications"), dest = path.join(apps, "Kioku.app");
  const implicitTmp = path.join(root, "implicit-tmp");
  for (const d of [home, tmp, serve, implicitTmp]) mkdirSync(d, { recursive: true });
  for (const [name, body] of Object.entries(FAKES)) write(path.join(bin, name), body, 0o755);
  // Copias de los scripts públicos en una ruta con espacios (así se ejecutan tras extraer el ZIP).
  const installer = path.join(spaced, "Instalar Kioku.command");
  mkdirSync(path.join(spaced, "scripts"), { recursive: true });
  copyFileSync(rootInstaller, installer); copyFileSync(scriptInstaller, path.join(spaced, "scripts", "install-macos.command"));
  // Node falso: tarball con bin/node, bin/npm y LICENSE; el mismo para las dos arquitecturas.
  const nodeDir = path.join(root, "pack", "node-v24.1.0");
  write(path.join(nodeDir, "bin", "node"), FAKE_NODE, 0o755);
  write(path.join(nodeDir, "bin", "npm"), FAKE_NPM, 0o755);
  write(path.join(nodeDir, "LICENSE"), NODE_LICENSE);
  const tgz = path.join(serve, "node-v24.1.0-darwin-arm64.tar.gz");
  assert.equal(spawnSync("tar", ["-czf", tgz, "-C", path.dirname(nodeDir), "node-v24.1.0"]).status, 0);
  copyFileSync(tgz, path.join(serve, "node-v24.1.0-darwin-x64.tar.gz"));
  const sum = createHash("sha256").update(readFileSync(tgz)).digest("hex");
  write(path.join(serve, "SHASUMS256.txt"), `${"0".repeat(64)}  node-v24.1.0-darwin-arm64.pkg\n${sum}  node-v24.1.0-darwin-arm64.tar.gz\n${sum}  node-v24.1.0-darwin-x64.tar.gz\n`);
  const srcDir = path.join(root, "pack", "kioku-" + PINNED);
  write(path.join(srcDir, "package.json"), "{}");
  write(path.join(srcDir, "scripts", "build-macos-app.mjs"), FAKE_BUILDER);
  assert.equal(spawnSync("tar", ["-czf", path.join(serve, "source.tar.gz"), "-C", path.dirname(srcDir), path.basename(srcDir)]).status, 0);

  const run = (o: { args?: string[]; input?: string; env?: Record<string, string>; script?: string } = {}) => spawnSync("/bin/bash", [o.script ?? installer, ...(o.args ?? [])], {
    encoding: "utf8", input: o.input ?? "", timeout: 60_000,
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, TMPDIR: tmp, FAKE_LOG: log, FAKE_SERVE: serve, FAKE_IMPLICIT_TMP: implicitTmp, FAKE_REAL_NODE: process.execPath, ...o.env },
  });
  const calls = () => existsSync(log) ? readFileSync(log, "utf8") : "";
  const seedUser = () => {
    write(path.join(home, "Library/Application Support/Kioku/Workspace/notas/nota.md"), "# nota sintética\n");
    write(path.join(home, "Library/Application Support/Kioku/Workspace/.kioku/secret"), "SINTETICO-NO-ES-UNA-CLAVE\n");
    write(path.join(home, "Documents/Kioku/nota.md"), "# otra\n");
  };
  const seedPrior = () => { write(path.join(dest, "Contents/MacOS/Kioku"), "#!/bin/sh\necho anterior\n", 0o755); write(path.join(dest, "Contents/Resources/version.txt"), "anterior\n"); };
  return { root, home, tmp, implicitTmp, log, apps, dest, installer, run, calls, seedUser, seedPrior, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const withFixture = (fn: (f: ReturnType<typeof fixture>) => void) => { const f = fixture(); try { fn(f); } finally { f.cleanup(); } };

test("la entrada raíz y el script ofrecen --help sin red ni cambios, y rechazan opciones desconocidas", () => withFixture((f) => {
  for (const script of [rootInstaller, scriptInstaller, f.installer]) {
    assert.ok(statSync(script).mode & 0o100, "ejecutable: " + script);
    const r = f.run({ script, args: ["--help"], env: { FAKE_UNAME_S: "Linux" } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    for (const text of ["KIOKU_REF", "KIOKU_REPO", "KIOKU_NODE_LINE", "KIOKU_INSTALL_NO_OPEN", PINNED, "no está firmada ni notarizada", "Workspace"]) assert.ok(r.stdout.includes(text), `${text} en la ayuda`);
  }
  assert.equal(f.calls(), "", "la ayuda no usa la red");
  const bad = f.run({ args: ["--instalar"] });
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, "");
  assert.match(bad.stderr, /Opción desconocida: --instalar/);
  assert.deepEqual(snapshot(f.home), {});
}));

test("comportamiento previo: rechaza sistemas y arquitecturas no soportados sin tocar nada", () => withFixture((f) => {
  f.seedUser();
  const before = snapshot(f.home);
  const linux = f.run({ env: { FAKE_UNAME_S: "Linux" } });
  assert.equal(linux.status, 1);
  assert.equal(linux.stdout, "\n");
  assert.equal(linux.stderr, "No se pudo instalar: este instalador es solo para macOS.\nNada de lo que ya tenías se ha modificado.\n");
  const arch = f.run({ env: { FAKE_UNAME_M: "ppc64" } });
  assert.equal(arch.status, 1);
  assert.equal(arch.stdout, "\n");
  assert.equal(arch.stderr, "No se pudo instalar: arquitectura no soportada: ppc64.\nNada de lo que ya tenías se ha modificado.\n");
  const invalid: Record<string, string>[] = [{ KIOKU_REF: "../x" }, { KIOKU_REF: "a b" }, { KIOKU_REPO: "a/b/c" }, { KIOKU_NODE_LINE: "v22.x" }];
  for (const env of invalid) {
    const r = f.run({ env });
    assert.equal(r.status, 1, JSON.stringify(env));
    assert.match(r.stderr, /KIOKU_(REF|REPO|NODE_LINE)/);
  }
  assert.equal(f.calls(), "");
  assert.deepEqual(snapshot(f.home), before);
}));

test("instalación nueva: versión fijada, Node verificado y con licencia, app completa y se abre por defecto", () => withFixture((f) => {
  f.seedUser();
  const before = snapshot(f.home);
  const r = f.run({ env: { FAKE_UNAME_M: "x86_64" } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, new RegExp("Listo: " + f.dest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(r.stdout, /clic derecho > Abrir/);
  const calls = f.calls();
  assert.ok(calls.includes("curl https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt"));
  assert.ok(calls.includes("curl https://nodejs.org/dist/latest-v24.x/node-v24.1.0-darwin-x64.tar.gz"), "elige la arquitectura del Mac");
  assert.ok(calls.includes(`curl https://codeload.github.com/EzequielMenor/kioku/tar.gz/${PINNED}\n`), "descarga el commit fijado");
  // El trabajo vive bajo el TMPDIR del llamador (mktemp de BSD no lo usa sin plantilla) y npm ci / build comparten la misma carpeta.
  const cache = /npm ci --silent cache=(.+)\/npm-cache cwd=src\n/.exec(calls)?.[1];
  assert.ok(cache?.startsWith(f.tmp + path.sep), `trabajo bajo TMPDIR (${cache})`);
  assert.ok(calls.includes(`npm run build:web --silent cache=${cache}/npm-cache cwd=src\n`), "mismo trabajo para npm ci y build");
  assert.deepEqual(readdirSync(f.implicitTmp), [], "nada en el directorio implícito de mktemp");
  const openEnv = readFileSync(f.log + ".openenv", "utf8");
  assert.ok(openEnv.startsWith("NODE_COMPILE_CACHE=[] npm_config_cache=[] PATH="), "la app se abre sin las cachés privadas del instalador");
  assert.doesNotMatch(openEnv, /kioku-instalador/, "ni el PATH con el Node temporal");
  assert.ok(calls.includes(`builder out=${f.apps}/.Kioku-instalacion.`), "se construye en la carpeta de preparación, no en el destino final");
  assert.ok(calls.endsWith(`open ${f.dest}\n`), "por defecto se abre la app instalada");
  assert.doesNotMatch(calls, /PROHIBIDO/);
  assert.equal(readFileSync(path.join(f.dest, "Contents/Resources/runtime/LICENSE"), "utf8"), NODE_LICENSE, "licencia de Node dentro de la app");
  assert.equal(readFileSync(path.join(f.dest, "Contents/Resources/version.txt"), "utf8"), "nueva\n");
  assert.deepEqual(readdirSync(f.apps), ["Kioku.app"], "sin restos de preparación");
  assert.deepEqual(readdirSync(f.tmp), [], "Node, fuentes y cachés (npm y compilación de Node) se borran");
  const after = snapshot(f.home);
  for (const [file, text] of Object.entries(before)) assert.equal(after[file], text, file);
  assert.equal(existsSync(path.join(f.home, ".npm")), false, "la caché de npm no va al usuario");
}));

test("KIOKU_INSTALL_NO_OPEN=1 no abre la app y un fallo al abrir se cuenta sin dar la instalación por fallida", () => withFixture((f) => {
  const quiet = f.run({ env: { KIOKU_INSTALL_NO_OPEN: "1" } });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.match(quiet.stdout, /No se abre la app \(KIOKU_INSTALL_NO_OPEN=1\)/);
  assert.doesNotMatch(f.calls(), /^open /m);
  rmSync(f.dest, { recursive: true });
  const broken = f.run({ env: { FAKE_OPEN_FAIL: "1" } });
  assert.equal(broken.status, 0);
  assert.match(broken.stderr, /Kioku está instalado, pero no pude abrirlo automáticamente/);
  assert.ok(existsSync(path.join(f.dest, "Contents/MacOS/Kioku")));
}));

test("el trabajo temporal usa el TMPDIR del llamador (con espacios y barra final), respeta su caché de Node y falla claro si no existe", () => withFixture((f) => {
  const spacedTmp = path.join(f.root, "tmp con espacios"), callerCache = path.join(f.root, "cache-del-llamador");
  mkdirSync(spacedTmp);
  const r = f.run({ env: { TMPDIR: spacedTmp + "/", NODE_COMPILE_CACHE: callerCache } });
  assert.equal(r.status, 0, r.stderr);
  const cache = /npm ci --silent cache=(.+)\/npm-cache cwd=src\n/.exec(f.calls())?.[1];
  assert.ok(cache?.startsWith(spacedTmp + path.sep), String(cache));
  assert.deepEqual(readdirSync(spacedTmp), [], "se limpia solo lo creado por el instalador");
  assert.deepEqual(readdirSync(f.implicitTmp), []);
  assert.equal(existsSync(callerCache), false, "la caché del llamador no se usa ni se escribe");
  assert.ok(readFileSync(f.log + ".openenv", "utf8").startsWith(`NODE_COMPILE_CACHE=[${callerCache}] `), "su variable llega intacta a la app");

  rmSync(f.apps, { recursive: true });
  const before = snapshot(f.home);
  const missing = f.run({ env: { TMPDIR: path.join(f.root, "no-existe") } });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No se pudo instalar: no pude crear una carpeta temporal en .*no-existe\./);
  assert.deepEqual(snapshot(f.home), before);
}));

test("las versiones alternativas son explícitas: avisan y usan el repositorio y la referencia indicados", () => withFixture((f) => {
  const r = f.run({ env: { KIOKU_REPO: "otro/kioku", KIOKU_REF: "feature/prueba", KIOKU_INSTALL_NO_OPEN: "1" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Aviso: usando una versión distinta de la validada \(KIOKU_REF=feature\/prueba\)/);
  assert.ok(f.calls().includes("curl https://codeload.github.com/otro/kioku/tar.gz/feature/prueba\n"));
}));

test("actualizar con confirmación aparta la app anterior sin borrarla y conserva datos y copias previas", () => withFixture((f) => {
  f.seedUser(); f.seedPrior();
  write(path.join(f.apps, "Kioku.app.anterior-20200101-000000/Contents/Resources/version.txt"), "copia vieja\n");
  const before = snapshot(f.home);
  const r = f.run({ input: "s\n", env: { KIOKU_INSTALL_NO_OPEN: "1" } });
  assert.equal(r.status, 0, r.stderr);
  const after = snapshot(f.home);
  const backups = Object.keys(after).filter((p) => /Kioku\.app\.anterior-\d{8}-\d{6}-\d+$/.test(p));
  assert.equal(backups.length, 1);
  assert.ok(r.stdout.includes("La versión anterior se guardó en: " + backups[0]));
  for (const [file, text] of Object.entries(before)) {
    const moved = file === f.dest || file.startsWith(f.dest + path.sep) ? backups[0] + file.slice(f.dest.length) : file;
    assert.equal(after[moved], text, file + " debe conservarse");
  }
  assert.equal(readFileSync(path.join(f.dest, "Contents/Resources/version.txt"), "utf8"), "nueva\n");
  assert.deepEqual(readdirSync(f.apps).sort(), ["Kioku.app", "Kioku.app.anterior-20200101-000000", path.basename(backups[0])].sort());
}));

test("la confirmación es cerrada: cualquier respuesta distinta de sí deja todo como estaba, sin descargar", () => withFixture((f) => {
  f.seedUser(); f.seedPrior();
  const before = snapshot(f.home);
  for (const input of ["", "\n", "n\n", "no\n", "yes\n", "quizá\n"]) {
    const r = f.run({ input });
    assert.equal(r.status, 0, JSON.stringify(input));
    assert.match(r.stdout, /No se ha instalado nada\. Tu Kioku sigue como estaba\./);
    assert.deepEqual(snapshot(f.home), before, JSON.stringify(input));
  }
  assert.equal(f.calls(), "", "ni descargas ni abrir");
}));

const FAILURES: [string, Record<string, string>, RegExp][] = [
  ["consulta de nodejs.org", { FAKE_CURL_FAIL: "shasums" }, /no pude consultar nodejs\.org/],
  ["descarga de Node", { FAKE_CURL_FAIL: "node" }, /falló la descarga de Node/],
  ["checksum de Node", { FAKE_CORRUPT: "1" }, /el checksum de Node no coincide; no se usa/],
  ["Node menor que 24", { FAKE_NODE_VERSION: "v22.1.0" }, /se necesita Node 24 o superior \(descargado: v22\.1\.0\)/],
  ["descarga del código", { FAKE_CURL_FAIL: "source" }, /no pude descargar EzequielMenor\/kioku@8580f9b/],
  ["npm ci", { FAKE_NPM_FAIL: "ci" }, /falló npm ci/],
  ["compilación web", { FAKE_NPM_FAIL: "run" }, /falló la compilación de la interfaz/],
  ["construcción de la app", { FAKE_BUILD_FAIL: "1" }, /falló al crear la aplicación/],
];
for (const [name, env, message] of FAILURES) {
  test(`fallo en ${name}: error claro, nada cambia y la app anterior sigue intacta`, () => withFixture((f) => {
    for (const prior of [true, false]) {
      f.seedUser(); if (prior) f.seedPrior();
      const before = snapshot(f.home);
      const r = f.run({ input: "s\n", env });
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, message);
      assert.match(r.stderr, /Nada de lo que ya tenías se ha modificado\.\n$/);
      assert.doesNotMatch(r.stdout, /Listo/);
      assert.deepEqual(snapshot(f.home), before, "ni app anterior, ni copias, ni preparación, ni carpeta nueva");
      assert.deepEqual(readdirSync(f.tmp), [], "sin restos temporales");
      assert.doesNotMatch(f.calls(), /^open /m);
      if (prior) rmSync(f.dest, { recursive: true });
      rmSync(f.apps, { recursive: true, force: true });
    }
  }));
}

test("si la app nueva no llega a su sitio, se restaura la anterior y el error dice qué pasó de verdad", () => withFixture((f) => {
  f.seedUser(); f.seedPrior();
  const before = snapshot(f.home);
  const r = f.run({ input: "s\n", env: { FAKE_MV_FAIL: "place" } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No se pudo instalar: no pude colocar la aplicación nueva en /);
  assert.ok(r.stderr.endsWith(`Tu versión anterior sigue en ${f.dest}.\n`));
  assert.doesNotMatch(r.stderr, /Nada de lo que ya tenías/);
  assert.doesNotMatch(r.stdout, /Listo/);
  assert.deepEqual(snapshot(f.home), before, "app anterior restaurada y sin restos");
  assert.doesNotMatch(f.calls(), /^open /m);

  // Si tampoco se puede restaurar, se dice dónde quedó guardada.
  const worse = f.run({ input: "s\n", env: { FAKE_MV_FAIL: "restore" } });
  assert.equal(worse.status, 1);
  const kept = readdirSync(f.apps).filter((e) => e.startsWith("Kioku.app.anterior-"));
  assert.equal(kept.length, 1);
  assert.ok(worse.stderr.endsWith(`No pude devolver tu versión anterior a ${f.dest}. Sigue guardada en: ${path.join(f.apps, kept[0])}\n`));
  assert.equal(readFileSync(path.join(f.apps, kept[0], "Contents/Resources/version.txt"), "utf8"), "anterior\n");
  assert.equal(existsSync(f.dest), false);
}));

test("una instalación nueva que falla al colocarse no deja ni app ni carpeta ni éxito falso", () => withFixture((f) => {
  f.seedUser();
  const before = snapshot(f.home);
  const r = f.run({ env: { FAKE_MV_FAIL: "place" } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no pude colocar la aplicación nueva/);
  assert.doesNotMatch(r.stdout, /Listo/);
  assert.deepEqual(snapshot(f.home), before);
}));

test("si mv no puede apartar la versión anterior, no se dice que exista una copia y no cambia nada", () => withFixture((f) => {
  f.seedUser(); f.seedPrior();
  const before = snapshot(f.home);
  const r = f.run({ input: "s\n", env: { FAKE_MV_FAIL: "backup" } });
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "No se pudo instalar: no pude apartar la versión anterior.\nNada de lo que ya tenías se ha modificado.\n");
  assert.deepEqual(snapshot(f.home), before);
  assert.doesNotMatch(f.calls(), /^open /m);
}));

test("una interrupción justo después de apartar la versión anterior la restaura y sale con error", () => withFixture((f) => {
  f.seedUser(); f.seedPrior();
  const before = snapshot(f.home);
  const r = f.run({ input: "s\n", env: { FAKE_MV_TERM: "backup" } });
  assert.notEqual(r.status, 0);
  assert.equal(r.status, 130);
  assert.deepEqual(snapshot(f.home), before, "app anterior y datos restaurados, sin copia ni carpeta de preparación");
  assert.equal(r.stderr, `Instalación interrumpida. Tu versión anterior sigue en ${f.dest}.\n`);
  assert.doesNotMatch(r.stdout, /Listo/);
  assert.deepEqual(readdirSync(f.tmp), []);
  assert.doesNotMatch(f.calls(), /^open /m);
}));

test("una interrupción justo después de colocar la app nueva conserva ambas versiones y lo dice", () => withFixture((f) => {
  f.seedUser(); f.seedPrior();
  const r = f.run({ input: "s\n", env: { FAKE_MV_TERM: "place" } });
  assert.equal(r.status, 130);
  const kept = readdirSync(f.apps).filter((e) => e.startsWith("Kioku.app.anterior-"));
  assert.equal(kept.length, 1);
  assert.equal(r.stderr, `Instalación interrumpida. No pude devolver tu versión anterior a ${f.dest}. Sigue guardada en: ${path.join(f.apps, kept[0])}\n`);
  assert.equal(readFileSync(path.join(f.apps, kept[0], "Contents/Resources/version.txt"), "utf8"), "anterior\n");
  assert.equal(readFileSync(path.join(f.dest, "Contents/Resources/version.txt"), "utf8"), "nueva\n", "la app nueva no se sobrescribe ni se anida");
  assert.deepEqual(readdirSync(f.apps).sort(), ["Kioku.app", kept[0]].sort(), "sin carpeta de preparación");
  assert.equal(existsSync(path.join(f.home, "Library/Application Support/Kioku/Workspace/notas/nota.md")), true);
}));

test("rechaza destinos que son enlaces simbólicos sin tocar lo que hay detrás", () => withFixture((f) => {
  const outside = path.join(f.root, "externo");
  write(path.join(outside, "Kioku.app/Contents/Resources/version.txt"), "ajena\n");
  write(path.join(outside, "otro.txt"), "ajeno\n");
  const outsideBefore = snapshot(outside);

  symlinkSync(outside, f.apps);
  const viaFolder = f.run({ input: "s\n" });
  assert.equal(viaFolder.status, 1);
  assert.match(viaFolder.stderr, /es un enlace simbólico; no instalo a través de enlaces/);
  assert.deepEqual(snapshot(outside), outsideBefore);
  unlinkSync(f.apps);

  mkdirSync(f.apps);
  symlinkSync(path.join(outside, "Kioku.app"), f.dest);
  const viaApp = f.run({ input: "s\n" });
  assert.equal(viaApp.status, 1);
  assert.match(viaApp.stderr, /es un enlace simbólico; no lo modifico/);
  assert.deepEqual(snapshot(outside), outsideBefore);
  assert.equal(readlinkSync(f.dest), path.join(outside, "Kioku.app"));
  assert.equal(f.calls(), "", "se rechaza antes de descargar nada");
}));

test("los scripts no quitan la cuarentena de macOS ni usan permisos de administrador ni instalaciones globales", () => {
  for (const file of [rootInstaller, scriptInstaller]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\bxattr\b|\bsudo\b|npm (i|install) .*(-g|--global)|\bbrew\b|\bdefaults write\b|launchctl|spctl|pmset/, file);
  }
});

// --- Instalación real en macOS (opt-in): ejecuta el instalador público, con red y sin simular nada.

const nativeSkip = process.platform !== "darwin" ? "requiere macOS (Mach-O, Node oficial y LaunchServices reales)"
  : process.env.KIOKU_INSTALLER_SMOKE !== "1" ? "opt-in: define KIOKU_INSTALLER_SMOKE=1 (lo hace el workflow de macOS)" : false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("el instalador público instala la app fijada en un HOME desechable y la app instalada arranca y se reutiliza", { skip: nativeSkip, timeout: 900_000 }, async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "kioku-installer-mac-")));
  const home = path.join(root, "home"), tmp = path.join(root, "tmp");
  const app = path.join(home, "Applications", "Kioku.app"), contents = path.join(app, "Contents");
  const bundledNode = path.join(contents, "Resources", "runtime", "node");
  const bundledMain = path.join(contents, "Resources", "app", "src", "cli", "main.ts");
  const workspace = path.join(home, "Library", "Application Support", "Kioku", "Workspace");
  const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, TMPDIR: tmp, KIOKU_ASSISTANT_FAKE: "1" };
  const cli = (...args: string[]) => spawnSync(bundledNode, ["--no-warnings", bundledMain, ...args], { encoding: "utf8", env: { ...env, KIOKU_HOME: workspace }, timeout: 30_000 });
  const command = (pid: number) => spawnSync("/bin/ps", ["-p", String(pid), "-ww", "-o", "command="], { encoding: "utf8" }).stdout;
  const discover = () => {
    const r = cli("status");
    const m = r.status === 0 ? /daemon pid (\d+) en (http:\/\/127\.0\.0\.1:\d+)/.exec(r.stdout) : null;
    return m ? { pid: Number(m[1]), base: m[2] } : null;
  };
  const launch = () => spawnSync(path.join(contents, "MacOS", "Kioku"), [], { encoding: "utf8", env, timeout: 40_000 });
  const markers: Tree = {
    [path.join(home, "Documents", "Kioku", "nota.md")]: "# Nota sintética\n",
    [path.join(home, "Documents", "Kioku", ".kioku", "secret")]: "SINTETICO-NO-ES-UNA-CLAVE\n",
    [path.join(home, ".hermes", ".env")]: "SINTETICO=1\n",
  };
  try {
    if (process.env.KIOKU_EXPECT_ARCH) assert.equal(process.arch, process.env.KIOKU_EXPECT_ARCH, "arquitectura del runner");
    mkdirSync(tmp);
    for (const [file, text] of Object.entries(markers)) write(file, text);
    const before = { ...snapshot(path.join(home, "Documents")), ...snapshot(path.join(home, ".hermes")) };

    // Entrada raíz real, sin OPEN (no escribe en el HOME real del runner) y con la versión fijada por defecto.
    const installed = spawnSync("/bin/bash", [rootInstaller], { encoding: "utf8", input: "", env: { ...env, KIOKU_INSTALL_NO_OPEN: "1" }, timeout: 840_000 });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    assert.match(installed.stdout, /Listo: /);
    assert.deepEqual(readdirSync(path.join(home, "Applications")), ["Kioku.app"]);
    assert.deepEqual(readdirSync(tmp), [], "sin restos temporales");

    assert.match(readFileSync(path.join(contents, "Resources", "runtime", "LICENSE"), "utf8"), /^Node\.js is licensed for use as follows/);
    const header = readFileSync(bundledNode).subarray(0, 8);
    assert.equal(header.readUInt32LE(0), 0xfeedfacf, "Mach-O de 64 bits");
    assert.equal(header.readUInt32LE(4), process.arch === "arm64" ? 0x0100000c : 0x01000007, "arquitectura del runtime = la del Mac");
    const version = spawnSync(bundledNode, ["--version"], { encoding: "utf8" });
    assert.match(version.stdout, /^v(2[4-9]|[3-9]\d)\./, "el runtime incluido se ejecuta y es Node 24+");

    const first = launch();
    assert.equal(first.status, 0, "primer arranque de la app instalada: " + first.stderr);
    const daemon = discover();
    assert.ok(daemon, "status debe encontrar el daemon del Workspace aislado");
    assert.ok(command(daemon.pid).includes(bundledNode), "el daemon usa el runtime de la app instalada");
    const url = cli("url");
    const key = url.status === 0 ? /[?&]k=([0-9a-f]{64})(?:[&#]|$)/.exec(url.stdout)?.[1] : undefined;
    assert.ok(key, "kioku url ofrece una URL con clave");
    assert.equal((await fetch(daemon.base + "/api/today")).status, 401, "la API exige clave");
    assert.equal((await fetch(daemon.base + "/api/today", { headers: { "x-kioku-key": key } })).status, 200);
    const second = launch();
    assert.equal(second.status, 0, "segundo arranque: " + second.stderr);
    assert.deepEqual(discover(), daemon, "el segundo arranque reutiliza el mismo daemon");
    for (const out of [installed.stdout, installed.stderr, first.stdout, first.stderr, second.stdout, second.stderr]) assert.ok(!out.includes(key), "ninguna salida contiene la clave");

    assert.deepEqual({ ...snapshot(path.join(home, "Documents")), ...snapshot(path.join(home, ".hermes")) }, before, "marcadores previos intactos");
  } finally {
    const daemon = existsSync(app) ? discover() : null;
    if (daemon && command(daemon.pid).includes(bundledNode)) {
      process.kill(daemon.pid, "SIGTERM");
      for (let i = 0; i < 50 && alive(daemon.pid); i++) await sleep(100);
      if (alive(daemon.pid) && command(daemon.pid).includes(bundledNode)) { process.kill(daemon.pid, "SIGKILL"); await sleep(500); }
    }
    rmSync(root, { recursive: true, force: true });
  }
});
