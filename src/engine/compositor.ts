// The compositor: renders a PhotoDoc to a canvas. Deterministic (same document,
// same sources, same fonts → same pixels), used by the Studio (live, cached,
// at preview scale) and by headless Chrome for `agentphoto render | export`.
//
// Per layer: rasterise the content in layer space (image crop + fit, text,
// shape) → filters → mask → transform (rotation, flip) into a canvas-space
// surface → layer effects → clip to the layer below (clip) → draw with
// opacity and blend mode. Fill layers and groups render in canvas space;
// adjustment layers filter what is below them.

import { fontDef } from "../core/catalog";
import { stableStringify } from "../core/jsonPath";
import type { FillLayer, GroupLayer, ImageLayer, Layer, LayerEffects, Mask, PhotoDoc, ShapeLayer, TextLayer } from "../core/types";
import { hasBox, isGradientMask, isImageMask, isShapeMask } from "../core/types";
import { compositeOp, createCanvas, ctx2d, readPixels, writePixels, type AnyCanvas, type Ctx, type Drawable, type Surface } from "./canvas";
import { applyEffects, effectsPad, hasEffects } from "./effects";
import { runFilters } from "./filters";
import { blurAlpha } from "./filters/pixels";
import { fillStyle, type Box } from "./paint";
import { drawText, layoutText, roundRect } from "./text";

export interface AssetLoader {
  // Decoded image for a document src ("assets/photo.jpg", "library:portrait").
  image(src: string): Promise<Drawable>;
  // Makes a catalog font usable; resolves the CSS family to draw with (null = system font).
  font?(id: string, weight: number, italic: boolean): Promise<string | null>;
  // Bumped when a file changes (cache key).
  version?(src: string): number;
}

export interface RenderOptions {
  // Output px per document px (0.5 = half-size preview).
  scale?: number;
  // Draw canvas.background (default true).
  background?: boolean;
  // Under everything (previews of transparent images): "checker" or a CSS colour.
  backdrop?: string;
  // Layers to skip (the Studio hides a layer being edited, e.g. live text).
  skip?: ReadonlySet<string>;
  // Render only these layer ids (and the groups holding them) — isolate.
  only?: ReadonlySet<string>;
  // Called when a source fails to load (the layer is skipped).
  onError?(layerId: string, message: string): void;
}

export interface LayerBoxInfo {
  // Document px: the layer's box before rotation.
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

interface CacheEntry {
  key: string;
  surface: Surface | null;
  used: number;
}

const MAX_CACHE = 96;

export class Compositor {
  private cache = new Map<string, CacheEntry>();
  private tick = 0;
  private natural = new Map<string, { width: number; height: number }>();
  constructor(readonly loader: AssetLoader) {}

  clearCache(): void {
    this.cache.clear();
  }

  // ─── public API ───────────────────────────────────────────────────────

  async render(doc: PhotoDoc, opts: RenderOptions = {}): Promise<AnyCanvas> {
    const s = opts.scale ?? 1;
    const W = Math.max(1, Math.round(doc.canvas.width * s));
    const H = Math.max(1, Math.round(doc.canvas.height * s));
    const out = createCanvas(W, H);
    const ctx = ctx2d(out);
    if (opts.backdrop === "checker") {
      const cell = Math.max(6, Math.round(12 * Math.min(1, s * 2)));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#d9d9d9";
      for (let y = 0; y < H; y += cell) for (let x = (y / cell) % 2 ? cell : 0; x < W; x += cell * 2) ctx.fillRect(x, y, cell, cell);
    } else if (opts.backdrop) {
      ctx.fillStyle = opts.backdrop;
      ctx.fillRect(0, 0, W, H);
    }
    if (opts.background !== false && doc.canvas.background) {
      ctx.fillStyle = fillStyle(ctx, doc.canvas.background, { x: 0, y: 0, w: W, h: H });
      ctx.fillRect(0, 0, W, H);
    }
    await this.preload(doc);
    await this.compose(doc.layers, out, doc, s, opts);
    this.evict();
    return out;
  }

