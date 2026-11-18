import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { Devices } from "../src/server/devices.ts";
import { loadOrCreateCompanionKey, loadOrCreateKey } from "../src/server/key.ts";
import { startServer } from "../src/server/server.ts";
import { extractCommitFromTarGz, readBuildInfo } from "../src/server/build-info.ts";
import { parseCommitsAtom, UpdateManager, type UpdateRunner } from "../src/server/updates.ts";
import { WEB, browserSkip, launch, until } from "./cdp.ts";
import { tmpVault } from "./helpers.ts";

const SHA_OLD = "1111111111111111111111111111111111111111";
const SHA_NEW = "2222222222222222222222222222222222222222";

function makePaxTarGz(commentSha?: string): Buffer {
  const blocks: Buffer[] = [];
  if (commentSha) {
    const payload = `52 comment=${commentSha}\n`;
    const hdr = Buffer.alloc(512, 0);
    hdr.write("pax_global_header", 0);
    hdr.write("0000666\0", 100);
    hdr.write(payload.length.toString(8).padStart(11, "0") + "\0", 124);
    hdr.write("g", 156);
    hdr.write("ustar\0", 257);
    hdr.write("00", 263);
    blocks.push(hdr);
    const data = Buffer.alloc(512, 0);
    data.write(payload, 0);
    blocks.push(data);
  }
  const fileHdr = Buffer.alloc(512, 0);
  fileHdr.write("kioku-main/README.md", 0);
  fileHdr.write("0", 124);
  fileHdr.write("0", 156);
  blocks.push(fileHdr, Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
}

const ATOM_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Recent Commits to kioku:main</title>
  <entry>
    <id>tag:github.com,2008:Grit::Commit/${SHA_NEW}</id>
    <link type="text/html" rel="alternate" href="https://github.com/EzequielMenor/kioku/commit/${SHA_NEW}"/>
    <title>
        feat: mejoras en Kio &amp; &quot;actualizador&quot;
    </title>
    <updated>2026-11-15T19:00:00Z</updated>
  </entry>
</feed>`;

test("extractCommitFromTarGz lee el SHA del pax_global_header y devuelve null si no existe", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kioku-tar-"));
  try {
    const withSha = path.join(dir, "with.tar.gz");
    writeFileSync(withSha, makePaxTarGz(SHA_NEW));
    assert.equal(extractCommitFromTarGz(withSha), SHA_NEW);

    const noSha = path.join(dir, "plain.tar.gz");
    writeFileSync(noSha, makePaxTarGz());
    assert.equal(extractCommitFromTarGz(noSha), null);

    const missing = path.join(dir, "missing.tar.gz");
    assert.equal(extractCommitFromTarGz(missing), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readBuildInfo lee build-info.json cuando existe o resuelve .git/HEAD y packed-refs", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kioku-binfo-"));
  try {
    const appDir = path.join(dir, "app");
    mkdirSync(appDir, { recursive: true });
    writeFileSync(path.join(appDir, "package.json"), JSON.stringify({ name: "kioku", version: "0.8.0" }));
    writeFileSync(path.join(appDir, "build-info.json"), JSON.stringify({
      version: "0.8.0", commit: SHA_OLD, ref: "main", repo: "EzequielMenor/kioku", channel: "macos-app", installedAt: "2026-11-15T18:00:00Z",
    }));
    const stamped = readBuildInfo(appDir, { inDocker: false });
    assert.equal(stamped.commit, SHA_OLD);
    assert.equal(stamped.shortCommit, SHA_OLD.slice(0, 7));
    assert.equal(stamped.channel, "macos-app");
    assert.equal(stamped.version, "0.8.0");

    const gitDir = path.join(dir, "gitrepo");
    mkdirSync(path.join(gitDir, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(path.join(gitDir, "package.json"), JSON.stringify({ name: "kioku", version: "0.8.1" }));
    writeFileSync(path.join(gitDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(path.join(gitDir, ".git", "packed-refs"), `${SHA_NEW} refs/heads/main\n`);
    const gitInfo = readBuildInfo(gitDir, { inDocker: false });
    assert.equal(gitInfo.channel, "git");
    assert.equal(gitInfo.commit, SHA_NEW);
    assert.equal(gitInfo.version, "0.8.1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseCommitsAtom extrae sha, titulo desenmascarado, fecha y url del feed de GitHub", () => {
  const parsed = parseCommitsAtom(ATOM_SAMPLE);
  assert.deepEqual(parsed, {
    commit: SHA_NEW,
    shortCommit: SHA_NEW.slice(0, 7),
    title: 'feat: mejoras en Kio & "actualizador"',
    date: "2026-11-15T19:00:00Z",
    url: `https://github.com/EzequielMenor/kioku/commit/${SHA_NEW}`,
  });
  assert.throws(() => parseCommitsAtom("<feed></feed>"), /No se encontró/);
});

