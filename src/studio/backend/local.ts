// Backend without the CLI (static hosting, `npm run dev`): projects live in
// the browser (IndexedDB) and the AI tools run in the page over a MemoryFs,
// with an in-page engine (pageEngine.ts). AI models come straight from the
// Hugging Face Hub (after the user agrees to the download).

import { callAiTool, listAiTools, type ToolHost } from "../../ai/tools";
import { slugify } from "../../core/ids";
import { IMAGE_MIME, imageTypeOfPath } from "../../core/imageInfo";
import type { LibraryIndex } from "../../core/library";
import type { PhotoDoc } from "../../core/types";
import { normalizeDoc } from "../../core/validate";
import { Engine, type EngineOptions } from "../../engine";
import { addAsset } from "../../ops/assets";
import { OpsError } from "../../ops/context";
import { parseTemplateInfo, type TemplateInfo } from "../../ops/templates";
import { PersistedFs, projectsDb } from "./idb";
import { pageEngineHost } from "./pageEngine";
import { ToolCallError, type AiProgress, type Backend, type CreateOptions, type ProjectRef, type ToolInfo } from "./types";

// Static hosting: library/ and ort/ sit next to the Studio (vite.config.ts
// copies them; the dev server serves them from the repo). A host serving the
// npm package's dist/ (no dist/studio/ort) sets ortBase "../engine/ort/".
const LIBRARY_BASE = "./library/";
const ORT_BASE = "./ort/";
const TEMPLATES_BASE = "./templates/";
const FS_SCHEME = "apfs:";

