import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const appDelegate = readFileSync(new URL("../macos/Sources/Kioku/AppDelegate.swift", import.meta.url), "utf8");

test("the Mac menu opens the existing connection and devices screen inside Kioku", () => {
  assert.match(appDelegate, /add\(menu, "Dispositivos y actualizaciones…", #selector\(menuConnections\), ""\)/);
  assert.match(appDelegate, /@objc private func menuConnections\(\) \{ showWorkspace\(route: "\/conexiones"\) \}/);
});