  // One layer alone (thumbnails, isolate): its canvas-space surface at `scale`.
  async layerSurface(layer: Layer, doc: PhotoDoc, scale: number): Promise<Surface | null> {
    await this.preload({ ...doc, layers: [layer] });
    return this.surface(layer, doc, scale, {});
  }

  // Box of a layer in document px (text measured with its font).
  async layerBox(layer: Layer): Promise<LayerBoxInfo | null> {
    if (!hasBox(layer)) return null;
    const x = layer.x ?? 0;
    const y = layer.y ?? 0;
    const rotation = layer.rotation ?? 0;
    if (layer.type === "text") {
      const fam = await this.family(layer);
      const lay = layoutText(layer, fam, 1);
      return { x, y, width: lay.width, height: lay.height, rotation };
    }
    if (layer.type === "image") {
      const nat = await this.naturalSize(layer.src).catch(() => null);
      const { w, h } = imageBoxSize(layer, nat);
      return { x, y, width: w, height: h, rotation };
    }
    return { x, y, width: layer.width ?? 0, height: layer.height ?? 0, rotation };
  }

  async naturalSize(src: string): Promise<{ width: number; height: number }> {
    const known = this.natural.get(src);
    if (known) return known;
    const img = await this.loader.image(src);
    const size = { width: img.width, height: img.height };
    this.natural.set(src, size);
    return size;
  }

  // ─── composition ──────────────────────────────────────────────────────

  private async preload(doc: PhotoDoc): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    const visit = (layers: Layer[]) => {
      for (const l of layers) {
        if (l.type === "text" && l.font && fontDef(l.font) && this.loader.font) jobs.push(this.loader.font(l.font, l.weight ?? 400, !!l.italic).catch(() => null));
        if (l.type === "group") visit(l.children ?? []);
      }
    };
    visit(doc.layers ?? []);
    await Promise.all(jobs);
  }

  private async compose(layers: Layer[], target: AnyCanvas, doc: PhotoDoc, s: number, opts: RenderOptions): Promise<void> {
    const ctx = ctx2d(target);
    let base: Surface | null = null;
    let baseVisible = true;
    for (const layer of layers ?? []) {
      if (!layer || typeof layer !== "object") continue;
      const hidden = layer.visible === false || opts.skip?.has(layer.id) || (opts.only && !includesOnly(layer, opts.only));
      if (layer.clip) {
        if (hidden || !base || !baseVisible) continue;
      }
      if (hidden) {
        if (!layer.clip) {
          base = null;
          baseVisible = false;
        }
        continue;
      }
      let surf: Surface | null;
      try {
        if (layer.type === "adjustment") surf = await this.adjust(layer, target, s);
        else surf = await this.surface(layer, doc, s, opts);
      } catch (e) {
        opts.onError?.(layer.id, (e as Error).message);
        surf = null;
      }
      if (!surf) {
        if (!layer.clip) {
          base = null;
          baseVisible = false;
        }
        continue;
      }
      if (layer.clip && base) surf = clipTo(surf, base);
      ctx.save();
      ctx.globalAlpha = clamp01(layer.opacity ?? 1);
      ctx.globalCompositeOperation = compositeOp(layer.blend);
      ctx.drawImage(surf.canvas, surf.x, surf.y);
      ctx.restore();
      if (!layer.clip) {
        base = surf;
        baseVisible = true;
      }
    }
  }

