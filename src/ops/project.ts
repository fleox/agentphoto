// Project lifecycle: create (blank, from a photo, or from a template), load, save.

import { sizePreset, SIZE_PRESETS } from "../core/catalog";
import type { ProjectFs } from "../core/fs";
import { slugify } from "../core/ids";
import { imageInfo } from "../core/imageInfo";
import { didYouMean } from "../core/suggest";
import { isImageMask, type AssetManifest, type ImageLayer, type Issue, type Paint, type PhotoDoc, type ProjectManifest } from "../core/types";
import { defaultDoc, MAX_CANVAS, normalizeDoc, validateDoc } from "../core/validate";
import { AGENTPHOTO_VERSION, hasErrors, nowIso, OpsError, readJson, readJsonOr, validationError, writeJson } from "./context";
import { findLayer } from "./tree";

export const MANIFEST_FILE = "agentphoto.json";
export const DOC_FILE = "photo.json";
export const ASSET_MANIFEST_FILE = "assets/manifest.json";

export interface NewImage {
  // File name (used for assets/images/<name>).
  name: string;
  bytes: Uint8Array;
  source?: string;
  license?: string;
  author?: string;
  sourceUrl?: string;
}

export interface CreateProjectOptions {
  name: string;
  title?: string;
  // Canvas size: a preset id (catalog "sizes") or explicit width / height.
  size?: string;
  width?: number;
  height?: number;
  background?: Paint | null;
  // Start from a photo: it becomes the "photo" layer (canvas = its size unless size / width / height).
  image?: NewImage;
  // Template id (recorded in the manifest) and its files (read by the front door from templates/<id>/).
  template?: string;
  templateFiles?: Record<string, Uint8Array | string>;
  force?: boolean;
}

export interface CreateProjectResult {
  manifest: ProjectManifest;
  doc: PhotoDoc;
  files: string[];
  issues: Issue[];
}

const decoder = new TextDecoder();
const asText = (v: Uint8Array | string) => (typeof v === "string" ? v : decoder.decode(v));

function resolveSize(opts: CreateProjectOptions): { width: number; height: number } | null {
  if (opts.size) {
    const p = sizePreset(opts.size);
    if (!p) throw new OpsError("invalid", `Unknown size preset "${opts.size}".`, `${didYouMean(opts.size, SIZE_PRESETS.map((s) => s.id))}Presets: ${SIZE_PRESETS.map((s) => `${s.id} (${s.width}×${s.height})`).join(", ")}. Or pass width and height.`);
    return { width: p.width, height: p.height };
  }
  if (opts.width !== undefined || opts.height !== undefined) {
    const w = Math.round(opts.width ?? opts.height ?? 0);
    const h = Math.round(opts.height ?? opts.width ?? 0);
    if (!(w >= 1 && h >= 1 && w <= MAX_CANVAS && h <= MAX_CANVAS)) throw new OpsError("invalid", `Invalid canvas size ${w}×${h}.`, `Width and height are 1…${MAX_CANVAS} px.`);
    return { width: w, height: h };
  }
  return null;
}

