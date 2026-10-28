// Empaqueta la UI (Preact + CodeMirror 6) en dist/web. Sin framework de build: solo esbuild.
import { build } from "esbuild";
import { cpSync, copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
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
// Service worker: el id del build (hash de lo que cambia entre versiones) nombra su caché de shell,
// de modo que cada despliegue estrena caché y borra la anterior al activarse.
const listing = (dir, prefix) => readdirSync(path.join(out, dir)).sort().map((f) => `${prefix}${f}`);
const precache = ["/", "/index.html", "/app.js", "/app.css", "/manifest.webmanifest", ...listing("icons", "/icons/"), ...listing("fonts", "/fonts/")];
const buildId = createHash("sha256")
  .update(["app.js", "app.css", "index.html"].map((f) => readFileSync(path.join(out, f))).join("\0"))
  .digest("hex").slice(0, 12);
await build({
  entryPoints: { sw: path.join(root, "web/src/sw.ts") },
  outdir: out,
  bundle: true,
  minify: !watch,
  target: ["chrome120"],
  format: "iife",
  legalComments: "none",
  define: { __BUILD_ID__: JSON.stringify(buildId), __PRECACHE__: JSON.stringify(precache) },
  logLevel: "warning",
});
const size = (f) => (statSync(path.join(out, f)).size / 1024).toFixed(0) + " KB";
console.log(`dist/web listo → app.js ${size("app.js")}, quick.js ${size("quick.js")}, sw.js (build ${buildId})`);
