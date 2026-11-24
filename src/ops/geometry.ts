// Document-wide geometry (pure): crop, canvas size, image size (resample),
// rotate 90° steps, flip. Every layer is moved / scaled so the picture stays
// the same — nothing is rasterised. Image layers without an explicit size get
// it from `sizes` (natural size of their source, filled in by the ops layer);
// text layers without a width use an estimate of their box.

import { filterDef, EFFECTS } from "../core/catalog";
import type { Filter, Layer, Mask, Paint, PhotoDoc, ShapeMask, TextLayer } from "../core/types";
import { hasBox, isGradientMask, isShapeMask } from "../core/types";
import { OpsError } from "./context";

export type SizeMap = Record<string, { width: number; height: number }>;

export type Anchor = "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";
export const ANCHORS: Anchor[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const r2 = (v: number) => Math.round(v * 100) / 100;

// Estimated text box (no font metrics outside the browser).
export function estimateTextBox(l: TextLayer): { width: number; height: number } {
  const size = l.size ?? 64;
  const lines = String(l.text ?? "").split("\n");
  const longest = Math.max(1, ...lines.map((s) => s.length));
  const width = l.width ?? longest * size * 0.55 + Math.max(0, longest - 1) * (l.letterSpacing ?? 0);
  const height = l.height ?? lines.length * size * (l.lineHeight ?? 1.2);
  return { width, height };
}

// Box of a layer with a box: explicit size, natural image size, or text estimate.
export function layerBox(l: Layer, sizes: SizeMap = {}): { x: number; y: number; width: number; height: number } | null {
  if (!hasBox(l)) return null;
  const x = l.x ?? 0;
  const y = l.y ?? 0;
  if (l.type === "text") {
    const b = estimateTextBox(l);
    return { x, y, ...b };
  }
  let w = l.width;
  let h = l.height;
  if (l.type === "image" && (w === undefined || h === undefined)) {
    const nat = sizes[l.src];
    const src = l.crop ? { width: l.crop.width, height: l.crop.height } : nat;
    if (src) {
      if (w === undefined && h === undefined) [w, h] = [src.width, src.height];
      else if (w === undefined) w = (h! * src.width) / src.height;
      else h = (w * src.height) / src.width;
    }
  }
  if (w === undefined || h === undefined) return null;
  return { x, y, width: w, height: h };
}

// Make implicit image sizes explicit (needed before any geometry op).
function pinSize(l: Layer, sizes: SizeMap): void {
  if (l.type !== "image" || (l.width !== undefined && l.height !== undefined)) return;
  const b = layerBox(l, sizes);
  if (!b) throw new OpsError("invalid", `The size of image layer "${l.id}" is unknown (its source ${l.src} could not be read).`, "Give the layer an explicit width and height, or fix its src (assets_list).");
  l.width = r2(b.width);
  l.height = r2(b.height);
}

function eachLayer(layers: Layer[], fn: (l: Layer) => void): void {
  for (const l of layers) {
    fn(l);
    if (l.type === "group") eachLayer(l.children ?? [], fn);
  }
}

// ─── translate (crop, canvas size) ──────────────────────────────────────

function translateMask(m: Mask | null | undefined, dx: number, dy: number): void {
  if (m && isShapeMask(m)) {
    m.x = r2(m.x + dx);
    m.y = r2(m.y + dy);
  }
}

function translateAll(layers: Layer[], dx: number, dy: number): void {
  eachLayer(layers, (l) => {
    if (hasBox(l)) {
      l.x = r2((l.x ?? 0) + dx);
      l.y = r2((l.y ?? 0) + dy);
    } else translateMask(l.mask, dx, dy); // canvas-space masks
  });
}

export function cropDoc(doc: PhotoDoc, rect: { x: number; y: number; width: number; height: number }): PhotoDoc {
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) throw new OpsError("invalid", "crop needs x, y, width ≥ 1, height ≥ 1 (canvas pixels).");
  const out = clone(doc);
  translateAll(out.layers, -x, -y);
  out.canvas = { ...out.canvas, width: Math.round(width), height: Math.round(height) };
  return out;
}

