// Índice derivado en SQLite. NUNCA es fuente de verdad: se puede borrar y reconstruir desde los .md.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { hashText, type Vault } from "./vault.ts";
import { normKey, parseNote, type Frontmatter } from "./markdown.ts";

const SCHEMA_VERSION = 2;

export type NoteType = "note" | "task" | "project" | "journal" | "resource" | "capture" | "database";
const NOTE_TYPES = new Set<string>(["note", "task", "project", "journal", "resource", "capture", "database"]);
export type TaskStatus = "todo" | "doing" | "done" | "dropped";
export const OPEN_STATUSES: TaskStatus[] = ["todo", "doing"];

export interface NoteRow {
  path: string;
  uid: string | null;
  type: NoteType;
  title: string;
  mtime: number;
  size: number;
  hash: string;
  body: string;
  fm: Frontmatter;
  fmError: boolean;
  tags: string[];
}

export interface TaskRow {
  path: string;
  title: string;
  status: TaskStatus;
  projectPath: string | null;
  projectTitle: string | null;
  due: string | null;
  priority: number | null;
  doneAt: string | null;
  mtime: number;
  focus: string | null;
}

export interface SearchHit {
  path: string;
  title: string;
  type: NoteType;
  snippet: string;
  kind: "title" | "content";
  score: number;
}

export interface Backlink {
  path: string;
  title: string;
  type: NoteType;
  context: string;
}

export interface EventRow {
  ts: string;
  kind: string;
  path: string | null;
  data: Record<string, unknown>;
}

