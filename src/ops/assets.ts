// Project assets: source photos (assets/images/), masks written by the AI and
// the Studio (assets/masks/), painted edits (assets/edits/). Every file is
// recorded in assets/manifest.json with where it came from and its licence.

import type { ProjectFs } from "../core/fs";
import { slugify } from "../core/ids";
import { imageInfo, IMAGE_EXTENSIONS } from "../core/imageInfo";
import { isLibraryRef } from "../core/library";
import type { AssetEntry, AssetKind, AssetManifest, PhotoDoc } from "../core/types";
import { KB, nowIso, OpsError, readJsonOr, writeJson } from "./context";
import { ASSET_MANIFEST_FILE, DOC_FILE } from "./project";
import { referencedFiles } from "./tree";

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

const KIND_DIRS: Record<AssetKind, string> = { image: "assets/images", mask: "assets/masks", edit: "assets/edits", font: "assets/fonts", other: "assets/files" };

export const MAX_ASSET_BYTES = 80 * 1024 * 1024;

export async function readAssetManifest(fs: ProjectFs): Promise<AssetManifest> {
  const m = await readJsonOr<AssetManifest>(fs, ASSET_MANIFEST_FILE, { assets: [] });
  return { assets: Array.isArray(m.assets) ? m.assets : [] };
}

async function writeAssetManifest(fs: ProjectFs, m: AssetManifest): Promise<void> {
  m.assets.sort((a, b) => a.path.localeCompare(b.path));
  await writeJson(fs, ASSET_MANIFEST_FILE, m);
}

// "IMG 2041.JPG" → "img-2041.jpg"
export function safeFileName(name: string, fallbackExt = "png"): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const m = /^(.*?)(?:\.([a-z0-9]{1,5}))?$/i.exec(base);
  const stem = slugify(m?.[1] || "image", "image").slice(0, 60);
  const ext = (m?.[2] ?? fallbackExt).toLowerCase();
  return `${stem}.${ext === "jpeg" ? "jpg" : ext}`;
}

async function freePath(fs: ProjectFs, path: string): Promise<string> {
  if (!(await fs.exists(path))) return path;
  const m = /^(.*?)(\.[^./]+)?$/.exec(path)!;
  for (let k = 2; ; k++) {
    const p = `${m[1]}-${k}${m[2] ?? ""}`;
    if (!(await fs.exists(p))) return p;
  }
}

export interface AddAssetInput {
  // Target path ("assets/images/hero.jpg"), or just a file name (→ assets/<kind dir>/<name>).
  name: string;
  bytes: Uint8Array;
  kind?: AssetKind;
  source: string;
  license?: string;
  author?: string;
  sourceUrl?: string;
  attribution?: string;
  // Replace an existing file at that exact path instead of picking a free name.
  overwrite?: boolean;
}

export async function addAsset(fs: ProjectFs, input: AddAssetInput): Promise<AssetEntry> {
  if (!input.bytes?.byteLength) throw new OpsError("invalid", `${input.name}: the file is empty.`);
  if (input.bytes.byteLength > MAX_ASSET_BYTES) throw new OpsError("invalid", `${input.name} is ${Math.round(input.bytes.byteLength / 1048576)} MB (max ${MAX_ASSET_BYTES / 1048576} MB).`, "Resize or recompress it first.");
  const info = imageInfo(input.bytes);
  const kind: AssetKind = input.kind ?? (info ? "image" : "other");
  if ((kind === "image" || kind === "mask" || kind === "edit") && !info) throw new OpsError("invalid", `${input.name} is not a supported image (PNG, JPEG, WebP, GIF, BMP, AVIF, SVG).`);
  const ext = info ? (info.type === "jpeg" ? "jpg" : info.type) : undefined;
  let path: string;
  if (input.name.includes("/")) {
    path = input.name.replace(/^\.\//, "");
    if (!path.startsWith("assets/")) throw new OpsError("invalid", `Asset paths live under assets/ (got "${input.name}").`);
  } else {
    let file = safeFileName(input.name, ext);
    // Keep the extension honest (a PNG named .jpg confuses browsers' sniffing less than people).
    if (ext && IMAGE_EXTENSIONS[file.split(".").pop()!] !== info?.type) file = `${file.replace(/\.[^.]+$/, "")}.${ext}`;
    path = `${KIND_DIRS[kind]}/${file}`;
  }
  if (!input.overwrite) path = await freePath(fs, path);
  await fs.writeBytes(path, input.bytes);
  const entry: AssetEntry = {
    path,
    kind,
    source: input.source,
    ...(input.license ? { license: input.license } : {}),
    ...(input.author ? { author: input.author } : {}),
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.attribution ? { attribution: input.attribution } : {}),
    ...(info ? { width: info.width, height: info.height } : {}),
    bytes: input.bytes.byteLength,
    addedAt: nowIso(),
  };
  const m = await readAssetManifest(fs);
  m.assets = [...m.assets.filter((a) => a.path !== path), entry];
  await writeAssetManifest(fs, m);
  return entry;
}