export function anchorOffset(anchor: Anchor, dw: number, dh: number): [number, number] {
  const ax = anchor.endsWith("left") ? 0 : anchor.endsWith("right") ? 1 : 0.5;
  const ay = anchor.startsWith("top") ? 0 : anchor.startsWith("bottom") ? 1 : 0.5;
  return [dw * ax, dh * ay];
}

export function resizeCanvasDoc(doc: PhotoDoc, width: number, height: number, anchor: Anchor = "center"): PhotoDoc {
  if (!ANCHORS.includes(anchor)) throw new OpsError("invalid", `Unknown anchor "${anchor}".`, `Anchors: ${ANCHORS.join(", ")}.`);
  const [ox, oy] = anchorOffset(anchor, width - doc.canvas.width, height - doc.canvas.height);
  return cropDoc(doc, { x: -ox, y: -oy, width, height });
}

// ─── scale (image size) ─────────────────────────────────────────────────

function scalePx(obj: Record<string, unknown> | null | undefined, keys: string[], k: number): void {
  if (!obj) return;
  for (const key of keys) if (typeof obj[key] === "number") obj[key] = r2((obj[key] as number) * k);
}

function scaleFilters(filters: Filter[] | undefined, k: number): void {
  for (const f of filters ?? []) {
    const def = filterDef(f.type);
    scalePx(f as Record<string, unknown>, (def?.params ?? []).filter((p) => p.px).map((p) => p.name), k);
  }
}

export function scaleDoc(doc: PhotoDoc, sx: number, sy: number, sizes: SizeMap = {}): PhotoDoc {
  if (!(sx > 0) || !(sy > 0)) throw new OpsError("invalid", "The scale must be > 0.");
  const out = clone(doc);
  eachLayer(out.layers, (l) => scaleLayer(l, sx, sy, sizes));
  out.canvas = { ...out.canvas, width: Math.max(1, Math.round(doc.canvas.width * sx)), height: Math.max(1, Math.round(doc.canvas.height * sy)) };
  return out;
}

// Scales one layer's geometry and distances (not its children) around the canvas origin.
function scaleLayer(l: Layer, sx: number, sy: number, sizes: SizeMap): void {
  const k = Math.sqrt(sx * sy);
  pinSize(l, sizes);
  if (hasBox(l)) {
    l.x = r2((l.x ?? 0) * sx);
    l.y = r2((l.y ?? 0) * sy);
    if (l.width !== undefined) l.width = r2(l.width * sx);
    if (l.height !== undefined) l.height = r2(l.height * sy);
  } else if (l.mask && isShapeMask(l.mask)) {
    const m = l.mask as ShapeMask;
    m.x = r2(m.x * sx);
    m.y = r2(m.y * sy);
    m.width = r2(m.width * sx);
    m.height = r2(m.height * sy);
  }
  if (l.mask) {
    if (hasBox(l) && isShapeMask(l.mask)) {
      const m = l.mask;
      m.x = r2(m.x * sx);
      m.y = r2(m.y * sy);
      m.width = r2(m.width * sx);
      m.height = r2(m.height * sy);
    }
    scalePx(l.mask as unknown as Record<string, unknown>, ["feather", "radius"], k);
  }
  if (l.type === "text") {
    scalePx(l as unknown as Record<string, unknown>, ["size", "letterSpacing"], k);
    if (l.background) {
      const p = l.background.padding;
      l.background.padding = Array.isArray(p) ? [r2(p[0] * k), r2(p[1] * k)] : typeof p === "number" ? r2(p * k) : p;
      scalePx(l.background as Record<string, unknown>, ["radius"], k);
    }
  }
  if (l.type === "shape") {
    scalePx(l as unknown as Record<string, unknown>, ["radius"], k);
    if (l.stroke) scalePx(l.stroke as Record<string, unknown>, ["width"], k);
  }
  scaleFilters(l.filters, k);
  if (l.effects) {
    for (const def of EFFECTS) {
      const fx = (l.effects as Record<string, Record<string, unknown> | null | undefined>)[def.id];
      scalePx(fx, def.params.filter((p) => p.px).map((p) => p.name), k);
    }
  }
}

