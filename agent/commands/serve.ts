import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { CATALOG } from "../../src/core/catalog";
import { callTool, listTools } from "../aiHost";
import { readLibraryIndex, readTemplatesIndex, templatePreviewFile } from "../host";
import { NodeFs } from "../nodeFs";
import { CliError, printResult, toCliError } from "../output";
import { engineDir, libraryDir, readVersionInfo, studioDir } from "../paths";
import { modelsRoute } from "../render/models";
import { mimeOf, readBody, sendJson, sendText, startLocalServer, type LocalServer, type Route } from "../render/server";
import { watchProject } from "../watch";
import type { Command } from "./types";
import { boolOpt, PROJECT_OPTION, projectDir, strOpt, usage } from "./util";

// `studio`: the Studio SPA + the small REST API it uses (docs/studio-api.md).
// Binds 127.0.0.1 only and refuses requests whose Host / Origin is not this
// local server (DNS rebinding, cross-site writes from other pages). Mounts
// the project (/project/), the library (/__library/), the engine bundle
// (/__engine/) and the AI model cache proxy (/__models/).

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    /* no browser: the URL is printed */
  }
}

// Only same-machine pages may talk to the server.
export function localGuard(getPort: () => number): Route {
  return (req, res) => {
    const port = getPort();
    const host = (req.headers.host ?? "").toLowerCase();
    const okHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    if (!okHosts.has(host)) {
      sendText(res, 403, "Forbidden host");
      return true;
    }
    const origin = req.headers.origin;
    if (origin && origin !== "null") {
      let o: URL | null = null;
      try {
        o = new URL(origin);
      } catch {
        o = null;
      }
      if (!o || !okHosts.has(o.host.toLowerCase())) {
        sendText(res, 403, "Forbidden origin");
        return true;
      }
    }
    return false;
  };
}

// Server-Sent Events hub.
export function sseHub() {
  const clients = new Set<ServerResponse>();
  const ping = setInterval(() => {
    for (const c of clients) c.write(": ping\n\n");
  }, 20_000);
  ping.unref();
  return {
    attach(req: IncomingMessage, res: ServerResponse) {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write("retry: 1000\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
    },
    send(event: string, data: unknown) {
      const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const c of clients) c.write(frame);
    },
    close() {
      clearInterval(ping);
      for (const c of clients) c.end();
      clients.clear();
    },
    get size() {
      return clients.size;
    },
  };
}

async function listen(start: (port: number) => Promise<LocalServer>, first: number): Promise<LocalServer> {
  if (first === 0) return start(0);
  for (let port = first; port < first + 20 && port <= 65535; port++) {
    try {
      return await start(port);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    }
  }
  throw new CliError("port-busy", `Ports ${first}-${first + 19} are all in use.`, "Pass --port <n> (0 = any free port).");
}

function portOpt(options: Record<string, unknown>, def: number): number {
  const raw = strOpt(options as never, "port");
  const port = raw === undefined ? def : Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) usage(`Invalid --port: ${raw}`);
  return port;
}

function waitForSignal(): Promise<void> {
  return new Promise((r) => {
    process.once("SIGINT", () => r());
    process.once("SIGTERM", () => r());
  });
}


// ─── studio ─────────────────────────────────────────────────────────────

export interface StudioServer extends LocalServer {
  stop(): Promise<void>;
}

