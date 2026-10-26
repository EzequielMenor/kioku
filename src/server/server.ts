// Daemon HTTP local (solo 127.0.0.1). API JSON + SSE + estáticos de la UI.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Jarvis } from "../core/jarvis.ts";
import { isLocalUrl } from "../core/llm.ts";
import { VaultError } from "../core/vault.ts";
import type { NoteType, TaskStatus } from "../core/index.ts";
import type { AssistantEngine } from "../assistant/engine.ts";
import { parseAssistantConfig } from "../assistant/policy.ts";
import { SessionRegistry } from "../assistant/session.ts";
import { AssistantTools } from "../assistant/tools.ts";
import { UndoStore } from "../assistant/undo.ts";

export const DEFAULT_PORT = 47800;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon",
};

function userPath(p: unknown): string {
  if (typeof p !== "string" || !p.toLowerCase().endsWith(".md")) throw new HttpError(400, "Ruta de nota inválida");
  if (p.split("/").some((seg) => seg.startsWith(".") || seg === "..")) throw new HttpError(400, "Ruta no permitida");
  return p;
}

function str(v: unknown, name: string): string {
  if (typeof v !== "string") throw new HttpError(400, `Falta «${name}»`);
  return v;
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const ct = req.headers["content-type"] ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Se requiere application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 5_000_000) throw new HttpError(413, "Cuerpo demasiado grande");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}

export interface ServerHandle {
  port: number;
  url: string;
  sessions: SessionRegistry;
  assistantTools: AssistantTools;
  close(): Promise<void>;
}

