import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exportVault, restoreVault } from "../src/core/portability.ts";
import { tmpVault } from "./helpers.ts";

test("export: incluye la memoria de Hermes pero no credenciales, cachés ni logs", async () => {
  const v = tmpVault({
    "Notas/A.md": "hola\n",
    ".jarvis/hermes/memories/USER.md": "Prefiere respuestas breves.",
    ".jarvis/hermes/SOUL.md": "# soul",
    ".jarvis/hermes/auth.json": "{\"token\":\"SECRETO\"}",
    ".jarvis/hermes/auth.lock": "",
    ".jarvis/hermes/logs/agent.log": "ruido",
    ".jarvis/hermes/cache/x.bin": "ruido",
  });
  const out = mkdtempSync(path.join(tmpdir(), "jarvis-exp-"));
  try {
    const archive = path.join(out, "b.tar.gz");
    exportVault(v.root, archive);
    const dest = path.join(out, "restaurado");
    await restoreVault(archive, dest);
    const root = path.join(dest, path.basename(v.root));
    const at = (rel: string) => existsSync(path.join(existsSync(path.join(dest, "Notas")) ? dest : root, rel));
    assert.ok(at("Notas/A.md"));
    assert.ok(at(".jarvis/hermes/memories/USER.md"));
    assert.ok(!at(".jarvis/hermes/auth.json"), "las credenciales no viajan en backups");
    assert.ok(!at(".jarvis/hermes/auth.lock"));
    assert.ok(!at(".jarvis/hermes/logs/agent.log"));
    assert.ok(!at(".jarvis/hermes/cache/x.bin"));
    assert.equal(readFileSync(path.join(existsSync(path.join(dest, "Notas")) ? dest : root, ".jarvis/hermes/memories/USER.md"), "utf8"), "Prefiere respuestas breves.");
  } finally { v.cleanup(); rmSync(out, { recursive: true, force: true }); }
});
