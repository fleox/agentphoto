// Image analysis for agents: exposure, contrast, colour cast, saturation,
// sharpness, dominant colours — and plain-language suggestions mapped to
// catalog filters. Pure over RGBA pixels.

import { toHex } from "../core/color";
import { histogram, luma, percentiles, type Pixels } from "./filters/pixels";

export interface ImageStats {
  width: number;
  height: number;
  // Share of pixels that are (partly) transparent, %.
  transparent: number;
  brightness: number; // mean luminance 0..255
  contrast: number; // luminance std-dev 0..128
  range: [number, number]; // 1 %–99 % luminance
  clippedShadows: number; // % pixels at ≤ 2
  clippedHighlights: number; // % pixels at ≥ 253
  saturation: number; // mean 0..100
  // Average colour cast: + = warm / magenta.
  cast: { warm: number; magenta: number };
  // Laplacian variance (higher = sharper); < 60 looks soft at this size.
  sharpness: number;
  dominant: { color: string; share: number }[];
  suggestions: { issue: string; filter: Record<string, unknown> }[];
}

export function analyzePixels(p: Pixels): ImageStats {
  const { data: d, width: w, height: h } = p;
  const hist = histogram(p);
  const n = Math.max(1, hist.count);
  let sum = 0;
  let sum2 = 0;
  let sat = 0;
  let rb = 0;
  let gm = 0;
  let transparent = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 250) transparent++;
    if (d[i + 3] < 8) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const l = luma(r, g, b);
    sum += l;
    sum2 += l * l;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    sat += max ? (max - min) / max : 0;
    rb += r - b;
    gm += (r + b) / 2 - g;
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const [lo, hi] = percentiles(hist.l, n, 1);
  let low = 0;
  let high = 0;
  for (let v = 0; v <= 2; v++) low += hist.l[v];
  for (let v = 253; v <= 255; v++) high += hist.l[v];
  // Sharpness: variance of the Laplacian on a subsample.
  let lap = 0;
  let lapN = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 250000)));
  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      const L = (xx: number, yy: number) => {
        const i = (yy * w + xx) * 4;
        return luma(d[i], d[i + 1], d[i + 2]);
      };
      const v = 4 * L(x, y) - L(x - 1, y) - L(x + 1, y) - L(x, y - 1) - L(x, y + 1);
      lap += v * v;
      lapN++;
    }
  }
  const stats: ImageStats = {
    width: w,
    height: h,
    transparent: round((transparent / (w * h)) * 100),
    brightness: round(mean),
    contrast: round(std),
    range: [lo, hi],
    clippedShadows: round((low / n) * 100),
    clippedHighlights: round((high / n) * 100),
    saturation: round((sat / n) * 100),
    cast: { warm: round(rb / n), magenta: round(gm / n) },
    sharpness: round(lapN ? lap / lapN : 0),
    dominant: dominantColors(p, 5),
    suggestions: [],
  };
  stats.suggestions = suggest(stats);
  return stats;
}

const round = (v: number) => Math.round(v * 10) / 10;

function dominantColors(p: Pixels, k: number): { color: string; share: number }[] {
  // 4-bit-per-channel buckets, then the k biggest (merged when close).
  const d = p.data;
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  const step = Math.max(1, Math.floor((p.width * p.height) / 120000)) * 4;
  let total = 0;
  for (let i = 0; i < d.length; i += step) {
    if (d[i + 3] < 128) continue;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const bk = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bk.r += d[i];
    bk.g += d[i + 1];
    bk.b += d[i + 2];
    bk.n++;
    buckets.set(key, bk);
    total++;
  }
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
  const out: { r: number; g: number; b: number; n: number }[] = [];
  for (const bk of sorted) {
    const c = { r: bk.r / bk.n, g: bk.g / bk.n, b: bk.b / bk.n, n: bk.n };
    const near = out.find((o) => Math.abs(o.r - c.r) + Math.abs(o.g - c.g) + Math.abs(o.b - c.b) < 60);
    if (near) near.n += c.n;
    else if (out.length < k) out.push(c);
  }
  return out.sort((a, b) => b.n - a.n).map((c) => ({ color: toHex({ r: c.r, g: c.g, b: c.b, a: 1 }), share: round((c.n / Math.max(1, total)) * 100) }));
}

function suggest(s: ImageStats): { issue: string; filter: Record<string, unknown> }[] {
  const out: { issue: string; filter: Record<string, unknown> }[] = [];
  if (s.brightness < 85) out.push({ issue: `Underexposed (mean brightness ${s.brightness}/255).`, filter: { type: "exposure", exposure: round(Math.min(1.5, (110 - s.brightness) / 45)) } });
  else if (s.brightness > 185) out.push({ issue: `Overexposed (mean brightness ${s.brightness}/255).`, filter: { type: "exposure", exposure: round(-Math.min(1.2, (s.brightness - 160) / 50)) } });
  if (s.range[0] > 25 || s.range[1] < 230) out.push({ issue: `Flat / hazy: tones only span ${s.range[0]}–${s.range[1]}.`, filter: { type: "autoContrast" } });
  else if (s.contrast < 40) out.push({ issue: `Low contrast (std-dev ${s.contrast}).`, filter: { type: "curves", rgb: [[0, 0], [64, 52], [192, 206], [255, 255]] } });
  if (s.clippedShadows > 8) out.push({ issue: `${s.clippedShadows} % of the picture is crushed black.`, filter: { type: "shadowsHighlights", shadows: 40 } });
  if (s.clippedHighlights > 8) out.push({ issue: `${s.clippedHighlights} % of the picture is blown out.`, filter: { type: "shadowsHighlights", shadows: 0, highlights: 40 } });
  if (Math.abs(s.cast.warm) > 18) out.push({ issue: `${s.cast.warm > 0 ? "Warm / orange" : "Cool / blue"} colour cast.`, filter: { type: "temperature", temperature: round(Math.max(-60, Math.min(60, -s.cast.warm * 0.8))) } });
  if (Math.abs(s.cast.magenta) > 12) out.push({ issue: `${s.cast.magenta > 0 ? "Magenta" : "Green"} tint.`, filter: { type: "temperature", tint: round(Math.max(-60, Math.min(60, -s.cast.magenta * 1.2))) } });
  if (s.saturation < 18 && s.contrast > 10) out.push({ issue: `Muted colours (saturation ${s.saturation}).`, filter: { type: "vibrance", vibrance: 35 } });
  if (s.sharpness < 60) out.push({ issue: `Soft image (sharpness ${s.sharpness}).`, filter: { type: "sharpen", amount: 90, radius: 1.2 } });
  return out;
}