  private async surface(layer: Layer, doc: PhotoDoc, s: number, opts: RenderOptions): Promise<Surface | null> {
    const key = await this.cacheKey(layer, doc, s, opts);
    const hit = this.cache.get(layer.id);
    if (hit && hit.key === key) {
      hit.used = ++this.tick;
      return hit.surface;
    }
    let surf: Surface | null = null;
    if (layer.type === "group") surf = await this.groupSurface(layer, doc, s, opts);
    else if (layer.type === "fill") surf = this.fillSurface(layer, doc, s);
    else if (hasBox(layer)) surf = await this.boxSurface(layer, s);
    if (surf && layer.type !== "group" && layer.type !== "adjustment" && !hasBox(layer) && layer.mask) surf = { ...surf, canvas: await this.maskCanvasSpace(surf.canvas, layer.mask, doc, s) };
    if (surf && hasEffects(layer.effects)) surf = applyEffects(surf, layer.effects as LayerEffects, s);
    this.cache.set(layer.id, { key, surface: surf, used: ++this.tick });
    return surf;
  }

  private async cacheKey(layer: Layer, doc: PhotoDoc, s: number, opts: RenderOptions): Promise<string> {
    const versions: string[] = [];
    const v = this.loader.version;
    const visit = (l: Layer) => {
      if (v) {
        if (l.type === "image") versions.push(`${l.src}@${v(l.src)}`);
        if (l.mask && isImageMask(l.mask)) versions.push(`${l.mask.src}@${v(l.mask.src)}`);
      }
      if (l.type === "group") (l.children ?? []).forEach(visit);
    };
    visit(layer);
    const canvasDep = layer.type === "fill" || layer.type === "group" ? `${doc.canvas.width}x${doc.canvas.height}` : "";
    const groupOpts = layer.type === "group" ? `${[...(opts.skip ?? [])].join(",")}|${[...(opts.only ?? [])].join(",")}` : "";
    return `${s}|${canvasDep}|${groupOpts}|${versions.join(",")}|${stableStringify(layer)}`;
  }