test("UpdateManager detecta actualizaciones, respeta caché TTL y ejecuta instalación con reinicio", async () => {
  const { root, cleanup } = tmpVault();
  const appRoot = path.join(root, "fake-app");
  mkdirSync(appRoot, { recursive: true });
  writeFileSync(path.join(appRoot, "build-info.json"), JSON.stringify({
    version: "0.8.0", commit: SHA_OLD, ref: "main", repo: "EzequielMenor/kioku", channel: "linux-install", installDir: appRoot, binDir: path.join(root, "bin"), installedAt: "2026-11-15T10:00:00Z",
  }));

  let fetches = 0;
  let clock = 1_000_000;
  const runCalls: { args: string[]; env: Record<string, string | undefined> }[] = [];
  let restarted = 0;
  const runner: UpdateRunner = async (req) => {
    runCalls.push({ args: req.args, env: req.env });
    return { ok: true };
  };

  try {
    const mgr = new UpdateManager({
      home: root,
      appRoot,
      now: () => clock,
      cacheTtlMs: 60_000,
      fetcher: async () => {
        fetches++;
        return new Response(ATOM_SAMPLE, { status: 200, headers: { "content-type": "application/atom+xml" } });
      },
      runner,
      onRestart: () => { restarted++; },
      restartDelayMs: 0,
    });

    const first = await mgr.checkNow();
    assert.equal(fetches, 1);
    assert.equal(first.updateAvailable, true);
    assert.equal(first.installed.commit, SHA_OLD);
    assert.equal(first.latest?.commit, SHA_NEW);
    assert.equal(first.canAutoUpdate, true);

    // Dentro de TTL, status() no vuelve a llamar a la red.
    clock += 10_000;
    const cached = await mgr.status();
    assert.equal(fetches, 1);
    assert.equal(cached.updateAvailable, true);

    // Al expirar TTL, status() sí refresca en primer plano/síncrono o queda actualizado tras esperar check.
    clock += 120_000;
    await mgr.status();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(fetches, 2);

    // Instalación con éxito: llama runner con env seguro y dispara onRestart.
    await mgr.startInstall();
    await mgr.waitIdle();
    assert.equal(runCalls.length, 1);
    assert.equal(runCalls[0].env.KIOKU_INSTALL_YES, "1");
    assert.equal(runCalls[0].env.KIOKU_INSTALL_NO_OPEN, "1");
    assert.equal(runCalls[0].env.KIOKU_INSTALL_NO_SERVICE, "1");
    assert.equal(runCalls[0].env.KIOKU_INSTALL_DIR, appRoot);
    assert.equal(restarted, 1);
    assert.equal(mgr.snapshot().phase, "restarting");
  } finally {
    cleanup();
  }
});

