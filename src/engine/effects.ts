// Layer effects (layer styles) on a canvas-space surface: drop shadow, outer
// glow, stroke, inner shadow, colour overlay. Distances are document px × scale.

import type { LayerEffects } from "../core/types";
import { alphaPlane, canvasFromAlpha, compositeOp, createCanvas, ctx2d, tinted, type AnyCanvas, type Surface } from "./canvas";
import { blurAlpha } from "./filters/pixels";

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

// How far effects reach outside the layer's pixels (output px).
export function effectsPad(fx: LayerEffects | undefined, scale: number): number {
  if (!fx) return 0;
  let p = 0;
  if (fx.dropShadow) p = Math.max(p, (num(fx.dropShadow.distance, 12) + num(fx.dropShadow.blur, 16) * 1.5 + num(fx.dropShadow.spread, 0)) * scale);
  if (fx.outerGlow) p = Math.max(p, (num(fx.outerGlow.blur, 20) * 1.5 + num(fx.outerGlow.spread, 0)) * scale);
  if (fx.stroke && (fx.stroke.position ?? "outside") !== "inside") p = Math.max(p, num(fx.stroke.width, 6) * scale);
  return Math.ceil(p) + (p ? 2 : 0);
}

export const hasEffects = (fx: LayerEffects | undefined): boolean => !!fx && Object.values(fx).some(Boolean);

// Grows the alpha by r px (circular): stamps the silhouette around rings.
export function dilate(src: AnyCanvas, r: number): AnyCanvas {
  const c = createCanvas(src.width, src.height);
  const ctx = ctx2d(c);
  ctx.drawImage(src, 0, 0);
  if (r < 0.5) return c;
  const rings = Math.min(8, Math.max(1, Math.ceil(r / 3)));
  for (let k = 1; k <= rings; k++) {
    const rr = (r * k) / rings;
    const steps = Math.min(48, Math.max(8, Math.ceil(rr * 1.5)));
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      ctx.drawImage(src, Math.cos(a) * rr, Math.sin(a) * rr);
    }
  }
  return c;
}

// Opaque where src is transparent (inside the surface rect).
function inverse(src: AnyCanvas): AnyCanvas {
  const c = createCanvas(src.width, src.height);
  const ctx = ctx2d(c);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(src, 0, 0);
  return c;
}

function blurred(src: AnyCanvas, radius: number, color: string): AnyCanvas {
  if (radius < 0.5) return tinted(src, color);
  const a = alphaPlane(src);
  blurAlpha(a, src.width, src.height, radius);
  const c = canvasFromAlpha(a, src.width, src.height);
  return tinted(c, color);
}

// Returns a new surface (same position) with the effects drawn.
export function applyEffects(s: Surface, fx: LayerEffects, scale: number): Surface {
  const src = s.canvas;
  const W = src.width;
  const H = src.height;
  const out = createCanvas(W, H);
  const ctx = ctx2d(out);

  // Behind the layer
  if (fx.dropShadow) {
    const d = fx.dropShadow;
    const spread = num(d.spread, 0) * scale;
    const base = spread ? dilate(src, spread) : src;
    const sh = blurred(base, num(d.blur, 16) * scale, d.color ?? "#000000");
    const a = (num(d.angle, 135) * Math.PI) / 180;
    const dist = num(d.distance, 12) * scale;
    ctx.globalAlpha = num(d.opacity, 0.5);
    ctx.drawImage(sh, -Math.cos(a) * dist, Math.sin(a) * dist);
    ctx.globalAlpha = 1;
  }
  if (fx.outerGlow) {
    const g = fx.outerGlow;
    const spread = num(g.spread, 0) * scale;
    const base = spread ? dilate(src, spread) : src;
    const gl = blurred(base, num(g.blur, 20) * scale, g.color ?? "#ffffff");
    ctx.globalAlpha = num(g.opacity, 0.6);
    ctx.drawImage(gl, 0, 0);
    // Twice for a denser core, like a real glow.
    ctx.globalAlpha = num(g.opacity, 0.6) * 0.5;
    ctx.drawImage(gl, 0, 0);
    ctx.globalAlpha = 1;
  }
  const st = fx.stroke;
  const stWidth = st ? num(st.width, 6) * scale : 0;
  const stPos = st?.position ?? "outside";
  if (st && stWidth > 0 && stPos !== "inside") {
    const r = stPos === "center" ? stWidth / 2 : stWidth;
    ctx.globalAlpha = num(st.opacity, 1);
    ctx.drawImage(tinted(dilate(src, r), st.color ?? "#ffffff"), 0, 0);
    ctx.globalAlpha = 1;
  }

  // The layer itself (+ overlays clipped to it)
  const body = createCanvas(W, H);
  const bctx = ctx2d(body);
  bctx.drawImage(src, 0, 0);
  if (fx.colorOverlay) {
    const o = fx.colorOverlay;
    const tint = tinted(src, o.color ?? "#ffffff");
    bctx.globalAlpha = num(o.opacity, 1);
    bctx.globalCompositeOperation = compositeOp(o.blend);
    bctx.drawImage(tint, 0, 0);
    bctx.globalAlpha = 1;
    bctx.globalCompositeOperation = "destination-in";
    bctx.drawImage(src, 0, 0);
    bctx.globalCompositeOperation = "source-over";
  }
  if (fx.innerShadow) {
    const d = fx.innerShadow;
    const inv = blurred(inverse(src), num(d.blur, 10) * scale, d.color ?? "#000000");
    const a = (num(d.angle, 135) * Math.PI) / 180;
    const dist = num(d.distance, 6) * scale;
    const layer = createCanvas(W, H);
    const lctx = ctx2d(layer);
    lctx.drawImage(inv, -Math.cos(a) * dist, Math.sin(a) * dist);
    lctx.globalCompositeOperation = "destination-in";
    lctx.drawImage(src, 0, 0);
    bctx.globalAlpha = num(d.opacity, 0.5);
    bctx.drawImage(layer, 0, 0);
    bctx.globalAlpha = 1;
  }
  if (st && stWidth > 0 && stPos !== "outside") {
    const r = stPos === "center" ? stWidth / 2 : stWidth;
    // Ring inside the edge: src minus src eroded by r.
    const eroded = inverse(dilate(inverse(src), r));
    const ring = tinted(src, st.color ?? "#ffffff");
    const rctx = ctx2d(ring);
    rctx.globalCompositeOperation = "destination-out";
    rctx.drawImage(eroded, 0, 0);
    bctx.globalAlpha = num(st.opacity, 1);
    bctx.drawImage(ring, 0, 0);
    bctx.globalAlpha = 1;
  }
  ctx.drawImage(body, 0, 0);
  return { canvas: out, x: s.x, y: s.y };
}
