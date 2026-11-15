// Compañero de escritorio (Python): sus pruebas sin pantalla y la integración real con el daemon.
// La ventana GTK4/Layer Shell se valida en el escritorio (docs/validation.md); aquí va todo lo demás.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kioku } from "../src/core/kioku.ts";
import { startServer } from "../src/server/server.ts";
import { loadOrCreateCompanionKey } from "../src/server/key.ts";
import { FakeEngine } from "../src/assistant/fake-engine.ts";
import { tmpVault } from "./helpers.ts";

const overlay = path.resolve(import.meta.dirname, "../companion/overlay");
const python = ["/usr/bin/python3", "python3"].find((p) => (p.startsWith("/") ? existsSync(p) : spawnSync(p, ["--version"]).status === 0));
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
const skip = python ? false : "sin python3";

test("overlay: geometría, espejo de estado, cliente y dibujo (unittest de Python)", { skip }, () => {
  const r = spawnSync(python!, ["-m", "unittest", "discover", "-s", overlay, "-p", "test_*.py"], { encoding: "utf8", env, timeout: 120_000 });
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  assert.match(r.stderr, /Ran \d+ tests/);
});

/** Lo que hace el overlay sin su ventana: conectar con la credencial limitada, reflejar el estado y conversar. */
const HEADLESS = `
import json, sys, threading, time
sys.path.insert(0, ${JSON.stringify(overlay)})
from client import Client, KiokuError
from store import Store, face_state
c = Client()
faces = []
recording = False
faces_lock = threading.Lock()
def on_notify():
    if not recording: return
    snap = s.snapshot(); f = face_state(snap["agent"], snap["companion"]["quiet"], snap["connected"])
    with faces_lock:
        if not faces or faces[-1] != f: faces.append(f)
s = Store(c, notify=on_notify)
stop = threading.Event()
threading.Thread(target=c.events, args=(s.on_event, s.on_status, stop), daemon=True).start()
def wait(pred, secs=15):
    t0 = time.time()
    while time.time() - t0 < secs:
        snap = s.snapshot()
        if pred(snap): return snap
        time.sleep(0.02)
    raise SystemExit("tiempo agotado: " + json.dumps(s.snapshot(), default=str)[:600])
wait(lambda x: x["ready"] and x["connected"])
recording = True
on_notify()
out = {"role": c.get("/api/session")["role"], "engine": s.snapshot()["engine"]}
s.send("crea una tarea: regar las plantas")
snap = wait(lambda x: len(x["msgs"]) == 2 and not x["agent"]["busy"])
out["msgs"] = [(m["role"], m.get("surface"), len(m.get("actions") or [])) for m in snap["msgs"]]
action = snap["msgs"][1]["actions"][0]["id"]
s.undo(action)
out["undone"] = bool(wait(lambda x: x["msgs"][1]["actions"][0].get("undone"))["msgs"][1]["actions"][0].get("undone"))
s.send("borra la primera captura")
snap = wait(lambda x: x["agent"]["state"] == "awaiting_confirmation" and len(x["msgs"]) == 4)
proposal = snap["msgs"][3]["proposals"][0]
out["proposal"] = [proposal["status"], proposal["ops"][0]["op"]]
s.decide(proposal["id"], "reject")
out["after_reject"] = wait(lambda x: x["agent"]["state"] == "idle" and x["msgs"][3]["proposals"][0]["status"] == "rejected")["msgs"][3]["proposals"][0]["status"]
s.set_mode("focus"); s.set_overlay(640, 300)
out["view"] = wait(lambda x: x["companion"]["mode"] == "focus" and x["companion"]["overlay"] == {"x": 640, "y": 300})["companion"]
s.new_conversation()
out["fresh"] = len(wait(lambda x: x["conversation"] != snap["conversation"])["msgs"])
denied = {}
for method, path in (("GET", "/api/search?q=x"), ("POST", "/api/note"), ("GET", "/api/assistant/memory"), ("POST", "/api/assistant/model")):
    try: c.request(method, path, {}); denied[path] = 200
    except KiokuError as e: denied[path] = e.status
out["denied"] = denied
on_notify()
with faces_lock:
    out["faces"] = list(faces)
stop.set()
print(json.dumps(out))
`;

test("overlay ↔ daemon: el compañero de escritorio conversa con el mismo agente y solo con su credencial limitada", { skip }, async () => {
  const { root, cleanup } = tmpVault({ "Bandeja/Idea suelta.md": "---\ntype: capture\n---\nIdea suelta\n" });
  const web = mkdtempSync(path.join(tmpdir(), "kioku-web-"));
  writeFileSync(path.join(web, "index.html"), "<h1>hola</h1>");
  const j = await Kioku.open({ root });
  const srv = await startServer(j, { port: 0, webDir: web, assistant: { engine: new FakeEngine() }, agentState: { successMs: 60, errorMs: 60, listeningMs: 60 } });
  try {
    writeFileSync(path.join(root, ".kioku", "runtime.json"), JSON.stringify({ pid: process.pid, port: srv.port }));
    loadOrCreateCompanionKey(root);
    const child = spawn(python!, ["-c", HEADLESS], { env: { ...env, KIOKU_HOME: root } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    assert.equal(code, 0, stderr.slice(-3000));
    const out = JSON.parse(stdout.trim().split("\n").at(-1)!);

    assert.equal(out.role, "companion");
    assert.equal(out.engine.model, "motor de pruebas");
    assert.deepEqual(out.msgs, [["user", "desktop", 0], ["assistant", null, 1]], "la respuesta trae su acción deshacible");
    assert.equal(out.undone, true, "Deshacer desde el escritorio");
    assert.deepEqual(out.proposal, ["pending", "trash"]);
    assert.equal(out.after_reject, "rejected");
    assert.equal(out.view.mode, "focus");
    assert.equal(out.view.quiet, true);
    assert.equal(out.fresh, 0, "conversación nueva vacía");
    for (const [p, status] of Object.entries(out.denied)) assert.equal(status, 403, `${p} no es del compañero`);
    // El personaje recorrió los estados reales del agente (los pinta tal cual llegan por el flujo de eventos).
    for (const f of ["thinking", "responding", "awaiting_confirmation"]) assert.ok(out.faces.includes(f), `${f} en ${out.faces}`);
    assert.equal(out.faces.at(-1), "quiet", "en concentración acaba en reposo");

    // Es el mismo agente que ve Kioku: la conversación y los ajustes están en el daemon.
    const view = await srv.companion.view();
    assert.equal(view.mode, "focus");
    assert.deepEqual(view.overlay, { x: 640, y: 300 });
    const list = await srv.companion.conversations.list();
    assert.ok(list.length >= 1, "la conversación del escritorio quedó guardada en el daemon");
  } finally {
    await srv.close(); j.close(); cleanup();
  }
});

test("overlay: todos los módulos, incluida la ventana GTK, compilan", { skip }, () => {
  const r = spawnSync(python!, ["-c", `import sys\nfor f in sys.argv[1:]: compile(open(f, encoding="utf-8").read(), f, "exec")`, ...["kioku_companion.py", "store.py", "geometry.py", "client.py", "face.py"].map((f) => path.join(overlay, f))], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
});
