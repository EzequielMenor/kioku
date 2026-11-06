// Servidor estático mínimo para previsualizar en local exactamente lo que se sube a Vercel (dist/web).
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "dist", "web");
const port = Number(process.env.PORT) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const srv = http.createServer((req, res) => {
  const urlPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (urlPath.startsWith("/api/")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Static preview (no daemon)" }));
    return;
  }
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.resolve(root, rel);
  const inside = path.relative(root, file);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});

srv.listen(port, "127.0.0.1", () => {
  console.log(`\n✓ Vista previa tipo Vercel lista (100 % estática, sin tocar tus datos reales):`);
  console.log(`  Portada + Instalar:        http://127.0.0.1:${port}/?demo=1#/inicio`);
  console.log(`  Entrar directo a la Demo:    http://127.0.0.1:${port}/?demo=1#/hoy\n`);
});
