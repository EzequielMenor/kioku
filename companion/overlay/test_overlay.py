"""Pruebas del compañero de escritorio que no necesitan pantalla: geometría, espejo de estado, cliente y dibujo.

    python3 -m unittest discover -s companion/overlay -p 'test_*.py'

(`npm test` las lanza desde test/companion-overlay.test.ts.) La ventana GTK se valida en el escritorio real:
ver docs/validation.md.
"""
import http.server
import json
import os
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import geometry as G  # noqa: E402
from client import Client, KiokuError  # noqa: E402
from store import PEEK_STATES, Store, face_state, messages_signature, op_text, risky  # noqa: E402

KEY = "a" * 64


class GeometryTest(unittest.TestCase):
    MON = (1440, 900)

    def test_margins_keep_the_whole_character_on_screen(self):
        b = G.box(G.CHAR)
        self.assertEqual(G.clamp_margins(24, 24, *self.MON), (24, 24))
        self.assertEqual(G.clamp_margins(-50, 99999, *self.MON), (0, 900 - b))
        self.assertEqual(G.clamp_margins(99999, -3, *self.MON), (1440 - b, 0))
        # Un monitor más pequeño que el guardado (cambio de pantalla) no lo deja fuera.
        self.assertEqual(G.clamp_margins(1300, 800, 800, 600), (800 - b, 600 - b))

    def test_origin_and_margins_are_inverse(self):
        for m in ((24, 24), (0, 0), (700, 400), (1440 - G.box(G.CHAR), 900 - G.box(G.CHAR))):
            ox, oy = G.box_origin(*m, *self.MON)
            self.assertEqual(G.margins_from_origin(ox, oy, *self.MON), m)
        # En concentración (más pequeño) conserva la esquina inferior derecha.
        big, small = G.box_origin(24, 24, *self.MON, G.CHAR), G.box_origin(24, 24, *self.MON, G.CHAR_QUIET)
        self.assertEqual(big[0] + G.box(G.CHAR), small[0] + G.box(G.CHAR_QUIET))
        self.assertEqual(big[1] + G.box(G.CHAR), small[1] + G.box(G.CHAR_QUIET))

    def test_drag_follows_the_pointer_but_never_leaves_the_monitor(self):
        ox, oy = G.box_origin(24, 24, *self.MON)
        self.assertEqual(G.drag_origin(ox, oy, -300, -200, *self.MON), (ox - 300, oy - 200))
        self.assertEqual(G.drag_origin(ox, oy, -5000, -5000, *self.MON), (0, 0))
        self.assertEqual(G.drag_origin(ox, oy, 5000, 5000, *self.MON), (1440 - G.box(G.CHAR), 900 - G.box(G.CHAR)))
        self.assertFalse(G.is_drag(3, 4))   # un clic con pulso
        self.assertTrue(G.is_drag(5, 5))

    def test_only_the_body_takes_clicks(self):
        for size in (G.CHAR, G.CHAR_QUIET):
            rects, b = G.body_rects(size), G.box(size)
            self.assertTrue(G.hit(rects, b / 2, b / 2), "el centro es Kio")
            for corner in ((1, 1), (b - 2, 1), (1, b - 2), (b - 2, b - 2)):
                self.assertFalse(G.hit(rects, *corner), "el aire de alrededor deja pasar el clic")
            p = G.pad(size) + size * 0.07
            self.assertFalse(G.hit(rects, p + 1, p + 1), "la esquina redondeada del cuerpo también")
            for x, y, w, h in rects:
                self.assertTrue(x >= 0 and y >= 0 and x + w <= b and y + h <= b and w > 0 and h > 0)

    def test_panel_opens_next_to_the_character_and_inside_the_monitor(self):
        mw, mh = self.MON
        pw, ph = G.panel_size(mw, mh)
        side = G.box(G.CHAR)
        for margins in ((24, 24), (0, 0), (1440 - side, 900 - side), (645, 404), (24, 900 - side), (1440 - side, 24), (700, 0), (700, 900 - side)):
            cx, cy = G.box_origin(*margins, mw, mh)
            x, y = G.panel_origin(cx, cy, side, mw, mh, pw, ph)
            self.assertTrue(x >= 0 and x + pw <= mw, (margins, x))
            self.assertTrue(y >= G.TOP_GUARD and y + ph <= mh, (margins, y))
            overlaps = x < cx + side and cx < x + pw and y < cy + side and cy < y + ph
            self.assertFalse(overlaps, f"el panel no tapa a Kio con márgenes {margins}")
            mr, mb = G.to_margins(x, y, pw, ph, mw, mh)
            self.assertTrue(mr >= 0 and mb >= 0)
        # Abajo a la derecha (lo normal): encima de Kio y alineado con su borde derecho.
        cx, cy = G.box_origin(24, 24, mw, mh)
        self.assertEqual(G.panel_origin(cx, cy, side, mw, mh, pw, ph), (cx + side - pw, cy - G.GAP - ph))

    def test_panel_fits_small_monitors(self):
        pw, ph = G.panel_size(1024, 600)
        self.assertTrue(pw <= 1024 - 2 * G.GAP and 240 <= ph <= 600 - G.TOP_GUARD)


