import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, type WriteStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { MODELS, type ModelDef } from "../../src/core/catalog";
import { modelsDir } from "../paths";
import { sendText, type Route } from "./server";

// The AI model cache proxy, mounted at /__models/ by the engine session and
// the Studio server. transformers.js (in the page) asks for
//   /__models/<repo…>/resolve/<rev>/<file…>
// (its remoteHost + the default path template). The file is served from
//   <models dir>/<repo…>/<rev>/<file…>        (~/.cache/agentphoto/models, $AGENTPHOTO_MODELS)
// or downloaded ONCE from https://huggingface.co/<repo>/resolve/<rev>/<file>
// (redirects followed), streamed to the page while it is written to a temp
// file that is renamed when complete — a half download is never cached.
// Upstream 404s pass through (transformers.js probes optional files).

export const MODELS_PREFIX = "/__models/";
export const HF_HOST = "https://huggingface.co/";

type FetchFn = (url: string, init?: { method?: string; redirect?: "follow" }) => Promise<Response>;

export interface ModelsRouteOptions {
  root?: () => string;
  fetchImpl?: FetchFn;
  upstream?: string;
  log?(message: string): void;
}

const SEGMENT = /^[\w@=+,-][\w.@=+,-]*$/;

export interface ModelFileRef {
  repo: string;
  rev: string;
  file: string;
}

