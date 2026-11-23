// Rasterize a text / shape / fill layer: its pixels (no filters / mask /
// effects, which stay live on the new layer) become a PNG in assets/edits/
// and the layer is replaced in place by an image layer with the same id.

import { hasBox, type ImageLayer, type Layer } from "../../core/types";
import { createCanvas, ctx2d, encode, type AnyCanvas } from "../../engine";
import { findLayer } from "../../ops/tree";
import { toast } from "../components/ui/Toast";
import { t } from "../i18n";
import { layerLabel } from "../lib/layers";
import { sideEngine } from "../render/sideEngine";
import type { EditorApi } from "../state/context";
import { freePath } from "./region";

export async function rasterizeLayer(api: EditorApi, id: string): Promise<void> {
  try {
    const doc = api.store.doc!;
    const loc = findLayer(doc.layers, id);
    if (!loc) return;
    const l = loc.layer;
    if (l.type !== "text" && l.type !== "shape" && l.type !== "fill") return;
    // Render the layer alone, unrotated and without filters / mask / effects (they stay
    // live on the new layer), then crop to its pixels: text label boxes and strokes included.
    // A stage around the layer's box (with room for label boxes / strokes), or the canvas for fills.
    const b = hasBox(l) ? api.boxes.get(id) : null;
    const m = b ? Math.ceil(Math.max(b.width, b.height) * 0.25 + 64) : 0;
    const ox = b ? b.x - m : 0;
    const oy = b ? b.y - m : 0;
    const sw = b ? b.width + m * 2 : doc.canvas.width;
    const sh = b ? b.height + m * 2 : doc.canvas.height;
    const k = Math.min(1, 4096 / Math.max(sw, sh));
    const bare = { ...l, visible: true, opacity: 1, blend: "normal", ...(hasBox(l) ? { rotation: 0, flipX: false, flipY: false, x: (l.x ?? 0) - ox, y: (l.y ?? 0) - oy } : {}) } as Layer;
    for (const key of ["filters", "mask", "effects", "clip"] as const) delete (bare as Partial<Layer>)[key];
    const stage = { ...doc, canvas: { width: sw, height: sh, background: null }, layers: [bare] };
    const full = await sideEngine(api).render(stage, { scale: k });
    const bb = alphaBounds(full);
    if (!bb) return void toast({ tone: "info", title: t("layers.rasterizeEmpty") });
    const out = createCanvas(bb.w, bb.h);
    ctx2d(out).drawImage(full as CanvasImageSource, -bb.x, -bb.y);
    const png = await encode(out, "image/png");
    const path = await freePath(api, "assets/edits", `${id}-raster`);
    await api.backend.writeFile(path, png.bytes);
    const f = { x: bb.x / k + ox, y: bb.y / k + oy, width: bb.w / k, height: bb.h / k };
    const keep: Partial<Layer> = {};
    for (const k of ["visible", "locked", "opacity", "blend", "mask", "clip", "filters", "effects"] as const) if (l[k] !== undefined) (keep as Record<string, unknown>)[k] = l[k];
    const image: ImageLayer = {
      ...(keep as object),
      id,
      type: "image",
      name: l.name ?? layerLabel(l),
      src: path,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      ...(hasBox(l) && l.rotation ? { rotation: l.rotation } : {}),
      ...(hasBox(l) && l.flipX ? { flipX: true } : {}),
      ...(hasBox(l) && l.flipY ? { flipY: true } : {}),
    } as ImageLayer;
    api.edit(
      [
        { op: "removeLayer", id },
        { op: "addLayer", layer: image, parent: loc.parent?.id ?? null, index: loc.index },
      ],
      { select: id },
    );
  } catch (e) {
    toast({ tone: "error", title: t("layers.rasterizeFailed"), detail: (e as Error).message });
  }
}

// Bounding box of the non-transparent pixels.
function alphaBounds(c: AnyCanvas): { x: number; y: number; w: number; h: number } | null {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width;
  let y0 = c.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (d[(y * c.width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
