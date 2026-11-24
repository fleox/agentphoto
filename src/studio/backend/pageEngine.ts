// EngineHost implemented in the page (in-browser projects): the AI tools'
// pixel work (render_preview, export, image_analyze, remove_background,
// mask_generate) runs with src/engine/ right here — same code as headless
// Chrome, so results match the CLI.

import type { EngineHost, EncodedImage } from "../../ai/types";
import { encode, Engine } from "../../engine";
import { walkLayers } from "../../ops/tree";

export function pageEngineHost(engine: Engine): EngineHost {
  const withErrors = async <T extends { bytes: Uint8Array; mime: string; width: number; height: number }>(run: (onError: (layer: string, message: string) => void) => Promise<T>): Promise<EncodedImage> => {
    const errors: { layer: string; message: string }[] = [];
    const r = await run((layer, message) => errors.push({ layer, message }));
    return { bytes: r.bytes, mime: r.mime, width: r.width, height: r.height, ...(errors.length ? { errors } : {}) };
  };
  return {
    render(doc, opts) {
      let scale = opts.scale ?? 1;
      if (opts.maxWidth) scale = Math.min(scale, opts.maxWidth / doc.canvas.width);
      if (opts.maxHeight) scale = Math.min(scale, opts.maxHeight / doc.canvas.height);
      return withErrors(async (onError) => {
        const c = await engine.render(doc, { scale, only: opts.only ? new Set(opts.only) : undefined, onError });
        return encode(c, opts.format === "jpeg" ? "image/jpeg" : "image/png", 88);
      });
    },
    exportImage: (doc, job) => withErrors((onError) => engine.exportImage(doc, job, { onError })),
    analyze: (doc, opts) => engine.analyze(doc, opts),
    backgroundMask: (doc, id, opts) => engine.backgroundMask(doc, id, opts),
    segmentMask: (doc, id, prompt, opts) => engine.segmentMask(doc, id, prompt, opts),
    colorRangeMask: (doc, id, opts) => engine.colorRangeMask(doc, id, opts),
    async layerBoxes(doc) {
      const out: Record<string, { x: number; y: number; width: number; height: number; rotation: number; ink?: { x: number; y: number; width: number; height: number } }> = {};
      const list: Parameters<Parameters<typeof walkLayers>[1]>[0][] = [];
      walkLayers(doc.layers, (l) => void list.push(l));
      for (const l of list) {
        const b = await engine.compositor.layerBox(l).catch(() => null);
        if (b) out[l.id] = b;
      }
      return out;
    },
  };
}