export async function startServer(
  j: Jarvis,
  opts: {
    port?: number;
    webDir: string;
    onQuickHide?: () => void | Promise<void>;
    onOpenWorkspace?: (route: string) => void | Promise<void>;
    assistant?: { engine: AssistantEngine };
  },
): Promise<ServerHandle> {
  const sessions = new SessionRegistry();
  const undo = new UndoStore(j);
  const exclude: string[] = []; // misma referencia que usa AssistantTools; se refresca desde .jarvis/assistant.json
  const assistantTools = new AssistantTools(j, undo, { exclude });
  const loadExclude = async () => {
    exclude.splice(0, exclude.length, ...parseAssistantConfig(await j.vault.readInternal("assistant.json")).exclude);
  };

  const sseClients = new Set<http.ServerResponse>();
  j.bus.on("change", (ev) => {
    const data = `data: ${JSON.stringify(ev)}\n\n`;
    for (const c of sseClients) c.write(data);
  });
  const keepAlive = setInterval(() => { for (const c of sseClients) c.write(": ka\n\n"); }, 25_000);
  keepAlive.unref();

  let boundPort = 0;

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(text);
  };

  /** Sesión del asistente a partir de «Authorization: Bearer …»; sin token válido nada se ejecuta. */
  function bearer(req: http.IncomingMessage) {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? "");
    const sess = sessions.byToken(m?.[1]);
    if (!sess) throw new HttpError(401, "Token de asistente ausente o caducado");
    return sess;
  }

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const m = req.method ?? "GET";
    const p = url.pathname;
    const q = url.searchParams;
    const body = m === "GET" ? {} : await readJson(req);

    if (m === "GET") {
      switch (p) {
        case "/api/health": return send(res, 200, { ok: true, root: j.vault.root, notes: j.index.count() });
        case "/api/today": return send(res, 200, await j.today());
        case "/api/focus": return send(res, 200, j.focusState());
        case "/api/inbox": return send(res, 200, j.inbox().map((n) => ({ path: n.path, title: n.title, mtime: n.mtime, excerpt: n.body.trim().slice(0, 200) })));
        case "/api/search": return send(res, 200, j.index.search(q.get("q") ?? "", Number(q.get("limit") ?? 20)));
        case "/api/ai": {
          const cfg = await j.aiConfig();
          return send(res, 200, cfg ? { configured: true, model: cfg.model, baseUrl: cfg.baseUrl, local: isLocalUrl(cfg.baseUrl), apiKeyEnv: cfg.apiKeyEnv ?? null } : { configured: false });
        }
        case "/api/ai/preview": return send(res, 200, await j.aiPreview());
        case "/api/assistant/actions": return send(res, 200, (await undo.list(50)));
        case "/api/assistant/tools/list": {
          bearer(req);
          return send(res, 200, assistantTools.specs());
        }
        case "/api/graph": {
          const focus = q.get("focus");
          return send(res, 200, j.index.graph({ focus: focus ? userPath(focus) : undefined, depth: Math.min(3, Number(q.get("depth") ?? 1)), max: Number(q.get("max") ?? 400) }));
        }
        case "/api/resolve": return send(res, 200, { path: j.index.resolve(q.get("q") ?? "") });
        case "/api/suggest-links": return send(res, 200, j.index.suggestLinks(q.get("q") ?? "", 8));
        case "/api/notes": {
          const type = q.get("type") as NoteType | null;
          return send(res, 200, j.index.listNotes({ type: type ?? undefined, limit: Number(q.get("limit") ?? 2000) }));
        }
        case "/api/tasks": {
          const st = q.get("status");
          const status = st ? (st.split(",") as TaskStatus[]) : undefined;
          return send(res, 200, j.index.tasks({ status, projectPath: q.get("project") ?? undefined }));
        }
        case "/api/projects": {
          const list = j.index.listNotes({ type: "project", limit: 500 });
          return send(res, 200, list.map((n) => j.resume(n.path)).filter(Boolean));
        }
        case "/api/project": {
          const card = j.resume(userPath(q.get("path")));
          if (!card) throw new HttpError(404, "Proyecto no encontrado");
          return send(res, 200, card);
        }
        case "/api/context": {
          const c = j.contextFor(userPath(q.get("path")));
          if (!c) throw new HttpError(404, "Proyecto no encontrado");
          return send(res, 200, c);
        }
        case "/api/note": {
          const rel = userPath(q.get("path"));
          const r = await j.readNote(rel);
          return send(res, 200, {
            path: rel, text: r.text, hash: r.hash,
            note: r.note && { title: r.note.title, type: r.note.type, tags: r.note.tags, fm: r.note.fm, fmError: r.note.fmError },
            backlinks: j.index.backlinks(rel), outgoing: j.index.outgoing(rel), unlinked: j.index.unlinkedMentions(rel),
          });
        }
        case "/api/proposals": {
          const list = await j.proposals.list((q.get("status") as "pending") ?? "pending");
          const withDiff = await Promise.all(list.map(async (pr) => ({
            ...pr,
            ops: await Promise.all(pr.ops.map(async (op) => {
              if (op.op === "setProp") {
                const cur = await j.vault.read(op.path).catch(() => null);
                return { ...op, current: cur ? j.index.getNote(op.path)?.fm ?? {} : null };
              }
              return op;
            })),
          })));
          return send(res, 200, withDiff);
        }
        case "/api/events": {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
          res.write(": ok\n\n");
          sseClients.add(res);
          req.on("close", () => sseClients.delete(res));
          return;
        }
      }
    } else if (m === "POST" || m === "PUT") {
      switch (p) {
        case "/api/capture": return send(res, 200, await j.capture(str(body.text, "text")));
        case "/api/note/create": {
          const n = await j.createNote({ title: str(body.title, "title"), type: (body.type as NoteType) ?? "note", body: (body.body as string) ?? "" });
          return send(res, 200, { path: n.path, title: n.title });
        }
        case "/api/note/open": { await j.openedNote(userPath(body.path)); return send(res, 200, { ok: true }); }
        case "/api/capture/convert": {
          const kind = body.kind;
          if (kind !== "task" && kind !== "note") throw new HttpError(400, "Tipo inválido");
          const n = await j.convertCapture(userPath(body.path), kind);
          return send(res, 200, { path: n.path });
        }
        case "/api/note/delete": return send(res, 200, { trashed: await j.deleteNote(userPath(body.path)) });
        case "/api/note": {
          const r = await j.saveNote(userPath(body.path), str(body.text, "text"), str(body.hash, "hash"));
          return send(res, 200, { hash: r.hash });
        }
        case "/api/task/status": {
          const st = str(body.status, "status") as TaskStatus;
          if (!["todo", "doing", "done", "dropped"].includes(st)) throw new HttpError(400, "Estado inválido");
          await j.setTaskStatus(userPath(body.path), st);
          return send(res, 200, { ok: true });
        }
        case "/api/project/create": { const n = await j.createProject(str(body.title, "title")); return send(res, 200, { path: n.path }); }
        case "/api/project/checkpoint": { await j.addCheckpoint(userPath(body.path), str(body.text, "text")); return send(res, 200, { ok: true }); }
        case "/api/project/decision": { await j.addDecision(userPath(body.path), str(body.text, "text")); return send(res, 200, { ok: true }); }
        case "/api/focus/start": return send(res, 200, await j.startFocus({
          taskPath: body.taskPath ? userPath(body.taskPath) : undefined, projectPath: body.projectPath ? userPath(body.projectPath) : undefined,
        }));
        case "/api/focus/end": return send(res, 200, await j.endFocus({ checkpoint: body.checkpoint as string | undefined, done: !!body.done }));
        case "/api/journal": { const n = await j.journal(body.date as string | undefined); return send(res, 200, { path: n.path }); }
        case "/api/note/props": {
          const props = body.props;
          if (!props || typeof props !== "object" || Array.isArray(props)) throw new HttpError(400, "Falta «props»");
          const BLOCK = new Set(["id", "created"]);
          for (const k of Object.keys(props)) if (BLOCK.has(k)) throw new HttpError(400, `«${k}» no es editable`);
          const n = await j.setProps(userPath(body.path), props as Record<string, unknown>);
          return send(res, 200, { fm: n.fm });
        }
        case "/api/desktop/open": {
          const route = typeof body.route === "string" && body.route.startsWith("/") ? body.route : "/hoy";
          j.bus.emit("change", { kind: "navigate", route });
          await opts.onOpenWorkspace?.(route);
          return send(res, 200, { ok: true });
        }
        case "/api/desktop/quick/hide": { await opts.onQuickHide?.(); return send(res, 200, { ok: true }); }
        case "/api/assistant/tools/call": {
          const sess = bearer(req);
          await loadExclude();
          return send(res, 200, await assistantTools.call(sess, str(body.name, "name"), body.args));
        }
        case "/api/assistant/undo": return send(res, 200, await undo.undo(str(body.id, "id")));
        case "/api/assistant/ask": {
          if (!opts.assistant) throw new HttpError(503, "El asistente no está configurado");
          const message = str(body.message, "message").trim();
          if (!message) throw new HttpError(400, "Escribe un mensaje");
          const avail = await opts.assistant.engine.available();
          if (!avail.ok) throw new HttpError(503, avail.reason ?? "El asistente no está disponible");
          await loadExclude();
          const sess = sessions.open();
          try {
            await j.log.record("ai.request", null, { sessionId: sess.id, chars: message.length });
            const { answer } = await opts.assistant.engine.ask({
              message, conversation: typeof body.conversation === "string" && body.conversation ? body.conversation : "default",
              session: sess, daemonUrl: `http://127.0.0.1:${boundPort}`,
            });
            const actions = (await undo.list(200)).filter((a) => a.sessionId === sess.id).reverse();
            return send(res, 200, { answer, reads: [...sess.reads], actions });
          } catch (e) {
            if (e instanceof HttpError || e instanceof VaultError) throw e;
            throw new HttpError(502, e instanceof Error ? e.message : String(e));
          } finally {
            sessions.close(sess.id);
          }
        }
        case "/api/ai/triage": {
          try { return send(res, 200, await j.llmTriage(str(body.hash, "hash"))); }
          catch (e) { if (e instanceof VaultError) throw e; throw new HttpError(502, e instanceof Error ? e.message : String(e)); }
        }
        case "/api/triage": return send(res, 200, await j.refreshTriage());
        case "/api/reindex": return send(res, 200, await j.reindex());
      }
      const mm = /^\/api\/proposals\/([0-9A-Z]{26})\/(apply|reject)$/.exec(p);
      if (mm) return send(res, 200, mm[2] === "apply" ? await j.applyProposal(mm[1]) : await j.rejectProposal(mm[1]));
    }
    throw new HttpError(404, "No existe");
  }

  async function serveStatic(res: http.ServerResponse, pathname: string): Promise<void> {
    const route = pathname === "/" ? "/index.html" : pathname === "/quick" ? "/quick.html" : pathname;
    const file = path.normalize(path.join(opts.webDir, route));
    if (!file.startsWith(opts.webDir + path.sep)) throw new HttpError(404, "No existe");
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
      res.end(data);
    } catch {
      // SPA: rutas de cliente (#/…) no llegan aquí; cualquier otra → 404
      throw new HttpError(404, "No existe");
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      // Anti DNS-rebinding / CSRF: solo aceptamos nuestro propio origen.
      const host = (req.headers.host ?? "").toLowerCase();
      if (host !== `127.0.0.1:${boundPort}` && host !== `localhost:${boundPort}`) throw new HttpError(403, "Host no permitido");
      const origin = req.headers.origin;
      if (origin && origin !== `http://127.0.0.1:${boundPort}` && origin !== `http://localhost:${boundPort}`) {
        throw new HttpError(403, "Origen no permitido");
      }
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname.startsWith("/api/")) await api(req, res, url);
      else if (req.method === "GET") await serveStatic(res, url.pathname);
      else throw new HttpError(405, "Método no permitido");
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (e instanceof VaultError) {
        const status = e.code === "not-found" ? 404 : e.code === "conflict" || e.code === "exists" ? 409 : 400;
        return send(res, status, { error: e.message, code: e.code });
      }
      console.error(e);
      send(res, 500, { error: (e as Error).message });
    }
  });

  const start = opts.port ?? DEFAULT_PORT;
  let port = start;
  for (;;) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EADDRINUSE" && port < start + 20) { port++; continue; }
      throw e;
    }
  }
  boundPort = (server.address() as AddressInfo).port;
  port = boundPort;
  return {
    port, url: `http://127.0.0.1:${port}`, sessions, assistantTools,
    close: () => new Promise((resolve) => {
      clearInterval(keepAlive);
      for (const c of sseClients) c.end();
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}