  private evict(): void {
    if (this.cache.size <= MAX_CACHE) return;
    const entries = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [id] of entries.slice(0, this.cache.size - MAX_CACHE)) this.cache.delete(id);
  }

  // ─── layer kinds ──────────────────────────────────────────────────────

  private async groupSurface(layer: GroupLayer, doc: PhotoDoc, s: number, opts: RenderOptions): Promise<Surface | null> {
    const W = Math.max(1, Math.round(doc.canvas.width * s));
    const H = Math.max(1, Math.round(doc.canvas.height * s));
    const c = createCanvas(W, H);
    await this.compose(layer.children ?? [], c, doc, s, opts);
    if (layer.filters?.length) filterCanvas(c, layer.filters, s);
    const masked = layer.mask ? await this.maskCanvasSpace(c, layer.mask, doc, s) : c;
    return { canvas: masked, x: 0, y: 0 };
  }

  private fillSurface(layer: FillLayer, doc: PhotoDoc, s: number): Surface {
    const W = Math.max(1, Math.round(doc.canvas.width * s));
    const H = Math.max(1, Math.round(doc.canvas.height * s));
    const c = createCanvas(W, H);
    const ctx = ctx2d(c);
    ctx.fillStyle = fillStyle(ctx, layer.fill, { x: 0, y: 0, w: W, h: H });
    ctx.fillRect(0, 0, W, H);
    if (layer.filters?.length) filterCanvas(c, layer.filters, s);
    return { canvas: c, x: 0, y: 0 };
  }

  // Adjustment layer: filtered copy of what is below (+ canvas-space mask).
  private async adjust(layer: Layer, below: AnyCanvas, s: number): Promise<Surface | null> {
    if (!layer.filters?.length) return null;
    const c = createCanvas(below.width, below.height);
    ctx2d(c).drawImage(below, 0, 0);
    filterCanvas(c, layer.filters, s);
    if (layer.mask && (layer.mask as { enabled?: boolean }).enabled !== false) {
      applyAlphaMask(c, await this.maskPlane(layer.mask, c.width, c.height, s, null));
    }
    return { canvas: c, x: 0, y: 0 };
  }

  private async boxSurface(layer: ImageLayer | TextLayer | ShapeLayer, s: number): Promise<Surface | null> {
    // 1. content in layer space (+ offset of the box inside it)
    let content: { canvas: AnyCanvas; ox: number; oy: number; w: number; h: number } | null;
    if (layer.type === "image") content = await this.imageContent(layer, s);
    else if (layer.type === "text") content = drawText(layer, await this.family(layer), s);
    else content = shapeContent(layer, s);
    if (!content || content.w <= 0 || content.h <= 0) return null;
    // 2. filters, 3. mask
    if (layer.filters?.length) filterCanvas(content.canvas, layer.filters, s);
    if (layer.mask && (layer.mask as { enabled?: boolean }).enabled !== false) {
      const plane = await this.maskPlane(layer.mask, Math.max(1, Math.round(content.w)), Math.max(1, Math.round(content.h)), s, layer);
      const full = new Uint8ClampedArray(content.canvas.width * content.canvas.height);
      // Outside the box (padding) follows the mask's edge value: hidden.
      const mw = Math.max(1, Math.round(content.w));
      const mh = Math.max(1, Math.round(content.h));
      const ox = Math.round(content.ox);
      const oy = Math.round(content.oy);
      for (let y = 0; y < mh; y++) {
        const ty = y + oy;
        if (ty < 0 || ty >= content.canvas.height) continue;
        for (let x = 0; x < mw; x++) {
          const tx = x + ox;
          if (tx < 0 || tx >= content.canvas.width) continue;
          full[ty * content.canvas.width + tx] = plane[y * mw + x];
        }
      }
      applyAlphaMask(content.canvas, full);
    }
    // 4. transform into canvas space (+ room for effects)
    const pad = effectsPad(layer.effects, s);
    const bx = (layer.x ?? 0) * s;
    const by = (layer.y ?? 0) * s;
    const cx = bx + content.w / 2;
    const cy = by + content.h / 2;
    const rot = ((layer.rotation ?? 0) * Math.PI) / 180;
    const fx = layer.flipX ? -1 : 1;
    const fy = layer.flipY ? -1 : 1;
    // Corners of the content canvas around the box centre.
    const left = -content.w / 2 - content.ox;
    const top = -content.h / 2 - content.oy;
    const corners = [
      [left, top],
      [left + content.canvas.width, top],
      [left, top + content.canvas.height],
      [left + content.canvas.width, top + content.canvas.height],
    ].map(([px, py]) => {
      const x = px * fx;
      const y = py * fy;
      return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)];
    });
    const minX = Math.floor(Math.min(...corners.map((c) => c[0]))) - pad;
    const minY = Math.floor(Math.min(...corners.map((c) => c[1]))) - pad;
    const maxX = Math.ceil(Math.max(...corners.map((c) => c[0]))) + pad;
    const maxY = Math.ceil(Math.max(...corners.map((c) => c[1]))) + pad;
    if (!rot && fx === 1 && fy === 1 && !pad) {
      return { canvas: content.canvas, x: Math.round(bx - content.ox), y: Math.round(by - content.oy) };
    }
    const out = createCanvas(maxX - minX, maxY - minY);
    const ctx = ctx2d(out);
    ctx.translate(cx - minX, cy - minY);
    ctx.rotate(rot);
    ctx.scale(fx, fy);
    ctx.drawImage(content.canvas, left, top);
    return { canvas: out, x: minX, y: minY };
  }

  private async imageContent(layer: ImageLayer, s: number): Promise<{ canvas: AnyCanvas; ox: number; oy: number; w: number; h: number } | null> {
    const img = await this.loader.image(layer.src);
    this.natural.set(layer.src, { width: img.width, height: img.height });
    const { w: bw, h: bh } = imageBoxSize(layer, { width: img.width, height: img.height });
    const w = Math.max(1, Math.round(bw * s));
    const h = Math.max(1, Math.round(bh * s));
    const crop = layer.crop ?? { x: 0, y: 0, width: img.width, height: img.height };
    const c = createCanvas(w, h);
    const ctx = ctx2d(c);
    const fit = layer.fit ?? "fill";
    const [fxp, fyp] = layer.focus ?? [0.5, 0.5];
    if (fit === "fill") ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
    else if (fit === "cover") {
      const k = Math.max(w / crop.width, h / crop.height);
      const sw = w / k;
      const sh = h / k;
      ctx.drawImage(img, crop.x + (crop.width - sw) * fxp, crop.y + (crop.height - sh) * fyp, sw, sh, 0, 0, w, h);
    } else {
      const k = Math.min(w / crop.width, h / crop.height);
      const dw = crop.width * k;
      const dh = crop.height * k;
      ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, (w - dw) * fxp, (h - dh) * fyp, dw, dh);
    }
    return { canvas: c, ox: 0, oy: 0, w, h };
  }

  async family(layer: TextLayer): Promise<string> {
    const id = layer.font ?? "inter";
    const def = fontDef(id);
    if (def && this.loader.font) {
      const fam = await this.loader.font(id, layer.weight ?? 400, !!layer.italic).catch(() => null);
      if (fam) return fam;
    }
    return def ? def.family : id;
  }

  // ─── masks ────────────────────────────────────────────────────────────

  // Mask alpha plane (w × h, 0..255) in layer space (box layers) or canvas space.
  private maskPlane(mask: Mask, w: number, h: number, s: number, layer: Layer | null): Uint8ClampedArray | Promise<Uint8ClampedArray> {
    const finish = (a: Uint8ClampedArray) => {
      if (mask.feather) blurAlpha(a, w, h, mask.feather * s);
      const density = clamp01(mask.density ?? 1);
      for (let i = 0; i < a.length; i++) {
        let v = mask.invert ? 255 - a[i] : a[i];
        if (density < 1) v = 255 - (255 - v) * density;
        a[i] = v;
      }
      return a;
    };
    if (isImageMask(mask)) {
      return this.loader.image(mask.src).then((img) => {
        const c = createCanvas(w, h);
        ctx2d(c).drawImage(img, 0, 0, w, h);
        return finish(lumAlpha(c));
      });
    }
    const c = createCanvas(w, h);
    const ctx = ctx2d(c);
    if (isShapeMask(mask)) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      const x = mask.x * s;
      const y = mask.y * s;
      const mw = mask.width * s;
      const mh = mask.height * s;
      if (mask.shape === "ellipse") ctx.ellipse(x + mw / 2, y + mh / 2, Math.max(0, mw / 2), Math.max(0, mh / 2), 0, 0, Math.PI * 2);
      else roundRect(ctx, x, y, mw, mh, (mask.radius ?? 0) * s);
      ctx.fill();
    } else if (isGradientMask(mask)) {
      ctx.fillStyle = fillStyle(ctx, mask.gradient, { x: 0, y: 0, w, h });
      ctx.fillRect(0, 0, w, h);
    }
    void layer;
    return finish(lumAlpha(c));
  }

  private async maskCanvasSpace(c: AnyCanvas, mask: Mask, _doc: PhotoDoc, s: number): Promise<AnyCanvas> {
    if ((mask as { enabled?: boolean }).enabled === false) return c;
    const plane = await this.maskPlane(mask, c.width, c.height, s, null);
    applyAlphaMask(c, plane);
    return c;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function includesOnly(l: Layer, only: ReadonlySet<string>): boolean {
  if (only.has(l.id)) return true;
  return l.type === "group" && (l.children ?? []).some((c) => includesOnly(c, only));
}

// Box size of an image layer in document px (explicit, natural, or crop).
export function imageBoxSize(l: ImageLayer, nat: { width: number; height: number } | null): { w: number; h: number } {
  const src = l.crop ? { width: l.crop.width, height: l.crop.height } : nat ?? { width: l.width ?? 1, height: l.height ?? 1 };
  if (l.width !== undefined && l.height !== undefined) return { w: l.width, h: l.height };
  if (l.width !== undefined) return { w: l.width, h: (l.width * src.height) / src.width };
  if (l.height !== undefined) return { w: (l.height * src.width) / src.height, h: l.height };
  return { w: src.width, h: src.height };
}

function filterCanvas(c: AnyCanvas, filters: Layer["filters"], s: number): void {
  if (!filters?.some((f) => f && f.enabled !== false)) return;
  const p = readPixels(c);
  runFilters(p, filters, { scale: s });
  writePixels(c, p);
}

// Luminance × alpha of a canvas → 0..255 plane.
function lumAlpha(c: AnyCanvas): Uint8ClampedArray {
  const d = readPixels(c).data;
  const a = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < a.length; i++, j += 4) a[i] = ((0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) * d[j + 3]) / 255;
  return a;
}

