// Public engine API — what hosts call: the Studio (in the page) and headless
// Chrome (agent/render/, through window.agentphoto). One code path for every
// front door, so a preview, an export and the Studio show the same pixels.

import type { LibraryIndex } from "../core/library";
import type { ImageLayer, Layer, PhotoDoc } from "../core/types";
import { hasBox } from "../core/types";
import type { ExportJob } from "../ops/export";
import { findLayer } from "../ops/tree";
import { configureAi, removeBackground, segment, type AiConfig, type SegmentPrompt } from "./ai";
import { analyzePixels, type ImageStats } from "./analyze";
import { canvasFromAlpha, canvasToBlob, createCanvas, ctx2d, readPixels, type AnyCanvas } from "./canvas";
import { Compositor, type AssetLoader, type RenderOptions } from "./compositor";
import { blurAlpha } from "./filters/pixels";
import { createUrlLoader, type UrlLoader, type UrlLoaderOptions } from "./loader";

export { Compositor, imageBoxSize } from "./compositor";
export type { AssetLoader, RenderOptions, LayerBoxInfo } from "./compositor";
export { createUrlLoader } from "./loader";
export type { UrlLoader } from "./loader";
export { FILTER_IMPLS, runFilters } from "./filters";
export { LOOK_IMPLS } from "./filters/looks";
export { analyzePixels } from "./analyze";
export type { ImageStats } from "./analyze";
export { canvasToBlob, createCanvas, ctx2d, readPixels, writePixels, canvasFromAlpha } from "./canvas";
export type { AnyCanvas } from "./canvas";
export { configureAi, removeBackground, segment, isModelLoaded } from "./ai";
export type { AiConfig, SegmentPrompt } from "./ai";
export { layoutText } from "./text";

export interface EngineOptions extends UrlLoaderOptions {
  ai?: AiConfig;
}

export interface Encoded {
  bytes: Uint8Array;
  // What the browser really produced (AVIF / WebP may fall back to PNG).
  mime: string;
  width: number;
  height: number;
}

export type MaskTarget = { kind: "layer"; id: string } | { kind: "canvas" };

export class Engine {
  readonly loader: UrlLoader;
  readonly compositor: Compositor;

  constructor(opts: EngineOptions, loader?: AssetLoader) {
    this.loader = (loader as UrlLoader) ?? createUrlLoader(opts);
    this.compositor = new Compositor(this.loader);
    if (opts.ai) configureAi(opts.ai);
  }

  setLibrary(index: LibraryIndex): void {
    this.loader.setLibrary?.(index);
  }

  render(doc: PhotoDoc, opts?: RenderOptions): Promise<AnyCanvas> {
    return this.compositor.render(doc, opts);
  }

  // The export pipeline: render at job.scale, crop / pad to the output, flatten, encode.
  async exportImage(doc: PhotoDoc, job: ExportJob, opts: RenderOptions = {}): Promise<Encoded> {
    const full = await this.compositor.render(doc, { ...opts, scale: job.scale });
    const out = createCanvas(job.width, job.height);
    const ctx = ctx2d(out);
    if (job.background) {
      ctx.fillStyle = job.background;
      ctx.fillRect(0, 0, job.width, job.height);
    }
    const s = job.scale;
    ctx.drawImage(full, job.source.x * s, job.source.y * s, job.source.width * s, job.source.height * s, job.dest.x, job.dest.y, job.dest.width, job.dest.height);
    return encode(out, job.mime, job.quality);
  }

  async analyze(doc: PhotoDoc, opts: { layer?: string; maxSide?: number } = {}): Promise<ImageStats> {
    const canvas = opts.layer ? await this.layerPixels(doc, opts.layer, { maxSide: opts.maxSide ?? 1200, withFilters: true }) : await this.render(doc, { scale: Math.min(1, (opts.maxSide ?? 1200) / Math.max(doc.canvas.width, doc.canvas.height)) });
    return analyzePixels(readPixels(canvas));
  }

  // A layer's own pixels in layer space (the box), unrotated: for image layers
  // at up to the source resolution — what the AI looks at, and what masks map to.
  async layerPixels(doc: PhotoDoc, id: string, opts: { maxSide?: number; withFilters?: boolean } = {}): Promise<AnyCanvas> {
    const loc = findLayer(doc.layers, id);
    if (!loc) throw new Error(`No layer "${id}".`);
    const layer = loc.layer;
    const maxSide = opts.maxSide ?? 2048;
    if (!hasBox(layer)) {
      const k = Math.min(1, maxSide / Math.max(doc.canvas.width, doc.canvas.height));
      return this.compositor.render({ ...doc, canvas: { ...doc.canvas, background: null }, layers: [stripForPixels(layer, opts.withFilters)] }, { scale: k });
    }
    const box = await this.compositor.layerBox(layer);
    if (!box) throw new Error(`Layer "${id}" has no size.`);
    let k = 1;
    if (layer.type === "image") {
      const nat = await this.compositor.naturalSize(layer.src);
      const src = (layer as ImageLayer).crop ?? nat;
      k = Math.max(src.width / box.width, src.height / box.height);
    }
    k = Math.min(k, maxSide / Math.max(box.width, box.height));
    const flat: Layer = { ...stripForPixels(layer, opts.withFilters), x: 0, y: 0, rotation: 0, flipX: false, flipY: false } as Layer;
    const W = Math.max(1, Math.round(box.width * k));
    const H = Math.max(1, Math.round(box.height * k));
    return this.compositor.render({ version: 1, id: "layer", canvas: { width: W / k, height: H / k }, layers: [flat] }, { scale: k });
  }

