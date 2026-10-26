// Editor Markdown (CodeMirror 6). Edita el CUERPO; el frontmatter se conserva intacto aparte.
import { autocompletion, closeBrackets, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, drawSelection, EditorView, keymap, placeholder, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { api } from "./api.ts";

const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Separa el bloque de frontmatter (texto exacto) del cuerpo. */
export function splitNote(text: string): { fm: string; body: string } {
  const bom = text.charCodeAt(0) === 0xfeff ? "﻿" : "";
  const src = bom ? text.slice(1) : text;
  const m = FM_RE.exec(src);
  return m ? { fm: bom + m[0], body: src.slice(m[0].length) } : { fm: bom, body: src };
}

const highlight = HighlightStyle.define([
  { tag: t.heading1, class: "tok-h1" }, { tag: t.heading2, class: "tok-h2" }, { tag: t.heading3, class: "tok-h3" },
  { tag: [t.heading4, t.heading5, t.heading6], class: "tok-h4" },
  { tag: t.strong, fontWeight: "650" }, { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, class: "tok-link" }, { tag: t.url, class: "tok-url" },
  { tag: t.monospace, class: "tok-code" }, { tag: t.quote, class: "tok-quote" },
  { tag: [t.processingInstruction, t.contentSeparator], class: "tok-mark" },
]);

const wikiMark = Decoration.mark({ class: "cm-wikilink" });
const tagMark = Decoration.mark({ class: "cm-hashtag" });
const doneLine = Decoration.line({ class: "cm-task-done" });

const WIKI = /!?\[\[[^\]\n]+\]\]/g;
const TAG = /(?<![\p{L}\p{N}_/&#])#[\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*/gu;

const decorate = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
    build(view: EditorView): DecorationSet {
      const b = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        const found: { s: number; e: number; d: Decoration }[] = [];
        for (const m of text.matchAll(WIKI)) found.push({ s: from + m.index!, e: from + m.index! + m[0].length, d: wikiMark });
        for (const m of text.matchAll(TAG)) {
          // no marcar encabezados "# Título" (requieren espacio, ya excluido por la regex) ni dentro de enlaces
          const s = from + m.index!;
          if (!found.some((f) => s >= f.s && s < f.e)) found.push({ s, e: s + m[0].length, d: tagMark });
        }
        found.sort((a, c) => a.s - c.s);
        for (const f of found) b.add(f.s, f.e, f.d);
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// Líneas de tarea completadas: tachadas y atenuadas (decoración de línea, rango aparte).
const doneLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
    build(view: EditorView): DecorationSet {
      const b = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          if (/^\s*[-*+]\s+\[[xX]\]\s/.test(line.text)) b.add(line.from, line.from, doneLine);
          pos = line.to + 1;
        }
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

async function linkCompletions(ctx: CompletionContext) {
  const m = ctx.matchBefore(/\[\[[^\]\n]*/);
  if (!m || (m.from === m.to && !ctx.explicit)) return null;
  const q = m.text.slice(2);
  const items = await api<{ path: string; title: string; type: string }[]>("GET", `/api/suggest-links?q=${encodeURIComponent(q)}`);
  return {
    from: m.from + 2,
    filter: false,
    options: items.map((i) => ({
      label: i.title, detail: i.type === "note" ? "" : i.type, type: "text",
      apply: (view: EditorView, _c: unknown, from: number, to: number) => {
        const after = view.state.doc.sliceString(to, to + 2);
        const insert = i.title + (after === "]]" ? "" : "]]");
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + (after === "]]" ? 2 : 0) } });
      },
    })),
  };
}

export interface EditorHandle {
  getBody(): string;
  setBody(body: string): void;
  focus(): void;
  destroy(): void;
}

export function createEditor(
  parent: HTMLElement,
  initial: string,
  hooks: { onChange(): void; onFollow(target: string): void; onSave(): void },
): EditorHandle {
  /** Enlace o casilla bajo el cursor: seguir enlace / alternar casilla. */
  const activate = (view: EditorView): boolean => {
    const { head } = view.state.selection.main;
    const line = view.state.doc.lineAt(head);
    for (const m of line.text.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
      const s = line.from + m.index!, e = s + m[0].length;
      if (head >= s && head <= e) {
        hooks.onFollow(m[1].split("|")[0].split("#")[0].trim());
        return true;
      }
    }
    const cb = /^(\s*[-*+]\s+)\[( |x|X)\]/.exec(line.text);
    if (cb) {
      const pos = line.from + cb[1].length + 1;
      view.dispatch({ changes: { from: pos, to: pos + 1, insert: cb[2] === " " ? "x" : " " } });
      return true;
    }
    return false;
  };

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initial,
      extensions: [
        placeholder("Escribe aquí…  [[ enlaza otra nota · - [ ] crea una tarea · # título"), history(), drawSelection(), closeBrackets(), EditorView.lineWrapping,
        markdown(), syntaxHighlighting(highlight), decorate, doneLines,
        autocompletion({ override: [linkCompletions], icons: false }),
        keymap.of([
          { key: "Mod-Enter", run: activate },
          { key: "Mod-s", run: () => { hooks.onSave(); return true; } },
          indentWithTab, ...defaultKeymap, ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => { if (u.docChanged) hooks.onChange(); }),
        EditorView.domEventHandlers({
          click(e, v) {
            if (!(e.ctrlKey || e.metaKey)) return false;
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos === null) return false;
            v.dispatch({ selection: { anchor: pos } });
            return activate(v);
          },
        }),
        EditorView.contentAttributes.of({ "aria-label": "Editor de nota", spellcheck: "true", lang: "es" }),
      ],
    }),
  });
  return {
    getBody: () => view.state.doc.toString(),
    setBody: (body) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body } }),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