test("UpdateManager maneja fallo del instalador sin reiniciar y bloquea auto-actualización en checkout git", async () => {
  const { root, cleanup } = tmpVault();
  const gitRoot = path.join(root, "git-app");
  mkdirSync(path.join(gitRoot, ".git", "refs", "heads"), { recursive: true });
  writeFileSync(path.join(gitRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(path.join(gitRoot, ".git", "refs", "heads", "main"), SHA_OLD + "\n");

  const linuxRoot = path.join(root, "linux-app");
  mkdirSync(linuxRoot, { recursive: true });
  writeFileSync(path.join(linuxRoot, "build-info.json"), JSON.stringify({
    version: "0.8.0", commit: SHA_OLD, ref: "main", repo: "EzequielMenor/kioku", channel: "linux-install", installDir: linuxRoot, installedAt: "2026-11-15T10:00:00Z",
  }));

  try {
    const gitMgr = new UpdateManager({ home: root, appRoot: gitRoot, autoCheck: false });
    assert.equal(gitMgr.snapshot().canAutoUpdate, false);
    await assert.rejects(() => gitMgr.startInstall(), /código fuente/i);

    let restarted = 0;
    const failMgr = new UpdateManager({
      home: root,
      appRoot: linuxRoot,
      autoCheck: false,
      fetcher: async () => new Response(ATOM_SAMPLE, { status: 200 }),
      runner: async () => ({ ok: false, error: "falló la descarga simulada" }),
      onRestart: () => { restarted++; },
    });
    await failMgr.startInstall();
    await failMgr.waitIdle();
    assert.equal(restarted, 0);
    assert.equal(failMgr.snapshot().phase, "error");
    assert.match(failMgr.snapshot().error ?? "", /falló la descarga simulada/);
  } finally {
    cleanup();
  }
});

test("API /api/update/* restringida a escritorio local: móvil y compañero reciben 403", async () => {
  const { root, cleanup } = tmpVault();
  const web = mkdtempSync(path.join(os.tmpdir(), "kioku-upd-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  const appRoot = path.join(root, "app");
  mkdirSync(appRoot, { recursive: true });
  writeFileSync(path.join(appRoot, "build-info.json"), JSON.stringify({
    version: "0.8.0", commit: SHA_OLD, ref: "main", repo: "EzequielMenor/kioku", channel: "macos-app", installedAt: "2026-11-15T10:00:00Z",
  }));

  let installs = 0;
  const j = await Kioku.open({ root });
  const updates = new UpdateManager({
    home: root,
    appRoot,
    autoCheck: false,
    fetcher: async () => new Response(ATOM_SAMPLE, { status: 200 }),
    runner: async () => { installs++; return { ok: true }; },
    onRestart: () => {},
    restartDelayMs: 0,
  });
  const key = loadOrCreateKey(root);
  const compKey = loadOrCreateCompanionKey(root);
  const srv = await startServer(j, { port: 0, webDir: web, key, updates, allowedHosts: ["phone.ts.net"] });
  const devs = new Devices(root);
  const { key: mobKey } = devs.redeem(devs.enrollment().token, "iPhone");

  try {
    const req = (p: string, method: string, k: string, host?: string, body?: unknown) =>
      new Promise<{ status: number; json: <T>() => Promise<T> }>((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : "";
        const r = http.request({
          hostname: "127.0.0.1", port: srv.port, path: p, method,
          headers: {
            "x-kioku-key": k,
            ...(host ? { host } : {}),
            ...(body ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}),
          },
        }, (res) => {
          let out = "";
          res.on("data", (d) => { out += d; });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: async () => JSON.parse(out) }));
        });
        r.on("error", reject);
        if (payload) r.write(payload);
        r.end();
      });

    assert.equal((await req("/api/update/status", "GET", mobKey)).status, 403);
    assert.equal((await req("/api/update/check", "POST", mobKey)).status, 403);
    assert.equal((await req("/api/update/install", "POST", mobKey, undefined, { confirm: true })).status, 403);

    assert.equal((await req("/api/update/status", "GET", compKey)).status, 403);
    assert.equal((await req("/api/update/check", "POST", compKey)).status, 403);
    assert.equal((await req("/api/update/install", "POST", compKey, undefined, { confirm: true })).status, 403);

    // Host remoto con clave completa no puede disparar instalación local.
    assert.equal((await req("/api/update/install", "POST", key, "phone.ts.net", { confirm: true })).status, 403);
    // Sin confirm: true responde 400.
    assert.equal((await req("/api/update/install", "POST", key, undefined, {})).status, 400);
    assert.equal(installs, 0);

    // Escritorio local consulta, comprueba e instala.
    const checked = await req("/api/update/check", "POST", key, undefined, {});
    assert.equal(checked.status, 200);
    const data = await checked.json() as { updateAvailable: boolean; latest: { commit: string } };
    assert.equal(data.updateAvailable, true);
    assert.equal(data.latest.commit, SHA_NEW);

    const installed = await req("/api/update/install", "POST", key, undefined, { confirm: true });
    assert.equal(installed.status, 202);
    await updates.waitIdle();
    assert.equal(installs, 1);
  } finally {
    await srv.close(); j.close(); cleanup();
    rmSync(web, { recursive: true, force: true });
  }
});

