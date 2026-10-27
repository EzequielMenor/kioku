// CLI de Kioku. Si el daemon corre, delega en él; si no, opera directamente sobre el vault.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { Kioku, type ResumeCard, type TodayView } from "../core/kioku.ts";
import { isLocalUrl, parseLlmConfig, type LlmPayload } from "../core/llm.ts";
import { exportVault, importObsidian, restoreVault } from "../core/portability.ts";
import { startServer } from "../server/server.ts";
import { HermesEngine } from "../assistant/engine.ts";
import { FakeEngine } from "../assistant/fake-engine.ts";
import type { UndoRecord } from "../assistant/undo.ts";
import { installService, serviceStatus, uninstallService } from "./service.ts";
import { loadOrCreateKey, readKey } from "../server/key.ts";
import { allowedHostsFrom, pairReport, publicHost } from "./pair.ts";
import { daemonAlive, ensureDaemon, hideQuick, kiokuHome, loginUrl, openWorkspace, readRuntime, toggleQuick, webDir } from "./desktop.ts";

const HELP = `kioku — segundo cerebro local-first

Uso: kioku <comando> [args]

  quick                    Abre/oculta la ventana de captura rápida (asigna esto a un atajo de Hyprland)
  open                     Abre el Workspace
  url                      Imprime la URL de acceso (lleva la clave del daemon: no la compartas)
  pair [--revoke]          Empareja el móvil/iPad (Tailscale): da la URL con su clave limitada · --revoke lo desempareja
  add <texto>              Captura rápida sin abrir ventana:  t tarea !mañana @proyecto · d decisión · n nota
  today                    Qué hacer hoy y a qué volver
  resume [proyecto]        Dónde lo dejaste, qué se decidió, qué falta
  search <consulta>        Buscar
  focus start <tarea|@proyecto> · focus end [-m "dónde lo dejas"] [--done]
  context <proyecto>       JSON con el contexto exacto que recibiría una IA (sin memoria oculta)
  proposals [apply|reject <id>]   Propuestas pendientes de aprobación
  triage                   Genera propuestas para la Bandeja (reglas, sin red)
  ai status|preview|config <url> <modelo> [VAR_CLAVE]|off|triage --yes   IA opcional: tu modelo local o API; ves el payload antes de enviar
  ask <mensaje>            Habla con el asistente (Hermes en una jaula; lee, organiza y propone)
  assistant status|actions|undo <id>   Estado del asistente · lo que hizo por su cuenta · deshacer una acción
  reindex                  Reconstruye el índice desde los archivos
  export <archivo.tar.gz>  Copia de seguridad          restore <archivo.tar.gz> <carpeta>
  import-obsidian <ruta> [--yes]   Copia (solo lectura del origen) un vault de Obsidian
  daemon                   Servidor en primer plano     status
  service install|uninstall|status   Arranque automático con tu sesión (servicio de usuario de systemd)

Datos: ${kiokuHome()}   (cambia con KIOKU_HOME)
`;

const J = (v: unknown) => console.log(JSON.stringify(v, null, 2));

function die(msg: string): never {
  console.error(`kioku: ${msg}`);
  process.exit(1);
}

/** Protege el vault de Obsidian: nunca adoptamos como casa una carpeta con .obsidian sin marcar. */
function guardHome(home: string): void {
  if (existsSync(path.join(home, ".obsidian")) && !existsSync(path.join(home, ".kioku"))) {
    die(`${home} parece un vault de Obsidian. Kioku no lo usará para no modificarlo.\n` +
        `Usa otra carpeta (KIOKU_HOME) e importa con: kioku import-obsidian <ruta>`);
  }
}

async function api<T>(base: string, method: string, p: string, body?: unknown): Promise<T> {
  const key = readKey(kiokuHome());
  const headers: Record<string, string> = {};
  if (key) headers["x-kioku-key"] = key;
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(base + p, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) die(j.error ?? `HTTP ${r.status}`);
  return j;
}

