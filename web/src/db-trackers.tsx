// Vistas visuales de seguimiento sobre una base: «habits» (rejilla de la semana, un toque marca el día) y «progress»
// (barras de lectura por grupo, con − / +). Las filas siguen siendo notas Markdown: cada toque cambia una propiedad.
import { useEffect, useState } from "preact/hooks";
import { api } from "./api.ts";
import { enc, type Result } from "./db-common.ts";
import { daysOf, lastDays, readingTotals, streak, toggleDay } from "./trackers.ts";
import type { ResultRow, View } from "./types.ts";

type SetCell = (row: ResultRow, key: string, value: unknown) => Promise<unknown>;
type AddRow = (title: string) => Promise<boolean>;
const today = () => new Date().toLocaleDateString("sv");
const WEEKDAY = ["D", "L", "M", "X", "J", "V", "S"];

function AddInline({ placeholder, onAdd }: { placeholder: string; onAdd: AddRow }) {
  const [t, setT] = useState("");
  return (
    <form class="tracker-add" onSubmit={async (e) => { e.preventDefault(); if (t.trim() && (await onAdd(t.trim()))) setT(""); }}>
      <input value={t} placeholder={placeholder} aria-label={placeholder} onInput={(e) => setT(e.currentTarget.value)} />
      <button disabled={!t.trim()}>Añadir</button>
    </form>
  );
}