function applyAlphaMask(c: AnyCanvas, plane: Uint8ClampedArray): void {
  const p = readPixels(c);
  const d = p.data;
  for (let i = 0, j = 3; i < plane.length; i++, j += 4) d[j] = (d[j] * plane[i]) / 255;
  writePixels(c, p);
}

// Keeps `surf` only where `base` is opaque (clipping mask).
function clipTo(surf: Surface, base: Surface): Surface {
  const c = createCanvas(surf.canvas.width, surf.canvas.height);
  const ctx = ctx2d(c);
  ctx.drawImage(surf.canvas, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(base.canvas, base.x - surf.x, base.y - surf.y);
  return { canvas: c, x: surf.x, y: surf.y };
}

function shapeContent(l: ShapeLayer, s: number): { canvas: AnyCanvas; ox: number; oy: number; w: number; h: number } {
  const w = Math.max(0, (l.width ?? 0) * s);
  const h = Math.max(0, (l.height ?? 0) * s);
  const sw = l.stroke ? (l.stroke.width ?? 4) * s : l.shape === "line" ? 4 * s : 0;
  const pad = Math.ceil(sw / 2 + 2);
  const c = createCanvas(Math.max(1, w + pad * 2), Math.max(1, h + pad * 2));
  const ctx = ctx2d(c);
  const box: Box = { x: pad, y: pad, w, h };
  ctx.beginPath();
  shapePath(ctx, l, box, s);
  if (l.shape !== "line") {
    if (l.fill !== null) {
      ctx.fillStyle = fillStyle(ctx, l.fill, box, "#ffffff");
      ctx.fill();
    }
  }
  if (l.stroke || l.shape === "line") {
    ctx.lineWidth = sw;
    ctx.strokeStyle = l.stroke?.color ?? "#ffffff";
    ctx.lineJoin = "round";
    ctx.lineCap = l.shape === "line" ? "round" : "butt";
    if (l.stroke?.dash?.length) ctx.setLineDash(l.stroke.dash.map((d) => d * s));
    ctx.stroke();
  }
  return { canvas: c, ox: pad, oy: pad, w: Math.max(w, 1), h: Math.max(h, 1) };
}

function shapePath(ctx: Ctx, l: ShapeLayer, b: Box, s: number): void {
  const { x, y, w, h } = b;
  switch (l.shape) {
    case "ellipse":
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case "line":
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      break;
    case "polygon":
    case "star": {
      const n = Math.max(3, Math.round(l.sides ?? (l.shape === "star" ? 5 : 6)));
      const inner = l.shape === "star" ? (l.innerRadius ?? 0.5) : 1;
      const pts = l.shape === "star" ? n * 2 : n;
      for (let k = 0; k < pts; k++) {
        const r = l.shape === "star" && k % 2 ? inner : 1;
        const a = -Math.PI / 2 + (k / pts) * Math.PI * 2;
        const px = x + w / 2 + Math.cos(a) * (w / 2) * r;
        const py = y + h / 2 + Math.sin(a) * (h / 2) * r;
        if (k) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      break;
    }
    default:
      roundRect(ctx, x, y, w, h, (l.radius ?? 0) * s);
  }
}