const abs = (u: string) => new URL(u, location.href).href;
const mimeOf = (path: string) => {
  const t = imageTypeOfPath(path);
  return t ? IMAGE_MIME[t] : path.endsWith(".json") ? "application/json" : "application/octet-stream";
};

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    if ((res.headers.get("content-type") ?? "").includes("text/html")) return null; // SPA fallback, not the file
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export class LocalBackend implements Backend {
  readonly mode = "local" as const;
  readonly version = undefined;
  readonly modelSource = "hub" as const;
  private fs: PersistedFs | null = null;
  private title = "";
  private thumb: string | undefined;
  private libraryIndex: LibraryIndex = { assets: [] };
  private templateIndex: (TemplateInfo & { files: string[] })[] = [];
  private blobs = new Map<string, string>();
  private engine: Engine | null = null;
  private uploads = new Map<string, Uint8Array>();
  private progress = new Set<(p: AiProgress) => void>();
  private changeListeners = new Set<(paths: string[]) => void>();
  private ortBase = ORT_BASE;

  async init(opts: { ortBase?: string } = {}): Promise<void> {
    if (opts.ortBase) this.ortBase = opts.ortBase.endsWith("/") ? opts.ortBase : `${opts.ortBase}/`;
    const bytes = await fetchBytes(`${LIBRARY_BASE}index.json`);
    try {
      if (bytes) this.libraryIndex = JSON.parse(new TextDecoder().decode(bytes)) as LibraryIndex;
    } catch {
      /* no library: fonts fall back to system fonts */
    }
    const tpl = await fetchBytes(`${TEMPLATES_BASE}index.json`);
    try {
      const list = tpl ? (JSON.parse(new TextDecoder().decode(tpl)) as (Record<string, unknown> & { id: string; files?: string[] })[]) : [];
      this.templateIndex = list.map((x) => ({ ...parseTemplateInfo(x, x.id), files: Array.isArray(x.files) ? x.files.map(String) : [] }));
    } catch {
      this.templateIndex = [];
    }
  }

  get location(): string | null {
    return this.fs?.id ?? null;
  }

  // Project path → blob URL (cached until the file changes).
  private blobUrl = async (path: string): Promise<string> => {
    const known = this.blobs.get(path);
    if (known) return known;
    const bytes = await this.requireFs().readBytes(path);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeOf(path) }));
    this.blobs.set(path, url);
    return url;
  };

  private onFsChange = (paths: string[]) => {
    for (const p of paths) {
      const u = this.blobs.get(p);
      if (u) {
        this.blobs.delete(p);
        setTimeout(() => URL.revokeObjectURL(u), 10_000);
      }
      this.engine?.loader.invalidate(p);
    }
    this.changeListeners.forEach((l) => l(paths));
  };

  // The engine reads project files straight from the in-browser fs through a
  // private URL scheme ("apfs:<path>[?v=n]") served by this fetch.
  private fetchFile = async (url: string, init?: RequestInit): Promise<Response> => {
    if (!url.startsWith(FS_SCHEME)) return fetch(url, init);
    const path = decodeURIComponent(url.slice(FS_SCHEME.length).replace(/\?v=\d+$/, ""));
    try {
      const bytes = await this.requireFs().readBytes(path);
      return new Response(bytes as BodyInit, { status: 200, headers: { "content-type": mimeOf(path) } });
    } catch {
      return new Response(null, { status: 404 });
    }
  };

  engineOptions(): EngineOptions {
    return {
      assetBase: FS_SCHEME,
      libraryBase: LIBRARY_BASE,
      library: this.libraryIndex,
      resolve: (path) => FS_SCHEME + encodeURIComponent(path),
      fetchImpl: this.fetchFile as typeof fetch,
      ai: { wasmPaths: abs(this.ortBase), onProgress: (p) => this.progress.forEach((l) => l(p)) },
    };
  }

  onAiProgress(cb: (p: AiProgress) => void): () => void {
    this.progress.add(cb);
    return () => this.progress.delete(cb);
  }

  private host(): ToolHost {
    const lib = this.libraryIndex;
    if (!this.engine) this.engine = new Engine(this.engineOptions());
    return {
      engine: pageEngineHost(this.engine),
      library: {
        index: lib,
        read: async (path) => {
          const bytes = await fetchBytes(LIBRARY_BASE + path);
          if (!bytes) throw new OpsError("notFound", `Library file ${path} is not available here.`);
          return bytes;
        },
      },
      templates: {
        index: this.templateIndex,
        files: async (id) => {
          const t = this.templateIndex.find((x) => x.id === id);
          if (!t) throw new OpsError("notFound", `Unknown template "${id}".`);
          const out: Record<string, Uint8Array> = {};
          for (const f of t.files) {
            const bytes = await fetchBytes(`${TEMPLATES_BASE}${id}/${f}`);
            if (bytes) out[f] = bytes;
          }
          return out;
        },
      },
      // project_create { image: "uploads/<name>" } reads the bytes the user picked.
      readLocalFile: async (path) => {
        const b = this.uploads.get(path);
        if (!b) throw new OpsError("invalid", "In the browser, open files with the Studio (drag & drop or the file picker).");
        return b;
      },
    };
  }

  hasProject(): boolean {
    return !!this.fs;
  }
  canCreate(): boolean {
    return true;
  }
  projectTitle(): string {
    return this.title || "Untitled";
  }

  private requireFs(): PersistedFs {
    if (!this.fs) throw new ToolCallError("no-project", "No project is open.");
    return this.fs;
  }

  async loadDoc(): Promise<PhotoDoc> {
    return normalizeDoc(JSON.parse(await this.requireFs().readText("photo.json")) as PhotoDoc);
  }

  async tools(): Promise<ToolInfo[]> {
    return listAiTools(this.host()).map(({ name, description, inputSchema, mutating, needsEngine }) => ({ name, description, inputSchema, mutating, needsEngine }));
  }

  async call<T = unknown>(name: string, input: Record<string, unknown>): Promise<T> {
    try {
      const r = (await callAiTool({ fs: this.requireFs(), host: this.host() }, name, input)) as T;
      if (name === "doc_apply" || name === "doc_patch" || name === "project_create") await this.refreshTitle();
      return r;
    } catch (e) {
      if (e instanceof OpsError) throw new ToolCallError(e.code, e.message, e.hint, e.details);
      if (e instanceof ToolCallError) throw e;
      throw new ToolCallError("io", (e as Error).message);
    }
  }

  private async refreshTitle(): Promise<void> {
    try {
      const d = await this.loadDoc();
      if (d.title) this.title = d.title;
    } catch {
      /* ignore */
    }
  }

  async library(): Promise<LibraryIndex> {
    return this.libraryIndex;
  }
  libraryBase(): string {
    return LIBRARY_BASE;
  }

  // The browser's model cache is not inspected: the consent is remembered instead.
  async modelCached(_model: string): Promise<boolean> {
    return false;
  }

  async templates(): Promise<TemplateInfo[]> {
    return this.templateIndex.map(({ files: _f, ...info }) => info);
  }
  templatePreview(id: string): string | null {
    return `${TEMPLATES_BASE}${encodeURIComponent(id)}/preview.jpg`;
  }

  fileUrl(path: string): Promise<string> {
    return this.blobUrl(path);
  }
  readFile(path: string): Promise<Uint8Array> {
    return this.requireFs().readBytes(path);
  }
  writeFile(path: string, bytes: Uint8Array): Promise<void> {
    return this.requireFs().writeBytes(path, bytes);
  }

  listFiles(prefix: string): Promise<string[]> {
    return this.requireFs().list(prefix);
  }

  async addImage(name: string, bytes: Uint8Array): Promise<string> {
    const entry = await addAsset(this.requireFs(), { name, bytes, kind: "image", source: "user" });
    return entry.path;
  }

  onChange(cb: (paths: string[]) => void): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  private attach(fs: PersistedFs): void {
    this.fs?.listeners.delete(this.onFsChange);
    this.blobs.forEach((u) => URL.revokeObjectURL(u));
    this.blobs.clear();
    this.engine = null;
    this.fs = fs;
    fs.listeners.add(this.onFsChange);
  }

  async createProject(opts: CreateOptions): Promise<void> {
    const name = slugify(opts.title, "photo");
    const id = `${name}-${Date.now().toString(36)}`;
    this.title = opts.title;
    this.thumb = undefined;
    const fs = new PersistedFs(id, {}, () => ({ title: this.title, thumb: this.thumb }));
    this.attach(fs);
    const input: Record<string, unknown> = { name, title: opts.title, ...(opts.template ? { template: opts.template } : {}) };
    if (opts.image || opts.libraryImage) {
      let file = opts.image;
      if (!file && opts.libraryImage) {
        const a = this.libraryIndex.assets.find((x) => x.id === opts.libraryImage);
        const bytes = a?.path ? await fetchBytes(LIBRARY_BASE + a.path) : null;
        if (!a?.path || !bytes) throw new ToolCallError("notFound", `Sample photo "${opts.libraryImage}" is not available.`);
        file = { name: a.path.split("/").pop()!, bytes };
      }
      const key = `uploads/${file!.name}`;
      this.uploads.set(key, file!.bytes);
      input.image = key;
      input.name = name;
    } else if (!opts.template) {
      input.width = opts.width ?? 1200;
      input.height = opts.height ?? 630;
      if (opts.background !== undefined) input.background = opts.background;
    }
    try {
      await this.call("project_create", input);
    } finally {
      this.uploads.clear();
    }
    await fs.save();
  }

  async recent(): Promise<ProjectRef[]> {
    return projectsDb.list();
  }

  async open(id: string): Promise<void> {
    const p = await projectsDb.get(id);
    if (!p) throw new ToolCallError("notFound", "This project is no longer stored in this browser.");
    this.title = p.title;
    this.thumb = p.thumb;
    this.attach(new PersistedFs(p.id, p.files, () => ({ title: this.title, thumb: this.thumb })));
  }

  // A project made elsewhere (an agent, the CLI): its files as a path → bytes
  // map. An id already stored opens that copy, with the person's edits.
  async importProject(id: string, title: string, files: Record<string, Uint8Array>): Promise<void> {
    if (await projectsDb.get(id)) return this.open(id);
    this.title = title;
    this.thumb = undefined;
    const fs = new PersistedFs(id, files, () => ({ title: this.title, thumb: this.thumb }));
    await fs.save();
    this.attach(fs);
  }

  async remove(id: string): Promise<void> {
    await projectsDb.remove(id);
    if (this.fs?.id === id) this.close();
  }

  async saveThumb(dataUrl: string): Promise<void> {
    this.thumb = dataUrl;
    await this.fs?.save();
  }

  close(): void {
    if (this.fs) void this.fs.save();
    this.fs?.listeners.delete(this.onFsChange);
    this.fs = null;
  }
}
