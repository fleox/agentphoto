// Layer masks as pixels (layer space), for painting on a mask and for
// selection actions that combine with an existing mask. Mirrors the
// compositor's mask plane (luminance × alpha, invert applied; feather and
// density stay mask properties).

import type { Mask } from "../../core/types";
import { isGradientMask, isImageMask, isShapeMask } from "../../core/types";
import { createCanvas, ctx2d, type AnyCanvas } from "../../engine";
import type { AssetLoader } from "../../engine";
import { fillStyle } from "../../engine/paint";
import { roundRect } from "../../engine/text";

export function lumAlpha(c: AnyCanvas): Uint8ClampedArray {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  const out = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (((d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114) * d[j + 3]) / 255) | 0;
  return out;
}

// The visible part of `mask` (255 = shown) on a w × h plane covering a frame
// of frameW × frameH document px (the layer box, or the canvas). null = all shown.
export async function maskPlane(loader: AssetLoader, mask: Mask | null | undefined, w: number, h: number, frameW: number, frameH: number): Promise<Uint8ClampedArray> {
  if (!mask) return new Uint8ClampedArray(w * h).fill(255);
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  if (isImageMask(mask)) {
    const img = await loader.image(mask.src);
    ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  } else if (isShapeMask(mask)) {
    const sx = w / frameW;
    const sy = h / frameH;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    if (mask.shape === "ellipse") ctx.ellipse((mask.x + mask.width / 2) * sx, (mask.y + mask.height / 2) * sy, Math.max(0, (mask.width / 2) * sx), Math.max(0, (mask.height / 2) * sy), 0, 0, Math.PI * 2);
    else roundRect(ctx, mask.x * sx, mask.y * sy, mask.width * sx, mask.height * sy, (mask.radius ?? 0) * sx);
    ctx.fill();
  } else if (isGradientMask(mask)) {
    ctx.fillStyle = fillStyle(ctx, mask.gradient, { x: 0, y: 0, w, h });
    ctx.fillRect(0, 0, w, h);
  }
  const a = lumAlpha(c);
  if (mask.invert) for (let i = 0; i < a.length; i++) a[i] = 255 - a[i];
  return a;
}

// A grey plane as an opaque RGBA canvas (painting buffers for masks).
export function planeToCanvas(a: Uint8ClampedArray, w: number, h: number): AnyCanvas {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(w, h);
  for (let i = 0, j = 0; i < a.length; i++, j += 4) {
    img.data[j] = img.data[j + 1] = img.data[j + 2] = a[i];
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