test("build-macos-app.mjs graba build-info.json dentro de Kioku.app con commit y canal macos-app", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kioku-mac-stamp-"));
  try {
    const runtime = path.join(dir, "node");
    const hdr = Buffer.alloc(32);
    hdr.writeUInt32LE(0xfeedfacf, 0); hdr.writeUInt32LE(0x0100000c, 4); hdr.writeUInt32LE(2, 12);
    writeFileSync(runtime, hdr);
    const out = path.join(dir, "Kioku.app");
    const res = spawnSync(process.execPath, [path.resolve("scripts/build-macos-app.mjs"), "--node", runtime, "--output", out], {
      encoding: "utf8",
      env: { ...process.env, KIOKU_BUILD_COMMIT: SHA_NEW, KIOKU_BUILD_REF: "main", KIOKU_BUILD_REPO: "EzequielMenor/kioku" },
    });
    assert.equal(res.status, 0, res.stderr);
    const info = readBuildInfo(path.join(out, "Contents", "Resources", "app"), { inDocker: false });
    assert.equal(info.channel, "macos-app");
    assert.equal(info.commit, SHA_NEW);
    assert.equal(info.ref, "main");
    assert.equal(JSON.parse(readFileSync(path.join(out, "Contents", "Resources", "app", "package.json"), "utf8")).version, info.version);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("UI escritorio muestra aviso de actualización y ejecuta Actualizar ahora tras confirmar; móvil no lo ve", { skip: browserSkip, timeout: 60_000 }, async () => {
  const { root, cleanup } = tmpVault();
  const appRoot = path.join(root, "app");
  mkdirSync(appRoot, { recursive: true });
  writeFileSync(path.join(appRoot, "build-info.json"), JSON.stringify({
    version: "0.8.0", commit: SHA_OLD, ref: "main", repo: "EzequielMenor/kioku", channel: "macos-app", installedAt: "2026-11-15T10:00:00Z",
  }));

  let installs = 0;
  const j = await Kioku.open({ root });
  const updates = new UpdateManager({
    home: root,
    appRoot,
    autoCheck: false,
    fetcher: async () => new Response(ATOM_SAMPLE, { status: 200 }),
    runner: async () => { installs++; return { ok: true }; },
    onRestart: () => {},
    restartDelayMs: 50,
  });
  await updates.checkNow();
  const key = loadOrCreateKey(root);
  const srv = await startServer(j, { port: 0, webDir: WEB, key, updates });
  const devs = new Devices(root);
  const { key: mobKey } = devs.redeem(devs.enrollment().token, "Tablet");
  const profile = mkdtempSync(path.join(os.tmpdir(), "kioku-upd-browser-"));
  let p: Awaited<ReturnType<typeof launch>> | undefined;

  try {
    p = await launch(profile);
    const page = p;

    // 1) En sesión móvil no existe ni banner ni tarjeta de actualizaciones.
    await page.send("Network.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
    await page.send("Page.navigate", { url: `${srv.url}/?k=${mobKey}#/conexiones` });
    await until(() => page.ev<boolean>(`!!document.querySelector('.connections') && localStorage.getItem('role') === 'mobile'`), "pantalla conexiones móvil");
    assert.equal(await page.ev<boolean>(`!!document.querySelector('.updatebar, [data-updates-panel]')`), false);

    // 2) En escritorio muestra banner + tarjeta, pide confirmación y avanza a reinicio.
    await page.send("Network.clearBrowserCookies");
    await page.send("Emulation.clearDeviceMetricsOverride");
    await page.ev(`localStorage.clear(); sessionStorage.clear();`);
    await page.send("Page.navigate", { url: `${srv.url}/?k=${key}#/hoy` });
    await until(() => page.ev<boolean>(`!!document.querySelector('.updatebar .primary')`), "banner de actualización en escritorio");
    assert.match(await page.ev<string>(`document.querySelector('.updatebar').textContent`), /2222222/);

    await page.ev(`location.hash = '/conexiones'`);
    await until(() => page.ev<boolean>(`!!document.querySelector('[data-updates-panel] .primary')`), "tarjeta de actualizaciones en Conexiones");
    assert.match(await page.ev<string>(`document.querySelector('[data-updates-panel]').textContent`), /Hay una actualización disponible/);

    await page.ev(`document.querySelector('[data-updates-panel] .primary').click()`);
    await until(() => page.ev<boolean>(`!!document.querySelector('[role=alertdialog] .primary')`), "diálogo de confirmación");
    await page.ev(`document.querySelector('[role=alertdialog] .primary').click()`);
    await until(() => page.ev<boolean>(`document.body.textContent.includes('Reiniciando Kioku')`), "estado de reinicio tras instalar");
    assert.equal(installs, 1);
  } finally {
    await p?.close();
    await srv.close(); j.close(); cleanup();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
