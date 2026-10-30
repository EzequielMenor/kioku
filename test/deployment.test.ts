import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");
const compose = () => parse(read("compose.dokploy.yml"));

test("deployment: existing daemon stays on loopback behind a private userspace sidecar", () => {
  const c = compose();
  assert.equal(c.services.kioku.network_mode, "service:tailscale");
  assert.equal(c.services.tailscale.environment.TS_USERSPACE, "true");
  assert.equal(c.services.tailscale.environment.TS_AUTH_ONCE, "true");
  assert.match(c.services.kioku.environment.KIOKU_ALLOWED_HOSTS, /\$\{KIOKU_ALLOWED_HOSTS:\?/);
  assert.equal(c.services.kioku.environment.KIOKU_PORT, "47800");
  assert.deepEqual(c.services.kioku.command, ["node", "src/cli/main.ts", "daemon"]);
  for (const service of Object.values(c.services) as Record<string, any>[]) {
    assert.equal(service.ports, undefined, "no host ports, even randomly allocated ones");
    assert.equal(service.privileged, undefined);
    assert.equal(service.cap_add, undefined);
    assert.equal(service.devices, undefined);
    assert.notEqual(service.network_mode, "host");
    assert.equal(service.labels["traefik.enable"], "false");
  }
  assert.doesNotMatch(read("compose.dokploy.yml"), /funnel/i);
});

test("deployment: user data and tailnet identity survive container recreation", () => {
  const c = compose();
  assert.equal(c.services.kioku.environment.KIOKU_HOME, "/data");
  assert.deepEqual(c.services.kioku.volumes, ["kioku-data:/data"]);
  assert.equal(c.services.tailscale.environment.TS_STATE_DIR, "/var/lib/tailscale");
  assert.deepEqual(c.services.tailscale.volumes, ["tailscale-state:/var/lib/tailscale"]);
  assert.deepEqual(Object.keys(c.volumes).sort(), ["kioku-data", "tailscale-state"]);
  assert.equal(c.services.kioku.restart, "unless-stopped");
  assert.equal(c.services.tailscale.restart, "unless-stopped");
});

test("deployment: image builds UI and runs Node 24 as an unprivileged user without personal files", () => {
  const file = read("Dockerfile");
  assert.match(file, /FROM node:24-bookworm-slim AS build/);
  assert.match(file, /RUN npm ci/);
  assert.match(file, /RUN npm run build:web/);
  assert.match(file, /npm prune --omit=dev/);
  assert.match(file, /USER node/);
  assert.match(file, /COPY --from=build .*dist\/web/);
  assert.doesNotMatch(file, /COPY\s+\.\s/);
  const ignore = read(".dockerignore");
  assert.equal(ignore.split("\n")[0], "**");
  for (const entry of ["!package.json", "!package-lock.json", "!src/**", "!web/**", "!scripts/build-web.mjs"]) {
    assert.ok(ignore.split("\n").includes(entry), entry);
  }
  assert.doesNotMatch(ignore, /!.*(?:\.hermes|\.config|\.git|\.env|\.kioku)/);
});
