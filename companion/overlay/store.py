"""Estado del compañero de escritorio: un espejo de lo que tiene el daemon, sin nada propio.

Es el mismo contrato que `web/src/companion-store.ts`: carga inicial por HTTP y cambios por el flujo de eventos
(`assistant.state|companion|delta|message`). No importa GTK: se prueba sin pantalla.

Lo tocan varios hilos (el del flujo de eventos y los de las peticiones), así que todo cambio pasa por un cerrojo
y avisa con `notify()`; la ventana lo recoge en su hilo y repinta a partir de `snapshot()`.
"""
import threading

from client import KiokuError, in_thread

IDLE = {"state": "idle", "label": None, "conversation": None, "since": "", "busy": False, "awaiting": []}
DEFAULT_VIEW = {"mode": "active", "conversation": "", "overlay": None, "quiet": False, "focusSession": False, "webForeground": False}

STATE_TEXT = {
    "idle": "Listo", "listening": "Te escucho", "thinking": "Pensando…", "responding": "Respondiendo…",
    "awaiting_confirmation": "Espera tu decisión", "success": "Hecho", "error": "Algo falló", "quiet": "En concentración",
}
PEEK_STATES = ("awaiting_confirmation", "error", "thinking", "responding")


def face_state(agent, quiet, connected=True):
    """Estado que pinta el personaje: el del agente, salvo en concentración o sin daemon, donde descansa."""
    if not connected:
        return "quiet"
    state = agent.get("state", "idle")
    if quiet and state in ("idle", "success", "listening"):
        return "quiet"
    return state


class Store:
    def __init__(self, client, notify=lambda: None, spawn=in_thread):
        self.client = client
        self.notify = notify
        self.spawn = spawn
        self._lock = threading.RLock()
        self._s = {
            "ready": False,        # ya se cargó el estado al menos una vez
            "connected": False,    # hay flujo de eventos con el daemon
            "agent": dict(IDLE),
            "companion": dict(DEFAULT_VIEW),
            "engine": None,
            "status": None,        # disponibilidad del asistente: {"ok": bool, "reason": str}
            "conversation": "",
            "msgs": [],
            "streaming": "",       # texto de la respuesta que está llegando
            "sending": False,      # mensaje enviado desde aquí que el daemon aún no ha confirmado
            "problem": None,       # fallo que no pertenece a la conversación
        }

    def snapshot(self):
        with self._lock:
            s = dict(self._s)
            s["msgs"] = list(s["msgs"])
            return s

    def _set(self, **patch):
        with self._lock:
            self._s.update(patch)
        self.notify()

    # ───────── carga ─────────

    def load_conversation(self):
        c = self.client.get("/api/assistant/conversation")
        self._set(conversation=c.get("id", ""), msgs=c.get("messages", []), streaming="")

    def load(self):
        """Estado completo desde el daemon. Devuelve si se pudo (sin daemon o sin permiso, el personaje descansa)."""
        try:
            s = self.client.get("/api/assistant/state")
            self.load_conversation()
            try:
                status = self.client.get("/api/assistant/status")
            except KiokuError:
                status = None
            self._set(ready=True, agent=s.get("agent") or dict(IDLE), companion=s.get("companion") or dict(DEFAULT_VIEW),
                      engine=s.get("engine"), status=status, problem=None)
            return True
        except KiokuError as e:
            self._set(problem=str(e))
            return False

    # ───────── flujo de eventos ─────────

    def on_status(self, connected):
        """Conexión o corte del flujo de eventos. Al (re)conectar se recarga todo: pudo cambiar mientras no se oía."""
        with self._lock:
            was = self._s["connected"]
        if connected:
            self._set(connected=True)
            self.spawn(self.load)
        elif was or not self._s["ready"]:
            # Sin daemon no hay consulta en curso que valga: se limpia lo transitorio para no dejar un «Pensando…» colgado.
            agent = dict(self._s["agent"], busy=False, state="idle", label=None)
            self._set(connected=False, streaming="", sending=False, agent=agent)

    def on_event(self, e):
        kind = e.get("kind")
        with self._lock:
            conversation = self._s["conversation"]
            msgs = self._s["msgs"]
        if kind == "assistant.state" and e.get("agent"):
            patch = {"agent": e["agent"]}
            if not e["agent"].get("busy"):
                patch["streaming"] = ""
            self._set(**patch)
        elif kind == "assistant.companion" and e.get("companion"):
            self._set(companion=e["companion"])
            if e["companion"].get("conversation") != conversation:
                self.spawn(self._reload_conversation)
        elif kind == "assistant.delta" and e.get("conversation") == conversation:
            with self._lock:
                self._s["streaming"] = "" if e.get("reset") else self._s["streaming"] + (e.get("text") or "")
            self.notify()
        elif kind == "assistant.message" and e.get("message") and e.get("conversation") == conversation:
            m = e["message"]
            if any(x.get("id") == m.get("id") for x in msgs):
                return
            patch = {"msgs": msgs + [m]}
            patch.update({"streaming": ""} if m.get("role") == "assistant" else {"sending": False})
            self._set(**patch)
        elif kind in ("proposals", "note", "delete"):
            # Una propuesta se resolvió o una acción se deshizo: los botones de los mensajes deben reflejarlo.
            if any(m.get("proposals") or m.get("actions") for m in msgs):
                self.spawn(self._reload_conversation)

    def _reload_conversation(self):
        try:
            self.load_conversation()
        except KiokuError:
            pass

    # ───────── acciones (bloquean: llámalas desde un hilo) ─────────

    def send(self, message):
        m = message.strip()
        with self._lock:
            if not m or self._s["sending"]:
                return
        self._set(sending=True, problem=None)
        try:
            # Una consulta puede tardar minutos (modelo local): el progreso llega por eventos, no por esta respuesta.
            self.client.post("/api/assistant/ask", {"message": m, "surface": "desktop"}, timeout=900)
        except KiokuError as e:
            # Los fallos de una consulta ya abierta llegan como mensaje de la conversación; aquí solo los previos.
            text = str(e)
            with self._lock:
                known = any(x.get("error") and x.get("text") == text for x in self._s["msgs"])
            if not known:
                self._set(problem=text)
        finally:
            self._set(sending=False)

    def _try(self, fn):
        try:
            return fn()
        except KiokuError as e:
            self._set(problem=str(e))
            return None

    def cancel(self):
        self._try(lambda: self.client.post("/api/assistant/cancel"))

    def new_conversation(self):
        if self._try(lambda: self.client.post("/api/assistant/conversation/new")) is not None:
            self._reload_conversation()

    def set_mode(self, mode):
        v = self._try(lambda: self.client.post("/api/assistant/companion", {"mode": mode}))
        if v:
            self._set(companion=v)

    def set_overlay(self, x, y):
        v = self._try(lambda: self.client.post("/api/assistant/companion", {"overlay": {"x": int(x), "y": int(y)}}))
        if v:
            self._set(companion=v)

    def listening(self, active):
        try:
            self.client.post("/api/assistant/listening", {"active": bool(active)}, timeout=5)
        except KiokuError:
            pass

    def undo(self, action_id):
        if self._try(lambda: self.client.post("/api/assistant/undo", {"id": action_id})) is not None:
            self._reload_conversation()

    def decide(self, proposal_id, what):
        """Aplica o descarta una propuesta (`what`: apply | reject)."""
        r = self._try(lambda: self.client.post(f"/api/proposals/{proposal_id}/{what}"))
        if r is not None:
            if r.get("status") == "failed":
                self._set(problem=r.get("error") or "No se pudo aplicar la propuesta.")
            self._reload_conversation()

    def open_kioku(self, route="/asistente"):
        self._try(lambda: self.client.post("/api/desktop/open", {"route": route}))

    def dismiss_problem(self):
        self._set(problem=None)