// The REST API of docs/studio-api.md.
export async function startStudioServer(opts: { project: string | null; port?: number; studioRoot?: string }): Promise<StudioServer> {
  const hub = sseHub();
  let actualPort = 0;
  const fs = opts.project ? new NodeFs(opts.project) : null;
  const watcher = opts.project ? watchProject(opts.project, (paths) => hub.send("change", { paths })) : null;
  const noProject = (res: ServerResponse) => sendJson(res, 404, { ok: false, error: { code: "no-project", message: "The Studio was started without a project.", hint: "Restart with `agentphoto studio --project <dir>`." } });
  const fail = (res: ServerResponse, err: unknown, status?: number) => {
    const e = toCliError(err);
    const code = status ?? (e.code === "notFound" ? 404 : e.code === "invalid-path" ? 400 : e.exitCode === 2 ? 400 : 500);
    sendJson(res, code, { ok: false, error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}), ...(e.details !== undefined ? { details: e.details } : {}) } });
  };
  const api: Route = async (req, res, url) => {
    if (!url.pathname.startsWith("/api/")) return false;
    const method = req.method ?? "GET";
    try {
      if (url.pathname === "/api/info" && method === "GET") {
        let manifest: unknown = null;
        if (fs && (await fs.exists("agentphoto.json"))) manifest = JSON.parse(await fs.readText("agentphoto.json"));
        sendJson(res, 200, {
          ok: true,
          data: { version: readVersionInfo().version, project: fs ? { dir: fs.root, manifest, exists: await fs.exists("photo.json") } : null, assetBase: "/project/", libraryBase: "/__library/", engineBase: "/__engine/", modelsBase: "/__models/" },
        });
        return true;
      }
      if (url.pathname === "/api/catalog" && method === "GET") return sendJson(res, 200, { ok: true, data: CATALOG }), true;
      if (url.pathname === "/api/library" && method === "GET") return sendJson(res, 200, { ok: true, data: readLibraryIndex() }), true;
      if (url.pathname === "/api/templates" && method === "GET") return sendJson(res, 200, { ok: true, data: { templates: readTemplatesIndex() } }), true;
      const preview = /^\/api\/templates\/([^/]+)\/preview\.(?:jpg|png)$/.exec(url.pathname);
      if (preview && (method === "GET" || method === "HEAD")) {
        let id = "";
        try {
          id = decodeURIComponent(preview[1]);
        } catch {
          /* bad encoding → 404 below */
        }
        const file = id ? templatePreviewFile(id) : null;
        if (!file) return sendJson(res, 404, { ok: false, error: { code: "notFound", message: `No preview image for template "${id}".`, hint: "GET /api/templates lists the templates; not every template ships a preview.jpg." } }), true;
        const bytes = readFileSync(file);
        res.writeHead(200, { "content-type": mimeOf(file), "cache-control": "no-cache", "x-content-type-options": "nosniff", "content-length": String(bytes.byteLength) });
        res.end(method === "HEAD" ? undefined : bytes);
        return true;
      }
      if (url.pathname === "/api/tools" && method === "GET") return sendJson(res, 200, { ok: true, data: { tools: await listTools() } }), true;
      if (url.pathname === "/api/events" && method === "GET") return hub.attach(req, res), true;
      if (url.pathname === "/api/tools/call" && method === "POST") {
        if (!fs) return noProject(res), true;
        let body: { name?: unknown; input?: unknown };
        try {
          body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        } catch {
          return fail(res, new CliError("usage", "The body must be JSON: { name, input }.", undefined, 2), 400), true;
        }
        if (typeof body.name !== "string") return fail(res, new CliError("usage", '"name" (a tool name) is required.', "GET /api/tools lists them.", 2), 400), true;
        const input = body.input && typeof body.input === "object" ? (body.input as Record<string, unknown>) : {};
        // Files the tool writes (photo.json, masks, the asset manifest…) are not
        // external changes: mute every file whose stamp changed during the call.
        const before = stamps(opts.project!);
        const result = await callTool(fs, body.name, input);
        const after = stamps(opts.project!);
        watcher?.ignoreWritten([...after.keys()].filter((p) => before.get(p) !== after.get(p)));
        sendJson(res, 200, { ok: true, data: result });
        return true;
      }
      if (url.pathname === "/api/project" || url.pathname === "/api/project/") {
        if (!fs) return noProject(res), true;
        if (method !== "GET") return sendText(res, 405, "Method not allowed"), true;
        const files = await fs.list(url.searchParams.get("prefix") ?? "");
        const withSize = await Promise.all(files.map(async (path) => ({ path, size: await fs.size(path) })));
        sendJson(res, 200, { ok: true, data: { files: withSize } });
        return true;
      }
      if (url.pathname.startsWith("/api/project/")) {
        if (!fs) return noProject(res), true;
        const raw = (req.url ?? "").split("?")[0].slice("/api/project/".length);
        let path: string;
        try {
          path = decodeURIComponent(raw);
        } catch {
          return fail(res, new CliError("invalid-path", "Bad path encoding.", undefined, 2), 400), true;
        }
        if (method === "GET" || method === "HEAD") {
          const bytes = await fs.readBytes(path);
          res.writeHead(200, { "content-type": mimeOf(path), "cache-control": "no-store", "x-content-type-options": "nosniff", "content-length": String(bytes.byteLength) });
          res.end(method === "HEAD" ? undefined : Buffer.from(bytes));
          return true;
        }
        if (method === "PUT") {
          const body = await readBody(req);
          await fs.writeBytes(path, new Uint8Array(body));
          watcher?.ignoreWritten([path]);
          sendJson(res, 200, { ok: true, data: { path, bytes: body.byteLength } });
          return true;
        }
        if (method === "DELETE") {
          if (!(await fs.exists(path))) return fail(res, new CliError("notFound", `No file ${path}.`), 404), true;
          await fs.remove(path);
          watcher?.ignoreWritten([path]);
          sendJson(res, 200, { ok: true, data: { removed: path } });
          return true;
        }
        sendText(res, 405, "Method not allowed");
        return true;
      }
      sendJson(res, 404, { ok: false, error: { code: "notFound", message: `No API route ${method} ${url.pathname}.`, hint: "See docs/studio-api.md." } });
      return true;
    } catch (err) {
      fail(res, err);
      return true;
    }
  };
  const models = modelsRoute({ log: (m) => void process.stderr.write(`${m}\n`) });
  const studioRoot = opts.studioRoot ?? studioDir();
  const server = await listen(
    (p) =>
      startLocalServer({
        port: p,
        mounts: { "/__engine/": engineDir(), "/__library/": libraryDir(), ...(opts.project ? { "/project/": opts.project } : {}) },
        routes: [localGuard(() => actualPort), api, models],
        fallbackRoot: studioRoot,
      }),
    opts.port ?? 0,
  );
  actualPort = server.port;
  return {
    ...server,
    async stop() {
      watcher?.close();
      hub.close();
      await server.close();
    },
  };
}

