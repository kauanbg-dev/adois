import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleCasal } from "../api/_lib/casal.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preferredPort = Number(process.env.PORT) || 8765;
const host = process.env.HOST || "0.0.0.0";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function sendJson(res, obj, status = 200, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(JSON.stringify(obj));
}

function safeFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep) && file !== root) return null;
  return file;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    if (!path.extname(pathname)) {
      const pretty = pathname === "/" ? "/index.html" : `${pathname}.html`;
      const prettyFile = safeFile(pretty);
      if (prettyFile && fs.existsSync(prettyFile) && fs.statSync(prettyFile).isFile()) {
        pathname = pretty;
      } else {
        const indexFile = safeFile(`${pathname}/index.html`);
        if (indexFile && fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
          pathname = `${pathname}/index.html`;
        }
      }
    }
    if (url.pathname === "/api/casal") {
      const out = await handleCasal(req);
      sendJson(res, out.json, out.status, out.headers);
      return;
    }
    const file = safeFile(pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const headers = { "Content-Type": mime[ext] || "application/octet-stream" };
    if (ext === ".html" || file.endsWith(`${path.sep}index.html`)) {
      headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
    } else if (file.endsWith(`${path.sep}sw.js`)) {
      headers["Cache-Control"] = "no-cache";
    } else if ([".css", ".js"].includes(ext)) {
      headers["Cache-Control"] = "public, max-age=60, must-revalidate";
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.listen(preferredPort, host, () => {
  console.log(`A Dois em http://127.0.0.1:${preferredPort}`);
});
