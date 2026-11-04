// Asistente desde el móvil: mismas herramientas y aprobaciones, pero con la privacidad del móvil ligada a CADA llamada de la sesión.
// Todo con bóvedas temporales, motor falso y las dos claves (completa y móvil); nunca datos reales.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { loadOrCreateMobileKey, revokeMobileKey } from "../src/server/key.ts";
import { mobileAllowed, mobileProposalVisible, mobileToolText } from "../src/server/mobile.ts";
import type { AssistantEngine } from "../src/assistant/engine.ts";
import { tmpVault } from "./helpers.ts";

const KEY = "a".repeat(64);
const FM = (extra: string) => `---\nid: 01HX${Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(22, "0")}\ncreated: 2026-10-27T00:00:00.000Z\n${extra}---\n`;
const SEED = {
  "Notas/Publica.md": FM("type: note\n") + "Texto público original.\n",
  "Privado/Secreto.md": FM("type: note\n") + "MARCASECRETA contenido reservado\n",
  "Privado/Proyecto oculto.md": FM("type: project\nstatus: active\n") + "MARCASECRETA proyecto\n",
  "Tareas/Tarea publica.md": FM("type: task\nstatus: todo\n") + "Hacer algo\n",
};

type AskInput = Parameters<AssistantEngine["ask"]>[0];
type Tool = (name: string, args?: unknown) => Promise<{ text: string; isError?: boolean; undoId?: string }>;
type Script = (i: AskInput, tool: Tool) => Promise<string>;