  // AI background removal on a layer → mask PNG (layer space, white = keep).
  async backgroundMask(doc: PhotoDoc, id: string, opts: { model?: string; feather?: number; threshold?: number } = {}): Promise<Encoded> {
    const src = await this.layerPixels(doc, id, { maxSide: 2048, withFilters: false });
    const alpha = await removeBackground(src, opts.model);
    return encodeMask(refineAlpha(alpha, src.width, src.height, opts), src.width, src.height);
  }

  // Segment Anything on a layer; points / box in layer px (document units).
  async segmentMask(doc: PhotoDoc, id: string, prompt: SegmentPrompt, opts: { model?: string; feather?: number } = {}): Promise<Encoded> {
    const src = await this.layerPixels(doc, id, { maxSide: 1600, withFilters: false });
    const box = await this.compositor.layerBox(findLayer(doc.layers, id)!.layer);
    const k = box ? src.width / box.width : 1;
    const scaled: SegmentPrompt = {
      ...(prompt.points ? { points: prompt.points.map(([x, y, l]) => [x * k, y * k, l] as [number, number, number]) } : {}),
      ...(prompt.box ? { box: prompt.box.map((v) => v * k) as [number, number, number, number] } : {}),
    };
    const alpha = await segment(src, scaled, opts.model);
    return encodeMask(refineAlpha(alpha, src.width, src.height, { feather: opts.feather ?? 1 }), src.width, src.height);
  }

  // Colour-range selection (global magic wand) on a layer → mask PNG.
  async colorRangeMask(doc: PhotoDoc, id: string, opts: { color: string; tolerance?: number; feather?: number }): Promise<Encoded> {
    const src = await this.layerPixels(doc, id, { maxSide: 2048, withFilters: true });
    const p = readPixels(src);
    const c = createCanvas(1, 1);
    const cx = ctx2d(c);
    cx.fillStyle = opts.color;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b] = cx.getImageData(0, 0, 1, 1).data;
    const tol = ((opts.tolerance ?? 32) / 100) * 441;
    const a = new Uint8ClampedArray(p.width * p.height);
    for (let i = 0, j = 0; i < a.length; i++, j += 4) {
      const d = Math.hypot(p.data[j] - r, p.data[j + 1] - g, p.data[j + 2] - b);
      a[i] = p.data[j + 3] < 8 ? 0 : d <= tol ? 255 : d <= tol * 1.25 ? 255 * (1 - (d - tol) / (tol * 0.25)) : 0;
    }
    return encodeMask(refineAlpha(a, p.width, p.height, { feather: opts.feather }), p.width, p.height);
  }
}

function stripForPixels(l: Layer, withFilters?: boolean): Layer {
  const { mask: _m, effects: _e, opacity: _o, blend: _b, clip: _c, ...rest } = l as Layer & Record<string, unknown>;
  const out = { ...rest, visible: true } as Layer;
  if (!withFilters && out.type !== "adjustment") delete (out as { filters?: unknown }).filters;
  return out;
}

// Optional hard threshold and feather on an AI alpha.
function refineAlpha(a: Uint8ClampedArray, w: number, h: number, opts: { feather?: number; threshold?: number }): Uint8ClampedArray {
  if (opts.threshold !== undefined) {
    const t = Math.max(0, Math.min(255, opts.threshold));
    for (let i = 0; i < a.length; i++) a[i] = a[i] >= t ? 255 : 0;
  }
  if (opts.feather) blurAlpha(a, w, h, opts.feather);
  return a;
}

// Mask PNG: grey = alpha, fully opaque (luminance masks).
export async function encodeMask(alpha: Uint8ClampedArray, w: number, h: number): Promise<Encoded> {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(canvasFromAlpha(alpha, w, h), 0, 0);
  return encode(c, "image/png");
}

export async function encode(c: AnyCanvas, mime: string, quality = 100): Promise<Encoded> {
  const blob = await canvasToBlob(c, mime, mime === "image/png" ? undefined : quality / 100);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || mime, width: c.width, height: c.height };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}
