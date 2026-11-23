// Canvas plumbing shared by the engine: works with OffscreenCanvas (workers,
// headless) and <canvas> alike.

import type { Pixels } from "./filters/pixels";

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Drawable = CanvasImageSource & { width: number; height: number };

// A rendered layer: a canvas placed at (x, y) in output pixels.
export interface Surface {
  canvas: AnyCanvas;
  x: number;
  y: number;
}

export const MAX_SIDE = 16384;

export function createCanvas(width: number, height: number): AnyCanvas {
  const w = Math.max(1, Math.min(MAX_SIDE, Math.ceil(width)));
  const h = Math.max(1, Math.min(MAX_SIDE, Math.ceil(height)));
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: AnyCanvas, opts?: CanvasRenderingContext2DSettings): Ctx {
  const ctx = (c as HTMLCanvasElement).getContext("2d", { willReadFrequently: false, ...opts }) as Ctx | null;
  if (!ctx) throw new Error("Canvas 2D is not available.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

export function readPixels(c: AnyCanvas): Pixels {
  const img = ctx2d(c).getImageData(0, 0, c.width, c.height);
  return { data: img.data, width: img.width, height: img.height };
}

export function writePixels(c: AnyCanvas, p: Pixels): void {
  const ctx = ctx2d(c);
  ctx.putImageData(new ImageData(p.data as unknown as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
}

export function cloneCanvas(src: AnyCanvas): AnyCanvas {
  const c = createCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

// Canvas composite operation for a document blend mode.
export function compositeOp(blend: string | undefined): GlobalCompositeOperation {
  return !blend || blend === "normal" ? "source-over" : (blend as GlobalCompositeOperation);
}

// Copy of `src` tinted with one colour (alpha kept) — silhouettes for effects.
export function tinted(src: AnyCanvas, color: string): AnyCanvas {
  const c = createCanvas(src.width, src.height);
  const ctx = ctx2d(c);
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

// Alpha-only operations through an 8-bit plane.
export function alphaPlane(c: AnyCanvas): Uint8ClampedArray {
  const d = readPixels(c).data;
  const a = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 3; i < a.length; i++, j += 4) a[i] = d[j];
  return a;
}

export function canvasFromAlpha(alpha: Uint8ClampedArray, w: number, h: number, rgb: [number, number, number] = [255, 255, 255]): AnyCanvas {
  const c = createCanvas(w, h);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < alpha.length; i++, j += 4) {
    data[j] = rgb[0];
    data[j + 1] = rgb[1];
    data[j + 2] = rgb[2];
    data[j + 3] = alpha[i];
  }
  writePixels(c, { data, width: w, height: h });
  return c;
}

// Encodes a canvas (PNG / JPEG / WebP / AVIF). Resolves the blob the browser
// really produced: an unsupported type falls back to PNG (check blob.type).
export async function canvasToBlob(c: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  const q = quality === undefined ? undefined : Math.max(0.01, Math.min(1, quality));
  if ("convertToBlob" in c) return (c as OffscreenCanvas).convertToBlob({ type, quality: q });
  return new Promise((resolve, reject) => (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed."))), type, q));
}
