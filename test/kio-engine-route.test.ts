import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { FakeEngine } from "../src/assistant/fake-engine.ts";
import { loadOrCreateMobileKey } from "../src/server/key.ts";
import { mobileAllowed } from "../src/server/mobile.ts";
import { tmpVault } from "./helpers.ts";

test("motor de Kio: el móvil puede saber qué modelo usa y si es local (para no avisar de más), y nada más del estado", async () => {
  assert.equal(mobileAllowed("GET", "/api/assistant/engine"), true);
  assert.equal(mobileAllowed("GET", "/api/assistant/state"), false, "el estado completo sigue siendo del escritorio");
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(os.tmpdir(), "kioku-engine-web-"));
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: web, key: "a".repeat(64), assistant: { engine: new FakeEngine() } });
  try {
    const r = await fetch(srv.url + "/api/assistant/engine", { headers: { "x-kioku-key": loadOrCreateMobileKey(root) } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { model: "motor de pruebas", local: true, origin: null });
  } finally { await srv.close(); j.close(); cleanup(); rmSync(web, { recursive: true, force: true }); }
});
