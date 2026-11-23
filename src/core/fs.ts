// ProjectFs — the storage API the engine (src/ops/) works over. A project is
// a folder:
//
//   agentphoto.json       ProjectManifest
//   photo.json            PhotoDoc
//   assets/               images, masks, edits (+ manifest.json)
//   renders/              previews written by `agentphoto render`
//   dist/                 exports written by `agentphoto export`
//
// Implementations: node (agent/nodeFs.ts, real folder), memory (tests, the
// Studio's in-browser projects), browser (Studio: File System Access API or
// IndexedDB). Paths are POSIX, relative to the project root, never "../".

export interface ProjectFs {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, text: string): Promise<void>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  // Files (not folders) under a prefix, recursively, project-relative.
  list(prefix?: string): Promise<string[]>;
  remove(path: string): Promise<void>;
  size(path: string): Promise<number>;
}

export class MemoryFs implements ProjectFs {
  readonly files = new Map<string, Uint8Array>();

  constructor(initial?: Record<string, string | Uint8Array>) {
    for (const [k, v] of Object.entries(initial ?? {})) this.files.set(normalizePath(k), typeof v === "string" ? new TextEncoder().encode(v) : v);
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path));
  }
  async readBytes(path: string): Promise<Uint8Array> {
    const v = this.files.get(normalizePath(path));
    if (!v) throw new FsError("notFound", `File not found: ${path}`);
    return v;
  }
  async writeText(path: string, text: string): Promise<void> {
    this.files.set(normalizePath(path), new TextEncoder().encode(text));
  }
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(normalizePath(path), bytes);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(normalizePath(path));
  }
  async list(prefix = ""): Promise<string[]> {
    const p = prefix ? normalizePath(prefix).replace(/\/?$/, "/") : "";
    return [...this.files.keys()].filter((k) => k.startsWith(p)).sort();
  }
  async remove(path: string): Promise<void> {
    this.files.delete(normalizePath(path));
  }
  async size(path: string): Promise<number> {
    return (await this.readBytes(path)).byteLength;
  }
}

export class FsError extends Error {
  override name = "FsError";
  constructor(
    readonly code: "notFound" | "invalidPath" | "io",
    message: string,
  ) {
    super(message);
  }
}

// Rejects absolute paths and "..": project paths stay inside the project.
export function normalizePath(path: string): string {
  const p = path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  if (p.startsWith("/") || p.split("/").includes("..") || /^[a-zA-Z]:/.test(p)) throw new FsError("invalidPath", `Invalid project path: ${path}`);
  return p;
}
