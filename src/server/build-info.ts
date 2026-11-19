// Metadatos de versión y origen de la instalación (Kioku.app, instalación Linux, git o Docker).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export type InstallChannel = "macos-app" | "linux-install" | "git" | "docker" | "source";

export interface BuildInfo {
  version: string;
  commit: string | null;
  shortCommit: string | null;
  ref: string;
  repo: string;
  channel: InstallChannel;
  installedAt: string | null;
  installDir?: string | null;
  binDir?: string | null;
}

export const DEFAULT_REPO = "EzequielMenor/kioku";
export const DEFAULT_REF = "main";
const SHA_RE = /^[0-9a-f]{40}$/i;

const safeJson = (file: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const safeText = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/** Extrae el commit SHA de la cabecera PAX (`pax_global_header`) de un `.tar.gz` de GitHub / `git archive`. */
export function extractCommitFromTarGz(tarGzPath: string): string | null {
  try {
    const raw = gunzipSync(readFileSync(tarGzPath)).subarray(0, 4096).toString("utf8");
    const pax = raw.indexOf("pax_global_header");
    if (pax < 0) return null;
    const m = /comment=([0-9a-f]{40})\b/i.exec(raw.slice(pax, pax + 1024));
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Resuelve el directorio `.git` real (incluyendo worktrees donde `.git` es un fichero `gitdir: ...`). */
function resolveGitDirs(appRoot: string): { gitDir: string; commonDir: string } | null {
  const dotGit = path.join(appRoot, ".git");
  if (!existsSync(dotGit)) return null;
  const pointer = safeText(dotGit)?.trim();
  if (pointer && /^gitdir:\s*/i.test(pointer)) {
    const raw = pointer.replace(/^gitdir:\s*/i, "").trim();
    if (!raw) return null;
    const gitDir = path.isAbsolute(raw) ? raw : path.resolve(appRoot, raw);
    const commonRaw = safeText(path.join(gitDir, "commondir"))?.trim();
    const commonDir = commonRaw ? (path.isAbsolute(commonRaw) ? commonRaw : path.resolve(gitDir, commonRaw)) : gitDir;
    return { gitDir, commonDir };
  }
  return { gitDir: dotGit, commonDir: dotGit };
}

/** Resuelve el commit y rama actuales leyendo `.git/` (o worktree) sin lanzar subprocesos. */
export function readGitHead(appRoot: string): { commit: string | null; ref: string | null } {
  const dirs = resolveGitDirs(appRoot);
  if (!dirs) return { commit: null, ref: null };
  const head = safeText(path.join(dirs.gitDir, "HEAD"))?.trim();
  if (!head) return { commit: null, ref: null };
  if (SHA_RE.test(head)) return { commit: head.toLowerCase(), ref: null };
  const refMatch = /^ref:\s+(.+)$/.exec(head);
  if (!refMatch) return { commit: null, ref: null };
  const fullRef = refMatch[1].trim();
  const shortRef = fullRef.startsWith("refs/heads/") ? fullRef.slice("refs/heads/".length) : fullRef;
  for (const base of [dirs.gitDir, dirs.commonDir]) {
    const direct = safeText(path.join(base, fullRef))?.trim();
    if (direct && SHA_RE.test(direct)) return { commit: direct.toLowerCase(), ref: shortRef };
  }
  for (const base of [dirs.gitDir, dirs.commonDir]) {
    const packed = safeText(path.join(base, "packed-refs"));
    if (!packed) continue;
    for (const line of packed.split(/\r?\n/)) {
      if (!line || line.startsWith("#") || line.startsWith("^")) continue;
      const [sha, name] = line.trim().split(/\s+/);
      if (name === fullRef && sha && SHA_RE.test(sha)) return { commit: sha.toLowerCase(), ref: shortRef };
    }
  }
  return { commit: null, ref: shortRef };
}

export function readBuildInfo(appRoot: string, opts?: { inDocker?: boolean }): BuildInfo {
  const pkg = safeJson(path.join(appRoot, "package.json"));
  const stamped = safeJson(path.join(appRoot, "build-info.json"));
  const pkgVersion = typeof pkg?.version === "string" && pkg.version ? pkg.version : "0.0.0";
  const inDocker = opts?.inDocker ?? (existsSync("/.dockerenv") || existsSync("/run/.containerenv"));

  if (stamped) {
    const commit = typeof stamped.commit === "string" && SHA_RE.test(stamped.commit) ? stamped.commit.toLowerCase() : null;
    const channel = inDocker
      ? "docker"
      : stamped.channel === "macos-app" || stamped.channel === "linux-install" || stamped.channel === "git" || stamped.channel === "docker"
        ? stamped.channel
        : "source";
    return {
      version: typeof stamped.version === "string" && stamped.version ? stamped.version : pkgVersion,
      commit,
      shortCommit: commit ? commit.slice(0, 7) : null,
      ref: typeof stamped.ref === "string" && stamped.ref ? stamped.ref : DEFAULT_REF,
      repo: typeof stamped.repo === "string" && stamped.repo ? stamped.repo : DEFAULT_REPO,
      channel,
      installedAt: typeof stamped.installedAt === "string" ? stamped.installedAt : null,
      installDir: typeof stamped.installDir === "string" ? stamped.installDir : null,
      binDir: typeof stamped.binDir === "string" ? stamped.binDir : null,
    };
  }

  const git = readGitHead(appRoot);
  const channel: InstallChannel = inDocker ? "docker" : existsSync(path.join(appRoot, ".git")) ? "git" : "source";
  return {
    version: pkgVersion,
    commit: git.commit,
    shortCommit: git.commit ? git.commit.slice(0, 7) : null,
    ref: git.ref || DEFAULT_REF,
    repo: DEFAULT_REPO,
    channel,
    installedAt: null,
  };
}
