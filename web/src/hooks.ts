import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api, onChange, type ChangeEvent } from "./api.ts";
import { isStaticDemoHost } from "./demo/engine.ts";

/** Contador que sube con cada cambio del vault (SSE) para refrescar las vistas. */
export function useRevision(onEvent?: (e: ChangeEvent) => void): number {
  const [rev, setRev] = useState(0);
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    let t: number | undefined;
    const off = onChange((e) => {
      cb.current?.(e);
      if (e.kind === "navigate") return;
      clearTimeout(t);
      t = window.setTimeout(() => setRev((r) => r + 1), 120);
    });
    return () => { off(); clearTimeout(t); };
  }, []);
  return rev;
}

export function useApi<T>(path: string | null, rev: number): { data: T | null; error: string | null; reload(): void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let dead = false;
    if (last.current !== path) { setData(null); last.current = path; }
    api<T>("GET", path).then(
      (d) => { if (!dead) { setData(d); setError(null); } },
      (e: Error) => { if (!dead) setError(e.message); },
    );
    return () => { dead = true; };
  }, [path, rev, tick]);
  return { data, error, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** Portada pública de la demo: solo en un alojamiento estático reconocido, nunca en un host propio con sesión real. */
export function isPublicWebHost(): boolean {
  if (typeof window === "undefined") return false;
  return isStaticDemoHost(location.hostname) && !new URLSearchParams(location.search).has("k");
}

/** Ruta del cliente basada en el hash: "#/nota/Notas/x.md" → "/nota/Notas/x.md". */
export function useRoute(): [string, (r: string) => void] {
  const defaultRoute = () => (isPublicWebHost() && new URLSearchParams(location.search).get("demo") !== "1" ? "/inicio" : "/hoy");
  const read = () => decodeURI(location.hash.slice(1)) || defaultRoute();
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const h = () => setRoute(read());
    addEventListener("hashchange", h);
    return () => removeEventListener("hashchange", h);
  }, []);
  return [route, (r) => { location.hash = encodeURI(r); }];
}
