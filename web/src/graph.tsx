// Vista de grafo: layout de fuerzas propio sobre <canvas> (sin dependencias). Pensado para cientos de nodos.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useApi } from "./hooks.ts";

interface GNode { path: string; title: string; type: string; degree: number }
interface GraphData { nodes: GNode[]; edges: [number, number][]; total: number; isolated: number }
interface SimNode { n: GNode; x: number; y: number; vx: number; vy: number; r: number; pinned: boolean }

const TYPE_COLOR: Record<string, string> = {
  project: "#f0b35c", task: "#6fcf97", note: "#7aa2f7", capture: "#8a8b93", journal: "#b392f0", resource: "#56d4c4",
};
const TYPE_LABEL: Record<string, string> = {
  project: "Proyectos", task: "Tareas", note: "Notas", capture: "Capturas", journal: "Diario", resource: "Recursos",
};

const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function GraphView({ rev, go, focus }: { rev: number; go(route: string): void; focus?: string }) {
  const [depth, setDepth] = useState(2);
  const url = `/api/graph?${focus ? `focus=${encodeURIComponent(focus)}&depth=${depth}` : "max=400"}`;
  const { data, error } = useApi<GraphData>(url, rev);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const types = useMemo(() => [...new Set((data?.nodes ?? []).map((n) => n.type))].sort(), [data]);

  return (
    <div class="graph-page">
      <header class="graph-bar">
        <h1>{focus ? "Grafo local" : "Grafo"}</h1>
        {focus && <button class="chip btn" onClick={() => go("/grafo")}>Ver todo</button>}
        {focus && (
          <span class="row" style="margin:0">
            {[1, 2, 3].map((d) => <button key={d} class={`chip btn ${depth === d ? "on" : ""}`} onClick={() => setDepth(d)}>{d} salto{d > 1 ? "s" : ""}</button>)}
          </span>
        )}
        <input class="search" placeholder="Resaltar por título…" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <span class="grow" />
        {data && <span class="muted small">{data.nodes.length} de {data.total} notas · {data.isolated} sin enlaces</span>}
      </header>
      <div class="chips graph-types">
        {types.map((t) => (
          <button key={t} class={`chip btn ${hidden.has(t) ? "" : "on"}`} style={hidden.has(t) ? "" : `background:${TYPE_COLOR[t] ?? "#888"};border-color:${TYPE_COLOR[t] ?? "#888"};color:#101010`}
            onClick={() => setHidden((h) => { const n = new Set(h); n.has(t) ? n.delete(t) : n.add(t); return n; })}>{TYPE_LABEL[t] ?? t}</button>
        ))}
      </div>
      {error && <div class="empty">No se pudo cargar el grafo: {error}</div>}
      {data && data.nodes.length === 0 && <div class="empty">Aún no hay enlaces. Escribe <code>[[Otra nota]]</code> en una nota para empezar a tejer el grafo.</div>}
      {data && data.nodes.length > 0 && <Canvas data={data} hidden={hidden} query={query} focus={focus} go={go} />}
    </div>
  );
}

