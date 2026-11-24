// Backend over the CLI's local REST API (`agentphoto studio`):
//   GET  ./api/info, ./api/catalog, ./api/library, ./api/templates, ./api/tools
//   POST ./api/tools/call { name, input } → { ok, data } | { ok: false, error }
//   GET  ./api/events (SSE "change" { paths })
//   GET / PUT / DELETE ./api/project/<path>, GET ./api/project?prefix=
// Every change to photo.json goes through doc_patch / doc_apply (validated).

import { slugify } from "../../core/ids";
import { imageInfo } from "../../core/imageInfo";
import type { LibraryIndex } from "../../core/library";
import type { PhotoDoc } from "../../core/types";
import { normalizeDoc } from "../../core/validate";
import type { EngineOptions } from "../../engine";
import { safeFileName } from "../../ops/assets";
import type { TemplateInfo } from "../../ops/templates";
import { ToolCallError, type AiProgress, type Backend, type CreateOptions, type ProjectRef, type ToolInfo } from "./types";

export interface ApiInfo {
  version: string;
  project: { dir: string; manifest: { name?: string; title?: string } | null; exists: boolean } | null;
  assetBase: string;
  libraryBase: string;
  engineBase?: string;
  modelsBase?: string;
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; hint?: string; details?: unknown } };

const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const abs = (u: string) => new URL(u, location.href).href;

export async function apiJson<T>(path: string, init?: RequestInit, fetchImpl: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(path, init);
  } catch (e) {
    throw new ToolCallError("offline", `The Studio server is not reachable (${(e as Error).message}).`, "Is `agentphoto studio` still running?");
  }
  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    if (res.ok) return undefined as T;
    throw new ToolCallError("bad-response", `Unexpected response from ${path} (HTTP ${res.status}).`);
  }
  if (body && typeof body === "object" && "ok" in body) {
    if (!body.ok) throw new ToolCallError(body.error.code, body.error.message, body.error.hint, body.error.details);
    return body.data;
  }
  if (!res.ok) throw new ToolCallError("http", `HTTP ${res.status} from ${path}.`);
  return body as unknown as T;
}

