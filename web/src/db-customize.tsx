// Panel «Personalizar» de una base: permite editar título, icono, origen (carpeta/tipo/etiquetas), propiedades visibles
// y acceder al fichero Markdown de definición sin obligar a editar YAML a mano.
import { useEffect, useState } from "preact/hooks";
import { api } from "./api.ts";
import { AddPropertyButton } from "./db-add-property.tsx";
import { enc, label, PROP_TYPE_LABEL } from "./db-common.ts";
import type { Meta } from "./db-common.ts";
import type { HeaderMenuCtx } from "./db-header-menu.tsx";
import type { View } from "./types.ts";

const DB_ICONS = ["", "🗂️", "📋", "✅", "📚", "🎯", "💡", "🌱", "⚙️", "⭐"] as const;

const SOURCE_TYPES: readonly { id: string; label: string }[] = [
  { id: "", label: "Cualquier tipo" },
  { id: "note", label: "Nota" },
  { id: "task", label: "Tarea" },
  { id: "project", label: "Proyecto" },
  { id: "journal", label: "Diario" },
  { id: "resource", label: "Recurso" },
  { id: "capture", label: "Captura" },
];

function parseTags(raw: string): string[] {
  return raw.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean);
}

export function CustomizePanel({ db, view, edit, menu, path, onClose }: {
  db: Meta;
  view: View;
  edit(patch: Partial<View>): void;
  menu: HeaderMenuCtx;
  path: string;
  onClose(): void;
}) {
  const [title, setTitle] = useState(db.title);
  const [folder, setFolder] = useState(db.source?.folder ?? "");
  const [type, setType] = useState(db.source?.type ?? "");
  const [tags, setTags] = useState((db.source?.tags ?? []).join(", "));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(db.title);
    setFolder(db.source?.folder ?? "");
    setType(db.source?.type ?? "");
    setTags((db.source?.tags ?? []).join(", "));
  }, [db.title, db.source?.folder, db.source?.type, (db.source?.tags ?? []).join(",")]);

  const cols = view.columns.length ? view.columns : db.available.filter((c) => c.key !== "tags").map((c) => c.key);

  const saveMeta = async (patch: { title?: string; icon?: string | null; source?: { folder?: string | null; type?: string | null; tags?: string[] } }, message?: string) => {
    setSaving(true);
    try {
      const ok = await menu.guard(() => api("POST", "/api/database/meta", { path, ...patch }));
      if (ok && message) menu.say(message);
    } finally { setSaving(false); }
  };

  const submitForm = async (e: Event) => {
    e.preventDefault();
    await saveMeta({
      title: title.trim() || db.title,
      source: { folder: folder.trim() || null, type: type || null, tags: parseTags(tags) },
    }, "Base actualizada");
  };

  return (
    <section class="dbpanel db-custom" aria-label="Personalizar base">
      <form class="db-custom-form" onSubmit={(e) => void submitForm(e)}>
        <h3 class="sec">Nombre e icono</h3>
        <label class="custom-field">
          <span>Título</span>
          <input aria-label="Título de la base" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
        </label>
        <div class="custom-field">
          <span>Icono</span>
          <div class="icon-row" role="group" aria-label="Icono de la base">
            {DB_ICONS.map((ic) => (
              <button
                key={ic || "none"}
                type="button"
                class={`icon-opt ${(db.icon ?? "") === ic ? "on" : ""}`}
                title={ic ? `Usar ${ic}` : "Sin icono"}
                disabled={saving}
                onClick={() => void saveMeta({ icon: ic || null })}
              >
                {ic || "—"}
              </button>
            ))}
          </div>
        </div>

        <h3 class="sec">Qué notas entran</h3>
        <div class="frow">
          <label class="custom-field">
            <span>Carpeta</span>
            <input aria-label="Carpeta de origen" placeholder="Todo el vault (o ej. Libros)" value={folder} onInput={(e) => setFolder(e.currentTarget.value)} />
          </label>
          <label class="custom-field">
            <span>Tipo</span>
            <select aria-label="Tipo de origen" value={type} onChange={(e) => setType(e.currentTarget.value)}>
              {SOURCE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
        </div>
        <label class="custom-field">
          <span>Etiquetas (separadas por coma)</span>
          <input aria-label="Etiquetas de origen" placeholder="Ej. libro, prioridad" value={tags} onInput={(e) => setTags(e.currentTarget.value)} />
        </label>
        <div class="row" style="margin-top:8px">
          <button type="submit" class="primary" disabled={saving}>Guardar ajustes</button>
          <a class="chip link" href={`#/nota/${enc(path)}`} title="Ver y editar el fichero Markdown de definición">Definición</a>
          <button type="button" class="subtle" onClick={onClose}>Cerrar</button>
        </div>
      </form>

      <div>
        <div class="row" style="justify-content:space-between;align-items:center">
          <h3 class="sec">Propiedades y columnas</h3>
          <AddPropertyButton ctx={menu} variant="btn" labelText="+ Nueva propiedad" />
        </div>
        <div class="colpick custom-cols">
          {db.available.map((c) => (
            <label key={c.key} class="custom-col-item">
              <input
                type="checkbox"
                checked={cols.includes(c.key)}
                onChange={(e) => edit({ columns: e.currentTarget.checked ? [...cols, c.key] : cols.filter((k) => k !== c.key) })}
              />
              <span>{label(c.key)}</span>
              <span class="chip small">{PROP_TYPE_LABEL[c.type]}</span>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
