import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { parseCapture } from "../src/core/capture.ts";
import { parseWhen, addDays } from "../src/core/dates.ts";
import { tmpVault } from "./helpers.ts";

function clock(start: string) {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), advance: (ms: number) => { t += ms; } };
}
const H = 3_600_000, D = 24 * H;

test("parseWhen / parseCapture", () => {
  const today = "2026-10-26"; // lunes
  assert.equal(parseWhen("mañana", today), "2026-10-27");
  assert.equal(parseWhen("lunes", today), "2026-11-02");
  assert.equal(parseWhen("+3d", today), "2026-10-29");
  assert.equal(parseWhen("2026-02-30", today), null);
  const p = parseCapture("t Llamar al banco !mañana @Kioku p1", today);
  assert.deepEqual([p.kind, p.title, p.due, p.projectQuery, p.priority], ["task", "Llamar al banco", "2026-10-27", "Kioku", 1]);
  assert.equal(parseCapture("idea suelta con #tag", today).kind, "capture");
  assert.equal(parseCapture("t Revisar !jamas", today).unparsed[0], "!jamas");
  assert.equal(parseCapture("d Usar SQLite @kioku", today).kind, "decision");
});

test("Quick: captura, tarea con proyecto/fecha, decisión", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const c = clock("2026-10-26T09:00:00");
    const j = await Kioku.open({ root, now: c.now });
    const proj = await j.createProject("Kioku");
    const r1 = await j.capture("idea: probar tmux popup");
    assert.equal(r1.message, "Guardado en Bandeja");
    assert.match(r1.path, /^Bandeja\//);
    const r2 = await j.capture("t Cablear watcher !mañana @kio p1");
    const t = j.index.tasks({ status: ["todo"] })[0];
    assert.equal(t.due, "2026-10-27");
    assert.equal(t.priority, 1);
    assert.equal(t.projectPath, proj.path);
    assert.equal(r2.warnings.length, 0);
    await j.capture("d Usar SQLite solo como índice @kioku");
    const card = j.resume(proj.path)!;
    assert.match(card.decisions[0], /Usar SQLite solo como índice/);
    await assert.rejects(j.capture("d Sin proyecto"), /proyecto/);
    j.close();
  } finally { cleanup(); }
});

test("P1 Hoy: sugerencia determinista y explicable", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const c = clock("2026-10-26T09:00:00");
    const j = await Kioku.open({ root, now: c.now });
    await j.capture("t Pagar luz !hoy");
    await j.capture("t Leer paper p1");
    await j.capture("t Tarea vencida !2026-10-20");
    await j.capture("t Sin nada");
    const v = await j.today();
    assert.equal(v.suggestion!.task.title, "Tarea vencida");
    assert.deepEqual(v.suggestion!.reasons, ["venció hace 6 días"]);
    assert.deepEqual(v.alternatives.map((a) => a.task.title), ["Pagar luz", "Leer paper"]);
    assert.equal(v.overdue, 1);
    j.close();
  } finally { cleanup(); }
});

test("P2 Foco: las capturas durante el foco se aparcan y reaparecen al terminar", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const c = clock("2026-10-26T09:00:00");
    const j = await Kioku.open({ root, now: c.now });
    const proj = await j.createProject("Kioku");
    await j.capture("t Cablear watcher @kioku");
    const task = j.index.tasks()[0];
    await j.startFocus({ taskPath: task.path });
    assert.equal(j.focusState().active, true);
    assert.equal(j.index.getNote(task.path)!.fm.status, "doing");
    await assert.rejects(j.startFocus({ taskPath: task.path }), /activa/);

    const r = await j.capture("se me ocurre otra cosa");
    assert.equal(r.parked, true);
    assert.equal(j.inbox().length, 0, "no aparece mientras dura el foco");
    const t2 = await j.capture("t Tarea nueva distractora");
    assert.equal(t2.parked, true);
    const hoy = await j.today();
    assert.equal(hoy.suggestion!.task.title, "Cablear watcher", "la tarea en foco sigue siendo la sugerida");
    assert.deepEqual(hoy.alternatives, [], "la tarea distractora aparcada no aparece");
    c.advance(25 * 60_000);
    const end = await j.endFocus({ checkpoint: "falta cablear el watcher al índice" });
    assert.equal(end.minutes, 25);
    assert.equal(j.inbox().length, 1, "reaparece al terminar");
    assert.equal(j.focusState().active, false);
    assert.equal(j.resume(proj.path)!.lastCheckpoint!.text, "falta cablear el watcher al índice");
    j.close();
  } finally { cleanup(); }
});

