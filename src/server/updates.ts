// Comprobación periódica de actualizaciones en GitHub e instalación segura desde la interfaz de escritorio.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readBuildInfo, type BuildInfo } from "./build-info.ts";

export interface RemoteCommit {
  commit: string;
  shortCommit: string;
  title: string;
  date: string;
  url: string;
}

export type UpdatePhase = "idle" | "checking" | "installing" | "restarting" | "error";

export interface UpdateStatus {
  installed: BuildInfo;
  latest: RemoteCommit | null;
  checkedAt: string | null;
  updateAvailable: boolean;
  unknownInstalledCommit: boolean;
  canAutoUpdate: boolean;
  manualCommand: string;
  cannotAutoUpdateReason: string | null;
  phase: UpdatePhase;
  message: string | null;
  error: string | null;
}

export interface UpdateRunRequest {
  repo: string;
  ref: string;
  args: string[];
  env: Record<string, string | undefined>;
}

export type UpdateRunner = (req: UpdateRunRequest) => Promise<{ ok: boolean; error?: string }>;
export type UpdateFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class UpdateError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface CacheFile {
  checkedAt: number;
  repo: string;
  ref: string;
  latest: RemoteCommit;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const AUTO_POLL_MS = 6 * 60 * 60 * 1000;
const SHA_RE = /^[0-9a-f]{40}$/i;

function unescapeXml(s: string): string {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

/** Extrae el commit más reciente del feed Atom público de commits de GitHub (`commits/<ref>.atom`). */
export function parseCommitsAtom(xml: string): RemoteCommit {
  const entry = /<entry\b[^>]*>([\s\S]*?)<\/entry>/i.exec(xml)?.[1];
  if (!entry) throw new Error("No se encontró ninguna entrada en el feed de commits.");
  const idMatch = /<id[^>]*>[^<]*Grit::Commit\/([0-9a-f]{40})<\/id>/i.exec(entry);
  if (!idMatch) throw new Error("No se encontró el hash del commit en el feed.");
  const commit = idMatch[1].toLowerCase();
  const titleRaw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(entry)?.[1] ?? "";
  const dateRaw = /<updated[^>]*>([\s\S]*?)<\/updated>/i.exec(entry)?.[1] ?? "";
  const linkMatch = /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(entry);
  const title = unescapeXml(titleRaw).replace(/\s+/g, " ").trim() || commit.slice(0, 7);
  return {
    commit,
    shortCommit: commit.slice(0, 7),
    title,
    date: dateRaw.trim(),
    url: linkMatch ? unescapeXml(linkMatch[1]) : "",
  };
}

function parseRemoteResponse(text: string, repo: string): RemoteCommit {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const j = JSON.parse(trimmed) as Record<string, unknown>;
    const commitObj = j.commit && typeof j.commit === "object" ? (j.commit as Record<string, unknown>) : null;
    const sha = typeof j.sha === "string" ? j.sha : typeof j.commit === "string" ? j.commit : "";
    if (!SHA_RE.test(sha)) throw new Error("Respuesta de versión sin SHA válido.");
    const msg = typeof j.title === "string"
      ? j.title
      : typeof commitObj?.message === "string"
        ? commitObj.message.split(/\r?\n/, 1)[0]
        : sha.slice(0, 7);
    const committer = commitObj?.committer && typeof commitObj.committer === "object" ? (commitObj.committer as Record<string, unknown>) : null;
    const date = typeof j.date === "string" ? j.date : typeof committer?.date === "string" ? committer.date : "";
    const url = typeof j.url === "string" ? j.url : typeof j.html_url === "string" ? j.html_url : `https://github.com/${repo}/commit/${sha}`;
    return { commit: sha.toLowerCase(), shortCommit: sha.slice(0, 7).toLowerCase(), title: msg.trim(), date, url };
  }
  return parseCommitsAtom(trimmed);
}

function validateRepo(repo: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.includes("..")) throw new Error("Repositorio no válido.");
  return repo;
}

function validateRef(ref: string): string {
  if (!ref || !/^[A-Za-z0-9._/-]+$/.test(ref) || ref.includes("..") || ref.startsWith("-")) throw new Error("Rama o referencia no válida.");
  return ref;
}

function macAppBundleFromRoot(appRoot: string): string {
  const normalized = path.resolve(appRoot);
  const suffix = `${path.sep}Contents${path.sep}Resources${path.sep}app`;
  if (normalized.endsWith(suffix)) return path.resolve(normalized, "..", "..", "..");
  return path.join(os.homedir(), "Applications", "Kioku.app");
}