# ───────── propuestas: texto de cada cambio ─────────

RISKY_OPS = ("trash", "move", "update")


def risky(proposal):
    """Borrar, mover o reemplazar contenido pide una segunda confirmación antes de aplicar."""
    return any(op.get("op") in RISKY_OPS for op in proposal.get("ops", []))


def op_text(op):
    import json
    kind = op.get("op")
    if kind == "create":
        return f"Crear {op.get('path')}"
    if kind == "update":
        return f"Reemplazar el contenido de {op.get('path')}"
    if kind == "move":
        return f"Mover {op.get('from')} → {op.get('to')}"
    if kind == "trash":
        return f"Mover a la papelera {op.get('path')}"
    if kind == "setProp":
        props = ", ".join(f"{k} → {'(quitar)' if v is None else json.dumps(v, ensure_ascii=False)}" for k, v in (op.get("props") or {}).items())
        return f"Cambiar propiedades de {op.get('path')}: {props}"
    return str(kind)


def proposal_status_text(status):
    return {"pending": "Necesita tu confirmación", "applied": "Aplicada", "rejected": "Descartada"}.get(status, "No se pudo aplicar")


def messages_signature(s):
    """Huella de lo que se pinta en la conversación: si no cambia, no hace falta reconstruir la lista."""
    return (s["conversation"], tuple(
        (m.get("id"), bool(m.get("error")), tuple((a.get("id"), bool(a.get("undone"))) for a in m.get("actions") or []),
         tuple((p.get("id"), p.get("status")) for p in m.get("proposals") or []))
        for m in s["msgs"]))
