/**
 * Serves the static demo export (out/, see scripts/build-demo.mjs) the way
 * GitHub Pages does, for checking it locally:
 *
 *   npm run demo:serve -- [--port 4300] [--base-path /hisse-analizi-dashboard]
 *
 * - Only paths under --base-path are served; "/" redirects there.
 * - /a/b → a/b.html, or a redirect to /a/b/ when a/b/ is a folder; /a/b/ → a/b/index.html.
 * - Anything else gets 404.html with status 404.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";

const root = path.resolve(import.meta.dirname, "../out");
const { values: args } = parseArgs({
  options: {
    port: { type: "string", default: "4300" },
    "base-path": { type: "string", default: "/hisse-analizi-dashboard" },
  },
});
const basePath = args["base-path"].replace(/\/$/, "");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

async function fileAt(relative) {
  const full = path.join(root, relative);
  if (!full.startsWith(root)) return null;
  try {
    const info = await stat(full);
    return info.isFile() ? full : info.isDirectory() ? "dir" : null;
  } catch {
    return null;
  }
}

function send(res, status, file) {
  res.writeHead(status, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname;
  }
  if (pathname === "/" && basePath) {
    res.writeHead(302, { location: `${basePath}/` }).end();
    return;
  }
  if (basePath && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
    send(res, 404, path.join(root, "404.html"));
    return;
  }
  const relative = pathname.slice(basePath.length) || "/";
  const direct = await fileAt(relative);
  if (direct && direct !== "dir") return send(res, 200, direct);
  if (direct === "dir") {
    if (!relative.endsWith("/")) {
      res.writeHead(301, { location: `${basePath}${relative}/${url.search}` }).end();
      return;
    }
    const index = await fileAt(path.join(relative, "index.html"));
    if (index && index !== "dir") return send(res, 200, index);
  }
  const html = await fileAt(`${relative.replace(/\/$/, "")}.html`);
  if (html && html !== "dir") return send(res, 200, html);
  send(res, 404, path.join(root, "404.html"));
});

server.listen(Number(args.port), () => {
  console.log(`Static demo: http://localhost:${args.port}${basePath}/`);
});
