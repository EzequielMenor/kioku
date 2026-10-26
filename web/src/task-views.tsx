// Vistas tipo base de datos sobre las propiedades de las tareas (frontmatter): Tabla y Tablero.
import { useState } from "preact/hooks";
import { api } from "./api.ts";
import type { TaskRow, TaskStatus } from "./types.ts";

type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;
interface Props { tasks: TaskRow[]; today?: string; guard: Guard; fmt(d: string | null, today?: string): string }

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
export const STATUS: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "Pendiente" }, { id: "doing", label: "En curso" }, { id: "done", label: "Hecha" }, { id: "dropped", label: "Descartada" },
];
const setStatus = (guard: Guard, path: string, status: TaskStatus) => guard(() => api("POST", "/api/task/status", { path, status }));

type SortKey = "title" | "project" | "status" | "due" | "priority";
const COLS: { key: SortKey; label: string }[] = [
  { key: "title", label: "Tarea" }, { key: "project", label: "Proyecto" }, { key: "status", label: "Estado" },
  { key: "due", label: "Vence" }, { key: "priority", label: "Prioridad" },
];
const order = (t: TaskRow, k: SortKey): string | number => {
  switch (k) {
    case "title": return t.title.toLowerCase();
    case "project": return (t.projectTitle ?? "￿").toLowerCase();
    case "status": return STATUS.findIndex((s) => s.id === t.status);
    case "due": return t.due ?? "9999";
    case "priority": return t.priority ?? 9;
  }
};

export function TaskTable({ tasks, today, guard, fmt }: Props) {
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "due", dir: 1 });
  const rows = [...tasks].sort((a, b) => {
    const x = order(a, sort.k), y = order(b, sort.k);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.title.localeCompare(b.title);
  });
  const th = (c: (typeof COLS)[number]) => (
    <th key={c.key} aria-sort={sort.k === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button class="th" onClick={() => setSort({ k: c.key, dir: sort.k === c.key ? (sort.dir === 1 ? -1 : 1) : 1 })}>
        {c.label}{sort.k === c.key && <span class="muted">{sort.dir === 1 ? " ↑" : " ↓"}</span>}
      </button>
    </th>
  );
  return (
    <div class="dbtable">
      <table>
        <thead><tr>{COLS.map(th)}</tr></thead>
        <tbody>
          {rows.map((t) => {
            const closed = t.status === "done" || t.status === "dropped";
            return (
              <tr key={t.path} class={closed ? "is-done" : ""}>
                <td><a href={`#/nota/${enc(t.path)}`}>{t.title}</a></td>
                <td>{t.projectPath ? <a class="chip link" href={`#/proyecto/${enc(t.projectPath)}`}>{t.projectTitle}</a> : <span class="muted">—</span>}</td>
                <td>
                  <select class="cell-select" value={t.status} aria-label={`Estado de «${t.title}»`}
                    onChange={(e) => void setStatus(guard, t.path, e.currentTarget.value as TaskStatus)}>
                    {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </td>
                <td class={!closed && t.due && today && t.due < today ? "bad-text" : ""}>{t.due ? fmt(t.due, today) : <span class="muted">—</span>}</td>
                <td>{t.priority ? `p${t.priority}` : <span class="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <div class="empty">Nada que mostrar.</div>}
    </div>
  );
}

export function TaskBoard({ tasks, today, guard, fmt }: Props) {
  const [over, setOver] = useState<TaskStatus | null>(null);
  const drop = (status: TaskStatus, e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const path = e.dataTransfer?.getData("text/plain");
    const t = tasks.find((x) => x.path === path);
    if (t && t.status !== status) void setStatus(guard, t.path, status);
  };
  return (
    <div class="board">
      {STATUS.map((col) => {
        const items = tasks.filter((t) => t.status === col.id)
          .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || (a.priority ?? 9) - (b.priority ?? 9));
        return (
          <section key={col.id} class={`col ${over === col.id ? "over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(col.id); }} onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
            onDrop={(e) => drop(col.id, e)}>
            <h2 class="sec">{col.label} <span class="muted">{items.length}</span></h2>
            {items.slice(0, 60).map((t) => {
              const overdue = !!t.due && !!today && t.due < today && col.id !== "done" && col.id !== "dropped";
              return (
                <article key={t.path} class="kcard" draggable onDragStart={(e) => e.dataTransfer?.setData("text/plain", t.path)}>
                  <a href={`#/nota/${enc(t.path)}`}>{t.title}</a>
                  <div class="meta">
                    {t.priority && <span class="chip">p{t.priority}</span>}
                    {t.due && <span class={`chip ${overdue ? "bad" : ""}`}>{fmt(t.due, today)}</span>}
                    {t.projectPath && <a class="chip link" href={`#/proyecto/${enc(t.projectPath)}`}>{t.projectTitle}</a>}
                    <select class="cell-select kmove" value={t.status} aria-label={`Mover «${t.title}»`}
                      onChange={(e) => void setStatus(guard, t.path, e.currentTarget.value as TaskStatus)}>
                      {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                </article>
              );
            })}
            {items.length === 0 && <div class="kempty muted small">Arrastra tareas aquí</div>}
          </section>
        );
      })}
    </div>
  );
}