class FakeClient:
    def __init__(self):
        self.calls = []
        self.conversation = {"id": "c1", "messages": []}
        self.state = {"agent": {"state": "idle", "label": None, "busy": False, "awaiting": []},
                      "companion": {"mode": "active", "conversation": "c1", "overlay": None, "quiet": False, "focusSession": False, "webForeground": False},
                      "engine": {"engine": "fake", "provider": "demo", "model": "m", "local": True}}
        self.fail = None

    def get(self, path, timeout=15):
        self.calls.append(("GET", path, None))
        if self.fail:
            raise KiokuError(self.fail)
        if path == "/api/assistant/state":
            return self.state
        if path == "/api/assistant/conversation":
            return self.conversation
        if path == "/api/assistant/status":
            return {"ok": True}
        raise KiokuError("404", 404)

    def post(self, path, body=None, timeout=15):
        self.calls.append(("POST", path, body))
        if self.fail:
            raise KiokuError(self.fail)
        if path == "/api/assistant/companion":
            self.state["companion"] = dict(self.state["companion"], **(body or {}))
            return self.state["companion"]
        if path == "/api/assistant/conversation/new":
            self.conversation = {"id": "c2", "messages": []}
            return {"id": "c2"}
        return {"status": "applied"} if path.startswith("/api/proposals/") else {}


def make_store():
    c = FakeClient()
    notes = []
    s = Store(c, notify=lambda: notes.append(1), spawn=lambda fn, *a: fn(*a))
    return s, c, notes


