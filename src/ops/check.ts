// `check`: everything that can be wrong before an export — validation, missing
// files, unknown library images, layers outside the canvas, upscaled (blurry)
// photos, fonts not bundled, licences that need attribution, heavy documents.

import { filterDef } from "../core/catalog";
import type { ProjectFs } from "../core/fs";
import { imageInfo } from "../core/imageInfo";
import { findLibraryAsset, isLibraryRef, libraryId, type LibraryIndex } from "../core/library";
import type { Issue, PhotoDoc } from "../core/types";
import { validateDoc } from "../core/validate";
import { readAssetManifest, missingFiles } from "./assets";
import { KB } from "./context";
import { getDoc } from "./doc";
import { layerBox, type SizeMap } from "./geometry";
import { walkLayers } from "./tree";

export interface CheckReport {
  ok: boolean;
  issues: Issue[];
  counts: { errors: number; warnings: number; infos: number };
  canvas: { width: number; height: number; megapixels: number };
  layers: number;
  // Relative render cost (filters × megapixels): > 60 is slow in the Studio.
  cost: number;
  assetsKb: number;
  licences: { path: string; license?: string; author?: string; attribution?: string; source: string }[];
}

export async function checkProject(fs: ProjectFs, opts: { library?: LibraryIndex } = {}): Promise<CheckReport> {
  const doc = await getDoc(fs);
  const issues: Issue[] = [...validateDoc(doc)];
  const add = (severity: Issue["severity"], code: string, path: string, message: string, hint?: string) => issues.push({ severity, code, path, message, ...(hint ? { hint } : {}) });

  for (const m of await missingFiles(fs, doc)) add("error", "missing-file", `layers#${m.by}.${m.role === "src" ? "src" : "mask.src"}`, `${m.path} does not exist in the project.`, "Import it with assets_add, or point the layer at an existing file (assets_list).");

  // Natural sizes (upscaling check) and library refs.
  const sizes: SizeMap = {};
  const srcs = new Set<string>();
  walkLayers(doc.layers, (l) => {
    if (l.type === "image") srcs.add(l.src);
  });
  for (const src of srcs) {
    if (isLibraryRef(src)) {
      const a = findLibraryAsset(opts.library, libraryId(src));
      if (opts.library && !a) add("error", "unknown-library", src, `Unknown library image "${src}".`, "library_list lists the built-in images (reference them as \"library:<id>\").");
      if (a?.width && a.height) sizes[src] = { width: a.width, height: a.height };
      continue;
    }
    try {
      const info = imageInfo(await fs.readBytes(src));
      if (info) sizes[src] = { width: info.width, height: info.height };
      else add("error", "bad-image", src, `${src} is not a readable image.`);
    } catch {
      /* reported as missing above */
    }
  }

  const W = doc.canvas.width;
  const H = doc.canvas.height;
  let layers = 0;
  let cost = 0;
  const mp = (W * H) / 1e6;
  walkLayers(doc.layers, (l) => {
    layers++;
    const p = `layers#${l.id}`;
    for (const f of l.filters ?? []) if (f.enabled !== false) cost += (filterDef(f.type)?.cost ?? 1) * mp;
    if (l.visible === false) return;
    if (l.opacity === 0) add("info", "invisible", p, `Layer "${l.id}" has opacity 0 (renders nothing).`);
    const box = layerBox(l, sizes);
    if (box && !(l as { rotation?: number }).rotation) {
      if (box.x >= W || box.y >= H || box.x + box.width <= 0 || box.y + box.height <= 0) add("warning", "off-canvas", p, `Layer "${l.id}" is entirely outside the canvas (${Math.round(box.x)}, ${Math.round(box.y)}, ${Math.round(box.width)}×${Math.round(box.height)}).`, `The canvas is ${W}×${H}: move it (x, y) or resize it.`);
      else if (l.type === "text" && !l.width && (box.x + box.width > W + 2 || box.x < -2)) add("info", "text-may-overflow", p, `Text "${l.id}" may run past the canvas edge (estimated width ${Math.round(box.width)} px).`, "Give it a width (it wraps), reduce size, or look at render_preview.");
    }
    if (l.type === "image" && box) {
      const nat = sizes[l.src];
      const src = l.crop ?? nat;
      if (src && nat) {
        const k = Math.max(box.width / src.width, box.height / src.height) * (l.fit === "cover" ? Math.max(1, (box.width / box.height) / (src.width / src.height), (src.width / src.height) / (box.width / box.height)) : 1);
        if (k > 1.6) add("warning", "upscaled", p, `Image "${l.id}" is shown at ${Math.round(k * 100)} % of its resolution (${src.width}×${src.height} stretched to ${Math.round(box.width)}×${Math.round(box.height)}): it will look soft.`, "Use a larger source, or a smaller layer / canvas.");
      }
    }
    if (l.clip && l.type === "group") add("info", "clip-group", p, "Clipping applies to the group as a whole.");
  });
  if (!doc.layers.length) add("warning", "empty", "layers", "The document has no layers.", "layer_add adds one (an image from assets_add, text, shapes…).");
  if (cost > 60) add("info", "heavy", "", `Rendering cost ${Math.round(cost)} (filters × megapixels): previews may be slow.`, "Fewer blur / sharpen / clarity filters, or a smaller canvas.");

  const manifest = await readAssetManifest(fs);
  const used = new Set<string>();
  walkLayers(doc.layers, (l) => {
    if (l.type === "image") used.add(l.src);
    if (l.mask && "src" in l.mask) used.add(l.mask.src);
  });
  const licences = manifest.assets.filter((a) => used.has(a.path) && (a.license || a.attribution)).map((a) => ({ path: a.path, license: a.license, author: a.author, attribution: a.attribution, source: a.source }));
  for (const src of used) {
    if (!isLibraryRef(src)) continue;
    const a = findLibraryAsset(opts.library, libraryId(src));
    if (a) licences.push({ path: src, license: a.license, author: a.author, attribution: undefined, source: a.source ?? "library" });
  }
  let assetsBytes = 0;
  for (const a of manifest.assets) if (used.has(a.path)) assetsBytes += a.bytes ?? 0;

  const counts = { errors: 0, warnings: 0, infos: 0 };
  for (const i of issues) counts[i.severity === "error" ? "errors" : i.severity === "warning" ? "warnings" : "infos"]++;
  return { ok: counts.errors === 0, issues, counts, canvas: { width: W, height: H, megapixels: Math.round(mp * 100) / 100 }, layers, cost: Math.round(cost * 10) / 10, assetsKb: KB(assetsBytes), licences };
}

export type { PhotoDoc };
