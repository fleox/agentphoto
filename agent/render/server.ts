import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";

// Local HTTP server (127.0.0.1 only) used by the engine session (render/
// session.ts) and `studio`. Mounts:
//   /__engine/    → dist/engine           /__library/ → library/
//   /project/     → the project folder    /__models/  → model cache (models.ts)
// plus routes the caller adds (serve's SSE, studio's API). Every mounted
// path is resolved under its root (no "..", no symlink escape).

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".hdr": "application/octet-stream",
  ".exr": "application/octet-stream",
  ".ktx2": "image/ktx2",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

export function mimeOf(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

// Absolute file for a URL-relative path under `root`, or null when it would
// leave the root (.., encoded traversal, absolute, symlink outside).
export function resolveUnder(root: string, rel: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const parts = decoded.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  if (parts.includes("..")) return null;
  const absRoot = resolve(root);
  const file = resolve(absRoot, ...parts);
  if (file !== absRoot && !file.startsWith(absRoot + sep)) return null;
  if (existsSync(file)) {
    try {
      const realRoot = realpathSync(absRoot);
      const real = realpathSync(file);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
    } catch {
      return null;
    }
  }
  return file;
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function sendFile(req: IncomingMessage, res: ServerResponse, file: string | null): void {
  if (!file || !isFile(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": mimeOf(file), "cache-control": "no-store", "x-content-type-options": "nosniff" });
  if (req.method === "HEAD") res.end();
  else
    createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
}

export function sendText(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" }).end(body);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  sendText(res, status, JSON.stringify(body), "application/json; charset=utf-8");
}

export type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean | Promise<boolean>;

export interface LocalServerOptions {
  // Static mounts: URL prefix ("/__runtime/") → folder.
  mounts: Record<string, string>;
  // Generated pages / API routes, tried before the mounts.
  routes?: Route[];
  // "/" → this path (e.g. "/__preview.html" or the studio index).
  index?: string;
  // Fallback folder for anything else (the Studio SPA).
  fallbackRoot?: string;
  port?: number;
  host?: string;
}

export interface LocalServer {
  server: Server;
  port: number;
  url: string; // http://127.0.0.1:<port>
  close(): Promise<void>;
}

export function startLocalServer(opts: LocalServerOptions): Promise<LocalServer> {
  const host = opts.host ?? "127.0.0.1";
  const mounts = Object.entries(opts.mounts).sort((a, b) => b[0].length - a[0].length);
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/" && opts.index) url.pathname = opts.index;
      // Browsers ask for it on every page: answer "no content" instead of a 404 console error.
      if (url.pathname === "/favicon.ico" && !opts.fallbackRoot) return void res.writeHead(204).end();
      for (const route of opts.routes ?? []) if (await route(req, res, url)) return;
      if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method not allowed");
      // Match on the raw (still percent-encoded) path so "%2e%2e" is decoded once, under the root.
      const raw = (req.url ?? "/").split("?")[0].split("#")[0];
      const rawPath = raw === "/" && opts.index ? opts.index : raw;
      for (const [prefix, root] of mounts) {
        if (rawPath.startsWith(prefix)) return sendFile(req, res, resolveUnder(root, rawPath.slice(prefix.length)));
      }
      if (opts.fallbackRoot) {
        const file = resolveUnder(opts.fallbackRoot, rawPath.replace(/^\//, "") || "index.html");
        // SPA: unknown non-asset paths serve index.html.
        if (file && isFile(file)) return sendFile(req, res, file);
        if (!extname(rawPath)) return sendFile(req, res, resolveUnder(opts.fallbackRoot, "index.html"));
      }
      sendText(res, 404, "Not found");
    })().catch((err) => {
      if (!res.headersSent) sendText(res, 500, (err as Error).message);
      else res.destroy();
    });
  });
  server.on("clientError", (_err, socket) => socket.destroy());
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => {
      server.off("error", reject);
      const port = (server.address() as AddressInfo).port;
      resolvePromise({
        server,
        port,
        url: `http://${host}:${port}`,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

// Reads a request body (JSON APIs), capped.
export function readBody(req: IncomingMessage, limit = 50 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
