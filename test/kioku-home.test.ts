import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { kiokuHome } from "../src/cli/desktop.ts";

test("KIOKU_HOME vacío cuenta como no definido: nunca se adopta la carpeta actual como bóveda", () => {
  const def = path.join(os.homedir(), "Documents", "Kioku");
  assert.equal(kiokuHome({}), def);
  assert.equal(kiokuHome({ KIOKU_HOME: "" }), def);
  assert.equal(kiokuHome({ KIOKU_HOME: "  " }), def);
  assert.equal(kiokuHome({ KIOKU_HOME: "/tmp/v" }), "/tmp/v");
});
