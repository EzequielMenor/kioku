import { test } from "node:test";
import assert from "node:assert/strict";
import { browserLaunch } from "../src/cli/browser-launch.ts";

test("Mac: abre el navegador del sistema sin buscar Chromium Linux ni crear su perfil", () => {
  const url = "http://127.0.0.1:47800/?k=test#/asistente";
  assert.deepEqual(browserLaunch(url, () => { throw new Error("No se debe ejecutar en Mac"); }, "darwin"), { bin: "/usr/bin/open", args: [url] });
});

test("Linux: conserva exactamente el comando Chromium y su perfil", () => {
  const existing = { bin: "chromium", args: ["--app=http://localhost/", "--user-data-dir=/tmp/kioku", "--window-size=1280,820"] };
  assert.equal(browserLaunch("http://localhost/", () => existing, "linux"), existing);
});
