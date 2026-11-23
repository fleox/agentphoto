// Paint (CSS colour or gradient) → canvas fillStyle over a box.

import type { Gradient, Paint } from "../core/types";
import type { Ctx } from "./canvas";

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

export function fillStyle(ctx: Ctx, paint: Paint | null | undefined, box: Box, fallback = "#ffffff"): string | CanvasGradient {
  if (paint === undefined || paint === null) return fallback;
  if (typeof paint === "string") return paint;
  let g: CanvasGradient;
  if (paint.type === "radial") {
    const cx = box.x + (paint.cx ?? 0.5) * box.w;
    const cy = box.y + (paint.cy ?? 0.5) * box.h;
    const r = Math.max(0.5, (paint.radius ?? 1) * Math.hypot(box.w, box.h) * 0.5);
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  } else {
    const a = ((paint.angle ?? 90) * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const half = Math.abs((box.w / 2) * dx) + Math.abs((box.h / 2) * dy);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  }
  for (const [o, c] of normStops(paint.stops)) {
    try {
      g.addColorStop(o, c);
    } catch {
      /* invalid colour: validation reports it */
    }
  }
  return g;
}
