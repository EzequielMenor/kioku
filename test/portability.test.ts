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
    ".kioku/hermes/memories/USER.md": "Prefiere respuestas breves.",
    ".kioku/hermes/SOUL.md": "# soul",
    ".kioku/hermes/auth.json": "{\"token\":\"SECRETO\"}",
    ".kioku/hermes/auth.lock": "",
    ".kioku/hermes/logs/agent.log": "ruido",
    ".kioku/hermes/cache/x.bin": "ruido",
  });
  const out = mkdtempSync(path.join(tmpdir(), "kioku-exp-"));
  try {
    const archive = path.join(out, "b.tar.gz");
    exportVault(v.root, archive);
    const dest = path.join(out, "restaurado");
    await restoreVault(archive, dest);
    const root = path.join(dest, path.basename(v.root));
    const at = (rel: string) => existsSync(path.join(existsSync(path.join(dest, "Notas")) ? dest : root, rel));
    assert.ok(at("Notas/A.md"));
    assert.ok(at(".kioku/hermes/memories/USER.md"));
    assert.ok(!at(".kioku/hermes/auth.json"), "las credenciales no viajan en backups");
    assert.ok(!at(".kioku/hermes/auth.lock"));
    assert.ok(!at(".kioku/hermes/logs/agent.log"));
    assert.ok(!at(".kioku/hermes/cache/x.bin"));
    assert.equal(readFileSync(path.join(existsSync(path.join(dest, "Notas")) ? dest : root, ".kioku/hermes/memories/USER.md"), "utf8"), "Prefiere respuestas breves.");
  } finally { v.cleanup(); rmSync(out, { recursive: true, force: true }); }
});
