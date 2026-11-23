// Entry of dist/engine/agentphoto-engine.js: the page agent/render/ drives in
// headless Chrome. It exposes window.agentphoto; every method takes / returns
// JSON (images as base64) so the CLI can call it through CDP Runtime.evaluate.

import type { LibraryIndex } from "../core/library";
import type { PhotoDoc } from "../core/types";
import type { ExportJob } from "../ops/export";
import { walkLayers } from "../ops/tree";
import { bytesToBase64, encode, Engine, type Encoded, type SegmentPrompt } from "./index";
import type { AiConfig } from "./ai";

export interface HeadlessInit {
  assetBase: string;
  libraryBase: string;
  library?: LibraryIndex;
  ai?: AiConfig;
}

export interface EncodedB64 {
  base64: string;
  mime: string;
  width: number;
  height: number;
  bbox?: Encoded["bbox"];
}

const b64 = (e: Encoded): EncodedB64 => ({ base64: bytesToBase64(e.bytes), mime: e.mime, width: e.width, height: e.height, ...(e.bbox !== undefined ? { bbox: e.bbox } : {}) });

let engine: Engine | null = null;
const errors: { layer: string; message: string }[] = [];
const need = () => {
  if (!engine) throw new Error("agentphoto.init() was not called.");
  return engine;
};

const api = {
  version: 1,
  async init(opts: HeadlessInit) {
    engine = new Engine({ assetBase: opts.assetBase, libraryBase: opts.libraryBase, library: opts.library, ai: opts.ai });
    return true;
  },
  // Full render as PNG (or JPEG for previews), optionally scaled to fit maxWidth / maxHeight.
  async render(doc: PhotoDoc, opts: { scale?: number; maxWidth?: number; maxHeight?: number; format?: "png" | "jpeg"; quality?: number; only?: string[]; background?: boolean } = {}) {
    errors.length = 0;
    let scale = opts.scale ?? 1;
    if (opts.maxWidth) scale = Math.min(scale, opts.maxWidth / doc.canvas.width);
    if (opts.maxHeight) scale = Math.min(scale, opts.maxHeight / doc.canvas.height);
    const c = await need().render(doc, { scale, background: opts.background, only: opts.only ? new Set(opts.only) : undefined, onError: (layer, message) => errors.push({ layer, message }) });
    const e = await encode(c, opts.format === "jpeg" ? "image/jpeg" : "image/png", opts.quality ?? 88);
    return { ...b64(e), scale, errors: [...errors] };
  },
  async exportImage(doc: PhotoDoc, job: ExportJob) {
    errors.length = 0;
    const e = await need().exportImage(doc, job, { onError: (layer, message) => errors.push({ layer, message }) });
    return { ...b64(e), errors: [...errors] };
  },
  analyze(doc: PhotoDoc, opts: { layer?: string; maxSide?: number } = {}) {
    return need().analyze(doc, opts);
  },
  async backgroundMask(doc: PhotoDoc, id: string, opts: { model?: string; feather?: number; threshold?: number } = {}) {
    return b64(await need().backgroundMask(doc, id, opts));
  },
  async segmentMask(doc: PhotoDoc, id: string, prompt: SegmentPrompt, opts: { model?: string; feather?: number } = {}) {
    return b64(await need().segmentMask(doc, id, prompt, opts));
  },
  async colorRangeMask(doc: PhotoDoc, id: string, opts: { color: string; tolerance?: number; feather?: number }) {
    return b64(await need().colorRangeMask(doc, id, opts));
  },
  // Project files that changed on disk (a regenerated mask, a Studio edit):
  // the next render reloads them instead of using the cached decode.
  invalidate(paths: string[]) {
    for (const p of paths) need().loader.invalidate(p);
    return paths.length;
  },
  // Measured boxes (document px) of every layer with a box — text uses real font metrics.
  async layerBoxes(doc: PhotoDoc) {
    const out: Record<string, { x: number; y: number; width: number; height: number; rotation: number }> = {};
    const list: Parameters<Parameters<typeof walkLayers>[1]>[0][] = [];
    walkLayers(doc.layers, (l) => void list.push(l));
    for (const l of list) {
      const b = await need().compositor.layerBox(l).catch(() => null);
      if (b) out[l.id] = b;
    }
    return out;
  },
};

declare global {
  interface Window {
    agentphoto: typeof api;
  }
}

(globalThis as unknown as { agentphoto: typeof api }).agentphoto = api;
export type HeadlessApi = typeof api;
