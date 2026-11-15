"""Cliente del daemon de Kioku para el compañero de escritorio: HTTP local autenticado y flujo de eventos (SSE).

Solo usa la biblioteca estándar. Se autentica con la credencial limitada del compañero (`.kioku/secret-companion`),
que el daemon restringe a conversar, ver el estado y confirmar: este proceso nunca tiene la clave completa.
"""
import http.client
import json
import os
import threading


class KiokuError(Exception):
    """Fallo al hablar con el daemon. `status` es el código HTTP, o None si ni siquiera hubo conexión."""

    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def kioku_home():
    return os.path.abspath(os.environ.get("KIOKU_HOME") or os.path.join(os.path.expanduser("~"), "Documents", "Kioku"))


class Client:
    def __init__(self, home=None):
        self.home = home or kioku_home()

    def _read(self, name):
        try:
            with open(os.path.join(self.home, ".kioku", name), encoding="utf-8") as f:
                return f.read().strip()
        except OSError:
            return None

    def port(self):
        """Puerto del daemon en marcha (se relee siempre: puede cambiar al reiniciarse).

        Solo vale si el proceso que lo anotó sigue vivo: si el daemon murió sin limpiar, otro programa podría
        estar escuchando en ese puerto y no se le entrega la credencial.
        """
        try:
            rt = json.loads(self._read("runtime.json") or "{}")
            port, pid = int(rt["port"]), int(rt.get("pid") or 0)
        except (KeyError, ValueError, TypeError, AttributeError):
            return None
        if not 0 < port < 65536:
            return None
        if pid > 0 and os.path.isdir("/proc") and not os.path.isdir(f"/proc/{pid}"):
            return None
        return port

    def key(self):
        k = self._read("secret-companion")
        return k if k and len(k) == 64 else None

    def _conn(self, timeout):
        port, key = self.port(), self.key()
        if not port:
            raise KiokuError("Kioku no está en marcha")
        if not key:
            raise KiokuError("Falta la credencial del compañero: lánzalo con «kioku companion»")
        # Siempre 127.0.0.1: el compañero solo habla con el daemon local.
        return http.client.HTTPConnection("127.0.0.1", port, timeout=timeout), {"x-kioku-key": key, "host": f"127.0.0.1:{port}"}

    def request(self, method, path, body=None, timeout=15):
        conn, headers = self._conn(timeout)
        try:
            payload = None
            if method != "GET":
                payload = json.dumps(body or {}).encode()
                headers["content-type"] = "application/json"
            conn.request(method, path, body=payload, headers=headers)
            res = conn.getresponse()
            raw = res.read().decode("utf-8", "replace")
            try:
                data = json.loads(raw) if raw else {}
            except ValueError:
                data = {}
            if res.status == 401:
                raise KiokuError("Kioku no reconoce la credencial del compañero: reinicia el daemon o vuelve a lanzar «kioku companion»", 401)
            if res.status >= 400:
                raise KiokuError((data.get("error") if isinstance(data, dict) else None) or f"Kioku respondió {res.status}", res.status)
            return data
        except (OSError, http.client.HTTPException) as e:
            raise KiokuError(f"Sin conexión con Kioku ({e.__class__.__name__})") from e
        finally:
            conn.close()

    def get(self, path, timeout=15):
        return self.request("GET", path, timeout=timeout)

    def post(self, path, body=None, timeout=15):
        return self.request("POST", path, body, timeout=timeout)

    def events(self, on_event, on_status, stop):
        """Bucle del flujo de eventos con reconexión. `on_status(True|False)` avisa de si hay daemon."""
        delay = 0.5
        while not stop.is_set():
            conn = None
            try:
                conn, headers = self._conn(timeout=40)
                conn.request("GET", "/api/events", headers=headers)
                res = conn.getresponse()
                if res.status != 200:
                    raise KiokuError(f"eventos: {res.status}")
                on_status(True)
                delay = 0.5
                while not stop.is_set():
                    line = res.readline()  # el daemon manda un latido cada 25 s: sin él, el tiempo de espera corta y se reconecta
                    if not line:
                        break
                    if line.startswith(b"data:"):
                        try:
                            on_event(json.loads(line[5:].decode("utf-8")))
                        except ValueError:
                            pass
            except (OSError, http.client.HTTPException, KiokuError):
                pass
            finally:
                if conn:
                    conn.close()
            if stop.is_set():
                break
            on_status(False)
            stop.wait(delay)
            delay = min(delay * 2, 8)


def in_thread(fn, *args):
    t = threading.Thread(target=fn, args=args, daemon=True)
    t.start()
    return t


if __name__ == "__main__":
    try:
        print(json.dumps(Client().get("/api/assistant/state"), ensure_ascii=False, indent=1))
    except KiokuError as e:
        raise SystemExit(f"kioku companion: {e}")
