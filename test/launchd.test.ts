import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  APP_LABEL, DAEMON_LABEL, appAgent, daemonAgent, installLaunchd, launchdStatus, legacyAgents, plistXml, uninstallLaunchd,
  type LaunchdDeps,
} from "../src/cli/launchd.ts";

function fakeDeps(userHome: string, o: { loaded?: Set<string>; fail?: string } = {}) {
  const loaded = o.loaded ?? new Set<string>();
  const calls: string[][] = [];
  const killed: number[] = [];
  const deps: LaunchdDeps = {
    userHome, uid: 501,
    launchctl(args) {
      calls.push(args);
      if (o.fail && args[0] === o.fail) return { ok: false, out: "boom" };
      if (args[0] === "bootstrap") { loaded.add(path.basename(args[2], ".plist")); return { ok: true, out: "" }; }
      if (args[0] === "bootout") { const label = args[1].split("/").pop()!; const was = loaded.delete(label); return { ok: was, out: was ? "" : "No such process" }; }
      if (args[0] === "print") { const label = args[1].split("/").pop()!; return { ok: loaded.has(label), out: loaded.has(label) ? "state = running\npid = 123" : "" }; }
      return { ok: true, out: "" };
    },
    kill(pid) { killed.push(pid); },
    now: () => new Date("2026-11-15T10:20:30Z"),
  };
  return { deps, calls, loaded, killed };
}

test("launchd: el plist escapa XML y no deja inyectar claves", () => {
  const xml = plistXml({ Label: "local.kioku.daemon", ProgramArguments: ["/a b/node", "x<y>&\"z"], RunAtLoad: true, KeepAlive: { SuccessfulExit: false } });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<string>x&lt;y&gt;&amp;&quot;z<\/string>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml, /<key>SuccessfulExit<\/key>\s*<false\/>/);
  assert.doesNotMatch(xml, /x<y>/);
});

test("launchd: el agente del daemon usa el runtime y la bóveda indicados, solo en loopback y con log propio", () => {
  const a = daemonAgent({ home: "/Users/e/Documents/Kioku", node: "/Apps/Kioku.app/Contents/Resources/runtime/node", main: "/Apps/Kioku.app/Contents/Resources/app/src/cli/main.ts", userHome: "/Users/e", env: { KIOKU_ALLOWED_HOSTS: "mac.tail.ts.net", KIOKU_PUBLIC_HOST: "bad\nhost" } });
  assert.equal(a.label, DAEMON_LABEL);
  assert.equal(a.path, "/Users/e/Library/LaunchAgents/local.kioku.daemon.plist");
  assert.deepEqual(a.plist.ProgramArguments, ["/Apps/Kioku.app/Contents/Resources/runtime/node", "--no-warnings", "/Apps/Kioku.app/Contents/Resources/app/src/cli/main.ts", "daemon"]);
  const env = a.plist.EnvironmentVariables as Record<string, string>;
  assert.equal(env.KIOKU_HOME, "/Users/e/Documents/Kioku");
  assert.equal(env.KIOKU_PORT, "47800", "el puerto de siempre: tailscale serve sigue apuntando bien");
  assert.equal(env.KIOKU_ALLOWED_HOSTS, "mac.tail.ts.net");
  assert.equal(env.KIOKU_PUBLIC_HOST, undefined, "un valor con saltos de línea no se copia");
  assert.match(env.PATH, /\/opt\/homebrew\/bin/);
  assert.equal(a.plist.StandardOutPath, "/Users/e/Library/Logs/Kioku/daemon.log");
  assert.deepEqual(a.plist.KeepAlive, { SuccessfulExit: false }, "se relanza si cae, no si se detiene a propósito");
});

test("launchd: el agente de la app abre Kio al iniciar sesión, solo en la sesión gráfica", () => {
  const a = appAgent({ app: "/Users/e/Applications/Kioku.app", userHome: "/Users/e" });
  assert.equal(a.label, APP_LABEL);
  assert.deepEqual(a.plist.ProgramArguments, ["/Users/e/Applications/Kioku.app/Contents/MacOS/Kioku", "--login"]);
  assert.equal(a.plist.LimitLoadToSessionType, "Aqua");
  assert.equal(a.plist.ProcessType, "Interactive");
  assert.throws(() => appAgent({ app: "/Users/e/Kioku", userHome: "/Users/e" }), /\.app/);
});

