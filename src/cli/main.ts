// CLI de JARVIS. Si el daemon corre, delega en él; si no, opera directamente sobre el vault.
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { Jarvis, type ResumeCard, type TodayView } from "../core/jarvis.ts";
import { isLocalUrl, parseLlmConfig, type LlmPayload } from "../core/llm.ts";
import { exportVault, importObsidian, restoreVault } from "../core/portability.ts";
import { startServer } from "../server/server.ts";
import { installService, serviceStatus, uninstallService } from "./service.ts";
import { daemonAlive, ensureDaemon, hideQuick, jarvisHome, openWorkspace, readRuntime, toggleQuick, webDir } from "./desktop.ts";

const HELP = `jarvis — segundo cerebro local-first

Uso: jarvis <comando> [args]

  quick                    Abre/oculta la ventana de captura rápida (asigna esto a un atajo de Hyprland)
  open                     Abre el Workspace
  add <texto>              Captura rápida sin abrir ventana:  t tarea !mañana @proyecto · d decisión · n nota
  today                    Qué hacer hoy y a qué volver
  resume [proyecto]        Dónde lo dejaste, qué se decidió, qué falta
  search <consulta>        Buscar
  focus start <tarea|@proyecto> · focus end [-m "dónde lo dejas"] [--done]
  context <proyecto>       JSON con el contexto exacto que recibiría una IA (sin memoria oculta)
  proposals [apply|reject <id>]   Propuestas pendientes de aprobación
  triage                   Genera propuestas para la Bandeja (reglas, sin red)
  ai status|preview|config <url> <modelo> [VAR_CLAVE]|off|triage --yes   IA opcional: tu modelo local o API; ves el payload antes de enviar
  reindex                  Reconstruye el índice desde los archivos
  export <archivo.tar.gz>  Copia de seguridad          restore <archivo.tar.gz> <carpeta>
  import-obsidian <ruta> [--yes]   Copia (solo lectura del origen) un vault de Obsidian
  daemon                   Servidor en primer plano     status
  service install|uninstall|status   Arranque automático con tu sesión (servicio de usuario de systemd)

Datos: ${jarvisHome()}   (cambia con JARVIS_HOME)
`;

const J = (v: unknown) => console.log(JSON.stringify(v, null, 2));

function die(msg: string): never {
  console.error(`jarvis: ${msg}`);
  process.exit(1);
}

/** Protege el vault de Obsidian: nunca adoptamos como casa una carpeta con .obsidian sin marcar. */
function guardHome(home: string): void {
  if (existsSync(path.join(home, ".obsidian")) && !existsSync(path.join(home, ".jarvis"))) {
    die(`${home} parece un vault de Obsidian. JARVIS no lo usará para no modificarlo.\n` +
        `Usa otra carpeta (JARVIS_HOME) e importa con: jarvis import-obsidian <ruta>`);
  }
}