class StoreTest(unittest.TestCase):
    def test_loads_on_connect_and_mirrors_the_daemon(self):
        s, c, notes = make_store()
        self.assertFalse(s.snapshot()["ready"])
        s.on_status(True)
        snap = s.snapshot()
        self.assertTrue(snap["ready"] and snap["connected"])
        self.assertEqual(snap["conversation"], "c1")
        self.assertEqual(snap["engine"]["model"], "m")
        self.assertTrue(notes)

    def test_events_drive_state_stream_and_messages(self):
        s, c, _ = make_store()
        s.on_status(True)
        s.on_event({"kind": "assistant.message", "conversation": "c1", "message": {"id": "u1", "role": "user", "text": "hola"}})
        s.on_event({"kind": "assistant.state", "agent": {"state": "thinking", "label": "Pensando…", "busy": True}})
        s.on_event({"kind": "assistant.delta", "conversation": "c1", "text": "Bue"})
        s.on_event({"kind": "assistant.delta", "conversation": "c1", "text": "nas"})
        s.on_event({"kind": "assistant.delta", "conversation": "otra", "text": "ruido"})
        self.assertEqual(s.snapshot()["streaming"], "Buenas")
        s.on_event({"kind": "assistant.delta", "conversation": "c1", "reset": True})
        self.assertEqual(s.snapshot()["streaming"], "")
        s.on_event({"kind": "assistant.delta", "conversation": "c1", "text": "Buenas"})
        s.on_event({"kind": "assistant.message", "conversation": "c1", "message": {"id": "a1", "role": "assistant", "text": "Buenas"}})
        s.on_event({"kind": "assistant.message", "conversation": "c1", "message": {"id": "a1", "role": "assistant", "text": "Buenas"}})  # repetido
        s.on_event({"kind": "assistant.message", "conversation": "otra", "message": {"id": "x", "role": "assistant", "text": "no"}})
        snap = s.snapshot()
        self.assertEqual([m["id"] for m in snap["msgs"]], ["u1", "a1"])
        self.assertEqual(snap["streaming"], "")
        s.on_event({"kind": "assistant.state", "agent": {"state": "success", "label": "Hecho", "busy": False}})
        self.assertEqual(s.snapshot()["agent"]["state"], "success")

    def test_switching_conversation_reloads_it(self):
        s, c, _ = make_store()
        s.on_status(True)
        c.conversation = {"id": "c9", "messages": [{"id": "m", "role": "user", "text": "x"}]}
        s.on_event({"kind": "assistant.companion", "companion": dict(c.state["companion"], conversation="c9", mode="focus", quiet=True)})
        snap = s.snapshot()
        self.assertEqual((snap["conversation"], len(snap["msgs"]), snap["companion"]["mode"]), ("c9", 1, "focus"))

    def test_resolved_proposals_refresh_the_buttons(self):
        s, c, _ = make_store()
        c.conversation = {"id": "c1", "messages": [{"id": "a", "role": "assistant", "text": "t", "actions": [], "proposals": [{"id": "P", "status": "pending", "ops": []}]}]}
        s.on_status(True)
        c.conversation = {"id": "c1", "messages": [{"id": "a", "role": "assistant", "text": "t", "actions": [], "proposals": [{"id": "P", "status": "applied", "ops": []}]}]}
        before = messages_signature(s.snapshot())
        s.on_event({"kind": "proposals"})
        self.assertEqual(s.snapshot()["msgs"][0]["proposals"][0]["status"], "applied")
        self.assertNotEqual(messages_signature(s.snapshot()), before)

    def test_losing_the_daemon_never_leaves_it_thinking(self):
        s, c, _ = make_store()
        s.on_status(True)
        s.on_event({"kind": "assistant.state", "agent": {"state": "thinking", "label": "Pensando…", "busy": True}})
        s.on_event({"kind": "assistant.delta", "conversation": "c1", "text": "a medias"})
        s.on_status(False)
        snap = s.snapshot()
        self.assertFalse(snap["connected"])
        self.assertEqual((snap["agent"]["state"], snap["agent"]["busy"], snap["streaming"], snap["sending"]), ("idle", False, "", False))
        self.assertEqual(face_state(snap["agent"], False, snap["connected"]), "quiet")
        # Al volver, recarga el estado real.
        c.state["agent"] = {"state": "awaiting_confirmation", "label": "Una propuesta espera tu decisión", "busy": False, "awaiting": ["P"]}
        s.on_status(True)
        self.assertEqual(s.snapshot()["agent"]["state"], "awaiting_confirmation")

    def test_send_reports_failures_that_are_not_part_of_the_conversation(self):
        s, c, _ = make_store()
        s.on_status(True)
        s.send("  hola  ")
        self.assertIn(("POST", "/api/assistant/ask", {"message": "hola", "surface": "desktop"}), c.calls)
        self.assertFalse(s.snapshot()["sending"])
        c.fail = "El asistente no está disponible"
        s.send("otra")
        self.assertEqual(s.snapshot()["problem"], "El asistente no está disponible")
        s.dismiss_problem()
        self.assertIsNone(s.snapshot()["problem"])
        n = len(c.calls)
        s.send("   ")
        self.assertEqual(len(c.calls), n, "un mensaje vacío no se envía")

    def test_actions_go_to_the_allowed_routes(self):
        s, c, _ = make_store()
        s.on_status(True)
        s.set_mode("focus")
        self.assertEqual(s.snapshot()["companion"]["mode"], "focus")
        s.set_overlay(645.7, 404.2)
        self.assertIn(("POST", "/api/assistant/companion", {"overlay": {"x": 645, "y": 404}}), c.calls)
        s.new_conversation()
        self.assertEqual(s.snapshot()["conversation"], "c2")
        s.undo("U1")
        s.decide("P1", "apply")
        s.decide("P2", "reject")
        s.cancel()
        s.listening(True)
        s.open_kioku()
        paths = [p for m, p, _ in c.calls if m == "POST"]
        for expected in ("/api/assistant/undo", "/api/proposals/P1/apply", "/api/proposals/P2/reject", "/api/assistant/cancel", "/api/assistant/listening", "/api/desktop/open"):
            self.assertIn(expected, paths)

    def test_face_state_rests_in_focus_mode_unless_something_needs_you(self):
        agent = lambda st: {"state": st}  # noqa: E731
        for st in ("idle", "success", "listening"):
            self.assertEqual(face_state(agent(st), True), "quiet")
        for st in ("thinking", "responding", "awaiting_confirmation", "error"):
            self.assertEqual(face_state(agent(st), True), st)
            self.assertEqual(face_state(agent(st), False), st)
            self.assertEqual(face_state(agent(st), False, connected=False), "quiet")
        self.assertNotIn("idle", PEEK_STATES)

    def test_proposal_helpers(self):
        self.assertTrue(risky({"ops": [{"op": "setProp"}, {"op": "trash", "path": "a.md"}]}))
        self.assertFalse(risky({"ops": [{"op": "create", "path": "a.md"}, {"op": "setProp"}]}))
        self.assertEqual(op_text({"op": "trash", "path": "Bandeja/x.md"}), "Mover a la papelera Bandeja/x.md")
        self.assertEqual(op_text({"op": "move", "from": "a.md", "to": "b.md"}), "Mover a.md → b.md")
        self.assertEqual(op_text({"op": "setProp", "path": "t.md", "props": {"status": "done", "due": None}}), 'Cambiar propiedades de t.md: status → "done", due → (quitar)')


