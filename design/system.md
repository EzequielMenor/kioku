# Kioku visual system

Extracted from existing source; not a proposed replacement. Sources: `web/src/app.css` and `web/src/quick.css`. Standalone mockups do not load fonts or production assets.

## Colors

Values from `web/src/app.css:4–24`; Quick repeats the dark background, foreground, accent, selection and error tokens in `web/src/quick.css:1–3`.

| Token | Dark | Light | Usage |
| --- | --- | --- | --- |
| `--bg` | `#0f0e0c` | `#f6f1e7` | Page / conversation canvas |
| `--side` | `#131210` | `#efe9dc` | Navigation / peripheral surfaces |
| `--surface` | `#181714` | `#fbf8f1` | Cards / controls |
| `--raised` | `#1e1c19` | `#fbf8f1` | Raised controls and inset actions |
| `--hover` | `#211f1b` | `#ebe4d4` | Hover state |
| `--sel` | `#292621` | `#e6dec9` | Selected item |
| `--line` | `#2a2723` | `#e2dacb` | Subtle separators |
| `--line2` | `#36322c` | `#d4cab6` | Control outlines |
| `--fg` | `#ebe6dc` | `#1f1b16` | Primary readable text |
| `--fg2` | `#bdb6a8` | `#4d463b` | Secondary readable text |
| `--muted` | `#8b8478` | `#6c6558` | Auxiliary text; verify contrast on its surface |
| `--accent` | `#7f9bd6` | `#2f4b8a` | Indigo primary action / focus |
| `--accent-fg` | `#0c1220` | `#fff` | Text on primary action |
| `--accent-soft` | `rgba(127,155,214,.13)` | `rgba(47,75,138,.09)` | Subtle primary tint |
| `--accent-line` | `rgba(127,155,214,.38)` | `rgba(47,75,138,.35)` | Primary outlines |
| `--bad` | `#e8786c` | `#b3342b` | Destructive / error, always with text |
| `--good` | `#8fb573` | `#4c7a32` | Success, always with text |
| `--warn-bg` | `rgba(216,166,87,.10)` | `#f6ead0` | Warning surface |
| `--warn-line` | `rgba(216,166,87,.38)` | `#dfc27f` | Warning outline |
| `--t-project` | `#7f9bd6` | `#2f4b8a` | Note-type semantic color |
| `--t-task` | `#8fb573` | `#5a8a3c` | Note-type semantic color |
| `--t-note` | `#d2c3a3` | `#9c8660` | Note-type semantic color |
| `--t-capture` | `#8a867c` | `#7a766c` | Note-type semantic color |
| `--t-journal` | `#a891c9` | `#7b5fa6` | Note-type semantic color |
| `--t-resource` | `#5fb3b3` | `#2f8a8a` | Note-type semantic color |

## Typography

Source: `web/src/app.css:12–14, 39–51, 204`; Quick input: `web/src/quick.css:6–9`.

- `--sans`: `Inter, "SF Pro Text", system-ui, -apple-system, "Segoe UI", sans-serif`.
- `--serif`: `"Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", Georgia, serif`.
- `--mono`: `"JetBrains Mono", ui-monospace, "Cascadia Code", Menlo, monospace`.
- Existing roles: body 14/1.55; mobile inputs 16 px; h1 28 px (22 px on mobile), h2 18 px; label 11 px uppercase; metadata 12.5 px. Sources: `web/src/app.css` body/headings and mobile media rules.
- **Standalone font rule:** use only existing system fallbacks: `system-ui, -apple-system, "Segoe UI", sans-serif`; `Georgia, serif`; `ui-monospace, Menlo, monospace`. These are subsets of the recorded stacks, not new brand fonts. Never load Shippori, Inter or JetBrains remotely in artboards.

## Spacing and shape

No named spacing/radius tokens exist in source; these are observed values, not invented token names.

| Value | Existing use / source |
| --- | --- |
| 4, 6 px | Small text/control padding; `web/src/app.css` code, mini buttons, chips |
| 8, 10, 12 px | Row, grid and chat gaps; `web/src/app.css` .row, .grid, .chat |
| 14, 16, 18 px | Mobile and card padding; `web/src/app.css` mobile .page, .cards .card |
| 20, 24 px | Card padding; `web/src/app.css` .card |
| 28, 40, 44 px | Section spacing and page padding; `web/src/app.css` .page, .chat-empty |
| 48, 54 px | Mobile list targets and bottom navigation; `web/src/app.css` .sheet-list, .bottomnav |
| 6 px radius | Buttons, inputs, chips; `web/src/app.css` button/input/.chip |
| 8 px radius | Cards and chat messages; `web/src/app.css` .card/.bubble |
| 10 px radius | Dialog and bottom sheet; `web/src/app.css` .modal/.modal.sheet |

## Shadows

- Dark `--shadow: 0 24px 60px rgba(0,0,0,.5)`; light `--shadow: 0 20px 50px rgba(60,45,20,.14)`. Source: `web/src/app.css:11,24`.

## Component rules

- Warm paper/ink surfaces, one indigo interaction accent, serif for editorial headings. Source: `web/src/app.css` opening comment and heading rules.
- Cards: surface + line, radius 8 px. Buttons/inputs: raised/surface + line2, radius 6 px. Source: .card, button, input.
- Primary action: accent background + accent-fg text. Focus: 2 px accent outline. Source: button.primary, :focus-visible.
- Destructive actions require a preview and an explicit confirmation. Use bad as a cue, never as the only label. Source: `web/src/dialogs.tsx` and `web/src/app.css` .danger-solid/.diff.
- Mobile baseline already has 40–48 px interactive targets, 16 px inputs and safe-area-aware navigation. Prefer observed 48 px targets in prototypes. Source: mobile rules in `web/src/app.css`.
- Motion respects prefers-reduced-motion. Source: .dot and .dots media overrides.
- Responsive layouts/interaction structure in proposals are new directions; these do not claim production capability.

## Artboard self-check

Use only the color variables above (including transparent overlays), the three recorded system fallback stacks and existing radii/shadow recipes. Verify keyboard focus, contrast, readable labels, mobile overflow, and that prototype controls never access the app or network. Real Mac/iPhone validation remains separate.