export function Habits({ res, view, setCell, addRow }: { res: Result; view: View; setCell: SetCell; addRow: AddRow | null }) {
  const track = view.track ?? "Hechos";
  const now = today();
  const days = lastDays(now, 7);
  // Cambio optimista: el toque se ve al instante y el servidor confirma con la recarga.
  const [local, setLocal] = useState<Record<string, string[]>>({});
  const doneOf = (r: ResultRow) => local[r.path] ?? daysOf(r.cells[track]);
  const toggle = (r: ResultRow, day: string) => {
    const next = toggleDay(doneOf(r), day);
    setLocal((m) => ({ ...m, [r.path]: next }));
    void setCell(r, track, next);
  };
  return (
    <div class="habits">
      <div class="habits-row habits-head" aria-hidden="true">
        <span />
        {days.map((d) => <span key={d} class={d === now ? "is-today" : ""}>{WEEKDAY[new Date(`${d}T12:00:00`).getDay()]}<small>{Number(d.slice(8))}</small></span>)}
        <span>Racha</span>
      </div>
      {res.rows.map((r) => {
        const done = new Set(doneOf(r));
        const s = streak([...done], now);
        return (
          <div key={r.path} class="habits-row">
            <a href={`#/nota/${enc(r.path)}`} class="habit-name">{r.title}</a>
            {days.map((d) => (
              <button key={d} class={`habit-day ${done.has(d) ? "on" : ""} ${d === now ? "is-today" : ""}`} aria-pressed={done.has(d)}
                aria-label={`${r.title}, ${d}: ${done.has(d) ? "hecho" : "sin hacer"}`} onClick={() => toggle(r, d)} />
            ))}
            <span class={`habit-streak ${s ? "" : "muted"}`}>{s ? `${s} d` : "—"}</span>
          </div>
        );
      })}
      {!res.rows.length && <p class="muted">Añade tu primer hábito (por ejemplo «Leer la Biblia», «Ejercicio» o «Dormir 8 h»). También puedes decirle a Kio «hoy hice ejercicio».</p>}
      {addRow ? <AddInline placeholder="Nuevo hábito…" onAdd={addRow} /> : <p class="muted small">Para añadir un hábito, díselo a Kio o hazlo desde el ordenador.</p>}
    </div>
  );
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function Progress({ res, view, setCell }: { res: Result; view: View; setCell: SetCell }) {
  const track = view.track ?? "Leídos";
  const totalKey = view.total ?? "Capítulos";
  const [local, setLocal] = useState<Record<string, number>>({});
  const valueOf = (r: ResultRow) => local[r.path] ?? num(r.cells[track]);
  const rows = res.rows.map((r) => ({ ...r, cells: { ...r.cells, [track]: valueOf(r) } }));
  const set = (r: ResultRow, v: number) => {
    const max = num(r.cells[totalKey]) || Infinity;
    const next = Math.max(0, Math.min(max, v));
    setLocal((m) => ({ ...m, [r.path]: next }));
    void setCell(r, track, next);
  };
  const all = readingTotals(rows, track, totalKey);
  const groups = res.groups?.length ? res.groups.map((g) => ({ key: g.key, rows: g.rows.map((r) => rows.find((x) => x.path === r.path)!) })) : [{ key: "", rows }];
  return (
    <div class="reading">
      <section class="reading-total">
        <div><b>{all.pct}%</b> <span class="muted">· {all.read} de {all.total} · {all.done === 1 ? "1 terminado" : `${all.done} terminados`}</span></div>
        <div class="bar"><i style={{ width: `${all.pct}%` }} /></div>
      </section>
      {groups.map((g) => {
        const t = readingTotals(g.rows, track, totalKey);
        return (
          <section key={g.key}>
            {g.key && <h2 class="sec">{g.key} <span class="muted">{t.pct}%</span></h2>}
            <div class="books">
              {g.rows.map((r) => {
                const v = num(r.cells[track]), max = num(r.cells[totalKey]);
                const pct = max ? Math.round((Math.min(v, max) / max) * 100) : 0;
                return (
                  <div key={r.path} class={`book ${max && v >= max ? "done" : v ? "started" : ""}`}>
                    <a href={`#/nota/${enc(r.path)}`}>{r.title}</a>
                    <div class="bar"><i style={{ width: `${pct}%` }} /></div>
                    <div class="book-ctl">
                      <button aria-label={`Un capítulo menos de ${r.title}`} disabled={v <= 0} onClick={() => set(r, v - 1)}>−</button>
                      <span>{v}/{max || "?"}</span>
                      <button aria-label={`Un capítulo más de ${r.title}`} disabled={!!max && v >= max} onClick={() => set(r, v + 1)}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Hoy: los hábitos del día como fichas; un toque marca o desmarca hoy. Sin base de hábitos no ocupa sitio. */
export function HabitsToday({ rev }: { rev: number }) {
  const [data, setData] = useState<{ res: Result; track: string } | null>(null);
  const [local, setLocal] = useState<Record<string, string[]>>({});
  const now = today();
  useEffect(() => {
    let dead = false;
    void (async () => {
      const dbs = await api<{ path: string; views: View[] }[]>("GET", "/api/databases").catch(() => []);
      const db = dbs.find((d) => d.views.some((v) => v.kind === "habits"));
      if (!db) { if (!dead) setData(null); return; }
      const view = db.views.find((v) => v.kind === "habits")!;
      const res = await api<Result>("POST", "/api/database/query", { path: db.path, view: view.name }).catch(() => null);
      if (!dead && res) { setData({ res, track: view.track ?? "Hechos" }); setLocal({}); }
    })();
    return () => { dead = true; };
  }, [rev]);
  if (!data?.res.rows.length) return null;
  const { res, track } = data;
  return (
    <section>
      <h2 class="sec">Hábitos de hoy <a class="muted small" href={`#/bases/${enc(res.database.path)}`}>ver semana</a></h2>
      <div class="habit-chips">
        {res.rows.map((r) => {
          const days = local[r.path] ?? daysOf(r.cells[track]);
          const on = days.includes(now);
          return (
            <button key={r.path} class={`habit-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => {
              const next = toggleDay(days, now);
              setLocal((m) => ({ ...m, [r.path]: next }));
              void api("POST", "/api/note/props", { path: r.path, props: { [track]: next.length ? next : null } });
            }}>{on ? "✓ " : ""}{r.title}</button>
          );
        })}
      </div>
    </section>
  );
}