function printCard(c: ResumeCard): void {
  const idle = c.idleDays === null ? "" : c.idleDays === 0 ? " · activo hoy" : ` · hace ${c.idleDays} d`;
  console.log(`▣ ${c.project.title}${idle}`);
  if (c.lastCheckpoint) console.log(`   Lo dejaste en: ${c.lastCheckpoint.text}${c.lastCheckpoint.ts ? `  (${c.lastCheckpoint.ts})` : ""}`);
  for (const d of c.decisions) console.log(`   Decidiste:     ${d}`);
  if (c.open.length) console.log(`   Falta:         ${c.open.map((t) => t.title).join(" · ")}`);
  if (c.touched.length) console.log(`   Relacionado:   ${c.touched.map((t) => t.title).join(" · ")}`);
  if (!c.lastCheckpoint && !c.decisions.length && !c.open.length) console.log("   (sin checkpoints, decisiones ni tareas todavía)");
}

function printToday(t: TodayView): void {
  console.log(`Hoy · ${t.date}`);
  if (t.focus.active) console.log(`● En foco: ${t.focus.taskTitle ?? t.focus.projectTitle}`);
  if (t.suggestion) {
    console.log(`\n→ Empieza por: ${t.suggestion.task.title}${t.suggestion.task.projectTitle ? `  [${t.suggestion.task.projectTitle}]` : ""}`);
    console.log(`  ${t.suggestion.reasons.join(" · ") || "sin urgencia: es la siguiente natural"}`);
    for (const a of t.alternatives) console.log(`  · alternativa: ${a.task.title} (${a.reasons.join(", ") || "—"})`);
  } else console.log("\nNo hay tareas abiertas. Captura algo con `kioku add`.");
  if (t.overdue) console.log(`\n⚠ ${t.overdue} vencida${t.overdue > 1 ? "s" : ""}`);
  if (t.resume.length) { console.log("\nRetomar"); t.resume.forEach(printCard); }
  console.log(`\nBandeja: ${t.inbox.count}   Propuestas por revisar: ${t.proposals}`);
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const home = kiokuHome();
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") return void console.log(HELP);

  switch (cmd) {
    case "daemon": {
      guardHome(home);
      const prev = readRuntime(home);
      if (prev && prev.pid !== process.pid && (await daemonAlive(prev.port))) {
        console.error(`Ya hay un daemon sirviendo ${home} en el puerto ${prev.port}; no se lanza otro.`);
        return;
      }
      const j = await Kioku.open({ root: home });
      j.watch();
      const srv = await startServer(j, { port: Number(process.env.KIOKU_PORT) || undefined, key: loadOrCreateKey(home), allowedHosts: allowedHostsFrom(process.env.KIOKU_ALLOWED_HOSTS), webDir, onQuickHide: hideQuick, assistant: { engine: process.env.KIOKU_ASSISTANT_FAKE === "1" ? new FakeEngine() : new HermesEngine({ homeDir: home }) }, onOpenWorkspace: (route) => openWorkspace(`http://127.0.0.1:${srv.port}`, route) });
      const rtFile = path.join(home, ".kioku", "runtime.json");
      writeFileSync(rtFile, JSON.stringify({ pid: process.pid, port: srv.port, startedAt: new Date().toISOString() }));
      console.log(`Kioku escuchando en ${srv.url}  (datos: ${home})`);
      const stop = async () => { try { unlinkSync(rtFile); } catch { /* ya no está */ } await srv.close(); j.close(); process.exit(0); };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return;
    }
    case "quick": { guardHome(home); const base = await ensureDaemon(home); console.log(await toggleQuick(base)); return; }
    case "open": { guardHome(home); openWorkspace(await ensureDaemon(home), "/hoy"); return; }
    case "url": { guardHome(home); console.log(loginUrl(await ensureDaemon(home), readKey(home), "/#/hoy")); return; }
    case "pair": {
      guardHome(home);
      const r = pairReport({ home, host: args.includes("--revoke") ? null : publicHost(), revoke: args.includes("--revoke") });
      r.lines.forEach((l) => console.log(l));
      if (r.url && spawnSync("sh", ["-c", "command -v qrencode"]).status === 0) spawnSync("qrencode", ["-t", "ANSIUTF8", r.url], { stdio: "inherit" });
      if (!r.url && !args.includes("--revoke")) process.exitCode = 1;
      return;
    }
    case "service": {
      guardHome(home);
      const sub = args[0];
      if (sub === "install") installService(home).forEach((l) => console.log(l));
      else if (sub === "uninstall") uninstallService().forEach((l) => console.log(l));
      else if (sub === "status" || !sub) console.log(serviceStatus());
      else die("uso: kioku service install|uninstall|status");
      return;
    }
    case "ask": {
      guardHome(home);
      const message = args.join(" ").trim();
      if (!message) die("uso: kioku ask <mensaje>");
      const base = await ensureDaemon(home);
      const r = await api<{ answer: string; reads: string[]; actions: UndoRecord[] }>(base, "POST", "/api/assistant/ask", { message, conversation: "cli" });
      console.log(r.answer);
      if (r.reads.length) console.log(`\n  Notas que ha leído: ${r.reads.join(", ")}`);
      for (const a of r.actions) console.log(`  ✓ ${a.summary}   (deshacer: kioku assistant undo ${a.id})`);
      return;
    }
    case "assistant": {
      guardHome(home);
      const [sub, id] = args;
      if (sub === "status" || !sub) {
        const av = await new HermesEngine({ homeDir: home }).available();
        console.log(av.ok ? "Asistente: listo (Hermes en jaula bwrap)" : `Asistente: no disponible — ${av.reason}`);
      } else if (sub === "actions") {
        const list = await api<UndoRecord[]>(await ensureDaemon(home), "GET", "/api/assistant/actions");
        if (!list.length) console.log("El asistente aún no ha hecho cambios por su cuenta.");
        for (const a of list) console.log(`${a.id}  ${a.ts.slice(0, 16).replace("T", " ")}  ${a.summary}${a.undone ? "  (deshecho)" : ""}`);
      } else if (sub === "undo") {
        if (!id) die("uso: kioku assistant undo <id>");
        const r = await api<UndoRecord>(await ensureDaemon(home), "POST", "/api/assistant/undo", { id });
        console.log(`✓ Deshecho: ${r.summary}`);
      } else die("uso: kioku assistant status|actions|undo <id>");
      return;
    }
    case "status": {
      const rt = readRuntime(home);
      console.log(rt ? `daemon pid ${rt.pid} en http://127.0.0.1:${rt.port}` : "daemon detenido");
      console.log(serviceStatus());
      console.log(`datos: ${home}${existsSync(home) ? "" : " (aún no existe)"}`);
      return;
    }
    case "export": {
      const dest = args[0] ?? die("falta el archivo de destino");
      exportVault(home, dest);
      console.log(`Exportado → ${path.resolve(dest)}`);
      return;
    }
    case "restore": {
      const [archive, dest] = args;
      if (!archive || !dest) die("uso: kioku restore <archivo.tar.gz> <carpeta-vacía>");
      const r = await restoreVault(archive, dest);
      console.log(`Restaurados ${r.files} archivos en ${path.resolve(dest)} (el índice se reconstruye al abrir)`);
      return;
    }
    case "import-obsidian": {
      guardHome(home);
      const src = args.find((a) => !a.startsWith("--")) ?? die("uso: kioku import-obsidian <ruta> [--yes]");
      const apply = args.includes("--yes");
      const r = await importObsidian(src, home, apply);
      console.log(`${apply ? "Importado" : "Simulación (no se copió nada; añade --yes)"} desde ${r.source}`);
      console.log(`  notas: ${r.notes} · adjuntos: ${r.attachments} · ya presentes: ${r.alreadyThere}`);
      console.log(`  enlaces rotos en el origen: ${r.brokenLinks.length}`);
      console.log(`  El origen NO se modifica nunca. Destino: ${path.join(home, "Notas", "Importado")}`);
      return;
    }
  }

  // Comandos que necesitan datos: vía daemon si corre; si no, directo.
  guardHome(home);
  const rt = readRuntime(home);
  let base: string | null = null;
  if (rt) {
    try { await fetch(`http://127.0.0.1:${rt.port}/api/health`, { signal: AbortSignal.timeout(500) }); base = `http://127.0.0.1:${rt.port}`; } catch { base = null; }
  }
  const direct = base ? null : await Kioku.open({ root: home });
  try {
    switch (cmd) {
      case "add": {
        const text = args.join(" ");
        if (!text.trim()) die("uso: kioku add <texto>");
        const r = direct ? await direct.capture(text) : await api<{ message: string; warnings: string[] }>(base!, "POST", "/api/capture", { text });
        console.log(`✓ ${r.message}`);
        r.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
        break;
      }
      case "today": printToday(direct ? await direct.today() : await api<TodayView>(base!, "GET", "/api/today")); break;
      case "resume": {
        const cards: ResumeCard[] = direct
          ? direct.index.listNotes({ type: "project" }).map((p) => direct.resume(p.path)!)
          : await api<ResumeCard[]>(base!, "GET", "/api/projects");
        const q = args.join(" ").toLowerCase();
        const sel = q ? cards.filter((c) => c.project.title.toLowerCase().includes(q)) : cards.filter((c) => c.project.status === "active");
        if (!sel.length) console.log("No hay proyectos que coincidan.");
        sel.forEach(printCard);
        break;
      }
      case "search": {
        const q = args.join(" ");
        const hits = direct ? direct.index.search(q) : await api<ReturnType<NonNullable<typeof direct>["index"]["search"]>>(base!, "GET", `/api/search?q=${encodeURIComponent(q)}`);
        for (const h of hits) console.log(`${h.kind === "title" ? "■" : "□"} ${h.title}  — ${h.path}\n    ${h.snippet}`);
        if (!hits.length) console.log("Sin resultados.");
        break;
      }
      case "focus": {
        const [sub, ...rest] = args;
        if (sub === "start") {
          const target = rest.join(" ");
          if (!target) die("uso: kioku focus start <tarea> | @proyecto");
          const j = direct ?? null;
          if (j) {
            const proj = target.startsWith("@") ? j.findProject(target.slice(1)) : null;
            const task = proj ? null : j.index.tasks({ status: ["todo", "doing"] }).find((t) => t.title.toLowerCase().includes(target.toLowerCase()));
            if (!proj && !task) die("No encontré esa tarea/proyecto");
            await j.startFocus(proj ? { projectPath: proj.path } : { taskPath: task!.path });
          } else {
            const tasks = await api<{ path: string; title: string }[]>(base!, "GET", "/api/tasks?status=todo,doing");
            const projects = await api<ResumeCard[]>(base!, "GET", "/api/projects");
            const proj = target.startsWith("@") ? projects.find((p) => p.project.title.toLowerCase().includes(target.slice(1).toLowerCase())) : null;
            const task = proj ? null : tasks.find((t) => t.title.toLowerCase().includes(target.toLowerCase()));
            if (!proj && !task) die("No encontré esa tarea/proyecto");
            await api(base!, "POST", "/api/focus/start", proj ? { projectPath: proj.project.path } : { taskPath: task!.path });
          }
          console.log("● Foco iniciado");
        } else if (sub === "end") {
          const mi = rest.findIndex((a) => a === "-m");
          const checkpoint = mi >= 0 ? rest[mi + 1] : undefined;
          const done = rest.includes("--done");
          const r = direct ? await direct.endFocus({ checkpoint, done }) : await api<{ minutes: number }>(base!, "POST", "/api/focus/end", { checkpoint, done });
          console.log(`○ Foco terminado (${r.minutes} min)`);
        } else die("uso: kioku focus start|end");
        break;
      }
      case "context": {
        const q = args.join(" ").toLowerCase();
        if (!q) die("uso: kioku context <proyecto>");
        const j = direct ?? (await Kioku.open({ root: home }));
        const p = j.index.listNotes({ type: "project" }).find((x) => x.title.toLowerCase().includes(q));
        if (!p) die("Proyecto no encontrado");
        J(j.contextFor(p.path));
        if (!direct) j.close();
        break;
      }
      case "triage": {
        const j = direct ?? null;
        const made = j ? await j.refreshTriage() : await api<unknown[]>(base!, "POST", "/api/triage", {});
        console.log(`${made.length} propuesta(s) nueva(s). Revísalas con: kioku proposals`);
        break;
      }
      case "ai": {
        const [sub, ...rest] = args;
        const cfgPath = path.join(home, ".kioku", "ai.json");
        if (sub === "config") {
          const [url, model, keyEnv] = rest;
          if (!url || !model) die("uso: kioku ai config <url-base> <modelo> [VARIABLE_CON_LA_CLAVE]   p. ej. http://127.0.0.1:11434/v1 llama3.1");
          const cfg = parseLlmConfig(JSON.stringify({ baseUrl: url, model, apiKeyEnv: keyEnv }));
          if (!cfg) die("configuración inválida (URL http(s) y modelo no vacío)");
          mkdirSync(path.dirname(cfgPath), { recursive: true });
          writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
          console.log(`✓ IA configurada: ${cfg.model} @ ${cfg.baseUrl}${isLocalUrl(cfg.baseUrl) ? " (local)" : " (REMOTA: los datos salen de tu máquina al enviar)"}`);
          console.log("  Nada se envía hasta que ejecutes: kioku ai triage --yes  (antes mira: kioku ai preview)");
        } else if (sub === "off") {
          if (existsSync(cfgPath)) writeFileSync(cfgPath, "");
          console.log("✓ IA desactivada.");
        } else if (sub === "status" || sub === undefined) {
          type St = { configured: boolean; model?: string; baseUrl?: string; local?: boolean; apiKeyEnv?: string | null };
          const st: St = base ? await api<St>(base, "GET", "/api/ai") : await direct!.aiConfig().then((c) => c ? { configured: true, model: c.model, baseUrl: c.baseUrl, local: isLocalUrl(c.baseUrl), apiKeyEnv: c.apiKeyEnv ?? null } : { configured: false });
          console.log(st.configured ? `IA: ${st.model} @ ${st.baseUrl} — ${st.local ? "local" : "REMOTA"}${st.apiKeyEnv ? ` · clave en $${st.apiKeyEnv}` : ""}` : "IA: sin configurar (solo reglas locales). Configura con: kioku ai config <url> <modelo>");
        } else if (sub === "preview" || sub === "triage") {
          const prev = direct ? await direct.aiPreview() : await api<LlmPayload | null>(base!, "GET", "/api/ai/preview");
          if (!prev) die("IA sin configurar o Bandeja vacía");
          console.log(`Destino: ${prev.endpoint} (${prev.local ? "local" : "REMOTO"}) · modelo ${prev.model} · ${prev.captures} captura(s)\n`);
          console.log(prev.messages.map((m) => `── ${m.role} ──\n${m.content}`).join("\n\n"));
          if (sub === "triage") {
            if (!rest.includes("--yes")) { console.log("\nNO se ha enviado nada. Para enviar exactamente esto: kioku ai triage --yes"); break; }
            const made = direct ? await direct.llmTriage(prev.hash) : await api<unknown[]>(base!, "POST", "/api/ai/triage", { hash: prev.hash });
            console.log(`\n✓ ${made.length} propuesta(s) del modelo. Revísalas con: kioku proposals`);
          }
        } else die("uso: kioku ai status|preview|config|off|triage --yes");
        break;
      }
      case "proposals": {
        const [sub, id] = args;
        if (sub === "apply" || sub === "reject") {
          if (!id) die(`uso: kioku proposals ${sub} <id>`);
          const r = direct ? (sub === "apply" ? await direct.applyProposal(id) : await direct.rejectProposal(id)) : await api<{ status: string }>(base!, "POST", `/api/proposals/${id}/${sub}`, {});
          console.log(`✓ ${r.status}`);
        } else {
          const list = direct ? await direct.proposals.list("pending") : await api<Awaited<ReturnType<NonNullable<typeof direct>["proposals"]["list"]>>>(base!, "GET", "/api/proposals");
          if (!list.length) console.log("No hay propuestas pendientes.");
          for (const p of list) {
            console.log(`${p.id}  ${p.title}\n    por qué: ${p.rationale}`);
            for (const op of p.ops) console.log(`    · ${op.op} ${"path" in op ? op.path : `${op.from} → ${op.to}`}`);
          }
        }
        break;
      }
      case "reindex": {
        const r = direct ? await direct.reindex() : await api<{ notes: number; events: number }>(base!, "POST", "/api/reindex", {});
        console.log(`Índice reconstruido: ${r.notes} notas, ${r.events} eventos`);
        break;
      }
      default: die(`comando desconocido «${cmd}». Prueba: kioku help`);
    }
  } finally {
    direct?.close();
  }
}

main().catch((e) => die((e as Error).message));