function Canvas({ data, hidden, query, focus, go }: { data: GraphData; hidden: Set<string>; query: string; focus?: string; go(r: string): void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const st = useRef({ nodes: [] as SimNode[], edges: data.edges, adj: [] as Set<number>[], alpha: 1, k: 1, tx: 0, ty: 0, w: 0, h: 0, hover: -1, raf: 0, fitted: false, touched: false, hidden, query, drag: null as null | { i: number; moved: boolean } | { pan: true; x: number; y: number; moved: boolean } });
  st.current.hidden = hidden;
  st.current.query = query;

  const draw = () => {
    const s = st.current, c = cv.current!, ctx = c.getContext("2d")!;
    const dpr = devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);
    const line = cssVar("--line2", "#444"), fg = cssVar("--fg", "#eee"), muted = cssVar("--muted", "#888"), accent = cssVar("--accent", "#f0b35c");
    const q = s.query.trim().toLowerCase();
    const hv = s.hover;
    const near = hv >= 0 ? s.adj[hv] : null;
    const vis = (i: number) => !s.hidden.has(s.nodes[i].n.type);
    ctx.save();
    ctx.translate(s.tx, s.ty);
    ctx.scale(s.k, s.k);
    ctx.lineWidth = 1 / s.k;
    for (const [a, b] of s.edges) {
      if (!vis(a) || !vis(b)) continue;
      const hot = hv >= 0 && (a === hv || b === hv);
      ctx.strokeStyle = hot ? accent : line;
      ctx.globalAlpha = hv >= 0 ? (hot ? 0.95 : 0.12) : 0.55;
      ctx.beginPath();
      ctx.moveTo(s.nodes[a].x, s.nodes[a].y);
      ctx.lineTo(s.nodes[b].x, s.nodes[b].y);
      ctx.stroke();
    }
    ctx.font = `${12 / s.k}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    for (let i = 0; i < s.nodes.length; i++) {
      if (!vis(i)) continue;
      const nd = s.nodes[i];
      const match = !q || nd.n.title.toLowerCase().includes(q);
      const dim = (hv >= 0 && i !== hv && !near!.has(i)) || !match;
      ctx.globalAlpha = dim ? 0.18 : 1;
      ctx.fillStyle = TYPE_COLOR[nd.n.type] ?? "#888";
      ctx.beginPath();
      ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2);
      ctx.fill();
      if (nd.n.path === focus) { ctx.strokeStyle = fg; ctx.lineWidth = 2 / s.k; ctx.stroke(); ctx.lineWidth = 1 / s.k; }
      const showLabel = i === hv || (near && near.has(i)) || (!dim && (nd.n.degree >= 4 || s.k > 1.5 || (q && match) || nd.n.path === focus || s.nodes.length <= 25));
      if (showLabel) {
        ctx.globalAlpha = dim ? 0.3 : 0.92;
        ctx.fillStyle = i === hv ? fg : muted;
        ctx.fillText(nd.n.title.length > 28 ? nd.n.title.slice(0, 27) + "…" : nd.n.title, nd.x, nd.y + nd.r + 13 / s.k);
      }
    }
    ctx.restore();
  };

  const tick = () => {
    const s = st.current, N = s.nodes;
    if (s.alpha > 0.015) {
      const a = s.alpha;
      for (let i = 0; i < N.length; i++) {
        for (let j = i + 1; j < N.length; j++) {
          let dx = N[j].x - N[i].x, dy = N[j].y - N[i].y;
          let d2 = dx * dx + dy * dy;
          if (d2 > 360000) continue;
          if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
          const f = (6500 * a) / d2, d = Math.sqrt(d2);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          N[i].vx -= fx; N[i].vy -= fy; N[j].vx += fx; N[j].vy += fy;
        }
      }
      for (const [x, y] of s.edges) {
        const A = N[x], B = N[y];
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 100) * 0.03 * a;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        A.vx += fx; A.vy += fy; B.vx -= fx; B.vy -= fy;
      }
      for (const n of N) {
        n.vx -= n.x * 0.0022 * a; n.vy -= n.y * 0.0022 * a;
        if (n.pinned) { n.vx = 0; n.vy = 0; continue; }
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx; n.y += n.vy;
      }
      s.alpha *= 0.988;
    }
    if (s.alpha <= 0.03 && !s.fitted && !s.touched) fit();
    draw();
    s.raf = s.alpha > 0.015 || s.drag ? requestAnimationFrame(tick) : 0;
  };
  /** Encuadra todo el grafo en la vista. */
  const fit = () => {
    const s = st.current, N = s.nodes.filter((n) => !s.hidden.has(n.n.type));
    if (!N.length || !s.w) return;
    s.fitted = true;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of N) { x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r); y0 = Math.min(y0, n.y - n.r); y1 = Math.max(y1, n.y + n.r + 16); }
    const k = Math.min(2.2, Math.max(0.2, 0.86 * Math.min(s.w / Math.max(1, x1 - x0), s.h / Math.max(1, y1 - y0))));
    s.k = k; s.tx = s.w / 2 - ((x0 + x1) / 2) * k; s.ty = s.h / 2 - ((y0 + y1) / 2) * k;
  };
  const wake = (alpha = 0.3) => {
    const s = st.current;
    s.alpha = Math.max(s.alpha, alpha);
    if (!s.raf) s.raf = requestAnimationFrame(tick);
  };

  // (Re)construye la simulación cuando cambian los datos.
  useEffect(() => {
    const s = st.current;
    s.edges = data.edges;
    const old = new Map(s.nodes.map((n) => [n.n.path, n]));
    s.nodes = data.nodes.map((n, i) => {
      const prev = old.get(n.path);
      const ang = i * 2.399963, rad = 28 * Math.sqrt(i + 1);
      return { n, x: prev?.x ?? Math.cos(ang) * rad, y: prev?.y ?? Math.sin(ang) * rad, vx: 0, vy: 0, r: 4 + Math.sqrt(n.degree) * 1.7, pinned: false };
    });
    s.adj = s.nodes.map(() => new Set<number>());
    for (const [a, b] of s.edges) { s.adj[a].add(b); s.adj[b].add(a); }
    s.alpha = old.size ? 0.4 : 1;
    s.fitted = false;
    wake(s.alpha);
    return () => { cancelAnimationFrame(s.raf); s.raf = 0; };
  }, [data]);

  useEffect(() => { draw(); }, [hidden, query]);

  // Tamaño del canvas.
  useEffect(() => {
    const el = wrap.current!, c = cv.current!;
    const fit = () => {
      const s = st.current, dpr = devicePixelRatio || 1;
      const first = s.w === 0;
      s.w = el.clientWidth; s.h = el.clientHeight;
      c.width = s.w * dpr; c.height = s.h * dpr;
      if (first) { s.tx = s.w / 2; s.ty = s.h / 2; }
      draw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toWorld = (e: PointerEvent | WheelEvent) => {
    const r = cv.current!.getBoundingClientRect(), s = st.current;
    return { x: (e.clientX - r.left - s.tx) / s.k, y: (e.clientY - r.top - s.ty) / s.k };
  };
  const hit = (e: PointerEvent) => {
    const s = st.current, p = toWorld(e);
    for (let i = s.nodes.length - 1; i >= 0; i--) {
      if (s.hidden.has(s.nodes[i].n.type)) continue;
      const n = s.nodes[i], dx = n.x - p.x, dy = n.y - p.y, r = n.r + 4 / s.k;
      if (dx * dx + dy * dy <= r * r) return i;
    }
    return -1;
  };

  const open = (n: GNode) => go(n.type === "project" ? `/proyecto/${n.path}` : `/nota/${n.path}`);

  const down = (e: PointerEvent) => {
    const s = st.current, i = hit(e);
    s.touched = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (i >= 0) { s.drag = { i, moved: false }; s.nodes[i].pinned = true; }
    else s.drag = { pan: true, x: e.clientX, y: e.clientY, moved: false };
    wake(0.15);
  };
  const move = (e: PointerEvent) => {
    const s = st.current, d = s.drag;
    if (d && "pan" in d) {
      s.tx += e.clientX - d.x; s.ty += e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; d.moved = true; draw();
    } else if (d) {
      const p = toWorld(e); const n = s.nodes[d.i]; n.x = p.x; n.y = p.y; d.moved = true; wake(0.2);
    } else {
      const i = hit(e);
      if (i !== s.hover) { s.hover = i; cv.current!.style.cursor = i >= 0 ? "pointer" : "grab"; draw(); }
    }
  };
  const up = () => {
    const s = st.current, d = s.drag;
    s.drag = null;
    if (d && !("pan" in d)) {
      s.nodes[d.i].pinned = false;
      if (!d.moved) open(s.nodes[d.i].n);
    }
    wake(0.05);
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    st.current.touched = true;
    const s = st.current, p = toWorld(e), r = cv.current!.getBoundingClientRect();
    const k = Math.min(4, Math.max(0.2, s.k * Math.exp(-e.deltaY * 0.0012)));
    s.k = k;
    s.tx = e.clientX - r.left - p.x * k;
    s.ty = e.clientY - r.top - p.y * k;
    draw();
  };
  useEffect(() => {
    const c = cv.current!;
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, []);

  return (
    <div class="graph-wrap" ref={wrap}>
      <canvas ref={cv} style="width:100%;height:100%;cursor:grab" onPointerDown={down} onPointerMove={move} onPointerUp={up}
        onPointerLeave={() => { if (!st.current.drag) { st.current.hover = -1; draw(); } }} aria-label="Grafo de notas y enlaces" />
      <button class="mini graph-fit" onClick={() => { st.current.touched = false; fit(); draw(); }}>Encuadrar</button>
      <div class="graph-hint muted small">Arrastra para mover · rueda para zoom · clic en un nodo para abrirlo</div>
    </div>
  );
}