class StubDaemon:
    """Daemon mínimo: comprueba la clave y sirve un flujo de eventos que se corta para forzar la reconexión."""

    def __init__(self):
        stub = self
        self.keys, self.streams = [], 0

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                stub.keys.append(self.headers.get("x-kioku-key"))
                if self.headers.get("x-kioku-key") != KEY:
                    return self._json(401, {"error": "Falta la clave"})
                if self.path == "/api/events":
                    stub.streams += 1
                    self.send_response(200)
                    self.send_header("content-type", "text/event-stream")
                    self.end_headers()
                    self.wfile.write(b": ok\n\n" + f'data: {json.dumps({"kind": "assistant.state", "n": stub.streams})}\n\n'.encode() + b"data: no-json\n\n")
                    self.wfile.flush()
                    return  # se cierra: el cliente debe reconectar
                if self.path == "/api/prohibido":
                    return self._json(403, {"error": "Eso no se puede hacer desde el compañero de escritorio: hazlo en Kioku"})
                self._json(200, {"ok": True})

            def _json(self, status, body):
                raw = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class ClientTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = self.tmp.name
        os.makedirs(os.path.join(self.home, ".kioku"))
        self.daemon = StubDaemon()

    def tearDown(self):
        self.daemon.close()
        self.tmp.cleanup()

    def write(self, name, text):
        with open(os.path.join(self.home, ".kioku", name), "w", encoding="utf-8") as f:
            f.write(text)

    def runtime(self, pid=None, port=None):
        self.write("runtime.json", json.dumps({"pid": os.getpid() if pid is None else pid, "port": port or self.daemon.port}))

    def test_talks_to_the_local_daemon_with_the_companion_key(self):
        self.runtime()
        self.write("secret-companion", KEY + "\n")
        c = Client(self.home)
        self.assertEqual(c.get("/api/health"), {"ok": True})
        self.assertEqual(self.daemon.keys, [KEY])
        with self.assertRaises(KiokuError) as e:
            c.get("/api/prohibido")
        self.assertEqual(e.exception.status, 403)
        self.assertIn("compañero", str(e.exception))

    def test_without_daemon_or_key_it_explains_and_sends_nothing(self):
        c = Client(self.home)
        with self.assertRaisesRegex(KiokuError, "no está en marcha"):
            c.get("/api/health")
        self.runtime()
        with self.assertRaisesRegex(KiokuError, "credencial"):
            c.get("/api/health")
        self.write("secret-companion", "corta")
        with self.assertRaisesRegex(KiokuError, "credencial"):
            c.get("/api/health")
        self.assertEqual(self.daemon.keys, [])

    def test_a_dead_daemon_pid_means_no_connection_even_if_the_port_answers(self):
        """Si el daemon murió sin limpiar runtime.json, quien escuche ahora en ese puerto no recibe la credencial."""
        self.write("secret-companion", KEY)
        dead = 2 ** 22 + 12345  # por encima de pid_max: no existe
        self.runtime(pid=dead)
        c = Client(self.home)
        self.assertIsNone(c.port())
        with self.assertRaisesRegex(KiokuError, "no está en marcha"):
            c.get("/api/health")
        self.assertEqual(self.daemon.keys, [])
        for bad in ("{", json.dumps({"pid": os.getpid(), "port": 0}), json.dumps({"pid": os.getpid(), "port": "x"}), json.dumps([1])):
            self.write("runtime.json", bad)
            self.assertIsNone(c.port())

    def test_a_rejected_key_is_reported_as_such(self):
        self.runtime()
        self.write("secret-companion", "b" * 64)
        with self.assertRaises(KiokuError) as e:
            Client(self.home).get("/api/health")
        self.assertEqual(e.exception.status, 401)

    def test_event_stream_reconnects_and_reports_status(self):
        self.runtime()
        self.write("secret-companion", KEY)
        events, status, stop = [], [], threading.Event()
        t = threading.Thread(target=Client(self.home).events, args=(events.append, status.append, stop), daemon=True)
        t.start()
        deadline = time.time() + 8
        while time.time() < deadline and len(events) < 2:
            time.sleep(0.05)
        stop.set()
        self.assertGreaterEqual(len(events), 2, "tras cortarse el flujo, vuelve a conectar")
        self.assertEqual([e["n"] for e in events[:2]], [1, 2])
        self.assertEqual(status[:3], [True, False, True])
        t.join(timeout=3)
        self.assertFalse(t.is_alive(), "el bucle termina al pedirlo")

    def test_event_stream_waits_while_there_is_no_daemon(self):
        status, stop = [], threading.Event()
        t = threading.Thread(target=Client(self.home).events, args=(lambda e: None, status.append, stop), daemon=True)
        t.start()
        time.sleep(0.3)
        self.assertEqual(status[0], False)
        self.write("secret-companion", KEY)
        self.runtime()
        deadline = time.time() + 6
        while time.time() < deadline and True not in status:
            time.sleep(0.05)
        stop.set()
        self.assertIn(True, status, "cuando aparece el daemon, conecta solo")


class FaceTest(unittest.TestCase):
    def test_every_state_draws_in_both_themes(self):
        try:
            import cairo
        except ImportError:
            self.skipTest("sin pycairo")
        from face import Face, load_spec
        spec = load_spec()
        for theme in ("dark", "light"):
            for reduced in (False, True):
                face = Face(spec, theme=theme, reduced_motion=reduced)
                for state in spec["states"]:
                    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, 64, 64)
                    cr = cairo.Context(surface)
                    self.assertTrue(face.set(state, 0.0) or state == "idle")
                    for t in (0.0, 0.05, 0.4, 2.0, 7.5):
                        face.draw(cr, 64, t)
                    data = bytes(surface.get_data())
                    self.assertTrue(any(data), f"{state} pinta algo")
                    self.assertEqual(data[3], 0, "la esquina queda transparente")
                self.assertFalse(face.set("no-existe", 1.0))
        quiet = Face(spec)
        quiet.set("quiet", 0.0)
        self.assertFalse(quiet.animated(), "en concentración no gasta fotogramas")


if __name__ == "__main__":
    unittest.main()