test("P3 Retomar: tarjeta con checkpoint, decisiones, pendientes y días de inactividad", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const c = clock(new Date().toISOString()); // mtime de archivos es real: el reloj simulado parte de ahora
    const j = await Kioku.open({ root, now: c.now });
    const proj = await j.createProject("Proyecto X");
    await j.createNote({ title: "Notas de diseño X", body: "enlaza [[Proyecto X]]\n" });
    await j.capture("t Terminar la API @proyecto-x");
    await j.capture("t Escribir pruebas @proyecto-x !2026-10-30");
    await j.capture("d Decidido: Postgres no, SQLite sí @proyecto-x");
    await j.addCheckpoint(proj.path, "dejado en el endpoint de búsqueda");
    c.advance(3 * D);
    const card = j.resume(proj.path)!;
    assert.equal(card.idleDays, 3);
    assert.equal(card.lastCheckpoint!.text, "dejado en el endpoint de búsqueda");
    assert.match(card.decisions[0], /SQLite sí/);
    assert.deepEqual(card.open.map((t) => t.title), ["Escribir pruebas", "Terminar la API"]);
    assert.deepEqual(card.touched.map((t) => t.title), ["Notas de diseño X"]);
    // el archivo de proyecto sigue siendo Markdown legible
    const md = readFileSync(path.join(root, proj.path), "utf8");
    assert.match(md, /## Bitácora\n\n- \d{4}-\d{2}-\d{2} \d{2}:\d{2} — dejado en el endpoint de búsqueda/);
    j.close();
  } finally { cleanup(); }
});

test("Propuestas: triage por reglas, aplicar con hash, conflicto y rechazo", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const c = clock("2026-10-26T09:00:00");
    const j = await Kioku.open({ root, now: c.now });
    await j.createProject("Kioku");
    const t = await j.capture("Revisar el diseño de Kioku");
    const n = await j.capture("Una idea sobre cocina");
    const made = await j.refreshTriage();
    assert.equal(made.length, 2);
    assert.equal((await j.refreshTriage()).length, 0, "no duplica propuestas pendientes");
    const pTask = made.find((p) => p.title.startsWith("Convertir en tarea"))!;
    assert.match(pTask.title, /«Kioku»/);
    // nada cambió todavía
    assert.ok(j.vault.exists(t.path));
    await j.applyProposal(pTask.id);
    assert.equal(j.vault.exists(t.path), false);
    const moved = j.index.tasks()[0];
    assert.equal(moved.title, "Revisar el diseño de Kioku");
    assert.equal(moved.projectTitle, "Kioku");
    // conflicto: se modifica externamente la otra captura
    const pNote = made.find((p) => p !== pTask)!;
    writeFileSync(path.join(root, n.path), readFileSync(path.join(root, n.path), "utf8") + "\ncambio externo\n");
    await assert.rejects(j.applyProposal(pNote.id), /cambió/);
    assert.ok(j.vault.exists(n.path), "no se tocó nada");
    await j.rejectProposal(pNote.id);
    assert.equal((await j.proposals.get(pNote.id))!.status, "rejected");
    await assert.rejects(j.applyProposal(pNote.id), /ya está/);
    j.close();
  } finally { cleanup(); }
});

test("Guardado con conflicto: no sobrescribe cambios externos", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const j = await Kioku.open({ root });
    const note = await j.createNote({ title: "Mi nota", body: "uno\n" });
    const r = await j.readNote(note.path);
    writeFileSync(path.join(root, note.path), r.text + "externo\n");
    await assert.rejects(j.saveNote(note.path, r.text + "mio\n", r.hash), /cambió fuera/);
    assert.match(readFileSync(path.join(root, note.path), "utf8"), /externo/);
    j.close();
  } finally { cleanup(); }
});

test("Reindex: borrar el índice no pierde nada y reproduce el mismo estado", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const j = await Kioku.open({ root });
    const p = await j.createProject("Alfa");
    await j.capture("t Hacer algo @alfa !hoy");
    await j.capture("d Decisión importante @alfa");
    await j.startFocus({ projectPath: p.path });
    const before = JSON.stringify({ t: await j.today(), r: j.resume(p.path) });
    const out = await j.reindex();
    assert.ok(out.notes >= 2 && out.events >= 3);
    const after = JSON.stringify({ t: await j.today(), r: j.resume(p.path) });
    assert.equal(after, before);
    j.close();
    // reabrir desde cero (sin index.db) también reproduce
    const files = readdirSync(path.join(root, ".kioku"));
    assert.ok(files.includes("index.db") && files.includes("log"));
    const j2 = await Kioku.open({ root });
    assert.equal(j2.focusState().active, true);
    j2.close();
  } finally { cleanup(); }
});

test("el log de actividad es JSONL plano y tolera líneas corruptas", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const j = await Kioku.open({ root, now: () => new Date("2026-10-26T10:00:00Z") });
    await j.capture("algo");
    const f = path.join(root, ".kioku/log/2026-10.jsonl");
    writeFileSync(f, readFileSync(f, "utf8") + "esto no es json\n");
    assert.equal(await j.log.reload(), 1);
    j.close();
  } finally { cleanup(); }
});