async function api<T>(base: string, method: string, p: string, body?: unknown): Promise<T> {
  const r = await fetch(base + p, {
    method, headers: body === undefined ? undefined : { "content-type": "application/json" },
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
  } else console.log("\nNo hay tareas abiertas. Captura algo con `jarvis add`.");
  if (t.overdue) console.log(`\n⚠ ${t.overdue} vencida${t.overdue > 1 ? "s" : ""}`);
  if (t.resume.length) { console.log("\nRetomar"); t.resume.forEach(printCard); }
  console.log(`\nBandeja: ${t.inbox.count}   Propuestas por revisar: ${t.proposals}`);
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const home = jarvisHome();
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") return void console.log(HELP);

  switch (cmd) {
    case "daemon": {
      guardHome(home);
      const prev = readRuntime(home);
      if (prev && prev.pid !== process.pid && (await daemonAlive(prev.port))) {
        console.error(`Ya hay un daemon sirviendo ${home} en el puerto ${prev.port}; no se lanza otro.`);
        return;
      }
      const j = await Jarvis.open({ root: home });
      j.watch();
      const srv = await startServer(j, { port: Number(process.env.JARVIS_PORT) || undefined, webDir, onQuickHide: hideQuick, onOpenWorkspace: (route) => openWorkspace(`http://127.0.0.1:${srv.port}`, route) });
      const rtFile = path.join(home, ".jarvis", "runtime.json");
      writeFileSync(rtFile, JSON.stringify({ pid: process.pid, port: srv.port, startedAt: new Date().toISOString() }));
      console.log(`JARVIS escuchando en ${srv.url}  (datos: ${home})`);
      const stop = async () => { try { unlinkSync(rtFile); } catch { /* ya no está */ } await srv.close(); j.close(); process.exit(0); };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return;
    }
    case "quick": { guardHome(home); const base = await ensureDaemon(home); console.log(await toggleQuick(base)); return; }
    case "open": { guardHome(home); openWorkspace(await ensureDaemon(home), "/hoy"); return; }
    case "service": {
      guardHome(home);
      const sub = args[0];
      if (sub === "install") installService(home).forEach((l) => console.log(l));
      else if (sub === "uninstall") uninstallService().forEach((l) => console.log(l));
      else if (sub === "status" || !sub) console.log(serviceStatus());
      else die("uso: jarvis service install|uninstall|status");
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
      if (!archive || !dest) die("uso: jarvis restore <archivo.tar.gz> <carpeta-vacía>");
      const r = await restoreVault(archive, dest);
      console.log(`Restaurados ${r.files} archivos en ${path.resolve(dest)} (el índice se reconstruye al abrir)`);
      return;
    }
    case "import-obsidian": {
      guardHome(home);
      const src = args.find((a) => !a.startsWith("--")) ?? die("uso: jarvis import-obsidian <ruta> [--yes]");
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
  const direct = base ? null : await Jarvis.open({ root: home });
  try {
    switch (cmd) {
      case "add": {
        const text = args.join(" ");
        if (!text.trim()) die("uso: jarvis add <texto>");
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
          if (!target) die("uso: jarvis focus start <tarea> | @proyecto");
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
        } else die("uso: jarvis focus start|end");
        break;
      }
      case "context": {
        const q = args.join(" ").toLowerCase();
        if (!q) die("uso: jarvis context <proyecto>");
        const j = direct ?? (await Jarvis.open({ root: home }));
        const p = j.index.listNotes({ type: "project" }).find((x) => x.title.toLowerCase().includes(q));
        if (!p) die("Proyecto no encontrado");
        J(j.contextFor(p.path));
        if (!direct) j.close();
        break;
      }
      case "triage": {
        const j = direct ?? null;
        const made = j ? await j.refreshTriage() : await api<unknown[]>(base!, "POST", "/api/triage", {});
        console.log(`${made.length} propuesta(s) nueva(s). Revísalas con: jarvis proposals`);
        break;
      }
      case "ai": {
        const [sub, ...rest] = args;
        const cfgPath = path.join(home, ".jarvis", "ai.json");
        if (sub === "config") {
          const [url, model, keyEnv] = rest;
          if (!url || !model) die("uso: jarvis ai config <url-base> <modelo> [VARIABLE_CON_LA_CLAVE]   p. ej. http://127.0.0.1:11434/v1 llama3.1");
          const cfg = parseLlmConfig(JSON.stringify({ baseUrl: url, model, apiKeyEnv: keyEnv }));
          if (!cfg) die("configuración inválida (URL http(s) y modelo no vacío)");
          mkdirSync(path.dirname(cfgPath), { recursive: true });
          writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
          console.log(`✓ IA configurada: ${cfg.model} @ ${cfg.baseUrl}${isLocalUrl(cfg.baseUrl) ? " (local)" : " (REMOTA: los datos salen de tu máquina al enviar)"}`);
          console.log("  Nada se envía hasta que ejecutes: jarvis ai triage --yes  (antes mira: jarvis ai preview)");
        } else if (sub === "off") {
          if (existsSync(cfgPath)) writeFileSync(cfgPath, "");
          console.log("✓ IA desactivada.");
        } else if (sub === "status" || sub === undefined) {
          type St = { configured: boolean; model?: string; baseUrl?: string; local?: boolean; apiKeyEnv?: string | null };
          const st: St = base ? await api<St>(base, "GET", "/api/ai") : await direct!.aiConfig().then((c) => c ? { configured: true, model: c.model, baseUrl: c.baseUrl, local: isLocalUrl(c.baseUrl), apiKeyEnv: c.apiKeyEnv ?? null } : { configured: false });
          console.log(st.configured ? `IA: ${st.model} @ ${st.baseUrl} — ${st.local ? "local" : "REMOTA"}${st.apiKeyEnv ? ` · clave en $${st.apiKeyEnv}` : ""}` : "IA: sin configurar (solo reglas locales). Configura con: jarvis ai config <url> <modelo>");
        } else if (sub === "preview" || sub === "triage") {
          const prev = direct ? await direct.aiPreview() : await api<LlmPayload | null>(base!, "GET", "/api/ai/preview");
          if (!prev) die("IA sin configurar o Bandeja vacía");
          console.log(`Destino: ${prev.endpoint} (${prev.local ? "local" : "REMOTO"}) · modelo ${prev.model} · ${prev.captures} captura(s)\n`);
          console.log(prev.messages.map((m) => `── ${m.role} ──\n${m.content}`).join("\n\n"));
          if (sub === "triage") {
            if (!rest.includes("--yes")) { console.log("\nNO se ha enviado nada. Para enviar exactamente esto: jarvis ai triage --yes"); break; }
            const made = direct ? await direct.llmTriage(prev.hash) : await api<unknown[]>(base!, "POST", "/api/ai/triage", { hash: prev.hash });
            console.log(`\n✓ ${made.length} propuesta(s) del modelo. Revísalas con: jarvis proposals`);
          }
        } else die("uso: jarvis ai status|preview|config|off|triage --yes");
        break;
      }
      case "proposals": {
        const [sub, id] = args;
        if (sub === "apply" || sub === "reject") {
          if (!id) die(`uso: jarvis proposals ${sub} <id>`);
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
      default: die(`comando desconocido «${cmd}». Prueba: jarvis help`);
    }
  } finally {
    direct?.close();
  }
}

main().catch((e) => die((e as Error).message));
