// Empaqueta la UI (Preact + CodeMirror 6) en dist/web. Sin framework de build: solo esbuild.
import { build } from "esbuild";
import { cpSync, copyFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist", "web");
mkdirSync(out, { recursive: true });

const watch = process.argv.includes("--dev");
await build({
  entryPoints: { app: path.join(root, "web/src/app.tsx"), quick: path.join(root, "web/src/quick.tsx") },
  outdir: out,
  bundle: true,
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  target: ["chrome120"],
  format: "esm",
  jsx: "automatic",
  jsxImportSource: "preact",
  legalComments: "none",
  external: ["/fonts/*"], // las @font-face apuntan a /fonts/…, que se copia más abajo
  logLevel: "info",
});
for (const f of ["index.html", "quick.html", "manifest.webmanifest"]) copyFileSync(path.join(root, "web", f), path.join(out, f));
cpSync(path.join(root, "web", "icons"), path.join(out, "icons"), { recursive: true });
// Tipografía serif de los títulos: solo el subconjunto latino de los pesos que usa app.css, servida en local (sin Google Fonts).
const fontsDir = path.join(root, "node_modules", "@fontsource", "shippori-mincho", "files");
mkdirSync(path.join(out, "fonts"), { recursive: true });
for (const w of [500, 600]) copyFileSync(path.join(fontsDir, `shippori-mincho-latin-${w}-normal.woff2`), path.join(out, "fonts", `shippori-mincho-latin-${w}-normal.woff2`));
const size = (f) => (statSync(path.join(out, f)).size / 1024).toFixed(0) + " KB";
console.log(`dist/web listo → app.js ${size("app.js")}, quick.js ${size("quick.js")}`);