// "/__models/briaai/RMBG-1.4/resolve/main/onnx/model.onnx" → { repo, rev, file }, or null.
export function parseModelPath(rawPath: string): ModelFileRef | null {
  if (!rawPath.startsWith(MODELS_PREFIX)) return null;
  let segs: string[];
  try {
    segs = rawPath.slice(MODELS_PREFIX.length).split("/").map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
  if (segs.some((s) => !SEGMENT.test(s) || s === "." || s === "..")) return null;
  const i = segs.indexOf("resolve");
  if (i < 1 || i > 3 || segs.length < i + 3) return null;
  return { repo: segs.slice(0, i).join("/"), rev: segs[i + 1], file: segs.slice(i + 2).join("/") };
}

export function cacheFileOf(root: string, ref: ModelFileRef): string {
  return join(root, ...ref.repo.split("/"), ref.rev, ...ref.file.split("/"));
}

const CONTENT_TYPE: Record<string, string> = { json: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8", onnx: "application/octet-stream" };
const typeOf = (file: string) => CONTENT_TYPE[file.split(".").pop() ?? ""] ?? "application/octet-stream";

function serveCached(req: IncomingMessage, res: ServerResponse, file: string, name: string): void {
  const size = statSync(file).size;
  res.writeHead(200, { "content-type": typeOf(name), "content-length": String(size), "cache-control": "no-store", "x-content-type-options": "nosniff" });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file)
    .on("error", () => res.destroy())
    .pipe(res);
}

const write = (stream: NodeJS.WritableStream, chunk: Uint8Array): Promise<void> =>
  new Promise((resolve, reject) => {
    const ok = stream.write(chunk, (err) => (err ? reject(err) : undefined));
    if (ok) resolve();
    else stream.once("drain", () => resolve());
  });

const close = (ws: WriteStream): Promise<void> => new Promise((resolve, reject) => ws.end((err?: Error | null) => (err ? reject(err) : resolve())));

export function modelsRoute(opts: ModelsRouteOptions = {}): Route {
  const root = opts.root ?? modelsDir;
  const fetchImpl: FetchFn = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const upstream = opts.upstream ?? HF_HOST;
  const log = opts.log ?? (() => undefined);
  // Downloads in progress (cache file → settles when it is written or failed).
  const inflight = new Map<string, Promise<void>>();

  return async (req, res, url) => {
    if (!url.pathname.startsWith(MODELS_PREFIX)) return false;
    const ref = parseModelPath((req.url ?? "").split("?")[0]);
    if (!ref) return sendText(res, 404, "Not a model file path"), true;
    if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method not allowed"), true;
    const file = cacheFileOf(root(), ref);
    const pending = inflight.get(file);
    if (pending) await pending.catch(() => undefined);
    if (existsSync(file)) return serveCached(req, res, file, ref.file), true;
    const remote = `${upstream.replace(/\/?$/, "/")}${ref.repo}/resolve/${encodeURIComponent(ref.rev)}/${ref.file.split("/").map(encodeURIComponent).join("/")}`;
    if (req.method === "HEAD") {
      const r = await fetchImpl(remote, { method: "HEAD", redirect: "follow" }).catch(() => null);
      res.writeHead(r?.status ?? 502, { "content-type": typeOf(ref.file), ...(r?.headers.get("content-length") ? { "content-length": r.headers.get("content-length")! } : {}) }).end();
      return true;
    }
    let done!: () => void;
    let failed!: (e: unknown) => void;
    const job = new Promise<void>((a, b) => ((done = a), (failed = b)));
    job.catch(() => undefined);
    inflight.set(file, job);
    const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.part`;
    let ws: WriteStream | null = null;
    try {
      let up: Response;
      try {
        up = await fetchImpl(remote, { redirect: "follow" });
      } catch (e) {
        log(`[models] ${ref.repo}/${ref.file}: download failed (${(e as Error).message}). Check the network (the model is downloaded once from huggingface.co).`);
        sendText(res, 502, `Model download failed: ${(e as Error).message}`);
        failed(e);
        return true;
      }
      if (!up.ok || !up.body) {
        // 404 / 401 / 403: an optional file transformers.js probes — pass through, nothing cached.
        sendText(res, up.status === 200 ? 502 : up.status, up.status === 404 ? "Not found" : `Upstream HTTP ${up.status}`);
        await up.body?.cancel().catch(() => undefined);
        done();
        return true;
      }
      const total = Number(up.headers.get("content-length")) || 0;
      mkdirSync(dirname(file), { recursive: true });
      ws = createWriteStream(tmp);
      res.writeHead(200, { "content-type": typeOf(ref.file), ...(total ? { "content-length": String(total) } : {}), "cache-control": "no-store", "x-content-type-options": "nosniff" });
      const big = total > 2 * 1024 * 1024;
      if (big) log(`Downloading ${ref.repo} ${ref.file} (${Math.round(total / 1048576)} MB, once — cached in ${root()})`);
      let received = 0;
      let lastPct = 0;
      let lastAt = Date.now();
      const reader = up.body.getReader();
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        received += value.byteLength;
        await write(ws, value);
        if (!res.destroyed) await write(res, value).catch(() => undefined);
        if (big) {
          const pct = Math.floor((received / total) * 100);
          if (pct >= lastPct + 10 || (Date.now() - lastAt > 3000 && pct > lastPct)) {
            lastPct = pct;
            lastAt = Date.now();
            log(`Downloading ${ref.repo} ${ref.file} (${pct} %)`);
          }
        }
      }
      await close(ws);
      ws = null;
      if (total && received !== total) throw new Error(`incomplete download (${received} of ${total} bytes)`);
      renameSync(tmp, file);
      res.end();
      done();
    } catch (e) {
      if (ws) ws.destroy();
      rmSync(tmp, { force: true });
      log(`[models] ${ref.repo}/${ref.file}: ${(e as Error).message}`);
      if (!res.headersSent) sendText(res, 502, (e as Error).message);
      else res.destroy();
      failed(e);
    } finally {
      inflight.delete(file);
    }
    return true;
  };
}

// ─── cache inspection (agentphoto models) ───────────────────────────────

export function modelCacheDir(def: ModelDef, root = modelsDir()): string {
  return join(root, ...def.repo.split("/"));
}

function dirSize(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const walk = (d: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && !e.name.endsWith(".part")) {
        bytes += statSync(p).size;
        files++;
      }
    }
  };
  walk(dir);
  return { bytes, files };
}

export interface CachedModel {
  id: string;
  task: string;
  repo: string;
  sizeMb: number;
  license: string;
  description: string;
  cached: boolean;
  cachedMb: number;
  files: number;
  dir: string;
}

export function listCachedModels(root = modelsDir()): CachedModel[] {
  return MODELS.map((m) => {
    const dir = modelCacheDir(m, root);
    const s = dirSize(dir);
    return { id: m.id, task: m.task, repo: m.repo, sizeMb: m.sizeMb, license: m.license, description: m.description, cached: s.files > 0 && existsSync(dir), cachedMb: Math.round((s.bytes / 1048576) * 10) / 10, files: s.files, dir };
  });
}