// ─── fit a layer (or a part of it) into a box ───────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const isRect = (r: unknown): r is Rect => !!r && typeof r === "object" && ["x", "y", "width", "height"].every((k) => Number.isFinite((r as Record<string, unknown>)[k]));

// Scales (uniformly) and moves a box layer so `subject` — a canvas-px region
// of it, default its whole box (e.g. the `subject` returned by
// remove_background) — fits inside `box`, aligned on `anchor` ("bottom" sits a
// cut-out on a floor line). The layer keeps its proportions; parts outside the
// subject may leave the canvas (they are usually masked out).
export function fitLayerDoc(doc: PhotoDoc, id: string, box: Rect, opts: { subject?: Rect | null; anchor?: Anchor; sizes?: SizeMap } = {}): PhotoDoc {
  if (!isRect(box) || box.width < 1 || box.height < 1) throw new OpsError("invalid", "fitLayer needs box { x, y, width ≥ 1, height ≥ 1 } (canvas px).");
  const anchor = opts.anchor ?? "center";
  if (!ANCHORS.includes(anchor)) throw new OpsError("invalid", `Unknown anchor "${anchor}".`, `Anchors: ${ANCHORS.join(", ")}.`);
  const out = clone(doc);
  let layer: Layer | null = null;
  eachLayer(out.layers, (l) => {
    if (l.id === id && !layer) layer = l;
  });
  const l = layer as Layer | null;
  if (!l) throw new OpsError("notFound", `No layer "${id}".`, "layer_list lists the layer ids.");
  if (!hasBox(l)) throw new OpsError("invalid", `"${id}" is a ${l.type} layer: fitLayer moves image, text and shape layers.`);
  pinSize(l, opts.sizes ?? {});
  const b = layerBox(l, opts.sizes);
  if (!b || !(b.width > 0) || !(b.height > 0)) throw new OpsError("invalid", `The box of layer "${id}" is unknown.`, "Give the layer an explicit width and height.");
  const subj = opts.subject ?? b;
  if (!isRect(subj) || !(subj.width > 0) || !(subj.height > 0)) throw new OpsError("invalid", "fitLayer subject must be { x, y, width > 0, height > 0 } (canvas px).", "Pass the subject returned by remove_background, or omit it to fit the whole layer.");
  const k = Math.min(box.width / subj.width, box.height / subj.height);
  const [ox, oy] = anchorOffset(anchor, box.width - subj.width * k, box.height - subj.height * k);
  const relX = subj.x - b.x;
  const relY = subj.y - b.y;
  scaleLayer(l, k, k, opts.sizes ?? {});
  l.x = r2(box.x + ox - relX * k);
  l.y = r2(box.y + oy - relY * k);
  return out;
}

// ─── rotate / flip ──────────────────────────────────────────────────────

// Degrees into (-180, 180].
const normAngle = (deg: number) => {
  const a = (((deg + 180) % 360) + 360) % 360 - 180;
  return a === -180 ? 180 : a;
};

// Gradients painted over the whole canvas (canvas background, fill layers,
// canvas-space gradient masks) turn / mirror with the picture. Box layers'
// paints are relative to their box, which already turns / flips with them.
function transformPaint(p: Paint | null | undefined, fn: { angle: (deg: number) => number; point: (x: number, y: number) => [number, number] }): void {
  if (!p || typeof p !== "object") return;
  if (p.type === "linear") p.angle = r2(normAngle(fn.angle(p.angle ?? 90)));
  else if (p.type === "radial") {
    const [cx, cy] = fn.point(p.cx ?? 0.5, p.cy ?? 0.5);
    p.cx = r2(cx);
    p.cy = r2(cy);
  }
}