test("convertCapture: Bandeja → tarea/nota, y rechaza lo que no es captura", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const j = await Kioku.open({ root, now: () => new Date("2026-10-26T10:00:00Z") });
    const a = await j.capture("Comprar café");
    const b = await j.capture("Una idea para después");
    const t = await j.convertCapture(a.path, "task");
    assert.equal(t.type, "task");
    assert.ok(t.path.startsWith("Tareas/"));
    assert.equal(j.index.getNote(a.path), null);
    assert.equal(j.index.tasks({ status: ["todo"] }).length, 1);
    const n = await j.convertCapture(b.path, "note");
    assert.ok(n.path.startsWith("Notas/"));
    assert.equal(j.inbox().length, 0);
    await assert.rejects(() => j.convertCapture(t.path, "note"), /capturas/);
    j.close();
  } finally { cleanup(); }
});

test("IA real: payload visible, hash obligatorio, el modelo solo clasifica y todo pasa por Propuestas", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const j = await Kioku.open({ root, now: clock("2026-10-26T09:00:00").now });
    await j.createProject("Kioku");
    const a = await j.capture("Idea suelta sobre el diseño");
    await j.capture("Llamar al dentista");
    assert.equal(await j.aiPreview(), null, "sin configuración no hay IA");

    await j.setAiConfig({ baseUrl: "http://127.0.0.1:11434/v1/", model: "test-model" });
    const prev = (await j.aiPreview())!;
    assert.equal(prev.local, true);
    assert.equal(prev.endpoint, "http://127.0.0.1:11434/v1/chat/completions");
    assert.equal(prev.captures, 2);
    assert.match(prev.messages[1].content, /Idea suelta sobre el diseño/);

    let sent: { model: string; messages: unknown[] } | null = null;
    const reply = (content: string) => (async (_u: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }) as typeof fetch;

    // los datos enviados son EXACTAMENTE los de la vista previa
    await assert.rejects(j.llmTriage("hash-incorrecto", reply("{}")), /cambió/);
    assert.equal(sent, null, "con hash incorrecto no se hace ninguna petición");

    const rules = await j.refreshTriage(); // propuestas por reglas ya existentes para las mismas capturas
    assert.equal(rules.length, 2);
    const prev2 = (await j.aiPreview())!;
    const content = "```json\n" + JSON.stringify({ items: [
      { path: a.path, kind: "task", project: "kioku", reason: "Es una acción de diseño" },
      { path: "Bandeja/inventada.md", kind: "task", project: null, reason: "x" },
      { path: "../../etc/passwd", kind: "note", project: null, reason: "x" },
    ] }) + "\n```";
    const made = await j.llmTriage(prev2.hash, reply(content));
    assert.deepEqual(JSON.parse(JSON.stringify(sent!.messages)), JSON.parse(JSON.stringify(prev2.messages)));
    assert.equal(made.length, 1, "se descartan rutas que no están en la Bandeja");
    assert.equal(made[0].source, "llm:test-model");
    assert.match(made[0].title, /tarea de «Kioku»/);
    assert.ok(j.vault.exists(a.path), "el modelo no modifica el vault");
    const pend = await j.proposals.list("pending");
    assert.equal(pend.filter((p) => p.key === `triage:${a.path}`).length, 1, "sustituye la propuesta de reglas de esa captura");
    assert.ok(j.index.events({ kinds: ["ai.request"] }).length === 1, "queda registrado en la actividad");
    j.close();
  } finally { cleanup(); }
});

test("IA real: respuesta no válida o fallo del modelo → error, sin propuestas", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const j = await Kioku.open({ root, now: clock("2026-10-26T09:00:00").now });
    await j.capture("Algo");
    await j.setAiConfig({ baseUrl: "https://api.example.com/v1", model: "m", apiKeyEnv: "KIOKU_TEST_NO_KEY" });
    const prev = (await j.aiPreview())!;
    assert.equal(prev.local, false);
    await assert.rejects(j.llmTriage(prev.hash, (async () => new Response("{}")) as typeof fetch), /KIOKU_TEST_NO_KEY/);
    delete process.env.KIOKU_TEST_NO_KEY;
    process.env.KIOKU_TEST_NO_KEY = "k";
    try {
      await assert.rejects(j.llmTriage(prev.hash, (async () => new Response("no json", { status: 200 })) as typeof fetch), /JSON|inesperada/);
      await assert.rejects(j.llmTriage(prev.hash, (async () => new Response("boom", { status: 500 })) as typeof fetch), /500/);
    } finally { delete process.env.KIOKU_TEST_NO_KEY; }
    assert.equal((await j.proposals.list("pending")).length, 0);
    j.close();
  } finally { cleanup(); }
});
