import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const installScript = path.resolve("scripts/install.sh");
const NODE_LICENSE = "Node.js is licensed for use as follows: LICENCIA SINTETICA\n";
const sh = (body: string) => "#!/bin/sh\n" + body;
const write = (file: string, text: string, mode = 0o644) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  chmodSync(file, mode);
};

function lstatOrNull(p: string) { try { return lstatSync(p); } catch { return null; } }
type Tree = Record<string, string>;
const snapshot = (dir: string, out: Tree = {}): Tree => {
  if (!lstatOrNull(dir)) return out;
  for (const e of readdirSync(dir).sort()) {
    const p = path.join(dir, e);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) out[p] = "-> " + readlinkSync(p);
    else if (st.isDirectory()) { out[p] = "dir"; snapshot(p, out); }
    else out[p] = readFileSync(p, "utf8");
  }
  return out;
};

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "kioku-linux-inst-")));
  const home = path.join(root, "home"), tmp = path.join(root, "tmp"), bin = path.join(root, "bin"), serve = path.join(root, "serve");
  const log = path.join(root, "calls.log");
  for (const d of [home, tmp, bin, serve]) mkdirSync(d, { recursive: true });

  const installDir = path.join(home, ".local/share/kioku");
  const binDir = path.join(home, ".local/bin");

  // Fake Node tarball (for cases where system node is absent or < 24)
  const nodePack = path.join(root, "pack", "node-v24.1.0");
  write(path.join(nodePack, "bin", "node"), sh('[ "$1" = --version ] && { echo "${FAKE_NODE_VERSION:-v24.1.0}"; exit 0; }\nexport FAKE_INVOKED_NODE="$0"\nexec "$FAKE_REAL_NODE" "$@"\n'), 0o755);
  write(path.join(nodePack, "bin", "npm"), sh('echo "npm $* cache=$npm_config_cache cwd=$(basename "$(pwd)")" >> "$FAKE_LOG"\n[ "$FAKE_NPM_FAIL" != "$1" ]\n'), 0o755);
  write(path.join(nodePack, "LICENSE"), NODE_LICENSE);
  const tgz = path.join(serve, "node-v24.1.0-linux-x64.tar.gz");
  assert.equal(spawnSync("tar", ["-czf", tgz, "-C", path.dirname(nodePack), "node-v24.1.0"]).status, 0);
  copyFileSync(tgz, path.join(serve, "node-v24.1.0-linux-arm64.tar.gz"));
  const sum = createHash("sha256").update(readFileSync(tgz)).digest("hex");
  write(path.join(serve, "SHASUMS256.txt"), `${sum}  node-v24.1.0-linux-x64.tar.gz\n${sum}  node-v24.1.0-linux-arm64.tar.gz\n`);

  // Fake Kioku source tarball matching real bin/kioku contract
  const srcPack = path.join(root, "pack", "kioku-main");
  write(path.join(srcPack, "package.json"), JSON.stringify({ name: "kioku", version: "0.8.0" }));
  write(path.join(srcPack, "bin", "kioku"), readFileSync(path.resolve("bin/kioku"), "utf8"), 0o755);
  write(path.join(srcPack, "src", "cli", "main.ts"), 'console.log("CLI:" + process.argv.slice(2).join(" ") + "|exec:" + (process.env.FAKE_INVOKED_NODE || process.execPath));\n');
  assert.equal(spawnSync("tar", ["-czf", path.join(serve, "source.tar.gz"), "-C", path.dirname(srcPack), "kioku-main"]).status, 0);

  // Fake macOS delegated script for raw.githubusercontent download tests
  write(path.join(serve, "install-macos.command"), sh('echo "macos-delegate ref=$KIOKU_REF yes=${KIOKU_INSTALL_YES:-} no_open=${KIOKU_INSTALL_NO_OPEN:-} args=$*" >> "$FAKE_LOG"\n'), 0o755);

  const fakes: Record<string, string> = {
    uname: sh('case "$1" in -s) echo "${FAKE_UNAME_S:-Linux}";; -m) echo "${FAKE_UNAME_M:-x86_64}";; esac\n'),
    shasum: sh('for t in /usr/bin/shasum /usr/bin/core_perl/shasum; do [ -x "$t" ] && exec "$t" "$@"; done\nexec "$FAKE_REAL_NODE" -e "const fs=require(\'fs\'),c=require(\'crypto\');const f=process.argv.at(-1);console.log(c.createHash(\'sha256\').update(fs.readFileSync(f)).digest(\'hex\')+\'  \'+f);" "$@"\n'),
    systemctl: sh('echo "systemctl $*" >> "$FAKE_LOG"\n[ "$FAKE_SYSTEMCTL_FAIL" != 1 ]\n'),
    sudo: sh('echo "PROHIBIDO sudo $*" >> "$FAKE_LOG"\n'),
    mv: sh(`case "$1" in
  *kioku-linux-stage*/kioku) [ "$FAKE_MV_FAIL" = place ] && exit 1;;
  */.local/share/kioku) [ "$FAKE_MV_FAIL" = backup ] && exit 1;;
esac
for t in /usr/bin/mv /bin/mv; do [ -x "$t" ] && exec "$t" "$@"; done
echo "mv no disponible" >&2; exit 127
`),
    curl: sh(`out=""; url=""
while [ "$#" -gt 0 ]; do case "$1" in -o) out="$2"; shift;; https://*) url="$1";; esac; shift; done
echo "curl $url" >> "$FAKE_LOG"
case "$url" in
  */SHASUMS256.txt) [ "$FAKE_CURL_FAIL" = shasums ] && exit 22; src=SHASUMS256.txt;;
  https://nodejs.org/*) [ "$FAKE_CURL_FAIL" = node ] && exit 22; src="\${url##*/}";;
  https://codeload.github.com/*) [ "$FAKE_CURL_FAIL" = source ] && exit 22; src=source.tar.gz;;
  https://raw.githubusercontent.com/*/scripts/install-macos.command) [ "$FAKE_CURL_FAIL" = macos ] && exit 22; src=install-macos.command;;
  *) exit 6;;
esac
[ -n "$out" ] && cp "$FAKE_SERVE/$src" "$out" || cat "$FAKE_SERVE/$src"
[ "$FAKE_CORRUPT" = 1 ] && case "$src" in node-*) [ -n "$out" ] && echo corrupto >> "$out";; esac
exit 0
`),
  };
  for (const [name, body] of Object.entries(fakes)) write(path.join(bin, name), body, 0o755);

  const run = (o: { args?: string[]; input?: string; env?: Record<string, string>; script?: string; pathWithNode?: boolean; pipe?: boolean } = {}) => {
    const sysNodeDir = path.join(root, "sysnode");
    const oldNodeDir = path.join(root, "oldnode");
    if (o.pathWithNode !== false && !existsSync(path.join(sysNodeDir, "node"))) {
      write(path.join(sysNodeDir, "node"), sh('[ "$1" = --version ] && { echo "${FAKE_SYS_NODE_VERSION:-v24.5.0}"; exit 0; }\nexec "$FAKE_REAL_NODE" "$@"\n'), 0o755);
      write(path.join(sysNodeDir, "npm"), sh('echo "npm $* cache=$npm_config_cache cwd=$(basename "$(pwd)")" >> "$FAKE_LOG"\n[ "$FAKE_NPM_FAIL" != "$1" ]\n'), 0o755);
    }
    if (o.pathWithNode === false && !existsSync(path.join(oldNodeDir, "node"))) {
      write(path.join(oldNodeDir, "node"), sh('echo "v22.0.0"\n'), 0o755);
    }
    const basePath = o.pathWithNode === false ? `${bin}:${oldNodeDir}:/usr/bin:/bin` : `${bin}:${sysNodeDir}:/usr/bin:/bin`;
    const env = { PATH: basePath, HOME: home, TMPDIR: tmp, FAKE_LOG: log, FAKE_SERVE: serve, FAKE_REAL_NODE: process.execPath, ...o.env };
    if (o.pipe) {
      return spawnSync("/bin/bash", ["-s", "--", ...(o.args ?? [])], {
        encoding: "utf8", input: readFileSync(o.script ?? installScript, "utf8"), timeout: 60_000, env,
      });
    }
    return spawnSync("/bin/bash", [o.script ?? installScript, ...(o.args ?? [])], {
      encoding: "utf8", input: o.input ?? "", timeout: 60_000, env,
    });
  };
  const calls = () => existsSync(log) ? readFileSync(log, "utf8") : "";
  const seedVault = () => write(path.join(home, "Documents/Kioku/nota.md"), "# personal\n");
  return { root, home, tmp, bin, serve, installDir, binDir, run, calls, seedVault, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const withFixture = (fn: (f: ReturnType<typeof fixture>) => void) => { const f = fixture(); try { fn(f); } finally { f.cleanup(); } };

test("install.sh --help funciona sin red y rechaza opciones desconocidas", () => withFixture((f) => {
  assert.ok(statSync(installScript).mode & 0o100, "scripts/install.sh debe ser ejecutable");
  const r = f.run({ args: ["--help"] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  for (const key of ["--yes", "--no-open", "--no-service", "KIOKU_REF", "KIOKU_REPO", "KIOKU_INSTALL_DIR", "KIOKU_BIN_DIR"]) {
    assert.ok(r.stdout.includes(key), `falta ${key}`);
  }
  assert.equal(f.calls(), "");
  const bad = f.run({ args: ["--desconocida"] });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Opción desconocida/);
}));

test("install.sh en macOS delega al instalador macOS tanto en modo piped como en copia local", () => withFixture((f) => {
  const standalone = path.join(f.root, "standalone.sh");
  copyFileSync(installScript, standalone);
  chmodSync(standalone, 0o755);
  const piped = f.run({ script: standalone, pipe: true, args: ["--yes", "--no-open"], env: { FAKE_UNAME_S: "Darwin", KIOKU_REF: "main" } });
  assert.equal(piped.status, 0, piped.stderr);
  assert.ok(f.calls().includes("curl https://raw.githubusercontent.com/EzequielMenor/kioku/main/scripts/install-macos.command"));
  assert.ok(f.calls().includes("macos-delegate ref=main yes=1 no_open=1"));
  assert.deepEqual(readdirSync(f.tmp), []);
}));

test("install.sh en Linux instala con Node del sistema, crea enlace en ~/.local/bin, configura servicio con --yes y abre /conexiones", () => withFixture((f) => {
  f.seedVault();
  const vaultBefore = snapshot(path.join(f.home, "Documents"));
  const r = f.run({ args: ["--yes"] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Listo:/);
  assert.equal(readlinkSync(path.join(f.binDir, "kioku")), path.join(f.installDir, "bin/kioku"));
  assert.ok(f.calls().includes("curl https://codeload.github.com/EzequielMenor/kioku/tar.gz/main"));
  assert.ok(f.calls().includes("npm ci --silent"));
  assert.ok(f.calls().includes("npm run build:web --silent"));
  assert.doesNotMatch(f.calls(), /nodejs\.org/, "no descarga Node si el del sistema es >= 24");
  assert.doesNotMatch(f.calls(), /PROHIBIDO/);
  assert.equal(existsSync(path.join(f.home, ".npm")), false);
  assert.deepEqual(readdirSync(f.tmp), []);
  assert.deepEqual(snapshot(path.join(f.home, "Documents")), vaultBefore, "nunca toca la bóveda");
  // Verifica que el binario enlazado ejecuta `service install` y `open /conexiones`
  assert.match(r.stdout, /CLI:open \/conexiones/);
}));

test("install.sh en Linux descarga y verifica Node 24 privado si falta en el sistema", () => withFixture((f) => {
  const r = f.run({ pathWithNode: false, args: ["--no-open", "--no-service"] });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(f.calls().includes("curl https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt"));
  assert.ok(f.calls().includes("curl https://nodejs.org/dist/latest-v24.x/node-v24.1.0-linux-x64.tar.gz"));
  assert.equal(readFileSync(path.join(f.installDir, "runtime/LICENSE"), "utf8"), NODE_LICENSE);
  const runCli = spawnSync(path.join(f.binDir, "kioku"), ["status"], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", FAKE_REAL_NODE: process.execPath },
  });
  assert.equal(runCli.status, 0, runCli.stderr);
  assert.match(runCli.stdout, /CLI:status\|exec:.*\/\.local\/share\/kioku\/runtime\/bin\/node/);
}));

test("install.sh falla cerrado si el checksum de Node no coincide o si falla colocar actualización y restaura la versión previa", () => withFixture((f) => {
  const corrupt = f.run({ pathWithNode: false, args: ["--no-open", "--no-service"], env: { FAKE_CORRUPT: "1" } });
  assert.equal(corrupt.status, 1);
  assert.match(corrupt.stderr, /el checksum de Node no coincide/);
  assert.equal(existsSync(f.installDir), false);

  // Instala una versión previa válida y luego fuerza fallo al colocar la nueva
  assert.equal(f.run({ args: ["--no-open", "--no-service"] }).status, 0);
  write(path.join(f.installDir, "marker.txt"), "previa\n");
  const failedPlace = f.run({ args: ["--yes", "--no-open", "--no-service"], env: { FAKE_MV_FAIL: "place" } });
  assert.equal(failedPlace.status, 1);
  assert.equal(readFileSync(path.join(f.installDir, "marker.txt"), "utf8"), "previa\n");
  assert.deepEqual(readdirSync(f.tmp), []);
}));

test("install.sh rechaza enlaces simbólicos en el destino de instalación", () => withFixture((f) => {
  const outside = path.join(f.root, "externo");
  write(path.join(outside, "algo.txt"), "intacto\n");
  mkdirSync(path.dirname(f.installDir), { recursive: true });
  symlinkSync(outside, f.installDir);
  const r = f.run({ args: ["--yes", "--no-open", "--no-service"] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /enlace simbólico/);
  assert.equal(readFileSync(path.join(outside, "algo.txt"), "utf8"), "intacto\n");
}));
