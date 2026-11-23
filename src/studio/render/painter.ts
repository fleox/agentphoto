// The painting engine of the brush / eraser / clone tools: round dabs
// (hardness, flow) accumulated into a stroke coverage buffer, composited over
// the layer's pixels (raster in layer space) with the stroke opacity, clipped
// by the pixel selection. Only the dirty rectangle is recomposited per frame.

import { createCanvas, ctx2d, type AnyCanvas } from "../../engine";

export type PaintMode = "paint" | "erase" | "clone";

export interface BrushDab {
  // Radius in raster px.
  radius: number;
  hardness: number;
  opacity: number;
  flow: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Painter {
  readonly display: HTMLCanvasElement;
  private stroke: AnyCanvas;
  private sctx;
  private dirty: Rect | null = null;
  private last: { x: number; y: number } | null = null;
  private clip: AnyCanvas | null = null;
  readonly w: number;
  readonly h: number;

  constructor(
    private base: AnyCanvas,
    private mode: PaintMode,
    private brush: BrushDab,
    private color: string,
    clip?: Uint8ClampedArray | null,
    private cloneOffset: { dx: number; dy: number } = { dx: 0, dy: 0 },
  ) {
    this.w = base.width;
    this.h = base.height;
    this.display = document.createElement("canvas");
    this.display.width = this.w;
    this.display.height = this.h;
    ctx2d(this.display).drawImage(base as CanvasImageSource, 0, 0);
    this.stroke = createCanvas(this.w, this.h);
    this.sctx = ctx2d(this.stroke);
    if (clip) {
      const c = createCanvas(this.w, this.h);
      const ctx = ctx2d(c);
      const img = ctx.createImageData(this.w, this.h);
      for (let i = 0; i < clip.length; i++) {
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = clip[i];
      }
      ctx.putImageData(img, 0, 0);
      this.clip = c;
    }
  }

  private dab(x: number, y: number): void {
    const r = Math.max(0.5, this.brush.radius);
    const g = this.sctx.createRadialGradient(x, y, 0, x, y, r);
    const hard = Math.max(0, Math.min(0.999, this.brush.hardness));
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(hard, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    this.sctx.globalAlpha = Math.max(0.01, Math.min(1, this.brush.flow));
    this.sctx.fillStyle = g;
    this.sctx.beginPath();
    this.sctx.arc(x, y, r, 0, Math.PI * 2);
    this.sctx.fill();
    const d = { x0: Math.floor(x - r - 1), y0: Math.floor(y - r - 1), x1: Math.ceil(x + r + 1), y1: Math.ceil(y + r + 1) };
    this.dirty = this.dirty ? { x0: Math.min(this.dirty.x0, d.x0), y0: Math.min(this.dirty.y0, d.y0), x1: Math.max(this.dirty.x1, d.x1), y1: Math.max(this.dirty.y1, d.y1) } : d;
  }

  // Dabs from the last point to (x, y), spaced by a fraction of the radius.
  lineTo(x: number, y: number): void {
    if (!this.last) {
      this.dab(x, y);
      this.last = { x, y };
      return;
    }
    const step = Math.max(0.5, this.brush.radius * 0.18);
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    const len = Math.hypot(dx, dy);
    if (len < step) return;
    const n = Math.floor(len / step);
    for (let i = 1; i <= n; i++) this.dab(this.last.x + (dx * i * step) / len, this.last.y + (dy * i * step) / len);
    this.last = { x: this.last.x + (dx * n * step) / len, y: this.last.y + (dy * n * step) / len };
  }

  // Recomposites the dirty area into `display`; returns it (raster px) or null.
  flush(): { x: number; y: number; w: number; h: number } | null {
    const d = this.dirty;
    if (!d) return null;
    this.dirty = null;
    const x = Math.max(0, d.x0);
    const y = Math.max(0, d.y0);
    const w = Math.min(this.w, d.x1) - x;
    const h = Math.min(this.h, d.y1) - y;
    if (w <= 0 || h <= 0) return null;
    const tmp = createCanvas(w, h);
    const t = ctx2d(tmp);
    t.drawImage(this.stroke as CanvasImageSource, x, y, w, h, 0, 0, w, h);
    if (this.clip) {
      t.globalCompositeOperation = "destination-in";
      t.drawImage(this.clip as CanvasImageSource, x, y, w, h, 0, 0, w, h);
    }
    t.globalCompositeOperation = "source-in";
    if (this.mode === "clone") t.drawImage(this.base as CanvasImageSource, x + this.cloneOffset.dx, y + this.cloneOffset.dy, w, h, 0, 0, w, h);
    else if (this.mode === "paint") {
      t.fillStyle = this.color;
      t.fillRect(0, 0, w, h);
    }
    const out = ctx2d(this.display);
    out.save();
    out.clearRect(x, y, w, h);
    out.drawImage(this.base as CanvasImageSource, x, y, w, h, x, y, w, h);
    out.globalAlpha = Math.max(0, Math.min(1, this.brush.opacity));
    if (this.mode === "erase") out.globalCompositeOperation = "destination-out";
    out.drawImage(tmp as CanvasImageSource, x, y);
    out.restore();
    return { x, y, w, h };
  }
}

// Red "quick mask" tint of a grey mask canvas (hidden = tinted), for mask painting.
export function maskTint(src: HTMLCanvasElement, into: HTMLCanvasElement, r?: { x: number; y: number; w: number; h: number }): void {
  if (into.width !== src.width || into.height !== src.height) {
    into.width = src.width;
    into.height = src.height;
    r = undefined;
  }
  const area = r ?? { x: 0, y: 0, w: src.width, h: src.height };
  const d = ctx2d(src).getImageData(area.x, area.y, area.w, area.h);
  for (let i = 0; i < d.data.length; i += 4) {
    const hidden = 255 - d.data[i];
    d.data[i] = 255;
    d.data[i + 1] = 60;
    d.data[i + 2] = 80;
    d.data[i + 3] = hidden * 0.55;
  }
  ctx2d(into).putImageData(d, area.x, area.y);
}