function transformCanvasPaints(doc: PhotoDoc, fn: Parameters<typeof transformPaint>[1]): void {
  transformPaint(doc.canvas.background, fn);
  eachLayer(doc.layers, (l) => {
    if (hasBox(l)) return;
    if (l.type === "fill") transformPaint(l.fill, fn);
    if (l.mask && isGradientMask(l.mask)) transformPaint(l.mask.gradient, fn);
  });
}

export function rotateDoc(doc: PhotoDoc, angle: number, sizes: SizeMap = {}): PhotoDoc {
  const a = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  if (angle % 90 !== 0) throw new OpsError("invalid", `Canvas rotation must be a multiple of 90°, got ${angle}.`, "To straighten a photo by a few degrees, set the image layer's rotation instead (and crop).");
  if (a === 0) return clone(doc);
  const out = clone(doc);
  const W = doc.canvas.width;
  const H = doc.canvas.height;
  // Canvas point (x, y) → rotated canvas.
  const map = (x: number, y: number): [number, number] => (a === 90 ? [H - y, x] : a === 180 ? [W - x, H - y] : [y, W - x]);
  eachLayer(out.layers, (l) => {
    pinSize(l, sizes);
    const box = layerBox(l, sizes);
    if (box) {
      const [cx, cy] = map(box.x + box.width / 2, box.y + box.height / 2);
      const bl = l as Layer & { x?: number; y?: number; rotation?: number };
      bl.x = r2(cx - box.width / 2);
      bl.y = r2(cy - box.height / 2);
      bl.rotation = normAngle((bl.rotation ?? 0) + a);
      if (bl.rotation === 0) delete bl.rotation;
    } else if (l.mask && isShapeMask(l.mask)) {
      const m = l.mask;
      const [cx, cy] = map(m.x + m.width / 2, m.y + m.height / 2);
      const [w, h] = a === 180 ? [m.width, m.height] : [m.height, m.width];
      Object.assign(m, { x: r2(cx - w / 2), y: r2(cy - h / 2), width: w, height: h });
    }
  });
  // Fractions of the canvas box: (fx, fy) → rotated box.
  transformCanvasPaints(out, { angle: (deg) => deg + a, point: (fx, fy) => (a === 90 ? [1 - fy, fx] : a === 180 ? [1 - fx, 1 - fy] : [fy, 1 - fx]) });
  if (a !== 180) out.canvas = { ...out.canvas, width: H, height: W };
  return out;
}

export function flipDoc(doc: PhotoDoc, axis: "horizontal" | "vertical", sizes: SizeMap = {}): PhotoDoc {
  if (axis !== "horizontal" && axis !== "vertical") throw new OpsError("invalid", `axis must be "horizontal" or "vertical".`);
  const out = clone(doc);
  const W = doc.canvas.width;
  const H = doc.canvas.height;
  eachLayer(out.layers, (l) => {
    pinSize(l, sizes);
    const box = layerBox(l, sizes);
    if (box) {
      const bl = l as Layer & { x?: number; y?: number; rotation?: number; flipX?: boolean; flipY?: boolean };
      if (axis === "horizontal") {
        bl.x = r2(W - box.x - box.width);
        if (l.type !== "text") bl.flipX = !bl.flipX || undefined;
      } else {
        bl.y = r2(H - box.y - box.height);
        if (l.type !== "text") bl.flipY = !bl.flipY || undefined;
      }
      if (bl.rotation) bl.rotation = -bl.rotation;
      if (!bl.flipX) delete bl.flipX;
      if (!bl.flipY) delete bl.flipY;
    } else if (l.mask && isShapeMask(l.mask)) {
      const m = l.mask;
      if (axis === "horizontal") m.x = r2(W - m.x - m.width);
      else m.y = r2(H - m.y - m.height);
    }
  });
  transformCanvasPaints(out, axis === "horizontal" ? { angle: (deg) => 180 - deg, point: (fx, fy) => [1 - fx, fy] } : { angle: (deg) => -deg, point: (fx, fy) => [fx, 1 - fy] });
  return out;
}
