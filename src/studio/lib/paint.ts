// Paint helpers (pure, tested): colour conversions for the HSV picker, CSS
// previews of document paints, gradient stop editing.

import { parseColor, toHex, type Rgba } from "../../core/color";
import type { ColorStop, Gradient, Paint } from "../../core/types";

export interface Hsva {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
  a: number; // 0..1
}

export function rgbToHsv({ r, g, b, a }: Rgba): Hsva {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max, a: a ?? 1 };
}

export function hsvToRgb({ h, s, v, a }: Hsva): Rgba {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255), a };
}

// #rrggbb, or #rrggbbaa when not opaque.
export function formatColor(c: Rgba): string {
  const hex = toHex(c);
  const a = c.a ?? 1;
  return a >= 1 ? hex : `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0")}`;
}

export function colorToHsv(color: string, fallback = "#000000"): Hsva {
  return rgbToHsv(parseColor(color) ?? parseColor(fallback)!);
}

export function hsvToColor(c: Hsva): string {
  return formatColor(hsvToRgb(c));
}

export type PaintKind = "solid" | "linear" | "radial";

export const paintKind = (p: Paint | null | undefined): PaintKind => (p && typeof p === "object" ? p.type : "solid");

// Stops as [offset, colour] pairs (bare colour lists are spread evenly).
export function stopsOf(g: Gradient): ColorStop[] {
  const list = Array.isArray(g.stops) && g.stops.length ? g.stops : ["#000000", "#ffffff"];
  const n = list.length;
  return list.map((s, i) => (Array.isArray(s) ? [Math.min(1, Math.max(0, Number(s[0]) || 0)), String(s[1])] : [n === 1 ? 0 : i / (n - 1), String(s)])) as ColorStop[];
}

export function sortStops(stops: ColorStop[]): ColorStop[] {
  return [...stops].sort((a, b) => a[0] - b[0]);
}

// Colour of a gradient at offset t (new stops take the colour under the click).
export function colorAt(stops: ColorStop[], t: number): string {
  const s = sortStops(stops);
  if (!s.length) return "#000000";
  if (t <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i][0]) {
      const a = parseColor(s[i - 1][1]) ?? { r: 0, g: 0, b: 0, a: 1 };
      const b = parseColor(s[i][1]) ?? { r: 0, g: 0, b: 0, a: 1 };
      const k = (t - s[i - 1][0]) / Math.max(1e-6, s[i][0] - s[i - 1][0]);
      return formatColor({ r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k, a: (a.a ?? 1) + ((b.a ?? 1) - (a.a ?? 1)) * k });
    }
  }
  return s[s.length - 1][1];
}

// Representative solid colour of a paint (swatches, inline text editing).
export function paintColor(p: Paint | null | undefined, fallback = "#000000"): string {
  if (!p) return fallback;
  if (typeof p === "string") return p;
  return stopsOf(p)[0]?.[1] ?? fallback;
}

// CSS background for previews. Document angle 0 = left → right, 90 = top → bottom.
export function paintToCss(p: Paint | null | undefined): string {
  if (!p) return "transparent";
  if (typeof p === "string") return p;
  const stops = sortStops(stopsOf(p))
    .map(([o, c]) => `${c} ${Math.round(o * 1000) / 10}%`)
    .join(", ");
  if (p.type === "radial") return `radial-gradient(circle at ${(p.cx ?? 0.5) * 100}% ${(p.cy ?? 0.5) * 100}%, ${stops})`;
  return `linear-gradient(${(p.angle ?? 90) + 90}deg, ${stops})`;
}

// Switch a paint to another kind, keeping its colours.
export function convertPaint(p: Paint | null | undefined, kind: PaintKind, fallback = "#ffffff"): Paint {
  const base = paintColor(p, fallback);
  if (kind === "solid") return base;
  const stops: ColorStop[] = p && typeof p === "object" ? stopsOf(p) : [
    [0, base],
    [1, "#000000"],
  ];
  if (kind === "linear") return { type: "linear", angle: p && typeof p === "object" && p.type === "linear" ? (p.angle ?? 90) : 90, stops };
  return { type: "radial", cx: 0.5, cy: 0.5, radius: 1, stops };
}
