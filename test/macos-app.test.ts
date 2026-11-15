import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync, symlinkSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.resolve("scripts/build-macos-app.mjs");
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("Mac packaging rejects linked source and recursive output before creating an app", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kioku-mac-inputs-"));
  try {
    const fixture = path.join(dir, "project");
    for (const name of ["scripts/build-macos-app.mjs", "scripts/native-macos.mjs", "src", "dist/web", "node_modules/yaml", "LICENSE"]) {
      mkdirSync(path.dirname(path.join(fixture, name)), { recursive: true });
      cpSync(path.resolve(name), path.join(fixture, name), { recursive: true });
    }
    const runtime = path.join(dir, "node");
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(0x0100000c, 4); bytes.writeUInt32LE(2, 12);
    writeFileSync(runtime, bytes);
    const build = (...args: string[]) => spawnSync(process.execPath, [path.join(fixture, "scripts/build-macos-app.mjs"), ...args], { encoding: "utf8" });
    const nested = path.join(fixture, "src", "Nested.app");
    const badOutput = build("--node", runtime, "--output", nested);
    assert.equal(badOutput.status, 1);
    assert.equal(badOutput.stdout, "");
    assert.equal(existsSync(nested), false, "no partial bundle on rejected output");
    assert.match(badOutput.stderr, /destino/);
    const secret = path.join(dir, "synthetic-secret.txt");
    writeFileSync(secret, "PRIVATE TEST MARKER");
    symlinkSync(secret, path.join(fixture, "src", "linked-secret"));
    const out = path.join(dir, "Kioku.app");
    const linked = build("--node", runtime, "--output", out);
    assert.equal(linked.status, 1);
    assert.equal(linked.stdout, "");
    assert.match(linked.stderr, /simbólico/);
    assert.equal(existsSync(out), false, "linked source must be rejected before writes");
    assert.equal(readFileSync(secret, "utf8"), "PRIVATE TEST MARKER");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Mac packaging explains its inputs without installing anything", () => {
  const r = run("--help");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--node/);
  assert.match(r.stdout, /sin firmar/);
  assert.equal(r.stderr, "");
});

test("Mac packaging rejects non-Mac runtime without creating output", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kioku-mac-"));
  try {
    const runtime = path.join(dir, "node");
    writeFileSync(runtime, "not a Mach-O runtime");
    const out = path.join(dir, "Kioku.app");
    const r = run("--node", runtime, "--output", out);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Mach-O/);
    assert.equal(r.stdout, "");
    assert.equal(existsSync(out), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Mac packaging creates an isolated app without source checkout state", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kioku-mac-"));
  try {
    const runtime = path.join(dir, "node");
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(0x0100000c, 4);
    header.writeUInt32LE(2, 12);
    writeFileSync(runtime, header);
    const out = path.join(dir, "Kioku.app");
    const r = run("--node", runtime, "--output", out);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /sin firmar/);
    const contents = path.join(out, "Contents");
    assert.match(readFileSync(path.join(contents, "Info.plist"), "utf8"), /Kioku/);
    assert.match(readFileSync(path.join(contents, "MacOS", "Kioku"), "utf8"), /runtime\/node/);
    const app = path.join(contents, "Resources", "app");
    assert.equal(existsSync(path.join(app, "src", "cli", "main.ts")), true);
    assert.equal(existsSync(path.join(app, "dist", "web", "index.html")), true);
    assert.equal(existsSync(path.join(app, "node_modules", "yaml", "package.json")), true);
    for (const name of [".git", ".kioku", "design", "test", ".kioku-local.env"]) {
      assert.equal(existsSync(path.join(app, name)), false, name);
    }
    const second = run("--node", runtime, "--output", out);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /existe/);
    assert.equal(second.stdout, "");
    assert.equal(readFileSync(path.join(contents, "Resources", "runtime", "node")).length, 32);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Mac packaging with --kio builds the native menu-bar app with Kio, its character and local-only networking", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kioku-mac-native-"));
  try {
    const macho = (name: string) => {
      const b = Buffer.alloc(64);
      b.writeUInt32LE(0xfeedfacf, 0); b.writeUInt32LE(0x0100000c, 4); b.writeUInt32LE(2, 12);
      const p = path.join(dir, name);
      writeFileSync(p, b);
      return p;
    };
    const runtime = macho("node");
    const kio = macho("Kioku-swift");
    const icon = path.join(dir, "Kioku.icns");
    writeFileSync(icon, "icns");
    const out = path.join(dir, "Kioku.app");
    const r = run("--node", runtime, "--output", out, "--kio", kio, "--icon", icon);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /nativa, con Kio/);
    const contents = path.join(out, "Contents");
    const plist = readFileSync(path.join(contents, "Info.plist"), "utf8");
    assert.match(plist, /<key>LSUIElement<\/key><true\/>/);
    assert.match(plist, /<key>CFBundleIdentifier<\/key><string>local\.kioku\.app<\/string>/);
    assert.match(plist, /NSAllowsLocalNetworking/);
    assert.match(plist, /<key>CFBundleIconFile<\/key><string>Kioku<\/string>/);
    assert.deepEqual(readFileSync(path.join(contents, "MacOS", "Kioku")), readFileSync(kio), "el ejecutable es el de Swift, no el lanzador de bash");
    assert.equal(statSync(path.join(contents, "MacOS", "Kioku")).mode & 0o111, 0o111);
    assert.deepEqual(JSON.parse(readFileSync(path.join(contents, "Resources", "character.json"), "utf8")), JSON.parse(readFileSync("companion/character.json", "utf8")));
    assert.ok(existsSync(path.join(contents, "Resources", "Kioku.icns")));
    assert.ok(existsSync(path.join(contents, "Resources", "app", "src", "cli", "launchd.ts")), "la CLI incluida sabe instalar launchd");
    assert.ok(existsSync(path.join(contents, "Resources", "runtime", "node")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Mac packaging rejects a --kio that is not a Mac executable", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kioku-mac-native-"));
  try {
    const runtime = path.join(dir, "node");
    const b = Buffer.alloc(32);
    b.writeUInt32LE(0xfeedfacf, 0); b.writeUInt32LE(0x0100000c, 4); b.writeUInt32LE(2, 12);
    writeFileSync(runtime, b);
    const kio = path.join(dir, "kio.sh");
    writeFileSync(kio, "#!/bin/sh\necho hola\n");
    const out = path.join(dir, "Kioku.app");
    const r = run("--node", runtime, "--output", out, "--kio", kio);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Mach-O/);
    assert.equal(existsSync(out), false);
    assert.equal(run("--node", runtime, "--output", out, "--icon", kio).status, 1, "--icon sin --kio no vale");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
