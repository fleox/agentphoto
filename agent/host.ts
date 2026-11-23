import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { LibraryAsset, LibraryIndex, LibraryProvider } from "../src/core/library";
import { parseTemplateInfo, type TemplateInfo } from "../src/ops/templates";
import { CliError } from "./output";
import { libraryDir, templatesDir } from "./paths";
import { resolveUnder } from "./render/server";

// What the Node front doors (CLI, MCP, Studio API) provide to the AI tools
// besides the ProjectFs: the built-in library and the templates folder (the
// headless engine lives in render/session.ts).

export function walkFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== ".git") walk(abs);
      } else if (e.isFile()) out.push(relative(root, abs).split(sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

let libraryCache: { dir: string; index: LibraryIndex } | null = null;

export function readLibraryIndex(): LibraryIndex {
  const dir = libraryDir();
  if (libraryCache?.dir === dir) return libraryCache.index;
  const file = join(dir, "index.json");
  let index: LibraryIndex = { assets: [] };
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<LibraryIndex> | LibraryAsset[];
      index = Array.isArray(raw) ? { assets: raw } : { ...(raw as LibraryIndex), assets: raw.assets ?? [] };
    } catch {
      /* broken index: empty library */
    }
  }
  libraryCache = { dir, index };
  return index;
}

// read(path): a file inside library/ (images of "library:<id>", font files).
export function libraryProvider(): LibraryProvider {
  const index = readLibraryIndex();
  return {
    index,
    async read(path: string) {
      const file = resolveUnder(libraryDir(), path);
      if (!file || !existsSync(file)) throw new CliError("notFound", `No library file "${path}".`, '`agentphoto assets library` lists the built-in assets (reference images as "library:<id>").');
      return new Uint8Array(readFileSync(file));
    },
  };
}

// templates/<folder>/template.json → TemplateInfo (src/ops/templates.ts).
export function readTemplatesIndex(): TemplateInfo[] {
  const dir = templatesDir();
  if (!existsSync(dir)) return [];
  const out: TemplateInfo[] = [];
  for (const name of readdirSync(dir).sort()) {
    const meta = join(dir, name, "template.json");
    if (!existsSync(meta) || !statSync(join(dir, name)).isDirectory()) continue;
    try {
      out.push(parseTemplateInfo(JSON.parse(readFileSync(meta, "utf8")), name));
    } catch {
      /* skip a broken template */
    }
  }
  return out;
}

// Files of a template folder (path → bytes). template.json is included (createProject
// reads its `slot`, and never copies it); the gallery preview image is not.
export function readTemplateFiles(id: string): Record<string, Uint8Array> {
  const index = readTemplatesIndex();
  if (!index.some((x) => x.id === id)) throw new CliError("notFound", `Unknown template "${id}".`, `\`agentphoto templates list\` lists them${index.length ? ` (${index.map((x) => x.id).join(", ")})` : " (none installed)"}.`);
  const root = join(templatesDir(), folderOf(id));
  const files: Record<string, Uint8Array> = {};
  for (const f of walkFiles(root)) if (!/^preview\.(png|jpe?g|webp)$/.test(f)) files[f] = new Uint8Array(readFileSync(join(root, f)));
  return files;
}

// templates/<folder>/preview.jpg (or .png / .webp) of a template id, or null.
export function templatePreviewFile(id: string): string | null {
  if (!readTemplatesIndex().some((t) => t.id === id)) return null;
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const file = join(templatesDir(), folderOf(id), `preview.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

function folderOf(id: string): string {
  const dir = templatesDir();
  for (const name of readdirSync(dir)) {
    const meta = join(dir, name, "template.json");
    if (!existsSync(meta)) continue;
    try {
      if ((JSON.parse(readFileSync(meta, "utf8")) as { id?: string }).id === id) return name;
    } catch {
      /* skip */
    }
    if (name === id) return name;
  }
  return id;
}