// GET ./api/info — resolves null when there is no CLI API (static hosting / vite dev).
export async function detectApi(fetchImpl: typeof fetch = fetch): Promise<ApiInfo | null> {
  try {
    const res = await fetchImpl("./api/info", { headers: { accept: "application/json" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    const body = (await res.json()) as Envelope<ApiInfo>;
    return body.ok ? body.data : null;
  } catch {
    return null;
  }
}

const RECENT_KEY = "agentphoto.studio.recentDirs";

export class RemoteBackend implements Backend {
  readonly mode = "cli" as const;
  readonly version: string;
  readonly modelSource = "cli" as const;
  private toolsCache: Promise<ToolInfo[]> | null = null;
  private libraryCache: Promise<LibraryIndex> | null = null;
  private progress = new Set<(p: AiProgress) => void>();

  constructor(private info: ApiInfo) {
    this.version = info.version;
    if (info.project?.exists) rememberDir(info.project.dir, this.projectTitle());
  }

  get location(): string | null {
    return this.info.project?.dir ?? null;
  }

  hasProject(): boolean {
    return !!this.info.project?.exists;
  }

  canCreate(): boolean {
    // project_create needs a folder: a server started without one has no fs.
    return !!this.info.project;
  }

  projectTitle(): string {
    const m = this.info.project?.manifest;
    return m?.title || m?.name || this.info.project?.dir.split("/").pop() || "Untitled";
  }

  async loadDoc(): Promise<PhotoDoc> {
    const res = await fetch(`./api/project/photo.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new ToolCallError("notFound", "photo.json could not be read.");
    return normalizeDoc((await res.json()) as PhotoDoc);
  }

  tools(): Promise<ToolInfo[]> {
    if (!this.toolsCache) this.toolsCache = apiJson<{ tools: ToolInfo[] }>("./api/tools").then((d) => d.tools);
    return this.toolsCache;
  }

  call<T = unknown>(name: string, input: Record<string, unknown>): Promise<T> {
    return apiJson<T>("./api/tools/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, input }) });
  }

  library(): Promise<LibraryIndex> {
    if (!this.libraryCache) this.libraryCache = apiJson<LibraryIndex>("./api/library").catch(() => ({ assets: [] }));
    return this.libraryCache;
  }

  libraryBase(): string {
    return this.info.libraryBase;
  }

  async modelCached(model: string): Promise<boolean> {
    try {
      const d = await apiJson<{ models: { id: string; cached: boolean }[] }>("./api/models");
      return !!d?.models?.some((m) => m.id === model && m.cached);
    } catch {
      return false;
    }
  }

  async templates(): Promise<TemplateInfo[]> {
    try {
      const d = await apiJson<{ templates: TemplateInfo[] } | TemplateInfo[]>("./api/templates");
      return Array.isArray(d) ? d : (d?.templates ?? []);
    } catch {
      return [];
    }
  }

  templatePreview(id: string): string | null {
    return `./api/templates/${encodeURIComponent(id)}/preview.jpg`;
  }

  // Tools may return absolute paths inside the project: make them relative.
  private rel(path: string): string {
    const dir = this.info.project?.dir;
    if (dir && path.startsWith(`${dir}/`)) return path.slice(dir.length + 1);
    const real = dir?.replace(/^\/private\//, "/");
    if (real && path.startsWith(`${real}/`)) return path.slice(real.length + 1);
    return path.replace(/^\.\//, "");
  }

  async fileUrl(path: string): Promise<string> {
    return `./api/project/${enc(this.rel(path))}?v=${Date.now()}`;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const res = await fetch(`./api/project/${enc(this.rel(path))}`, { cache: "no-store" });
    if (!res.ok) throw new ToolCallError("notFound", `No file ${path}.`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    await apiJson(`./api/project/${enc(path)}`, { method: "PUT", body: bytes as unknown as BodyInit });
  }

  async listFiles(prefix: string): Promise<string[]> {
    try {
      const d = await apiJson<string[] | { files: (string | { path: string })[] }>(`./api/project?prefix=${encodeURIComponent(prefix)}`);
      const list = Array.isArray(d) ? d : (d?.files ?? []);
      return list.map((f) => (typeof f === "string" ? f : f.path));
    } catch {
      return [];
    }
  }

  async addImage(name: string, bytes: Uint8Array): Promise<string> {
    const info = imageInfo(bytes);
    const file = safeFileName(name, info ? (info.type === "jpeg" ? "jpg" : info.type) : "png");
    const taken = new Set(await this.listFiles("assets/images/"));
    let path = `assets/images/${file}`;
    for (let k = 2; taken.has(path); k++) path = `assets/images/${file.replace(/(\.[^.]+)?$/, `-${k}$1`)}`;
    await this.writeFile(path, bytes);
    return path;
  }

  onChange(cb: (paths: string[]) => void): () => void {
    if (typeof EventSource === "undefined") return () => undefined;
    const es = new EventSource("./api/events");
    const onMsg = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data)) as { paths?: string[] };
        if (Array.isArray(data.paths)) cb(data.paths.map((p) => this.rel(p)));
      } catch {
        /* ignore malformed */
      }
    };
    es.addEventListener("change", onMsg as EventListener);
    return () => es.close();
  }

  engineOptions(): EngineOptions {
    return {
      assetBase: this.info.assetBase,
      libraryBase: this.info.libraryBase,
      ai: {
        ...(this.info.engineBase ? { wasmPaths: abs(`${this.info.engineBase.replace(/\/?$/, "/")}ort/`) } : {}),
        ...(this.info.modelsBase ? { remoteHost: abs(this.info.modelsBase.replace(/\/?$/, "/")) } : {}),
        onProgress: (p) => this.progress.forEach((l) => l(p)),
      },
    };
  }

  onAiProgress(cb: (p: AiProgress) => void): () => void {
    this.progress.add(cb);
    return () => this.progress.delete(cb);
  }

  async createProject(opts: CreateOptions): Promise<void> {
    const name = slugify(opts.title, "photo");
    const base = { name, title: opts.title, force: true };
    if (opts.template) {
      await this.call("project_create", { ...base, template: opts.template });
      if (opts.image) {
        // The photo goes into the template's slot layer (or on top when it has none).
        const slot = (await this.templates()).find((x) => x.id === opts.template)?.slot;
        const src = await this.addImage(opts.image.name, opts.image.bytes);
        const doc = await this.loadDoc();
        const has = slot && JSON.stringify(doc.layers).includes(`"id":"${slot}"`);
        await this.call("doc_patch", { ops: has ? [{ op: "updateLayer", id: slot, set: { src, crop: null } }] : [{ op: "addLayer", layer: { id: "photo", type: "image", src, x: 0, y: 0, width: doc.canvas.width, height: doc.canvas.height, fit: "cover" }, index: 0 }] });
      }
    } else if (opts.image) {
      const info = imageInfo(opts.image.bytes);
      if (!info) throw new ToolCallError("invalid", `${opts.image.name} is not a supported image.`);
      await this.call("project_create", { ...base, width: info.width, height: info.height, background: null });
      const src = await this.addImage(opts.image.name, opts.image.bytes);
      await this.call("doc_patch", { ops: [{ op: "addLayer", layer: { id: "photo", type: "image", name: "Photo", src, x: 0, y: 0, width: info.width, height: info.height } }] });
    } else if (opts.libraryImage) {
      const a = (await this.library()).assets.find((x) => x.id === opts.libraryImage);
      const w = a?.width ?? 1600;
      const h = a?.height ?? 1067;
      await this.call("project_create", { ...base, width: w, height: h, background: null });
      await this.call("doc_patch", { ops: [{ op: "addLayer", layer: { id: "photo", type: "image", name: a?.title ?? "Photo", src: `library:${opts.libraryImage}`, x: 0, y: 0, width: w, height: h } }] });
    } else {
      await this.call("project_create", { ...base, width: opts.width ?? 1200, height: opts.height ?? 630, ...(opts.background !== undefined ? { background: opts.background } : {}) });
    }
    this.info = (await detectApi()) ?? this.info;
    if (this.info.project?.exists) rememberDir(this.info.project.dir, this.projectTitle());
  }

  async recent(): Promise<ProjectRef[]> {
    return readRecentDirs();
  }

  async open(): Promise<void> {
    // A CLI server edits one folder; switching means restarting `agentphoto studio --project <dir>`.
  }

  close(): void {
    /* the folder stays the project */
  }
}

function readRecentDirs(): ProjectRef[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as ProjectRef[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function rememberDir(dir: string, title: string): void {
  try {
    const list = [{ id: dir, title, updatedAt: new Date().toISOString() }, ...readRecentDirs().filter((r) => r.id !== dir)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
