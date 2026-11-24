// Paint (CSS colour or gradient) → canvas fillStyle over a box.

import type { Gradient, Paint } from "../core/types";
import { createCanvas, ctx2d, type Ctx } from "./canvas";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function normStops(stops: Gradient["stops"]): [number, string][] {
  const list = Array.isArray(stops) && stops.length ? stops : ["#000", "#fff"];
  const n = list.length;
  return list.map((s, i) => (Array.isArray(s) ? [Math.min(1, Math.max(0, Number(s[0]) || 0)), String(s[1])] : [n === 1 ? 0 : i / (n - 1), String(s)])) as [number, string][];
}

export function fillStyle(ctx: Ctx, paint: Paint | null | undefined, box: Box, fallback = "#ffffff"): string | CanvasGradient | CanvasPattern {
  if (paint === undefined || paint === null) return fallback;
  if (typeof paint === "string") return paint;
  if (paint.type === "radial") {
    const cx = box.x + (paint.cx ?? 0.5) * box.w;
    const cy = box.y + (paint.cy ?? 0.5) * box.h;
    // Elliptical, following the box: radius 1 reaches the corners (half-axes
    // w/√2 and h/√2). On a square box this is the plain circle of radius
    // diagonal / 2, drawn as a gradient as it always was.
    const k = (paint.radius ?? 1) / Math.SQRT2;
    const rx = Math.max(0.5, k * box.w);
    const ry = Math.max(0.5, k * box.h);
    if (box.w === box.h || Math.abs(rx - ry) < 0.5) {
      const r = Math.max(0.5, (paint.radius ?? 1) * Math.hypot(box.w, box.h) * 0.5);
      return withStops(ctx.createRadialGradient(cx, cy, 0, cx, cy, r), paint.stops);
    }
    return ellipticalRadial(ctx, cx, cy, rx, ry, paint.stops);
  }
  const a = ((paint.angle ?? 90) * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const half = Math.abs((box.w / 2) * dx) + Math.abs((box.h / 2) * dy);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return withStops(ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half), paint.stops);
}

function withStops(g: CanvasGradient, stops: Gradient["stops"]): CanvasGradient {
  for (const [o, c] of normStops(stops)) {
    try {
      g.addColorStop(o, c);
    } catch {
      /* invalid colour: validation reports it */
    }
  }
  return g;
}

// A circular gradient squashed into an ellipse (rx × ry around cx, cy). A
// gradient lives in the context's transform at fill time, so it is painted
// once over the whole target canvas and returned as a pattern (the caller
// fills with the identity transform, like every engine caller does).
function ellipticalRadial(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, stops: Gradient["stops"]): CanvasPattern | CanvasGradient {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const pc = createCanvas(W, H);
  const pctx = ctx2d(pc);
  const ky = ry / rx;
  pctx.setTransform(1, 0, 0, ky, cx, cy);
  pctx.fillStyle = withStops(pctx.createRadialGradient(0, 0, 0, 0, 0, rx), stops);
  pctx.fillRect(-cx, -cy / ky, W, H / ky);
  return ctx.createPattern(pc, "no-repeat") ?? withStops(ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry)), stops);
}