// Downloads an image the user pointed at (http/https) into assets/images/.
export async function addAssetFromUrl(fs: ProjectFs, url: string, fetchImpl: FetchLike, opts: { name?: string; license?: string; author?: string } = {}): Promise<AssetEntry> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new OpsError("invalid", `Not a URL: ${url}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new OpsError("invalid", `Only http(s) URLs can be imported (got ${u.protocol}).`);
  const res = await fetchImpl(url, { headers: { accept: "image/*" } });
  if (!res.ok) throw new OpsError("io", `Download failed (HTTP ${res.status}): ${url}`, "Check the URL in a browser; some sites block direct downloads.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const name = opts.name ?? decodeURIComponent(u.pathname.split("/").pop() || "image");
  return addAsset(fs, { name, bytes, kind: "image", source: u.host, sourceUrl: url, license: opts.license, author: opts.author });
}

export interface ListedAsset extends AssetEntry {
  exists: boolean;
  usedBy: string[];
  kb: number;
}

export async function listAssets(fs: ProjectFs): Promise<{ assets: ListedAsset[]; untracked: string[]; totalKb: number }> {
  const m = await readAssetManifest(fs);
  let doc: PhotoDoc | null = null;
  try {
    doc = JSON.parse(await fs.readText(DOC_FILE)) as PhotoDoc;
  } catch {
    doc = null;
  }
  const refs = doc ? referencedFiles(doc) : [];
  const files = new Set((await fs.list("assets")).filter((p) => p !== ASSET_MANIFEST_FILE));
  const assets: ListedAsset[] = [];
  let total = 0;
  for (const a of m.assets) {
    const exists = files.has(a.path);
    const size = exists ? await fs.size(a.path) : 0;
    total += size;
    assets.push({ ...a, exists, usedBy: [...new Set(refs.filter((r) => r.path === a.path).map((r) => r.by))], kb: KB(size) });
    files.delete(a.path);
  }
  return { assets, untracked: [...files], totalKb: KB(total) };
}

export async function removeAsset(fs: ProjectFs, path: string, opts: { force?: boolean } = {}): Promise<{ removed: string; usedBy: string[] }> {
  const m = await readAssetManifest(fs);
  const known = m.assets.some((a) => a.path === path) || (await fs.exists(path));
  if (!known) throw new OpsError("notFound", `No asset ${path}.`, "assets_list lists the project's assets.");
  let usedBy: string[] = [];
  try {
    const doc = JSON.parse(await fs.readText(DOC_FILE)) as PhotoDoc;
    usedBy = [...new Set(referencedFiles(doc).filter((r) => r.path === path).map((r) => r.by))];
  } catch {
    usedBy = [];
  }
  if (usedBy.length && !opts.force) throw new OpsError("conflict", `${path} is used by layer${usedBy.length > 1 ? "s" : ""} ${usedBy.join(", ")}.`, "Remove or change those layers first, or pass force.");
  await fs.remove(path);
  m.assets = m.assets.filter((a) => a.path !== path);
  await writeAssetManifest(fs, m);
  return { removed: path, usedBy };
}

// Missing files referenced by the document (check).
export async function missingFiles(fs: ProjectFs, doc: PhotoDoc): Promise<{ path: string; by: string; role: "src" | "mask" }[]> {
  const out: { path: string; by: string; role: "src" | "mask" }[] = [];
  for (const r of referencedFiles(doc)) {
    if (isLibraryRef(r.path)) continue;
    let ok = false;
    try {
      ok = await fs.exists(r.path);
    } catch {
      ok = false;
    }
    if (!ok) out.push(r);
  }
  return out;
}