export const studioCommand: Command = {
  name: "studio",
  usage: "studio [--port <n>] [--no-open] [--project <dir>]",
  summary: "Open the Studio (visual editor: canvas, layers, inspector, filters & looks, masks, AI cut-out, export, assistant) on this computer, editing the project folder through a local API (docs/studio-api.md). Runs until stopped (Ctrl+C).",
  options: [PROJECT_OPTION, { name: "port", type: "string", description: "First port to try (default 4330; 0 = any free port)." }, { name: "no-open", type: "boolean", description: "Don't open a browser." }],
  async run({ io, options }) {
    const studio = studioDir();
    const built = existsSync(join(studio, "index.html"));
    // Without the SPA the API still runs (scripts, other front ends); say so.
    if (!built) process.stderr.write(`[agentphoto studio] The Studio build is missing (${studio}): only the API is served. Use the npm package, or run \`npm run build:studio\` in a clone.\n`);
    const dir = projectDir(options);
    if (!existsSync(dir)) throw new CliError("notFound", `The folder ${dir} does not exist.`, `Create it first (mkdir), or create a project with \`agentphoto new ${dir}\`.`);
    // A folder without photo.json still gets a NodeFs: the Studio's start screen creates the project there (project_create).
    const exists = existsSync(join(dir, "photo.json"));
    const server = await startStudioServer({ project: dir, port: portOpt(options, 4330) });
    const url = `http://localhost:${server.port}/`;
    printResult(io, { url, project: dir, exists, studio: built }, () => `AgentPhoto Studio — ${dir}${exists ? "" : " (no project yet: create one from the start screen)"}\n${url}\nPress Ctrl+C to stop.`);
    if (!boolOpt(options, "no-open")) openBrowser(url);
    await waitForSignal();
    await server.stop();
    const { closeEngineSessions } = await import("../render/session");
    await closeEngineSessions();
  },
};

// size:mtime of every project file outside renders/ and dist/ (cheap: a project is a few dozen files).
function stamps(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, rel: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!/^(renders|dist|node_modules|\.git)$/.test(r)) walk(join(dir, e.name), r);
      } else if (e.isFile()) {
        try {
          const st = statSync(join(dir, e.name));
          out.set(r, `${st.size}:${st.mtimeMs}`);
        } catch {
          /* gone */
        }
      }
    }
  };
  walk(root, "");
  return out;
}