test("launchd: detecta el LaunchAgent antiguo de Kioku y no instala encima sin permiso", () => {
  const home = mkdtempSync(path.join(tmpdir(), "kioku-launchd-"));
  try {
    const agents = path.join(home, "Library", "LaunchAgents");
    mkdirSync(agents, { recursive: true });
    writeFileSync(path.join(agents, "com.ezequiel.kioku-server.plist"), "<plist>kioku-server.sh run</plist>");
    writeFileSync(path.join(agents, "com.otra.cosa.plist"), "<plist/>");
    const { deps, loaded, calls } = fakeDeps(home, { loaded: new Set(["com.ezequiel.kioku-server"]) });
    assert.deepEqual(legacyAgents(deps).map((l) => [l.label, l.loaded]), [["com.ezequiel.kioku-server", true]]);
    const opts = { home: path.join(home, "Documents", "Kioku"), node: "/n", main: "/m.ts", env: {} };
    assert.throws(() => installLaunchd(opts, deps), /com\.ezequiel\.kioku-server[\s\S]*--replace-legacy/);
    assert.equal(calls.filter((c) => c[0] === "bootstrap").length, 0, "no se carga nada");
    assert.ok(loaded.has("com.ezequiel.kioku-server"), "el antiguo sigue intacto");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("launchd: --replace-legacy retira el antiguo guardando su plist y carga daemon y app", () => {
  const home = mkdtempSync(path.join(tmpdir(), "kioku-launchd-"));
  try {
    const agents = path.join(home, "Library", "LaunchAgents");
    mkdirSync(agents, { recursive: true });
    const legacy = path.join(agents, "com.ezequiel.kioku-server.plist");
    writeFileSync(legacy, "<plist>legacy</plist>");
    const { deps, loaded } = fakeDeps(home, { loaded: new Set(["com.ezequiel.kioku-server"]) });
    const log = installLaunchd({ home: path.join(home, "Documents", "Kioku"), node: "/n", main: "/m.ts", app: path.join(home, "Applications", "Kioku.app"), env: {}, replaceLegacy: true }, deps);
    assert.equal(existsSync(legacy), false, "ya no se carga al iniciar sesión");
    const kept = path.join(home, "Library", "Application Support", "Kioku", "legacy");
    const saved = readdirSync(kept);
    assert.equal(saved.length, 1);
    assert.equal(readFileSync(path.join(kept, saved[0]), "utf8"), "<plist>legacy</plist>", "se guarda tal cual para poder volver");
    assert.ok(!loaded.has("com.ezequiel.kioku-server"));
    assert.ok(loaded.has(DAEMON_LABEL) && loaded.has(APP_LABEL));
    assert.ok(existsSync(path.join(agents, "local.kioku.daemon.plist")) && existsSync(path.join(agents, "local.kioku.app.plist")));
    assert.ok(log.some((l) => /guardado/.test(l)));
    const st = launchdStatus(deps);
    assert.deepEqual([st.daemon.installed, st.daemon.loaded, st.app.installed, st.app.loaded, st.legacy.length], [true, true, true, true, 0]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("launchd: reinstalar recarga el agente y detiene antes un daemon lanzado a mano", () => {
  const home = mkdtempSync(path.join(tmpdir(), "kioku-launchd-"));
  try {
    const vault = path.join(home, "Documents", "Kioku");
    mkdirSync(path.join(vault, ".kioku"), { recursive: true });
    writeFileSync(path.join(vault, ".kioku", "runtime.json"), JSON.stringify({ pid: 4242, port: 47800 }));
    const { deps, calls, killed } = fakeDeps(home, { loaded: new Set([DAEMON_LABEL]) });
    installLaunchd({ home: vault, node: "/n", main: "/m.ts", env: {} }, deps);
    assert.deepEqual(killed, [], "si launchd ya lo gestiona, no se mata a mano: bootout lo para");
    const order = calls.map((c) => c[0]).filter((c) => c !== "print");
    assert.deepEqual(order, ["bootout", "bootstrap"]);
    const { deps: d2, killed: k2 } = fakeDeps(home);
    installLaunchd({ home: vault, node: "/n", main: "/m.ts", env: {} }, d2);
    assert.deepEqual(k2, [4242], "un daemon manual se detiene para que lo gestione launchd");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("launchd: si bootstrap falla se dice, y desinstalar descarga y borra solo lo nuestro", () => {
  const home = mkdtempSync(path.join(tmpdir(), "kioku-launchd-"));
  try {
    const { deps } = fakeDeps(home, { fail: "bootstrap" });
    assert.throws(() => installLaunchd({ home: path.join(home, "v"), node: "/n", main: "/m.ts", env: {} }, deps), /launchctl bootstrap.*boom/);
    const ok = fakeDeps(home);
    installLaunchd({ home: path.join(home, "v"), node: "/n", main: "/m.ts", app: "/A/Kioku.app", env: {} }, ok.deps);
    const agents = path.join(home, "Library", "LaunchAgents");
    writeFileSync(path.join(agents, "com.otra.cosa.plist"), "<plist/>");
    const log = uninstallLaunchd(ok.deps);
    assert.ok(log.length >= 2);
    assert.deepEqual(readdirSync(agents), ["com.otra.cosa.plist"]);
    assert.equal(ok.loaded.size, 0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
