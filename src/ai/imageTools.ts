// Tools that need pixels (host.engine): render_preview, export, image_analyze,
// remove_background, mask_generate. The engine runs in headless Chrome (CLI /
// MCP / Studio API) or in the Studio page; the files land in the project.

import { DEFAULT_MODELS, MODELS, SIZE_PRESETS } from "../core/catalog";
import type { ProjectFs } from "../core/fs";
import { uniqueId } from "../core/ids";
import { isImageMask, type Layer, type Paint, type PhotoDoc } from "../core/types";
import { addAsset, readAssetManifest } from "../ops/assets";
import { OpsError } from "../ops/context";
import { getDoc, patchDoc, type PatchOp } from "../ops/doc";
import { FORMAT_EXT, IMAGE_FORMATS, planExport, type ExportRequest } from "../ops/export";
import { allLayerIds, findLayer, referencedFiles } from "../ops/tree";
import { bool, mutationResult, num, optStr, str } from "./shared";
import type { AiTool, EngineHost, EncodedImage, ToolContext } from "./types";

function engine(ctx: ToolContext): EngineHost {
  const e = ctx.host?.engine;
  if (!e) throw new OpsError("unavailable", "This host cannot render images.", "Run the CLI (`agentphoto`, needs Google Chrome / Chromium) or the Studio.");
  return e;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif" };

function layerOf(doc: PhotoDoc, id: string): Layer {
  const loc = findLayer(doc.layers, id);
  if (!loc) throw new OpsError("notFound", `No layer "${id}".`, "layer_list lists the layer ids.");
  return loc.layer;
}

function disableEdits(doc: PhotoDoc): PhotoDoc {
  const strip = (layers: Layer[]): Layer[] =>
    layers
      .filter((l) => l.type !== "adjustment")
      .map((l) => {
        const { filters: _f, ...rest } = l as Layer & { filters?: unknown };
        return (l.type === "group" ? { ...rest, children: strip(l.children ?? []) } : rest) as Layer;
      });
  return { ...doc, layers: strip(doc.layers) };
}

// Writes a mask PNG and points the layer's mask at it (old generated mask removed when unused).
async function writeMask(ctx: ToolContext, doc: PhotoDoc, id: string, img: EncodedImage, opts: { invert?: boolean; feather?: number; label: string; extraOps?: PatchOp[]; source: string }) {
  const layer = layerOf(doc, id);
  const entry = await addAsset(ctx.fs, { name: `${id}-${opts.label}.png`, bytes: img.bytes, kind: "mask", source: opts.source });
  const mask = { src: entry.path, ...(opts.invert ? { invert: true } : {}), ...(opts.feather ? { feather: opts.feather } : {}) };
  const r = await patchDoc(ctx.fs, [{ op: "setMask", id, mask }, ...(opts.extraOps ?? [])]);
  // Drop the previous generated mask if nothing uses it any more.
  const prev = layer.mask && isImageMask(layer.mask) ? layer.mask.src : null;
  if (r.applied && prev && prev !== entry.path && prev.startsWith("assets/masks/")) {
    const still = referencedFiles(r.doc).some((f) => f.path === prev);
    if (!still) await removeGenerated(ctx.fs, prev);
  }
  return { mask: entry.path, size: `${img.width}×${img.height}`, ...(img.bbox !== undefined ? { subject: subjectBox(layer, img) } : {}), ...mutationResult(r, false) };
}

// Kept area of a mask in canvas px (layer box mapping; approximate when the layer is rotated).
function subjectBox(layer: Layer, img: EncodedImage): { x: number; y: number; width: number; height: number } | null {
  const b = img.bbox;
  if (!b) return null;
  const l = layer as Layer & { x?: number; y?: number; width?: number; height?: number; flipX?: boolean; flipY?: boolean };
  const kx = (l.width ?? img.width) / img.width;
  const ky = (l.height ?? img.height) / img.height;
  const bx = l.flipX ? img.width - b.x - b.width : b.x;
  const by = l.flipY ? img.height - b.y - b.height : b.y;
  const r = (v: number) => Math.round(v);
  return { x: r((l.x ?? 0) + bx * kx), y: r((l.y ?? 0) + by * ky), width: r(b.width * kx), height: r(b.height * ky) };
}

async function removeGenerated(fs: ProjectFs, path: string) {
  const { removeAsset } = await import("../ops/assets");
  await removeAsset(fs, path, { force: true }).catch(() => undefined);
}

let previewCounter = 0;

export const IMAGE_TOOLS: AiTool[] = [
  {
    name: "render_preview",
    description:
      "Render the document and LOOK at it (the image is returned to you). Use after every visual change: check composition, crop, legibility of text, colours, mask edges. compare: true also renders the 'before' (no filters / adjustments) for retouching. layer renders one layer alone. zoom: { x, y, width, height } renders a canvas region at full resolution (inspect mask edges, skin, text).",
    inputSchema: {
      type: "object",
      properties: {
        maxWidth: { type: "integer", description: "Preview width cap in px (default 1000)." },
        compare: { type: "boolean", description: "Also render the unedited version (before / after)." },
        layer: { type: "string", description: "Render only this layer (and the groups holding it)." },
        zoom: { type: "object", description: "Canvas region { x, y, width, height } rendered at 1:1 (max 1600 px).", additionalProperties: true },
      },
    },
    mutating: false,
    needsEngine: true,
    async handler(ctx, input) {
      const e = engine(ctx);
      let doc = await getDoc(ctx.fs);
      const maxWidth = num(input, "maxWidth") ?? 1000;
      const zoom = input.zoom as { x: number; y: number; width: number; height: number } | undefined;
      if (zoom) {
        const { cropDoc } = await import("../ops/geometry");
        doc = cropDoc(doc, { x: zoom.x, y: zoom.y, width: Math.min(1600, zoom.width), height: Math.min(1600, zoom.height) });
      }
      const only = optStr(input, "layer");
      if (only) layerOf(doc, only);
      const opts = { maxWidth: zoom ? undefined : maxWidth, maxHeight: zoom ? undefined : Math.max(maxWidth, 1000), only: only ? [only] : undefined, format: "png" as const };
      const n = ++previewCounter % 4;
      const after = await e.render(doc, opts);
      const path = `renders/preview-${n}.png`;
      await ctx.fs.writeBytes(path, after.bytes);
      const images = [path];
      if (bool(input, "compare")) {
        const before = await e.render(disableEdits(doc), opts);
        const bp = `renders/preview-${n}-before.png`;
        await ctx.fs.writeBytes(bp, before.bytes);
        images.unshift(bp);
      }
      return {
        preview: path,
        images,
        size: `${after.width}×${after.height}`,
        canvas: `${doc.canvas.width}×${doc.canvas.height}`,
        ...(after.errors?.length ? { errors: after.errors, hint: "Some layers failed to render (see errors): fix their src / mask." } : {}),
      };
    },
  },
  {
    name: "export",
    description: `Render the final image(s) into dist/ (or out): format png | jpeg | webp | avif, quality, size (preset: ${SIZE_PRESETS.map((s) => s.id).join(", ")} — or width / height / scale), fit (cover crops, contain pads) and background (flatten transparency). variants: several outputs at once (e.g. og + square + story). Run check first.`,
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: IMAGE_FORMATS },
        quality: { type: "integer", minimum: 1, maximum: 100 },
        preset: { type: "string" },
        width: { type: "integer" },
        height: { type: "integer" },
        scale: { type: "number" },
        fit: { type: "string", enum: ["cover", "contain", "stretch"] },
        background: { type: ["string", "null"] },
        name: { type: "string", description: "File name without extension (default: the document id)." },
        out: { type: "string", description: "Output path inside the project (default dist/<name>.<ext>)." },
        variants: { type: "array", items: { type: "object", additionalProperties: true }, description: "Several export requests (same fields) in one call." },
      },
    },
    mutating: true,
    needsEngine: true,
    async handler(ctx, input) {
      const e = engine(ctx);
      const doc = await getDoc(ctx.fs);
      const base: ExportRequest = {
        format: optStr(input, "format") as ExportRequest["format"],
        quality: num(input, "quality"),
        preset: optStr(input, "preset"),
        width: num(input, "width"),
        height: num(input, "height"),
        scale: num(input, "scale"),
        fit: optStr(input, "fit") as ExportRequest["fit"],
        background: input.background === null ? null : optStr(input, "background"),
        name: optStr(input, "name"),
        out: optStr(input, "out"),
      };
      const reqs: ExportRequest[] = Array.isArray(input.variants) && input.variants.length ? (input.variants as ExportRequest[]).map((v) => ({ ...base, out: undefined, ...v })) : [base];
      const files: { path: string; format: string; width: number; height: number; kb: number; note?: string }[] = [];
      for (const req of reqs) {
        const job = planExport(doc, req);
        const img = await e.exportImage(doc, job);
        let path = job.file;
        let note: string | undefined;
        if (img.mime !== job.mime) {
          path = path.replace(/\.[^.]+$/, `.${EXT[img.mime] ?? "png"}`);
          note = `${job.format.toUpperCase()} encoding is not supported by this browser: written as ${img.mime}.`;
        }
        await ctx.fs.writeBytes(path, img.bytes);
        files.push({ path, format: EXT[img.mime] ?? job.format, width: img.width, height: img.height, kb: Math.round(img.bytes.byteLength / 102.4) / 10, ...(note ? { note } : {}) });
      }
      return { files, hint: "Done. Tell the user where the files are; offer other sizes (variants) if useful." };
    },
  },
  {
    name: "image_analyze",
    description: "Measure the picture (or one layer): brightness, contrast, tonal range, clipped shadows / highlights, colour cast, saturation, sharpness, dominant colours — with suggested filters (ready to pass to filter_add). Use before retouching.",
    inputSchema: { type: "object", properties: { layer: { type: "string", description: "Analyse this layer's own pixels (default: the whole render)." } } },
    mutating: false,
    needsEngine: true,
    async handler(ctx, input) {
      const doc = await getDoc(ctx.fs);
      const layer = optStr(input, "layer");
      if (layer) layerOf(doc, layer);
      return engine(ctx).analyze(doc, { layer });
    },
  },
  {
    name: "remove_background",
    description: `Remove the background of a photo layer with local AI (no upload): writes a mask PNG to assets/masks/ and sets it as the layer's mask — non-destructive (mask_set null restores). Optional background: a colour / gradient placed under the cut-out (adds a fill layer), shadow: true adds a soft drop shadow. Models: ${MODELS.filter((m) => m.task === "background-removal").map((m) => `${m.id} (${m.description})`).join("; ")}. First use downloads the model once (~25–45 MB).`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Image layer id." },
        model: { type: "string", enum: MODELS.filter((m) => m.task === "background-removal").map((m) => m.id) },
        feather: { type: "number", description: "Soften the edge, px (default 0)." },
        threshold: { type: "integer", description: "Hard edge: keep pixels whose confidence ≥ threshold (0..255). Default: soft alpha (best for hair)." },
        background: { type: ["string", "object"], description: "Colour / gradient to put behind the subject (adds a fill layer below it)." },
        shadow: { type: "boolean", description: "Add a soft drop shadow under the subject." },
      },
      required: ["id"],
    },
    mutating: true,
    needsEngine: true,
    async handler(ctx, input) {
      const id = str(input, "id");
      const doc = await getDoc(ctx.fs);
      const layer = layerOf(doc, id);
      if (layer.type !== "image") throw new OpsError("invalid", `"${id}" is a ${layer.type} layer: background removal works on image layers.`);
      const model = optStr(input, "model") ?? DEFAULT_MODELS["background-removal"];
      const img = await engine(ctx).backgroundMask(doc, id, { model, feather: num(input, "feather"), threshold: num(input, "threshold") });
      const extra: PatchOp[] = [];
      if (input.background !== undefined && input.background !== null) {
        const bgId = uniqueId(`${id}-background`, allLayerIds(doc));
        extra.push({ op: "addLayer", layer: { id: bgId, type: "fill", name: "Background", fill: input.background as Paint }, below: id });
      }
      if (bool(input, "shadow")) extra.push({ op: "updateLayer", id, set: { effects: { dropShadow: { color: "#000000", opacity: 0.35, angle: 90, distance: 18, blur: 30 } } } });
      const r = await writeMask(ctx, doc, id, img, { label: "cutout", extraOps: extra, source: `remove_background:${model}` });
      return { ...r, model, hint: "subject = the kept area in canvas px (null: nothing found). Center / scale the layer from it if needed, then render_preview (zoom on an edge: hair, fingers) to check; refine with mask_generate (points) or threshold / feather." };
    },
  },
  {
    name: "mask_generate",
    description:
      'Make a mask for a layer from pixels, with local AI or colours, and set it as the layer mask: method "subject" (main subject, background-removal model), "points" (Segment Anything: points [[x, y, 1 = include | 0 = exclude], …] in layer px), "box" (SAM: [x1, y1, x2, y2] layer px), "color" (colour range: color + tolerance 0..100). invert: true keeps the rest instead (e.g. select the sky, then invert to protect it; or mask a filter / adjustment). target: "mask" (default) sets it on the layer itself; "copy" duplicates the layer, masks the copy (cut-out on its own layer, the original stays).',
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Layer id (layer px = relative to the layer's top-left, before rotation)." },
        method: { type: "string", enum: ["subject", "points", "box", "color"] },
        points: { type: "array", items: { type: "array", items: { type: "number" } } },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        color: { type: "string" },
        tolerance: { type: "number", minimum: 0, maximum: 100 },
        invert: { type: "boolean" },
        feather: { type: "number" },
        model: { type: "string" },
        target: { type: "string", enum: ["mask", "copy"] },
        copyId: { type: "string", description: 'Id of the copy (target "copy").' },
      },
      required: ["id", "method"],
    },
    mutating: true,
    needsEngine: true,
    async handler(ctx, input) {
      const id = str(input, "id");
      const method = str(input, "method");
      const doc = await getDoc(ctx.fs);
      layerOf(doc, id);
      const e = engine(ctx);
      const feather = num(input, "feather");
      let img: EncodedImage;
      if (method === "subject") img = await e.backgroundMask(doc, id, { model: optStr(input, "model"), feather });
      else if (method === "points" || method === "box") {
        const points = method === "points" ? (input.points as number[][] | undefined) : undefined;
        if (method === "points" && (!Array.isArray(points) || !points.length)) throw new OpsError("invalid", 'method "points" needs points: [[x, y, 1], …] (layer px; 1 = include, 0 = exclude).');
        const box = method === "box" ? (input.box as number[] | undefined) : undefined;
        if (method === "box" && (!Array.isArray(box) || box.length !== 4)) throw new OpsError("invalid", 'method "box" needs box: [x1, y1, x2, y2] (layer px).');
        img = await e.segmentMask(doc, id, { ...(points ? { points: points.map((p) => [p[0], p[1], p[2] ?? 1] as [number, number, number]) } : {}), ...(box ? { box: box as [number, number, number, number] } : {}) }, { model: optStr(input, "model"), feather });
      } else if (method === "color") {
        img = await e.colorRangeMask(doc, id, { color: str(input, "color"), tolerance: num(input, "tolerance"), feather });
      } else throw new OpsError("invalid", `Unknown method "${method}".`, "Methods: subject, points, box, color.");
      const target = optStr(input, "target") ?? "mask";
      const invert = bool(input, "invert");
      if (target === "copy") {
        const copyId = uniqueId(optStr(input, "copyId") ?? `${id}-cutout`, allLayerIds(doc));
        await patchDoc(ctx.fs, [{ op: "duplicateLayer", id, newId: copyId }]);
        const r = await writeMask(ctx, await getDoc(ctx.fs), copyId, img, { label: method, invert, source: `mask_generate:${method}` });
        return { ...r, layer: copyId };
      }
      return writeMask(ctx, doc, id, img, { label: method, invert, source: `mask_generate:${method}` });
    },
  },
];

// Generated masks still listed in the manifest (for cleanups / Studio).
export async function generatedMasks(fs: ProjectFs): Promise<string[]> {
  return (await readAssetManifest(fs)).assets.filter((a) => a.kind === "mask").map((a) => a.path);
}

export { FORMAT_EXT };