/** Motor falso: ejecuta un guion de llamadas a herramientas con el token de la sesión, como haría el puente MCP. */
function fakeEngine(script: Script, isolatesMobile = true) {
  const asked: { conversation: string; role: string }[] = [];
  const engine: AssistantEngine & { isolatesMobile?: boolean } = {
    available: async () => ({ ok: true }),
    ask: async (i) => {
      asked.push({ conversation: i.conversation, role: i.session.role });
      const tool: Tool = async (name, args = {}) => (await fetch(`${i.daemonUrl}/api/assistant/tools/call`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${i.session.token}` }, body: JSON.stringify({ name, args }),
      })).json() as never;
      return { answer: await script(i, tool) };
    },
  };
  if (isolatesMobile) engine.isolatesMobile = true;
  return { engine, asked };
}

async function setup(opts: { script?: Script; isolates?: boolean; mobileExclude?: string[]; assistantExclude?: string[]; noEngine?: boolean } = {}) {
  const { root, cleanup } = tmpVault(SEED);
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  mkdirSync(path.join(root, ".kioku"), { recursive: true });
  const config = (name: string, exclude: string[]) => writeFileSync(path.join(root, ".kioku", name), JSON.stringify({ exclude }));
  config("mobile.json", opts.mobileExclude ?? ["Privado/"]);
  if (opts.assistantExclude) config("assistant.json", opts.assistantExclude);
  const j = await Kioku.open({ root });
  const fake = fakeEngine(opts.script ?? (async () => "ok"), opts.isolates ?? true);
  const srv = await startServer(j, { port: 0, webDir: web, key: KEY, assistant: opts.noEngine ? undefined : { engine: fake.engine } });
  const mk = loadOrCreateMobileKey(root);
  const call = async (method: string, p: string, body?: unknown, key: string | null = mk, headers: Record<string, string> = {}) => {
    const r = await fetch(srv.url + p, {
      method, headers: { ...(key ? { "x-kioku-key": key } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() as any };
  };
  return { j, srv, root, mk, call, asked: fake.asked, config, done: async () => { await srv.close(); j.close(); cleanup(); } };
}

const ask = (s: Awaited<ReturnType<typeof setup>>, message = "hola", conversation?: string, key: string | null = s.mk) =>
  s.call("POST", "/api/assistant/ask", { message, ...(conversation ? { conversation } : {}) }, key);
const parse = (r: { text: string }) => JSON.parse(r.text);

// ───────── S3: el móvil habla con el asistente y la privacidad viaja con la sesión ─────────

test("móvil: preguntar al asistente funciona y la consulta se identifica como móvil", async () => {
  const s = await setup({ script: async (_i, tool) => { await tool("read_note", { path: "Notas/Publica.md" }); return "Hay una nota pública."; } });
  try {
    const r = await ask(s, "¿qué hay?", "c1");
    assert.equal(r.status, 200);
    assert.equal(r.json.answer, "Hay una nota pública.");
    assert.deepEqual(r.json.reads, ["Notas/Publica.md"]);
    assert.deepEqual(r.json.actions, []);
    assert.equal(s.asked.length, 1);
    assert.equal(s.asked[0].role, "mobile");
    assert.match(s.asked[0].conversation, /^mobile:[0-9a-f]{12}:c1$/, "conversación atada al rol y a la huella de privacidad");
    const st = await s.call("GET", "/api/assistant/status");
    assert.deepEqual([st.status, st.json], [200, { ok: true }]);
  } finally { await s.done(); }
});

test("móvil: lo privado no existe para el asistente (buscar, leer, escribir, listar) y nada cambia ni se filtra", async () => {
  const seen: string[] = [];
  const s = await setup({
    script: async (_i, tool) => {
      const out = [
        await tool("search", { query: "MARCASECRETA" }), await tool("read_note", { path: "Privado/Secreto.md" }),
        await tool("append_to_note", { path: "Privado/Secreto.md", text: "intruso" }), await tool("set_props", { path: "Privado/Secreto.md", props: { x: 1 } }),
        await tool("list_notes", {}), await tool("today", {}), await tool("get_project", { path: "Privado/Proyecto oculto.md" }),
        await tool("propose", { title: "Borrar", rationale: "x", ops: [{ op: "trash", path: "Privado/Secreto.md" }] }),
        await tool("neighbors", { path: "Privado/Secreto.md" }),
      ];
      seen.push(...out.map((o) => (o.isError ? "E:" : "ok:") + o.text));
      return "listo";
    },
  });
  try {
    const before = (await s.j.vault.read("Privado/Secreto.md")).text;
    const r = await ask(s);
    assert.equal(r.status, 200);
    assert.deepEqual(seen.map((x) => x.slice(0, 2)), ["ok", "E:", "E:", "E:", "ok", "ok", "E:", "E:", "E:"]);
    assert.doesNotMatch(seen.join("\n") + r.text, /MARCASECRETA|Privado\/Secreto|Proyecto oculto/);
    assert.equal((await s.j.vault.read("Privado/Secreto.md")).text, before, "la nota privada no cambió");
    assert.deepEqual(await s.j.proposals.list(), [], "ni siquiera como propuesta");
    // el mismo servidor, con la clave completa, sí la lee: el filtro es de la sesión, no global
    const full = await s.call("POST", "/api/assistant/ask", { message: "hola" }, KEY);
    assert.equal(full.status, 200);
  } finally { await s.done(); }
});

test("móvil: la exclusión del móvil y la del asistente se suman; escribir en una carpeta privada se rechaza", async () => {
  const results: Record<string, { isError?: boolean; text: string }> = {};
  const s = await setup({
    mobileExclude: ["Tareas/"], assistantExclude: ["Notas/"],
    script: async (i, tool) => {
      const tag = i.session.role;
      results[`${tag}:nota`] = await tool("read_note", { path: "Notas/Publica.md" });
      results[`${tag}:tareaLeer`] = await tool("read_note", { path: "Tareas/Tarea publica.md" });
      results[`${tag}:crear`] = await tool("create_task", { title: "Desde el asistente" });
      return "hecho";
    },
  });
  try {
    assert.equal((await ask(s)).status, 200);
    assert.equal((await s.call("POST", "/api/assistant/ask", { message: "hola" }, KEY)).status, 200);
    assert.equal(results["mobile:nota"].isError, true, "la exclusión del asistente también vale en el móvil");
    assert.equal(results["mobile:tareaLeer"].isError, true, "la privada del móvil");
    assert.equal(results["mobile:crear"].isError, true, "crear dentro de una carpeta privada del móvil se rechaza");
    // el escritorio conserva su comportamiento: solo cuenta assistant.json
    assert.equal(results["full:nota"].isError, true);
    assert.equal(results["full:tareaLeer"].isError, undefined);
    assert.equal(results["full:crear"].isError, undefined);
    assert.ok(s.j.vault.exists("Tareas/Desde el asistente.md"), "la creó la sesión de escritorio, no la del móvil");
  } finally { await s.done(); }
});

test("móvil: cambiar privacidad durante una consulta bloquea las herramientas y descarta toda la respuesta", async () => {
  let step = "";
  const s = await setup({
    script: async (_i, tool) => {
      const first = await tool("read_note", { path: "Notas/Publica.md" });
      step = first.isError ? "bloqueada" : "legible";
      s.config("mobile.json", ["Privado/", "Notas/"]);
      const second = await tool("read_note", { path: "Notas/Publica.md" });
      step += second.isError ? "+bloqueada" : "+legible";
      return "fin";
    },
  });
  try {
    const r = await ask(s);
    assert.equal(step, "legible+bloqueada");
    assert.equal(r.status, 409, "se descarta también el texto libre que podría recordar la nota ahora privada");
    assert.doesNotMatch(r.text, /fin|Texto público original/);
  } finally { await s.done(); }
});

test("móvil: una actividad de calendario ligada a un proyecto privado tampoco se lista ni se lee desde el asistente", async () => {
  const out: Record<string, { isError?: boolean; text: string }> = {};
  const s = await setup({
    script: async (i, tool) => {
      const day = (await s.j.today()).date as string;
      out[`${i.session.role}:list`] = await tool("list_events", { from: day, to: day });
      out[`${i.session.role}:read`] = await tool("read_note", { path: "Calendario/oculta-0001.md" });
      return "ok";
    },
  });
  try {
    const day = (await s.j.today()).date as string;
    await s.j.calendar.create({ id: "oculta-0001", title: "Cita reservada", kind: "event", start: `${day}T10:00`, end: `${day}T11:00`, projectPath: "Privado/Proyecto oculto.md" });
    await ask(s);
    await s.call("POST", "/api/assistant/ask", { message: "hola" }, KEY);
    assert.doesNotMatch(out["mobile:list"].text, /Cita reservada|oculta-0001/);
    assert.equal(out["mobile:read"].isError, true);
    assert.match(out["full:list"].text, /Cita reservada/, "el escritorio la sigue viendo");
  } finally { await s.done(); }
});

test("móvil: las conversaciones se atan al rol: el escritorio y el móvil nunca comparten identificador", async () => {
  const s = await setup();
  try {
    await ask(s, "a", "x", KEY);
    await ask(s, "b", "x");
    await ask(s, "c");
    await ask(s, "d", "mobile:x", KEY);
    const [desk, mob, def, deskMobileLike] = s.asked;
    assert.deepEqual([desk, def.role, deskMobileLike], [{ conversation: "x", role: "full" }, "mobile", { conversation: "mobile:x", role: "full" }], "el escritorio conserva sus identificadores tal cual");
    assert.match(mob.conversation, /^mobile:[0-9a-f]{12}:x$/);
    assert.notEqual(mob.conversation, desk.conversation);
    assert.notEqual(mob.conversation, deskMobileLike.conversation, "ni escribiendo «mobile:x» desde el escritorio se cae en la del móvil");
    assert.match(def.conversation, /^mobile:[0-9a-f]{12}:default$/);
    assert.equal(mob.conversation.split(":")[1], def.conversation.split(":")[1], "misma privacidad, mismo espacio");
  } finally { await s.done(); }
});

test("móvil: sin aislamiento del motor o sin asistente configurado, preguntar es un 503 explícito (el escritorio sigue igual)", async () => {
  const noIso = await setup({ isolates: false });
  try {
    const st = await noIso.call("GET", "/api/assistant/status");
    assert.equal(st.json.ok, false);
    assert.match(st.json.reason, /móvil/);
    const r = await ask(noIso);
    assert.equal(r.status, 503);
    assert.deepEqual(noIso.asked, [], "el motor ni se invoca");
    assert.equal((await ask(noIso, "hola", undefined, KEY)).status, 200);
    assert.equal((await noIso.call("GET", "/api/assistant/status", undefined, KEY)).json.ok, true);
  } finally { await noIso.done(); }
  const none = await setup({ noEngine: true });
  try {
    assert.equal((await none.call("GET", "/api/assistant/status")).json.ok, false);
    assert.equal((await ask(none)).status, 503);
  } finally { await none.done(); }
});

test("móvil: un mensaje vacío o un config roto no llegan al motor", async () => {
  const s = await setup();
  try {
    assert.equal((await s.call("POST", "/api/assistant/ask", { message: "   " })).status, 400);
    writeFileSync(path.join(s.root, ".kioku", "mobile.json"), "{roto");
    assert.equal((await ask(s)).status, 503);
    writeFileSync(path.join(s.root, ".kioku", "mobile.json"), JSON.stringify({ exclude: ["Privado/"] }));
    writeFileSync(path.join(s.root, ".kioku", "assistant.json"), "{roto");
    assert.equal((await ask(s)).status, 503);
    assert.deepEqual(s.asked, []);
  } finally { await s.done(); }
});

// ───────── Lo que el móvil sigue sin poder hacer ─────────

test("móvil: memoria, herramientas, borrar recuerdos y configuración siguen prohibidos; el token de una sesión no abre rutas de escritorio", async () => {
  const s = await setup();
  try {
    const sess = s.srv.sessions.open("mobile");
    const bearer = { authorization: `Bearer ${sess.token}` };
    for (const [m, p, b] of [
      ["GET", "/api/assistant/memory"], ["POST", "/api/assistant/memory/delete", { path: "a.md" }],
      ["GET", "/api/assistant/tools/list"], ["POST", "/api/assistant/tools/call", { name: "today", args: {} }],
      ["GET", "/api/ai"], ["POST", "/api/ai/triage", {}], ["POST", "/api/triage", {}], ["POST", "/api/reindex", {}],
    ] as [string, string, unknown?][]) {
      assert.equal((await s.call(m, p, b)).status, 403, `${m} ${p} con clave móvil`);
      assert.equal((await s.call(m, p, b, s.mk, bearer)).status, 403, `${m} ${p} con clave móvil y token`);
    }
    // el token de sesión solo vale en las dos rutas del puente; en otras no hay clave → 401
    assert.equal((await s.call("GET", "/api/today", undefined, null, bearer)).status, 401);
    assert.equal((await s.call("POST", "/api/assistant/undo", { id: "0".repeat(26) }, null, bearer)).status, 401);
    assert.equal((await s.call("GET", "/api/assistant/status", undefined, "b".repeat(64))).status, 401);
  } finally { await s.done(); }
});

// ───────── S4: criticidad, propuestas y deshacer desde el móvil ─────────

test("móvil: una acción crítica queda como propuesta (no se aplica sola), se ve en el móvil y solo cambia al aprobarla", async () => {
  const s = await setup({ script: async (_i, tool) => { const r = await tool("propose", { title: "Descartar la nota", rationale: "Está repetida", ops: [{ op: "trash", path: "Notas/Publica.md" }] }); return r.isError ? r.text : "Propuesta lista."; } });
  try {
    assert.equal((await ask(s)).status, 200);
    assert.ok(s.j.vault.exists("Notas/Publica.md"), "antes de aprobar no se toca nada");
    const list = await s.call("GET", "/api/proposals?status=pending");
    assert.equal(list.status, 200);
    assert.equal(list.json.length, 1);
    assert.equal(list.json[0].title, "Descartar la nota");
    const id = list.json[0].id;
    assert.equal((await s.call("POST", `/api/proposals/${id}/apply`, {})).status, 200);
    assert.ok(!s.j.vault.exists("Notas/Publica.md"), "aprobada: va a la papelera");
    assert.equal((await s.call("GET", "/api/proposals?status=pending")).json.length, 0);
  } finally { await s.done(); }
});

test("móvil: rechazar una propuesta desde el móvil no toca la nota; si la nota cambió, aprobar aborta entera", async () => {
  const s = await setup({ script: async (_i, tool) => { await tool("propose", { title: "Reescribir", rationale: "x", ops: [{ op: "update", path: "Notas/Publica.md", text: "Texto nuevo\n" }] }); return "ok"; } });
  try {
    await ask(s);
    await ask(s);
    const [a, b] = (await s.call("GET", "/api/proposals?status=pending")).json as { id: string }[];
    assert.equal((await s.call("POST", `/api/proposals/${a.id}/reject`, {})).status, 200);
    assert.match((await s.j.vault.read("Notas/Publica.md")).text, /Texto público original/);
    const cur = await s.j.vault.read("Notas/Publica.md");
    await s.j.saveNote("Notas/Publica.md", cur.text + "cambio mío\n", cur.hash);
    assert.equal((await s.call("POST", `/api/proposals/${b.id}/apply`, {})).status, 409);
    assert.match((await s.j.vault.read("Notas/Publica.md")).text, /cambio mío/);
    assert.equal((await s.j.proposals.get(b.id))?.status, "pending");
  } finally { await s.done(); }
});

test("móvil: las propuestas del escritorio y las que tocan algo privado no se ven ni se resuelven desde el móvil, sin cambios", async () => {
  const s = await setup({ script: async (_i, tool) => { await tool("propose", { title: "Mover", rationale: "x", ops: [{ op: "move", from: "Notas/Publica.md", to: "Notas/Movida.md" }] }); return "ok"; } });
  try {
    const hash = async (p: string) => (await s.j.vault.read(p)).hash;
    const secret = await s.j.createProposal({ source: "assistant", title: "Descartar MARCASECRETA", rationale: "privada", ops: [{ op: "trash", path: "Privado/Secreto.md", before: await hash("Privado/Secreto.md") }] });
    const desk = await s.j.createProposal({ source: "assistant", title: "Visible pero de escritorio", rationale: "x", ops: [{ op: "trash", path: "Tareas/Tarea publica.md", before: await hash("Tareas/Tarea publica.md") }] });
    await ask(s);
    const list = await s.call("GET", "/api/proposals");
    assert.deepEqual(list.json.map((p: { title: string }) => p.title), ["Mover"]);
    assert.doesNotMatch(list.text, /MARCASECRETA|Privado|escritorio/);
    for (const pr of [secret, desk]) {
      for (const what of ["apply", "reject"]) assert.equal((await s.call("POST", `/api/proposals/${pr.id}/${what}`, {})).status, 404, `${what} ${pr.title}`);
      assert.equal((await s.j.proposals.get(pr.id))?.status, "pending");
    }
    assert.ok(s.j.vault.exists("Privado/Secreto.md") && s.j.vault.exists("Tareas/Tarea publica.md"));
    // la del móvil pasa a tocar algo privado: se esconde y no se aplica
    s.config("mobile.json", ["Privado/", "Notas/"]);
    const mine = (await s.j.proposals.list("pending")).find((p) => p.title === "Mover")!;
    assert.deepEqual((await s.call("GET", "/api/proposals")).json, []);
    assert.equal((await s.call("POST", `/api/proposals/${mine.id}/apply`, {})).status, 404);
    assert.ok(s.j.vault.exists("Notas/Publica.md") && !s.j.vault.exists("Notas/Movida.md"));
    // el escritorio las ve todas
    assert.equal((await s.call("GET", "/api/proposals", undefined, KEY)).json.length, 3);
  } finally { await s.done(); }
});

test("móvil: el contador de propuestas de «Hoy» solo cuenta las visibles para el móvil", async () => {
  const s = await setup({ script: async (_i, tool) => { await tool("propose", { title: "Mía", rationale: "x", ops: [{ op: "trash", path: "Notas/Publica.md" }] }); return "ok"; } });
  try {
    await s.j.createProposal({ source: "assistant", title: "Ajena", rationale: "x", ops: [{ op: "create", path: "Privado/Nueva.md", text: "x" }] });
    await ask(s);
    assert.equal((await s.call("GET", "/api/today", undefined, KEY)).json.proposals, 2);
    assert.equal((await s.call("GET", "/api/today")).json.proposals, 1);
  } finally { await s.done(); }
});

test("móvil: una acción automática se devuelve sin textos previos, se ve en Actividad y se deshace desde el móvil", async () => {
  const s = await setup({ script: async (_i, tool) => { await tool("append_to_note", { path: "Notas/Publica.md", text: "añadido" }); await tool("create_task", { title: "Tarea nueva" }); return "ok"; } });
  try {
    const r = await ask(s);
    assert.equal(r.json.actions.length, 2);
    assert.doesNotMatch(r.text, /Texto público original/, "la instantánea previa no viaja al móvil");
    for (const a of r.json.actions) assert.ok(a.files.every((f: { beforeText: unknown }) => f.beforeText === null));
    const list = await s.call("GET", "/api/assistant/actions");
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.map((a: { id: string }) => a.id).sort(), r.json.actions.map((a: { id: string }) => a.id).sort());
    assert.doesNotMatch(list.text, /Texto público original/);
    const task = r.json.actions.find((a: { tool: string }) => a.tool === "create_task");
    assert.equal((await s.call("POST", "/api/assistant/undo", { id: task.id })).status, 200);
    assert.ok(!s.j.vault.exists("Tareas/Tarea nueva.md"));
    assert.equal((await s.call("POST", "/api/assistant/undo", { id: task.id })).status, 400, "ya deshecha");
  } finally { await s.done(); }
});

test("móvil: deshacer no pisa cambios posteriores (409) y no alcanza acciones del escritorio ni de carpetas que ya son privadas", async () => {
  let n = 0;
  const s = await setup({ script: async (_i, tool) => { await tool("create_task", { title: `Tarea ${++n}` }); return "ok"; } });
  try {
    const mine = (await ask(s)).json.actions[0];
    const cur = await s.j.vault.read(mine.files[0].path);
    await s.j.saveNote(mine.files[0].path, cur.text + "editada\n", cur.hash);
    assert.equal((await s.call("POST", "/api/assistant/undo", { id: mine.id })).status, 409);
    assert.ok(s.j.vault.exists(mine.files[0].path), "conflicto: nada se pisó");

    const desk = (await ask(s, "hola", undefined, KEY)).json.actions[0];
    assert.equal((await s.call("POST", "/api/assistant/undo", { id: desk.id })).status, 404);
    assert.ok(s.j.vault.exists(desk.files[0].path));
    assert.ok(!(await s.call("GET", "/api/assistant/actions")).json.some((a: { id: string }) => a.id === desk.id));

    const third = (await ask(s)).json.actions[0];
    s.config("mobile.json", ["Privado/", "Tareas/"]);
    assert.deepEqual((await s.call("GET", "/api/assistant/actions")).json, []);
    assert.equal((await s.call("POST", "/api/assistant/undo", { id: third.id })).status, 404);
    assert.ok(s.j.vault.exists(third.files[0].path));
    assert.equal((await s.call("POST", "/api/assistant/undo", { id: desk.id }, KEY)).status, 200, "el escritorio sigue pudiendo");
  } finally { await s.done(); }
});

test("móvil: si cambian las exclusiones, la misma conversación pasa a otro espacio (nada se borra); en el escritorio no cambia", async () => {
  const s = await setup();
  try {
    await ask(s, "a", "c1");
    s.config("mobile.json", ["Privado/", "Tareas/"]);
    await ask(s, "b", "c1");
    await ask(s, "c", "c1", KEY);
    await s.call("POST", "/api/assistant/ask", { message: "d", conversation: "c1" }, KEY);
    const [a, b, d1, d2] = s.asked.map((x) => x.conversation);
    assert.notEqual(a, b, "otra privacidad → otro espacio para el motor");
    assert.deepEqual([d1, d2], ["c1", "c1"]);
    // volver a la configuración anterior recupera el espacio anterior: es una huella, no un contador
    s.config("mobile.json", ["Privado/"]);
    await ask(s, "e", "c1");
    assert.equal(s.asked.at(-1)!.conversation, a);
    // las actividades de calendario ocultas no mueven el espacio (cambiarían a cada edición del calendario)
    assert.equal(s.asked.every((x) => x.role === "full" || x.conversation.startsWith("mobile:")), true);
  } finally { await s.done(); }
});

// ───────── Visibilidad de propuestas y resultados: reglas puras ─────────

const prop = (over: Record<string, unknown>) => ({ id: "01".padEnd(26, "0"), createdAt: "", source: "assistant", status: "pending", key: "mobile:mobile-1", title: "t", rationale: "r", ops: [], ...over }) as never;
const resolve = (t: string) => ({ secreto: "Privado/Secreto.md", publica: "Notas/Publica.md" } as Record<string, string>)[t.toLowerCase()] ?? null;

test("propuestas: solo las del móvil, y se esconden si CUALQUIER ruta, texto o enlace toca algo oculto", () => {
  const ex = ["Privado/"];
  const ok = (over: Record<string, unknown>) => mobileProposalVisible(prop(over), ex, resolve);
  assert.equal(ok({ ops: [{ op: "create", path: "Notas/Nueva.md", text: "hola [[Publica]] y [[No existe]]" }] }), true);
  assert.equal(ok({ key: undefined }), false, "sin origen móvil");
  assert.equal(ok({ key: "triage:Bandeja/x.md" }), false);
  for (const ops of [
    [{ op: "move", from: "Notas/A.md", to: "Privado/A.md", before: "h" }], [{ op: "move", from: "Privado/A.md", to: "Notas/A.md", before: "h" }],
    [{ op: "create", path: "Notas/Nueva.md", text: "mira [[Secreto]]" }], [{ op: "create", path: "Notas/Nueva.md", text: "ver Privado/Secreto.md" }],
    [{ op: "setProp", path: "Notas/A.md", before: "h", props: { enlace: "[[Secreto|el secreto]]" } }],
    [{ op: "update", path: "Notas/A.md", before: "h", text: "x" }, { op: "trash", path: "privado/B.md", before: "h" }],
  ]) assert.equal(ok({ ops }), false, JSON.stringify(ops));
  assert.equal(ok({ title: "Sobre Privado/Secreto.md" }), false);
  assert.equal(ok({ rationale: "toca Privado/" }), false);
});

test("herramientas en el móvil: los elementos de lista que nombran algo oculto desaparecen aunque no lleven «path»", () => {
  const ex = ["Privado/"];
  const text = JSON.stringify([{ kind: "move", data: { to: "Privado/x.md" } }, { kind: "capture", data: { text: "hola" } }]);
  assert.deepEqual(JSON.parse(mobileToolText(text, ex)), [{ kind: "capture", data: { text: "hola" } }]);
  assert.equal(mobileToolText("no es json", ex), "no es json");
  assert.deepEqual(JSON.parse(mobileToolText(JSON.stringify({ proposals: 9, x: 1 }), ex, (o) => { o.proposals = 1; })), { proposals: 1, x: 1 });
});

test("lista blanca del móvil: del asistente solo estado y actividad, preguntar, deshacer y aprobar o descartar propuestas por id", () => {
  const id = "0".repeat(26);
  for (const [m, p] of [["GET", "/api/assistant/status"], ["GET", "/api/assistant/actions"], ["GET", "/api/proposals"], ["POST", "/api/assistant/ask"], ["POST", "/api/assistant/undo"], ["POST", `/api/proposals/${id}/apply`], ["POST", `/api/proposals/${id}/reject`]]) assert.equal(mobileAllowed(m, p), true, `${m} ${p}`);
  for (const [m, p] of [["GET", "/api/assistant/memory"], ["GET", "/api/assistant/tools/list"], ["GET", "/api/assistant/otra"], ["GET", `/api/proposals/${id}`], ["POST", "/api/assistant/tools/call"], ["POST", "/api/assistant/memory/delete"], ["POST", "/api/proposals/corto/apply"], ["POST", `/api/proposals/${id}/borrar`], ["PUT", `/api/proposals/${id}/apply`], ["GET", "/api/ai"]]) assert.equal(mobileAllowed(m, p), false, `${m} ${p}`);
});

test("móvil: si se revoca el emparejamiento durante la consulta, las herramientas y la respuesta dejan de valer", async () => {
  let after: { text?: string; error?: string } = {};
  const s = await setup({
    script: async (_i, tool) => {
      revokeMobileKey(s.root);
      after = (await tool("create_task", { title: "Tras revocar" })) as never;
      return "nunca debería llegar al móvil";
    },
  });
  try {
    const r = await ask(s);
    assert.equal(r.status, 401);
    assert.match(after.error ?? "", /emparejado/);
    assert.ok(!s.j.vault.exists("Tareas/Tras revocar.md"), "ninguna herramienta actuó");
    assert.doesNotMatch(r.text, /nunca/);
  } finally { await s.done(); }
});

test("móvil: lo que el límite de la consulta convierte en propuesta también nace como propuesta del móvil (visible y aprobable allí)", async () => {
  const s = await setup({ script: async (_i, tool) => { for (let n = 1; n <= 6; n++) await tool("create_task", { title: `Tarea ${n}` }); return "ok"; } });
  try {
    const r = await ask(s);
    assert.equal(r.json.actions.length, 5, "las cinco primeras con Deshacer");
    const list = (await s.call("GET", "/api/proposals")).json;
    assert.equal(list.length, 1, "la sexta queda como propuesta del móvil");
    assert.ok(!s.j.vault.exists("Tareas/Tarea 6.md"));
    assert.equal((await s.call("POST", `/api/proposals/${list[0].id}/apply`, {})).status, 200);
    assert.ok(s.j.vault.exists("Tareas/Tarea 6.md"));
  } finally { await s.done(); }
});
