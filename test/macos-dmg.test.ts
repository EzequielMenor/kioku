import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/build-macos-dmg.mjs", import.meta.url));
const onMac = process.platform === "darwin";

function fixture(t: { after: (cleanup: () => void) => void }) {
  const root = mkdtempSync(join(process.cwd(), ".kioku dmg test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, "Kioku.app");
  const output = join(root, "Kioku Test.dmg");
  mkdirSync(join(app, "Contents"), { recursive: true });
  writeFileSync(join(app, "Contents", "Info.plist"), "fixture plist\n");
  return { root, app, output };
}

function build(app: string, output: string, env = process.env) {
  return spawnSync(process.execPath, [script, app, output], { encoding: "utf8", env });
}

test("the DMG builder never replaces an existing path, including a dangling link", (t) => {
  const { root, app, output } = fixture(t);
  writeFileSync(output, "previous image");
  const reject = (path: string) => {
    const result = build(app, path);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `Error: el destino ya existe: ${path}\n`);
  };
  reject(output);
  assert.equal(readFileSync(output, "utf8"), "previous image");
  const link = join(root, "linked.dmg");
  symlinkSync("missing.dmg", link);
  reject(link);
  assert.equal(readlinkSync(link), "missing.dmg");
  assert.deepEqual(readdirSync(root).sort(), ["Kioku Test.dmg", "Kioku.app", "linked.dmg"]);
});

test("a failed image build leaves no output or staging and preserves the app", { skip: !onMac }, (t) => {
  const { root, app, output } = fixture(t);
  const fakeTool = join(root, "hdiutil");
  writeFileSync(fakeTool, '#!/bin/bash\nfor output; do :; done\n: > "$output"\nexit 42\n', { mode: 0o755 });
  const result = build(app, output, { ...process.env, PATH: `${root}:${process.env.PATH}` });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Error: hdiutil terminó con código 42.\n");
  assert.deepEqual(readdirSync(root).sort(), ["Kioku.app", "hdiutil"]);
  assert.equal(readFileSync(join(app, "Contents", "Info.plist"), "utf8"), "fixture plist\n");
});

test("the mounted image contains Kioku.app and a Finder shortcut to Applications", {
  skip: !onMac || process.env.KIOKU_DMG_SMOKE !== "1",
}, (t) => {
  const { root, app, output } = fixture(t);
  const result = build(app, output);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout, `Imagen creada: ${output}\n`);
  assert.equal(result.stderr, "");
  const mountpoint = join(root, "mount");
  mkdirSync(mountpoint);
  execFileSync("hdiutil", ["verify", output]);
  execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mountpoint, output]);
  try {
    assert.deepEqual(readdirSync(mountpoint).filter((name) => !name.startsWith(".")).sort(), ["Applications", "Kioku.app"]);
    assert.equal(readlinkSync(join(mountpoint, "Applications")), "/Applications");
    assert.equal(readFileSync(join(mountpoint, "Kioku.app", "Contents", "Info.plist"), "utf8"), "fixture plist\n");
  } finally {
    execFileSync("hdiutil", ["detach", mountpoint]);
  }
});