function defaultManualCommand(info: BuildInfo): string {
  if (info.channel === "docker") return "git pull && docker compose up -d --build";
  if (info.channel === "git" || info.channel === "source") return "git pull && npm ci && npm run build:web";
  return `curl -fsSL https://raw.githubusercontent.com/${info.repo}/${info.ref}/scripts/install.sh | bash -s -- --yes`;
}

function cannotAutoUpdateMessage(info: BuildInfo): string | null {
  if (info.channel === "macos-app" || info.channel === "linux-install") return null;
  if (info.channel === "docker") return "Kioku corre dentro de Docker: reconstruye el contenedor manualmente.";
  if (info.channel === "git") return "Instalación desde código fuente (git): actualiza manualmente para no tocar tu árbol de trabajo.";
  return "Instalación de origen desconocido: actualiza manualmente con git pull o el instalador oficial.";
}

async function runInstallerFromRemote(req: UpdateRunRequest, fetcher: UpdateFetcher): Promise<{ ok: boolean; error?: string }> {
  const repo = validateRepo(req.repo);
  const ref = validateRef(req.ref);
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/scripts/install.sh`;
  const tmp = mkdtempSync(path.join(os.tmpdir(), "kioku-self-update-"));
  const scriptPath = path.join(tmp, "install.sh");
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ok: false, error: `No se pudo descargar el instalador (HTTP ${res.status}).` };
    writeFileSync(scriptPath, await res.text(), { mode: 0o700 });
    return await new Promise((resolve) => {
      const child = spawn("/bin/bash", [scriptPath, ...req.args], {
        env: { ...process.env, ...req.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let err = "";
      let out = "";
      child.stdout?.on("data", (d) => { out = (out + String(d)).slice(-2000); });
      child.stderr?.on("data", (d) => { err = (err + String(d)).slice(-2000); });
      child.on("error", (e) => resolve({ ok: false, error: e.message }));
      child.on("close", (code) => {
        if (code === 0) return resolve({ ok: true });
        const detail = (err || out).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" · ");
        resolve({ ok: false, error: detail || `El instalador terminó con código ${code ?? "desconocido"}.` });
      });
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function performDefaultRestart(opts: {
  installed: BuildInfo;
  appRoot: string;
  shutdown?: () => Promise<void>;
}): Promise<void> {
  const { installed, appRoot, shutdown } = opts;
  if (installed.channel === "macos-app" || process.platform === "darwin") {
    const appPath = macAppBundleFromRoot(appRoot);
    // Espera a que termine este daemon antes de abrir el nuevo paquete, así native-macos arranca el nuevo servidor.
    const helper = [
      `pid="${process.pid}"`,
      `for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done`,
      `exec /usr/bin/open "$1"`,
    ].join("; ");
    const child = spawn("/bin/bash", ["-c", helper, "_", appPath], { detached: true, stdio: "ignore" });
    child.unref();
    await shutdown?.().catch(() => {});
    process.exit(0);
  }

  const systemdActive = spawnSync("systemctl", ["--user", "is-active", "--quiet", "kioku.service"]).status === 0;
  if (systemdActive) {
    const child = spawn("systemctl", ["--user", "restart", "kioku.service"], { detached: true, stdio: "ignore" });
    child.unref();
    return;
  }

  const installRoot = installed.installDir || appRoot;
  const binPath = path.join(installRoot, "bin", "kioku");
  await shutdown?.().catch(() => {});
  const cmd = existsSync(binPath) ? binPath : process.execPath;
  const args = existsSync(binPath) ? ["daemon"] : ["--no-warnings", path.join(installRoot, "src", "cli", "main.ts"), "daemon"];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", env: process.env });
  child.unref();
  process.exit(0);
}

export interface UpdateManagerOptions {
  home: string;
  appRoot: string;
  cacheTtlMs?: number;
  autoCheck?: boolean;
  pollIntervalMs?: number;
  restartDelayMs?: number;
  inDocker?: boolean;
  now?: () => number;
  fetcher?: UpdateFetcher;
  runner?: UpdateRunner;
  onEvent?: (status: UpdateStatus) => void;
  onRestart?: (installed: BuildInfo) => Promise<void> | void;
  onShutdown?: () => Promise<void>;
}

export class UpdateManager {
  private home: string;
  private appRoot: string;
  private cacheFile: string;
  private cacheTtlMs: number;
  private autoCheck: boolean;
  private restartDelayMs: number;
  private inDocker?: boolean;
  private now: () => number;
  private fetcher: UpdateFetcher;
  private runner: UpdateRunner;
  private onEvent?: (status: UpdateStatus) => void;
  private onRestart?: (installed: BuildInfo) => Promise<void> | void;
  private onShutdown?: () => Promise<void>;

  private installed: BuildInfo;
  private latest: RemoteCommit | null = null;
  private checkedAtMs: number | null = null;
  private phase: UpdatePhase = "idle";
  private message: string | null = null;
  private error: string | null = null;
  private checkPromise: Promise<UpdateStatus> | null = null;
  private installPromise: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private listeners = new Set<(status: UpdateStatus) => void>();

  constructor(opts: UpdateManagerOptions) {
    this.home = opts.home;
    this.appRoot = opts.appRoot;
    this.cacheFile = path.join(opts.home, ".kioku", "update-check.json");
    this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_TTL_MS;
    this.autoCheck = opts.autoCheck ?? true;
    this.restartDelayMs = opts.restartDelayMs ?? 350;
    this.inDocker = opts.inDocker;
    this.now = opts.now ?? (() => Date.now());
    this.fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
    this.runner = opts.runner ?? ((req) => runInstallerFromRemote(req, this.fetcher));
    this.onEvent = opts.onEvent;
    this.onRestart = opts.onRestart;
    this.onShutdown = opts.onShutdown;

    this.installed = readBuildInfo(this.appRoot, { inDocker: this.inDocker });
    this.loadCache();

    if (this.autoCheck) {
      const interval = opts.pollIntervalMs ?? AUTO_POLL_MS;
      if (interval > 0) {
        this.timer = setInterval(() => {
          if (this.phase === "idle" || this.phase === "error") void this.maybeCheckInBackground();
        }, interval);
        this.timer.unref();
      }
      // Primera comprobación diferida si no hay caché reciente al arrancar el daemon.
      setTimeout(() => { void this.maybeCheckInBackground(); }, 1500).unref();
    }
  }

  close(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private loadCache(): void {
    try {
      const raw = JSON.parse(readFileSync(this.cacheFile, "utf8")) as CacheFile;
      if (raw && raw.repo === this.installed.repo && raw.ref === this.installed.ref && raw.latest && SHA_RE.test(raw.latest.commit)) {
        this.latest = raw.latest;
        this.checkedAtMs = typeof raw.checkedAt === "number" ? raw.checkedAt : null;
      }
    } catch {
      /* sin caché previa */
    }
  }

  private saveCache(): void {
    if (!this.latest || this.checkedAtMs === null) return;
    try {
      mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      const data: CacheFile = { checkedAt: this.checkedAtMs, repo: this.installed.repo, ref: this.installed.ref, latest: this.latest };
      writeFileSync(this.cacheFile, JSON.stringify(data));
    } catch {
      /* si el disco no admite escribir caché, seguimos con memoria */
    }
  }

  private stale(): boolean {
    if (this.checkedAtMs === null) return true;
    return this.now() - this.checkedAtMs >= this.cacheTtlMs;
  }

  snapshot(): UpdateStatus {
    this.installed = readBuildInfo(this.appRoot, { inDocker: this.inDocker });
    const reason = cannotAutoUpdateMessage(this.installed);
    const canAutoUpdate = reason === null;
    const unknownInstalledCommit = this.installed.commit === null;
    const updateAvailable = this.latest
      ? (this.installed.commit ? this.installed.commit !== this.latest.commit : canAutoUpdate)
      : false;
    return {
      installed: this.installed,
      latest: this.latest,
      checkedAt: this.checkedAtMs !== null ? new Date(this.checkedAtMs).toISOString() : null,
      updateAvailable,
      unknownInstalledCommit,
      canAutoUpdate,
      manualCommand: defaultManualCommand(this.installed),
      cannotAutoUpdateReason: reason,
      phase: this.phase,
      message: this.message,
      error: this.error,
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    this.onEvent?.(snap);
    for (const fn of this.listeners) fn(snap);
  }

  subscribe(fn: (status: UpdateStatus) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private async maybeCheckInBackground(): Promise<void> {
    if (!this.autoCheck || !this.stale() || this.checkPromise || this.installPromise) return;
    try {
      await this.runCheck(false);
    } catch {
      /* sin ruido si no hay conexión en comprobación automática */
    }
  }

  async status(): Promise<UpdateStatus> {
    if (this.autoCheck && this.stale() && !this.installPromise) {
      void this.maybeCheckInBackground();
    }
    return this.snapshot();
  }

  async checkNow(): Promise<UpdateStatus> {
    if (this.installPromise) return this.snapshot();
    return this.runCheck(true);
  }

  private runCheck(surfaceError: boolean): Promise<UpdateStatus> {
    if (this.checkPromise) return this.checkPromise;
    this.checkPromise = (async () => {
      const prevPhase = this.phase;
      if (this.phase !== "installing" && this.phase !== "restarting") {
        this.phase = "checking";
        this.error = null;
      }
      try {
        const repo = validateRepo(this.installed.repo);
        const ref = validateRef(this.installed.ref);
        const url = process.env.KIOKU_UPDATE_FEED_URL || `https://github.com/${repo}/commits/${ref}.atom`;
        const res = await this.fetcher(url, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/atom+xml, application/json" } });
        if (!res.ok) throw new Error(`No se pudo consultar GitHub (HTTP ${res.status}).`);
        this.latest = parseRemoteResponse(await res.text(), repo);
        this.checkedAtMs = this.now();
        this.saveCache();
        if (this.phase === "checking") {
          this.phase = "idle";
          this.error = null;
          this.message = null;
        }
        this.emit();
      } catch (e) {
        if (this.phase === "checking") {
          this.phase = surfaceError ? "error" : prevPhase === "error" ? "error" : "idle";
          this.error = surfaceError ? (e instanceof Error ? e.message : String(e)) : null;
        }
        if (surfaceError) this.emit();
      } finally {
        this.checkPromise = null;
      }
      return this.snapshot();
    })();
    return this.checkPromise;
  }

  async startInstall(): Promise<UpdateStatus> {
    if (this.installPromise || this.phase === "installing" || this.phase === "restarting") {
      throw new UpdateError(409, "Ya hay una actualización en curso.");
    }
    const snap = this.snapshot();
    if (!snap.canAutoUpdate) {
      throw new UpdateError(409, snap.cannotAutoUpdateReason || "Esta instalación no se actualiza desde la app.");
    }
    this.phase = "installing";
    this.error = null;
    this.message = "Descargando y preparando la nueva versión (tus datos y claves quedan intactos)…";
    this.emit();

    this.installPromise = (async () => {
      try {
        const env: Record<string, string | undefined> = {
          KIOKU_REPO: snap.installed.repo,
          KIOKU_REF: snap.installed.ref,
          KIOKU_INSTALL_YES: "1",
          KIOKU_INSTALL_NO_OPEN: "1",
          KIOKU_INSTALL_NO_SERVICE: "1",
        };
        if (snap.installed.installDir) env.KIOKU_INSTALL_DIR = snap.installed.installDir;
        if (snap.installed.binDir) env.KIOKU_BIN_DIR = snap.installed.binDir;

        const args = ["--yes", "--no-open"];
        if (snap.installed.channel === "linux-install") args.push("--no-service");

        const result = await this.runner({ repo: snap.installed.repo, ref: snap.installed.ref, args, env });
        if (!result.ok) {
          this.phase = "error";
          this.message = null;
          this.error = result.error || "No se pudo completar la actualización. Tu versión anterior sigue intacta.";
          this.emit();
          return;
        }

        // Actualiza estado instalado / caché tras colocar la nueva versión.
        this.installed = readBuildInfo(this.appRoot, { inDocker: this.inDocker });
        this.phase = "restarting";
        this.error = null;
        this.message = "Actualización instalada. Reiniciando Kioku…";
        this.emit();

        if (this.restartDelayMs > 0) await new Promise((r) => setTimeout(r, this.restartDelayMs));
        if (this.onRestart) {
          await this.onRestart(this.installed);
        } else {
          await performDefaultRestart({ installed: this.installed, appRoot: this.appRoot, shutdown: this.onShutdown });
        }
      } catch (e) {
        this.phase = "error";
        this.message = null;
        this.error = e instanceof Error ? e.message : String(e);
        this.emit();
      } finally {
        this.installPromise = null;
      }
    })();

    return this.snapshot();
  }

  async waitIdle(): Promise<void> {
    if (this.checkPromise) await this.checkPromise.catch(() => {});
    if (this.installPromise) await this.installPromise;
  }
}