const DDL = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS notes(
  rid INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, uid TEXT, type TEXT NOT NULL, title TEXT NOT NULL,
  mtime REAL NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL,
  fm_json TEXT NOT NULL, fm_error INTEGER NOT NULL DEFAULT 0, tags_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS notes_type ON notes(type);
CREATE TABLE IF NOT EXISTS links(
  src TEXT NOT NULL, dst_raw TEXT NOT NULL, dst_key TEXT NOT NULL, dst_path TEXT,
  anchor TEXT, alias TEXT, embed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS links_src ON links(src);
CREATE INDEX IF NOT EXISTS links_dst ON links(dst_path);
CREATE INDEX IF NOT EXISTS links_key ON links(dst_key);
CREATE TABLE IF NOT EXISTS names(key TEXT NOT NULL, path TEXT NOT NULL, rank INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS names_key ON names(key);
CREATE INDEX IF NOT EXISTS names_path ON names(path);
CREATE TABLE IF NOT EXISTS tags(path TEXT NOT NULL, tag TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
CREATE TABLE IF NOT EXISTS tasks(
  path TEXT PRIMARY KEY, status TEXT NOT NULL, project_key TEXT, project_path TEXT,
  due TEXT, priority INTEGER, done_at TEXT, focus TEXT
);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, path TEXT, data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_path ON events(path);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title, body, tags, tokenize = 'unicode61 remove_diacritics 2'
);
`;

const v = <T>(x: T | undefined): T | null => (x === undefined ? null : x);

function asString(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  const s = String(x).trim();
  return s ? s : null;
}

/** "[[Proyecto X]]" | "Proyecto X" → "Proyecto X" */
export function relationTarget(x: unknown): string | null {
  const s = asString(x);
  if (!s) return null;
  const m = /\[\[([^\]|#]+)/.exec(s);
  return (m ? m[1] : s).trim() || null;
}

export class Index {
  readonly db: DatabaseSync;
  private titleCache: { path: string; title: string; key: string; type: NoteType }[] | null = null;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;");
    const row = this.safeGet("SELECT value FROM meta WHERE key='schema_version'");
    if (row && Number(row.value) !== SCHEMA_VERSION) this.reset();
    this.db.exec(DDL);
    this.db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version', ?)").run(String(SCHEMA_VERSION));
  }

  private safeGet(sql: string): Record<string, unknown> | undefined {
    try {
      return this.db.prepare(sql).get() as Record<string, unknown> | undefined;
    } catch {
      return undefined;
    }
  }

  close(): void {
    this.db.close();
  }

  /** Borra todo el contenido derivado. */
  reset(): void {
    for (const t of ["notes_fts", "notes", "links", "names", "tags", "tasks", "events", "meta"]) {
      this.db.exec(`DROP TABLE IF EXISTS ${t}`);
    }
    this.db.exec(DDL);
    this.titleCache = null;
  }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /* ---------- escritura ---------- */

  upsertNote(rel: string, text: string, stat: { mtimeMs: number; size: number }): NoteRow {
    const parsed = parseNote(text, rel);
    const fm = parsed.frontmatter;
    const rawType = typeof fm.type === "string" ? fm.type.toLowerCase() : "note";
    const type = (NOTE_TYPES.has(rawType) ? rawType : "note") as NoteType;
    const hash = hashText(text);
    const uid = typeof fm.id === "string" ? fm.id : null;

    const row = this.db
      .prepare(
        `INSERT INTO notes(path,uid,type,title,mtime,size,hash,body,fm_json,fm_error,tags_json)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(path) DO UPDATE SET uid=excluded.uid,type=excluded.type,title=excluded.title,mtime=excluded.mtime,
           size=excluded.size,hash=excluded.hash,body=excluded.body,fm_json=excluded.fm_json,fm_error=excluded.fm_error,
           tags_json=excluded.tags_json
         RETURNING rid`,
      )
      .get(
        rel, uid, type, parsed.title, stat.mtimeMs, stat.size, hash, parsed.body,
        JSON.stringify(fm), parsed.frontmatterError ? 1 : 0, JSON.stringify(parsed.tags),
      ) as { rid: number };

    this.db.prepare("DELETE FROM notes_fts WHERE rowid=?").run(row.rid);
    this.db
      .prepare("INSERT INTO notes_fts(rowid,title,body,tags) VALUES(?,?,?,?)")
      .run(row.rid, parsed.title, parsed.body, parsed.tags.join(" "));

    this.db.prepare("DELETE FROM links WHERE src=?").run(rel);
    const insLink = this.db.prepare(
      "INSERT INTO links(src,dst_raw,dst_key,anchor,alias,embed) VALUES(?,?,?,?,?,?)",
    );
    for (const l of parsed.links) insLink.run(rel, l.target, normKey(l.target), v(l.anchor), v(l.alias), l.embed ? 1 : 0);

    this.db.prepare("DELETE FROM tags WHERE path=?").run(rel);
    const insTag = this.db.prepare("INSERT INTO tags(path,tag) VALUES(?,?)");
    for (const t of parsed.tags) insTag.run(rel, t);

    this.db.prepare("DELETE FROM names WHERE path=?").run(rel);
    const insName = this.db.prepare("INSERT INTO names(key,path,rank) VALUES(?,?,?)");
    const noExt = rel.replace(/\.md$/i, "");
    const parts = noExt.split("/");
    insName.run(normKey(noExt), rel, 0);
    for (let i = 1; i < parts.length; i++) insName.run(normKey(parts.slice(i).join("/")), rel, 1);
    const aliases = Array.isArray(fm.aliases) ? fm.aliases : typeof fm.aliases === "string" ? [fm.aliases] : [];
    for (const a of aliases) if (typeof a === "string" && a.trim()) insName.run(normKey(a), rel, 2);
    insName.run(normKey(parsed.title), rel, 3);

    this.db.prepare("DELETE FROM tasks WHERE path=?").run(rel);
    if (type === "task") {
      const st = String(fm.status ?? "todo").toLowerCase();
      const status: TaskStatus = (["todo", "doing", "done", "dropped"] as string[]).includes(st) ? (st as TaskStatus) : "todo";
      const prio = Number(fm.priority);
      this.db
        .prepare("INSERT INTO tasks(path,status,project_key,due,priority,done_at,focus) VALUES(?,?,?,?,?,?,?)")
        .run(
          rel, status, v(relationTarget(fm.project) && normKey(relationTarget(fm.project)!)), v(asString(fm.due)),
          Number.isFinite(prio) && prio >= 1 && prio <= 3 ? prio : null, v(asString(fm.done_at)),
          v(asString(fm.parked)),
        );
    }
    this.titleCache = null;
    return {
      path: rel, uid, type, title: parsed.title, mtime: stat.mtimeMs, size: stat.size, hash,
      body: parsed.body, fm, fmError: parsed.frontmatterError, tags: parsed.tags,
    };
  }

  removeNote(rel: string): void {
    const r = this.db.prepare("SELECT rid FROM notes WHERE path=?").get(rel) as { rid: number } | undefined;
    if (r) this.db.prepare("DELETE FROM notes_fts WHERE rowid=?").run(r.rid);
    for (const t of ["notes", "tasks", "tags", "names"]) this.db.prepare(`DELETE FROM ${t} WHERE path=?`).run(rel);
    this.db.prepare("DELETE FROM links WHERE src=?").run(rel);
    this.db.prepare("UPDATE links SET dst_path=NULL WHERE dst_path=?").run(rel);
    this.titleCache = null;
  }

  /** Resuelve enlaces y relaciones contra la tabla de nombres. Idempotente. */
  resolveAll(): void {
    this.db.exec(`
      UPDATE links SET dst_path = (
        SELECT path FROM names WHERE names.key = links.dst_key ORDER BY rank, length(path), path LIMIT 1
      ) WHERE dst_key <> '';
      UPDATE links SET dst_path = src WHERE dst_key = '';
      UPDATE tasks SET project_path = (
        SELECT names.path FROM names JOIN notes ON notes.path = names.path AND notes.type = 'project'
        WHERE names.key = tasks.project_key ORDER BY names.rank, length(names.path), names.path LIMIT 1
      ) WHERE project_key IS NOT NULL;
    `);
  }

  /** Sincroniza el índice con el disco. Solo reparsea lo que cambió (mtime+size). */
  async sync(vault: Vault): Promise<{ added: number; updated: number; removed: number }> {
    const files = await vault.listMarkdown();
    const known = new Map<string, { mtime: number; size: number }>();
    for (const r of this.db.prepare("SELECT path,mtime,size FROM notes").all() as { path: string; mtime: number; size: number }[]) {
      known.set(r.path, r);
    }
    let added = 0, updated = 0, removed = 0;
    const toIndex: string[] = [];
    for (const f of files) {
      const k = known.get(f.path);
      if (!k) { toIndex.push(f.path); added++; }
      else if (k.mtime !== f.mtimeMs || k.size !== f.size) { toIndex.push(f.path); updated++; }
      known.delete(f.path);
    }
    const loaded: { path: string; text: string; mtimeMs: number; size: number }[] = [];
    for (const p of toIndex) {
      try {
        const r = await vault.read(p);
        loaded.push({ path: p, text: r.text, mtimeMs: r.mtimeMs, size: Buffer.byteLength(r.text) });
      } catch { /* desapareció entre listado y lectura: lo recogerá el siguiente sync */ }
    }
    this.tx(() => {
      for (const l of loaded) this.upsertNote(l.path, l.text, l);
      for (const gone of known.keys()) { this.removeNote(gone); removed++; }
      this.resolveAll();
    });
    return { added, updated, removed };
  }

  /* ---------- eventos ---------- */

  addEvent(e: EventRow): void {
    this.db.prepare("INSERT INTO events(ts,kind,path,data) VALUES(?,?,?,?)").run(e.ts, e.kind, v(e.path), JSON.stringify(e.data ?? {}));
  }

  clearEvents(): void {
    this.db.exec("DELETE FROM events");
  }

  events(opts: { kinds?: string[]; path?: string; since?: string; limit?: number } = {}): EventRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.kinds?.length) { where.push(`kind IN (${opts.kinds.map(() => "?").join(",")})`); args.push(...opts.kinds); }
    if (opts.path) { where.push("path = ?"); args.push(opts.path); }
    if (opts.since) { where.push("ts >= ?"); args.push(opts.since); }
    const sql = `SELECT ts,kind,path,data FROM events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ts DESC, id DESC LIMIT ?`;
    args.push(opts.limit ?? 200);
    return (this.db.prepare(sql).all(...args) as { ts: string; kind: string; path: string | null; data: string }[]).map((r) => ({
      ts: r.ts, kind: r.kind, path: r.path, data: JSON.parse(r.data),
    }));
  }

  /* ---------- lectura ---------- */

  getNote(rel: string): NoteRow | null {
    const r = this.db.prepare("SELECT * FROM notes WHERE path=?").get(rel) as Record<string, unknown> | undefined;
    return r ? this.toNote(r) : null;
  }

  private toNote(r: Record<string, unknown>): NoteRow {
    return {
      path: r.path as string, uid: (r.uid as string) ?? null, type: r.type as NoteType, title: r.title as string,
      mtime: r.mtime as number, size: r.size as number, hash: r.hash as string, body: r.body as string,
      fm: JSON.parse(r.fm_json as string), fmError: !!r.fm_error, tags: JSON.parse(r.tags_json as string),
    };
  }

  listNotes(opts: { type?: NoteType; prefix?: string; limit?: number } = {}): Omit<NoteRow, "body" | "fm">[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.type) { where.push("type=?"); args.push(opts.type); }
    if (opts.prefix) { where.push("path LIKE ?"); args.push(opts.prefix.replace(/[%_]/g, "") + "%"); }
    args.push(opts.limit ?? 1000);
    const rows = this.db
      .prepare(`SELECT path,uid,type,title,mtime,size,hash,fm_error,tags_json FROM notes ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY mtime DESC LIMIT ?`)
      .all(...args) as Record<string, unknown>[];
    return rows.map((r) => ({
      path: r.path as string, uid: (r.uid as string) ?? null, type: r.type as NoteType, title: r.title as string,
      mtime: r.mtime as number, size: r.size as number, hash: r.hash as string, fmError: !!r.fm_error,
      tags: JSON.parse(r.tags_json as string),
    }));
  }

  count(): number {
    return (this.db.prepare("SELECT count(*) c FROM notes").get() as { c: number }).c;
  }

  tasks(opts: { status?: TaskStatus[]; projectPath?: string; includeParked?: boolean } = {}): TaskRow[] {
    const where: string[] = [];
    const args: string[] = [];
    if (opts.status?.length) { where.push(`t.status IN (${opts.status.map(() => "?").join(",")})`); args.push(...opts.status); }
    if (opts.projectPath) { where.push("t.project_path = ?"); args.push(opts.projectPath); }
    const rows = this.db
      .prepare(
        `SELECT t.*, n.title, n.mtime, p.title AS project_title FROM tasks t JOIN notes n ON n.path=t.path
         LEFT JOIN notes p ON p.path=t.project_path ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY n.mtime DESC`,
      )
      .all(...args) as Record<string, unknown>[];
    return rows.map((r) => ({
      path: r.path as string, title: r.title as string, status: r.status as TaskStatus,
      projectPath: (r.project_path as string) ?? null, projectTitle: (r.project_title as string) ?? null,
      due: (r.due as string) ?? null, priority: (r.priority as number) ?? null, doneAt: (r.done_at as string) ?? null,
      mtime: r.mtime as number, focus: (r.focus as string) ?? null,
    }));
  }

  backlinks(rel: string): Backlink[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT n.path, n.title, n.type, n.body FROM links l JOIN notes n ON n.path=l.src
         WHERE l.dst_path=? AND l.src<>? ORDER BY n.mtime DESC`,
      )
      .all(rel, rel) as { path: string; title: string; type: NoteType; body: string }[];
    const keys = this.keysFor(rel);
    return rows.map((r) => ({ path: r.path, title: r.title, type: r.type, context: contextLine(r.body, keys) }));
  }

  private keysFor(rel: string): Set<string> {
    const ks = (this.db.prepare("SELECT key FROM names WHERE path=?").all(rel) as { key: string }[]).map((x) => x.key);
    return new Set(ks);
  }

  outgoing(rel: string): { target: string; path: string | null; title: string | null }[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT l.dst_raw AS target, l.dst_path AS path, n.title FROM links l LEFT JOIN notes n ON n.path=l.dst_path
         WHERE l.src=? AND l.embed=0 AND l.dst_key<>''`,
      )
      .all(rel) as { target: string; path: string | null; title: string | null }[];
    return rows;
  }

  /** Enlaces que no apuntan a ninguna nota (sin incrustaciones). */
  brokenLinks(): { from: string; target: string }[] {
    return this.db
      .prepare(`SELECT DISTINCT src AS "from", dst_raw AS target FROM links WHERE dst_path IS NULL AND embed=0 AND dst_key<>'' ORDER BY src, dst_raw`)
      .all() as { from: string; target: string }[];
  }

  /** Menciones del título en texto plano, sin enlace, en otras notas. */
  unlinkedMentions(rel: string, limit = 10): Backlink[] {
    const n = this.getNote(rel);
    if (!n || n.title.length < 3) return [];
    const hits = this.ftsQuery(`"${n.title.replace(/"/g, "")}"`, limit + 10, ["title", "body"]);
    const linked = new Set(this.backlinks(rel).map((b) => b.path));
    const key = normKey(n.title);
    return hits
      .filter((h) => h.path !== rel && !linked.has(h.path))
      .slice(0, limit)
      .map((h) => ({ path: h.path, title: h.title, type: h.type, context: contextLine(this.getNote(h.path)?.body ?? "", new Set([key])) || h.snippet }));
  }

  /* ---------- búsqueda ---------- */

  private titles() {
    if (!this.titleCache) {
      this.titleCache = (this.db.prepare("SELECT path,title,type FROM notes").all() as { path: string; title: string; type: NoteType }[]).map(
        (r) => ({ ...r, key: normKey(r.title) }),
      );
    }
    return this.titleCache;
  }

  private ftsQuery(match: string, limit: number, cols?: string[]): SearchHit[] {
    const colFilter = cols ? `{${cols.join(" ")}} : ` : "";
    try {
      const rows = this.db
        .prepare(
          `SELECT n.path, n.title, n.type, snippet(notes_fts, 1, '«', '»', '…', 14) AS snip, bm25(notes_fts, 10.0, 1.0, 5.0) AS rank
           FROM notes_fts JOIN notes n ON n.rid = notes_fts.rowid
           WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?`,
        )
        .all(colFilter + match, limit) as { path: string; title: string; type: NoteType; snip: string; rank: number }[];
      return rows.map((r) => ({ path: r.path, title: r.title, type: r.type, snippet: r.snip, kind: "content", score: -r.rank }));
    } catch {
      return [];
    }
  }

  /** Búsqueda combinada: coincidencia difusa de título primero, luego texto completo (FTS5/bm25). */
  search(query: string, limit = 20): SearchHit[] {
    const q = query.trim();
    if (!q) return [];
    const qk = normKey(q);
    const out = new Map<string, SearchHit>();

    for (const t of this.titles()) {
      const s = fuzzyScore(qk, t.key);
      if (s > 0) {
        const body = (this.db.prepare("SELECT substr(body,1,140) b FROM notes WHERE path=?").get(t.path) as { b: string }).b;
        out.set(t.path, { path: t.path, title: t.title, type: t.type, snippet: body.replace(/\s+/g, " ").trim(), kind: "title", score: 1000 + s });
      }
    }
    const toks = q.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (toks.length) {
      const match = toks.map((t) => `"${t}"*`).join(" ");
      for (const h of this.ftsQuery(match, limit)) if (!out.has(h.path)) out.set(h.path, h);
    }
    return [...out.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Grafo de enlaces resueltos. Con `focus`, solo el vecindario (no dirigido) hasta `depth`; si no, los `max` nodos más conectados. */
  graph(opts: { focus?: string; depth?: number; max?: number } = {}): {
    nodes: { path: string; title: string; type: NoteType; degree: number }[];
    edges: [number, number][];
    total: number;
    isolated: number;
  } {
    const notes = this.db.prepare("SELECT path,title,type FROM notes").all() as { path: string; title: string; type: NoteType }[];
    const raw = this.db
      .prepare("SELECT DISTINCT src, dst_path AS dst FROM links WHERE dst_path IS NOT NULL AND src<>dst_path")
      .all() as { src: string; dst: string }[];
    const known = new Map(notes.map((n) => [n.path, n]));
    const adj = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      if (!adj.has(a)) adj.set(a, new Set());
      adj.get(a)!.add(b);
    };
    for (const e of raw) if (known.has(e.src) && known.has(e.dst)) { link(e.src, e.dst); link(e.dst, e.src); }
    const degree = (p: string) => adj.get(p)?.size ?? 0;
    const isolated = notes.filter((n) => degree(n.path) === 0).length;
    let keep: Set<string>;
    if (opts.focus && known.has(opts.focus)) {
      keep = new Set([opts.focus]);
      let frontier = [opts.focus];
      for (let d = 0; d < (opts.depth ?? 1); d++) {
        const next: string[] = [];
        for (const p of frontier) for (const q of adj.get(p) ?? []) if (!keep.has(q)) { keep.add(q); next.push(q); }
        frontier = next;
      }
    } else {
      keep = new Set(
        notes.filter((n) => degree(n.path) > 0).sort((a, b) => degree(b.path) - degree(a.path)).slice(0, opts.max ?? 400).map((n) => n.path),
      );
    }
    const list = [...keep];
    const idx = new Map(list.map((p, i) => [p, i]));
    const edges: [number, number][] = [];
    for (const e of raw) {
      const a = idx.get(e.src), b = idx.get(e.dst);
      if (a !== undefined && b !== undefined) edges.push([a, b]);
    }
    return {
      nodes: list.map((p) => ({ path: p, title: known.get(p)!.title, type: known.get(p)!.type, degree: degree(p) })),
      edges, total: notes.length, isolated,
    };
  }

  /** Resuelve un destino de enlace ("Nombre", "Carpeta/Nombre", alias, título) a una ruta. */
  resolve(target: string): string | null {
    const key = normKey(target.replace(/\.md$/i, ""));
    const r = this.db
      .prepare("SELECT path FROM names WHERE key=? ORDER BY rank, length(path), path LIMIT 1")
      .get(key) as { path: string } | undefined;
    return r?.path ?? null;
  }

  /** Sugerencias de [[enlace]] por título/alias/nombre. */
  suggestLinks(query: string, limit = 8): { path: string; title: string; type: NoteType }[] {
    const qk = normKey(query);
    return this.titles()
      .map((t) => ({ t, s: qk ? fuzzyScore(qk, t.key) : 1 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.t.title.localeCompare(b.t.title))
      .slice(0, limit)
      .map((x) => ({ path: x.t.path, title: x.t.title, type: x.t.type }));
  }
}

/** 0 = sin coincidencia. Mayor = mejor. */
export function fuzzyScore(q: string, target: string): number {
  if (!q) return 0;
  if (target === q) return 100;
  if (target.startsWith(q)) return 80 - Math.min(20, target.length - q.length);
  if (target.split(" ").some((w) => w.startsWith(q))) return 60;
  if (target.includes(q)) return 50;
  if (q.length < 3) return 0;
  // subsecuencia con penalización por huecos
  let ti = 0, gaps = 0, last = -1;
  for (const ch of q) {
    const idx = target.indexOf(ch, ti);
    if (idx < 0) return 0;
    if (last >= 0) gaps += idx - last - 1;
    last = idx;
    ti = idx + 1;
  }
  const s = 30 - gaps;
  return s > 5 ? s : 0;
}

function contextLine(body: string, keys: Set<string>): string {
  for (const line of body.split("\n")) {
    if (!line.includes("[[")) {
      continue;
    }
    for (const m of line.matchAll(/\[\[([^\]|#]*)/g)) {
      if (keys.has(normKey(m[1]))) return line.trim().slice(0, 200);
    }
  }
  // sin enlace (mención sin enlazar): primera línea que contenga la clave
  for (const line of body.split("\n")) {
    const nk = normKey(line);
    for (const k of keys) if (k && nk.includes(k)) return line.trim().slice(0, 200);
  }
  return "";
}
