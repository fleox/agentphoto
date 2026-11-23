// What a marquee selection can become (pure, tested): a layer mask, an
// adjustment layer masked to it, or a crop.

import type { Layer, PhotoDoc, ShapeMask } from "../../core/types";
import { hasBox } from "../../core/types";
import type { LayerBoxInfo } from "../../engine";
import type { PatchOp } from "../../ops/doc";
import { findLayer } from "../../ops/tree";
import type { Marquee } from "../state/context";
import { newId } from "./layers";
import { clampRect } from "./transform";

const r = (n: number) => Math.round(n * 10) / 10;

// Shape mask in the layer's coordinates: layer-local px for box layers, canvas px otherwise.
export function marqueeMask(layer: Layer, m: Marquee, box: LayerBoxInfo | undefined, opts: { invert?: boolean; feather?: number } = {}): ShapeMask {
  const ox = hasBox(layer) ? (box?.x ?? layer.x ?? 0) : 0;
  const oy = hasBox(layer) ? (box?.y ?? layer.y ?? 0) : 0;
  return { shape: m.kind, x: r(m.x - ox), y: r(m.y - oy), width: r(m.width), height: r(m.height), ...(opts.invert ? { invert: true } : {}), ...(opts.feather ? { feather: opts.feather } : {}) };
}

export function maskFromMarquee(doc: PhotoDoc, id: string, m: Marquee, box: LayerBoxInfo | undefined): PatchOp[] | null {
  const loc = findLayer(doc.layers, id);
  if (!loc) return null;
  return [{ op: "setMask", id, mask: marqueeMask(loc.layer, m, box) }];
}

// A new adjustment layer (above the selection or on top) masked to the marquee.
export function adjustmentFromMarquee(doc: PhotoDoc, m: Marquee, above: string | null, name: string): { ops: PatchOp[]; id: string } {
  const id = newId(doc, "adjustment");
  const layer: Layer = { id, type: "adjustment", name, filters: [{ type: "brightnessContrast", brightness: 0, contrast: 0 }], mask: { shape: m.kind, x: r(m.x), y: r(m.y), width: r(m.width), height: r(m.height), feather: 2 } };
  return { ops: [{ op: "addLayer", layer, ...(above && findLayer(doc.layers, above) ? { above } : {}) }], id };
}

export function cropFromMarquee(doc: PhotoDoc, m: Marquee): PatchOp[] | null {
  const c = clampRect(m, doc.canvas.width, doc.canvas.height);
  const x = Math.round(c.x);
  const y = Math.round(c.y);
  const width = Math.round(c.width);
  const height = Math.round(c.height);
  if (width < 1 || height < 1) return null;
  return [{ op: "crop", x, y, width, height }];
}