export async function createProject(fs: ProjectFs, opts: CreateProjectOptions): Promise<CreateProjectResult> {
  if (!opts.name || !opts.name.trim()) throw new OpsError("invalid", "A project needs a name.", 'Pass a name, e.g. "summer-sale".');
  if (!opts.force && ((await fs.exists(MANIFEST_FILE)) || (await fs.exists(DOC_FILE)))) {
    throw new OpsError("conflict", "This folder already contains an AgentPhoto project.", "Choose an empty folder, or pass force: true (CLI --force) to overwrite it.");
  }
  if (opts.template && !opts.templateFiles) throw new OpsError("invalid", `Template "${opts.template}" was requested but its files were not provided.`, "The front door reads templates/<id>/ and passes templateFiles (templates_list lists the ids).");
  const name = slugify(opts.name, "photo");
  const title = opts.title?.trim() || opts.name.trim();
  const files: string[] = [];
  const size = resolveSize(opts);
  let doc: PhotoDoc;
  let templateSlot: string | undefined;

  // The photo first: its size drives the canvas.
  let photo: { path: string; width: number; height: number } | null = null;
  if (opts.image) {
    const info = imageInfo(opts.image.bytes);
    if (!info) throw new OpsError("invalid", `${opts.image.name} is not a supported image (PNG, JPEG, WebP, GIF, BMP, AVIF, SVG).`);
    const { addAsset } = await import("./assets");
    const entry = await addAsset(fs, { name: opts.image.name, bytes: opts.image.bytes, kind: "image", source: opts.image.source ?? "user", license: opts.image.license, author: opts.image.author, sourceUrl: opts.image.sourceUrl });
    photo = { path: entry.path, width: info.width, height: info.height };
    files.push(entry.path);
  }

  if (opts.templateFiles) {
    const tf = opts.templateFiles;
    if (!tf[DOC_FILE]) throw new OpsError("invalid", `Template "${opts.template ?? "?"}" has no photo.json.`, "A template folder holds photo.json, template.json and optional assets/.");
    for (const [path, content] of Object.entries(tf)) {
      if (path === DOC_FILE || path === MANIFEST_FILE || path === "template.json" || path === "preview.png" || path === "preview.jpg") continue;
      if (typeof content === "string") await fs.writeText(path, content);
      else await fs.writeBytes(path, content);
      files.push(path);
    }
    try {
      doc = normalizeDoc(JSON.parse(asText(tf[DOC_FILE])) as PhotoDoc);
    } catch (e) {
      throw new OpsError("invalid", `Template photo.json is not valid JSON: ${(e as Error).message}`);
    }
    try {
      templateSlot = tf["template.json"] ? (JSON.parse(asText(tf["template.json"])) as { slot?: string }).slot : undefined;
    } catch {
      templateSlot = undefined;
    }
    doc.id = name;
    doc.title = title;
    if (size) doc.canvas = { ...doc.canvas, ...size };
    if (opts.background !== undefined) doc.canvas.background = opts.background;
    if (photo) {
      const slot = templateSlot ? findLayer(doc.layers, templateSlot) : null;
      if (slot && slot.layer.type === "image") {
        slot.layer.src = photo.path;
        // The template's cut-out mask belongs to its sample image.
        if (slot.layer.mask && isImageMask(slot.layer.mask)) delete slot.layer.mask;
        delete slot.layer.crop;
      }
      else doc.layers.unshift(photoLayer(photo, doc.canvas));
    }
  } else {
    const canvas = size ?? (photo ? { width: photo.width, height: photo.height } : { width: 1200, height: 630 });
    doc = defaultDoc({ id: name, title, ...canvas, background: opts.background !== undefined ? opts.background : photo ? undefined : "#ffffff" });
    if (photo) doc.layers.push(photoLayer(photo, doc.canvas));
  }

  const issues = validateDoc(doc);
  if (hasErrors(issues)) throw validationError("The new project's document is invalid.", issues, "Fix the template (or the options) and retry.");

  const now = nowIso();
  const manifest: ProjectManifest = { name, title, createdAt: now, updatedAt: now, ...(opts.template ? { template: opts.template } : {}), agentphoto: AGENTPHOTO_VERSION };
  await writeJson(fs, MANIFEST_FILE, manifest);
  await writeJson(fs, DOC_FILE, doc);
  if (!(await fs.exists(ASSET_MANIFEST_FILE))) await writeJson(fs, ASSET_MANIFEST_FILE, { assets: [] } satisfies AssetManifest);
  files.push(MANIFEST_FILE, DOC_FILE, ASSET_MANIFEST_FILE);
  return { manifest, doc, files: [...new Set(files)].sort(), issues };
}

// The photo fills the canvas (cover) when the canvas has another size.
function photoLayer(photo: { path: string; width: number; height: number }, canvas: { width: number; height: number }): ImageLayer {
  const same = photo.width === canvas.width && photo.height === canvas.height;
  return same
    ? { id: "photo", type: "image", name: "Photo", src: photo.path, x: 0, y: 0, width: photo.width, height: photo.height }
    : { id: "photo", type: "image", name: "Photo", src: photo.path, x: 0, y: 0, width: canvas.width, height: canvas.height, fit: "cover" };
}

export async function loadManifest(fs: ProjectFs): Promise<ProjectManifest> {
  return readJson<ProjectManifest>(fs, MANIFEST_FILE, "Project manifest");
}

export async function loadProject(fs: ProjectFs): Promise<{ manifest: ProjectManifest; doc: PhotoDoc }> {
  const manifest = await loadManifest(fs);
  const doc = normalizeDoc(await readJson<PhotoDoc>(fs, DOC_FILE, "The document"));
  return { manifest, doc };
}

// Validates then writes photo.json (and bumps agentphoto.json updatedAt).
// Refuses documents with errors unless allowInvalid.
export async function saveDoc(fs: ProjectFs, doc: PhotoDoc, opts: { allowInvalid?: boolean } = {}): Promise<{ issues: Issue[] }> {
  const issues = validateDoc(doc);
  if (hasErrors(issues) && !opts.allowInvalid) throw validationError("Document not saved:", issues);
  await writeJson(fs, DOC_FILE, doc);
  await touchManifest(fs);
  return { issues };
}

export async function touchManifest(fs: ProjectFs): Promise<void> {
  const manifest = await readJsonOr<ProjectManifest | null>(fs, MANIFEST_FILE, null);
  if (!manifest) return;
  await writeJson(fs, MANIFEST_FILE, { ...manifest, updatedAt: nowIso(), agentphoto: AGENTPHOTO_VERSION });
}
