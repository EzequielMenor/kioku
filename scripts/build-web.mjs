// Empaqueta la UI (Preact + CodeMirror 6) en dist/web. Sin framework de build: solo esbuild.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
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
  logLevel: "info",
});
for (const f of ["index.html", "quick.html"]) copyFileSync(path.join(root, "web", f), path.join(out, f));
const size = (f) => (statSync(path.join(out, f)).size / 1024).toFixed(0) + " KB";
console.log(`dist/web listo → app.js ${size("app.js")}, quick.js ${size("quick.js")}`);
