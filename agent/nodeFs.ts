import { existsSync, realpathSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { FsError, normalizePath, type ProjectFs } from "../src/core/fs";

// ProjectFs over a real folder (the CLI, `serve`, `studio`, MCP). Every path
// is project-relative and POSIX; normalizePath() rejects "..", absolute and
// drive-letter paths, and the resolved file must stay inside the root even
// through symlinks (a link pointing outside is refused).

const SKIP_DIRS = new Set([".git", "node_modules"]);

export class NodeFs implements ProjectFs {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  // Absolute path of a project path; throws FsError("invalidPath") when it
  // would escape the project.
  resolve(path: string): string {
    const p = normalizePath(path);
    const abs = resolve(this.root, p);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) throw new FsError("invalidPath", `Invalid project path: ${path}`);
    // Symlinks: the deepest existing ancestor must resolve inside the root.
    let probe = abs;
    while (probe !== this.root && !existsSync(probe)) probe = dirname(probe);
    if (probe !== this.root && existsSync(this.root)) {
      const realRoot = realpathSync(this.root);
      const real = realpathSync(probe);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new FsError("invalidPath", `Project path leaves the project through a symlink: ${path}`);
    }
    return abs;
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const abs = this.resolve(path);
    try {
      return new Uint8Array(await readFile(abs));
    } catch (e) {
      throw toFsError(e, path);
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, new TextEncoder().encode(text));
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const abs = this.resolve(path);
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, bytes);
    } catch (e) {
      throw toFsError(e, path);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      return (await stat(this.resolve(path))).isFile();
    } catch (e) {
      if (e instanceof FsError) throw e;
      return false;
    }
  }

  async list(prefix = ""): Promise<string[]> {
    const p = prefix ? normalizePath(prefix).replace(/\/+$/, "") : "";
    const start = p ? this.resolve(p) : this.root;
    const out: string[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(abs);
        } else if (e.isFile()) out.push(relative(this.root, abs).split(sep).join("/"));
      }
    };
    await walk(start);
    return out.sort();
  }

  async remove(path: string): Promise<void> {
    try {
      await rm(this.resolve(path), { force: true });
    } catch (e) {
      throw toFsError(e, path);
    }
  }

  async size(path: string): Promise<number> {
    try {
      const s = await stat(this.resolve(path));
      if (!s.isFile()) throw new FsError("notFound", `File not found: ${path}`);
      return s.size;
    } catch (e) {
      throw toFsError(e, path);
    }
  }
}

function toFsError(e: unknown, path: string): FsError {
  if (e instanceof FsError) return e;
  const code = (e as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") return new FsError("notFound", `File not found: ${path}`);
  return new FsError("io", `${path}: ${(e as Error).message}`);
}
