// The filter registry: one implementation per catalog filter id
// (src/core/catalog.ts FILTERS). registry.test.ts fails when they diverge.
// Filters mutate a straight-alpha RGBA buffer in place; `env.scale` scales
// distance params (preview at 50 % → blur radius / 2) so previews match exports.

import { FILTERS, filterDef } from "../../core/catalog";
import { parseColor } from "../../core/color";
import type { Filter } from "../../core/types";
import { LOOK_IMPLS } from "./looks";
import {
  applyLut,
  blurPlane,
  blurredLuma,
  clamp01,
  clamp255,
  copyPixels,
  curveLut,
  gaussianBlur,
  histogram,
  hslToRgb,
  lut,
  luma,
  mulberry32,
  percentiles,
  rgbToHsl,
  stretchLut,
  toLinear,
  toSrgb,
  type Pixels,
} from "./pixels";

export interface FilterEnv {
  scale: number;
}

type Params = Record<string, unknown>;
type Impl = (p: Pixels, params: Params, env: FilterEnv) => void;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const rgb3 = (v: unknown): [number, number, number] => (Array.isArray(v) && v.length === 3 ? [num(v[0], 0), num(v[1], 0), num(v[2], 0)] : [0, 0, 0]);
const color = (v: unknown, d: string) => parseColor(typeof v === "string" ? v : d) ?? parseColor(d)!;

function stopsLut(stops: unknown): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] {
  const list = (Array.isArray(stops) && stops.length >= 2 ? stops : ["#000", "#fff"]).map((s, i, a) => (Array.isArray(s) ? [num(s[0], i / (a.length - 1)), color(s[1], "#000")] : [i / (a.length - 1), color(s, "#000")])) as [number, ReturnType<typeof color>][];
  list.sort((a, b) => a[0] - b[0]);
  const R = new Uint8ClampedArray(256);
  const G = new Uint8ClampedArray(256);
  const B = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    let k = 0;
    while (k < list.length - 2 && t > list[k + 1][0]) k++;
    const [t0, c0] = list[k];
    const [t1, c1] = list[k + 1];
    const u = t1 > t0 ? clamp01((t - t0) / (t1 - t0)) : t >= t1 ? 1 : 0;
    R[v] = c0.r + (c1.r - c0.r) * u;
    G[v] = c0.g + (c1.g - c0.g) * u;
    B[v] = c0.b + (c1.b - c0.b) * u;
  }
  return [R, G, B];
}

// Keep the luminance of `before` (preserveLuminosity).
function keepLuma(d: Uint8ClampedArray, i: number, l0: number): void {
  const l1 = luma(d[i], d[i + 1], d[i + 2]);
  const k = l0 - l1;
  d[i] = clamp255(d[i] + k);
  d[i + 1] = clamp255(d[i + 1] + k);
  d[i + 2] = clamp255(d[i + 2] + k);
}

export const FILTER_IMPLS: Record<string, Impl> = {
  brightnessContrast(p, q) {
    const b = num(q.brightness, 0) / 100;
    const c = num(q.contrast, 0) / 100;
    // Brightness: lift / lower midtones without clipping (gamma-like curve); contrast: around mid-grey.
    const g = b >= 0 ? 1 / (1 + b * 1.2) : 1 - b * 1.2;
    const k = c >= 0 ? 1 / (1 - c * 0.85) : 1 + c * 0.85;
    applyLut(p, lut((v) => (255 * (v / 255) ** g - 128) * k + 128));
  },
  exposure(p, q) {
    const e = 2 ** num(q.exposure, 0);
    const off = num(q.offset, 0);
    const gm = num(q.gamma, 1);
    applyLut(p, lut((v) => 255 * toSrgb(clamp01(Math.max(0, toLinear(v / 255) * e + off) ** (1 / gm)))));
  },
  shadowsHighlights(p, q, env) {
    const s = num(q.shadows, 35) / 100;
    const h = num(q.highlights, 0) / 100;
    if (!s && !h) return;
    const L = blurredLuma(p, Math.max(1, num(q.radius, 30) * env.scale));
    const d = p.data;
    for (let i = 0, j = 0; j < L.length; i += 4, j++) {
      const lb = L[j];
      const ws = (1 - lb) ** 2;
      const wh = lb ** 2;
      for (let c = 0; c < 3; c++) {
        let v = d[i + c] / 255;
        v = v + s * ws * (1 - v) * v * 2.2; // lift dark values (keeps black at 0)
        v = v - h * wh * v * (1 - v) * 2.2; // pull down bright values (keeps white at 1)
        d[i + c] = v * 255;
      }
    }
  },
  levels(p, q) {
    const bp = num(q.black, 0);
    const wp = Math.max(bp + 1, num(q.white, 255));
    const g = num(q.gamma, 1);
    const ob = num(q.outBlack, 0);
    const ow = num(q.outWhite, 255);
    applyLut(p, lut((v) => ob + (ow - ob) * clamp01((v - bp) / (wp - bp)) ** (1 / g)));
  },
  curves(p, q) {
    const id = lut((v) => v);
    const master = Array.isArray(q.rgb) ? curveLut(q.rgb as [number, number][]) : id;
    const ch = (v: unknown) => (Array.isArray(v) ? curveLut(v as [number, number][]) : id);
    const [r, g, b] = [ch(q.red), ch(q.green), ch(q.blue)];
    applyLut(p, lut((v) => r[master[v]]), lut((v) => g[master[v]]), lut((v) => b[master[v]]));
  },
  hueSaturation(p, q) {
    const hue = num(q.hue, 0);
    const sat = num(q.saturation, 0) / 100;
    const light = num(q.lightness, 0) / 100;
    const colorize = bool(q.colorize, false);
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      if (colorize) {
        h = hue;
        s = clamp01(0.25 + sat * 0.75);
      } else {
        h += hue;
        s = sat >= 0 ? s + (1 - s) * sat * s : s * (1 + sat);
      }
      l = light >= 0 ? l + (1 - l) * light : l * (1 + light);
      const [r, g, b] = hslToRgb(h, clamp01(s), clamp01(l));
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
  },
  vibrance(p, q) {
    const v = num(q.vibrance, 30) / 100;
    const s = num(q.saturation, 0) / 100;
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const max = Math.max(r, g, b);
      const avg = (r + g + b) / 3;
      const sat = (max - Math.min(r, g, b)) / 255;
      // Muted colours get more; skin-ish (r > g > b) gets less.
      const skin = r > g && g > b ? 0.5 : 1;
      const k = 1 + s + v * (1 - sat) * skin * 1.4;
      const gray = luma(r, g, b);
      void avg;
      d[i] = clamp255(gray + (r - gray) * k);
      d[i + 1] = clamp255(gray + (g - gray) * k);
      d[i + 2] = clamp255(gray + (b - gray) * k);
    }
  },
  temperature(p, q) {
    const t = num(q.temperature, 0) / 100;
    const tint = num(q.tint, 0) / 100;
    // Multipliers in linear light (closer to a real white-balance change).
    const rk = 1 + t * 0.32 + tint * 0.06;
    const gk = 1 - tint * 0.22 + Math.abs(t) * 0.02;
    const bk = 1 - t * 0.36 + tint * 0.08;
    const mk = (k: number) => lut((v) => 255 * toSrgb(clamp01(toLinear(v / 255) * k)));
    applyLut(p, mk(rk), mk(gk), mk(bk));
  },
  colorBalance(p, q) {
    const S = rgb3(q.shadows);
    const M = rgb3(q.midtones);
    const H = rgb3(q.highlights);
    const keep = bool(q.preserveLuminosity, true);
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      const l0 = luma(d[i], d[i + 1], d[i + 2]);
      const l = l0 / 255;
      const ws = clamp01(1 - l * 2.2) * 0.8;
      const wm = clamp01(1 - Math.abs(l - 0.5) * 2.5) * 0.8;
      const wh = clamp01((l - 0.55) * 2.2) * 0.8;
      for (let c = 0; c < 3; c++) d[i + c] = clamp255(d[i + c] + (S[c] * ws + M[c] * wm + H[c] * wh) * 1.28);
      if (keep) keepLuma(d, i, l0);
    }
  },
  photoFilter(p, q) {
    const c = color(q.color, "#ec8a00");
    const k = clamp01(num(q.density, 25) / 100);
    const keep = bool(q.preserveLuminosity, true);
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      const l0 = luma(d[i], d[i + 1], d[i + 2]);
      // Multiply-like tint, then mix by density.
      d[i] = d[i] * (1 - k) + ((d[i] * c.r) / 255) * k + c.r * k * 0.25;
      d[i + 1] = d[i + 1] * (1 - k) + ((d[i + 1] * c.g) / 255) * k + c.g * k * 0.25;
      d[i + 2] = d[i + 2] * (1 - k) + ((d[i + 2] * c.b) / 255) * k + c.b * k * 0.25;
      if (keep) keepLuma(d, i, l0);
    }
  },
  gradientMap(p, q) {
    const [R, G, B] = stopsLut(q.stops);
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = Math.round(luma(d[i], d[i + 1], d[i + 2]));
      d[i] = R[l];
      d[i + 1] = G[l];
      d[i + 2] = B[l];
    }
  },
  grayscale(p, q) {
    let r = num(q.red, 30) / 100;
    let g = num(q.green, 59) / 100;
    let b = num(q.blue, 11) / 100;
    const sum = r + g + b;
    // Photoshop-style: weights don't have to sum to 1 (contrasty B&W), but keep it sane.
    if (Math.abs(sum) < 0.05) [r, g, b] = [0.3, 0.59, 0.11];
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = clamp255(d[i] * r + d[i + 1] * g + d[i + 2] * b);
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  },
  sepia(p, q) {
    const k = clamp01(num(q.intensity, 100) / 100);
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      d[i] = r + (clamp255(r * 0.393 + g * 0.769 + b * 0.189) - r) * k;
      d[i + 1] = g + (clamp255(r * 0.349 + g * 0.686 + b * 0.168) - g) * k;
      d[i + 2] = b + (clamp255(r * 0.272 + g * 0.534 + b * 0.131) - b) * k;
    }
  },
  invert(p) {
    applyLut(p, lut((v) => 255 - v));
  },
  threshold(p, q) {
    const t = num(q.level, 128);
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = luma(d[i], d[i + 1], d[i + 2]) >= t ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  },
  posterize(p, q) {
    const n = Math.max(2, Math.round(num(q.levels, 6)));
    const step = 255 / (n - 1);
    applyLut(p, lut((v) => Math.round(v / step) * step));
  },
  blur(p, q, env) {
    gaussianBlur(p, num(q.radius, 6) * env.scale);
  },
  motionBlur(p, q, env) {
    const dist = Math.round(num(q.distance, 20) * env.scale);
    if (dist < 1) return;
    const a = (num(q.angle, 0) * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const { data: s, width: w, height: h } = copyPixels(p);
    const d = p.data;
    const n = dist + 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let al = 0;
        for (let k = 0; k < n; k++) {
          const t = k - dist / 2;
          const sx = Math.min(w - 1, Math.max(0, Math.round(x + dx * t)));
          const sy = Math.min(h - 1, Math.max(0, Math.round(y + dy * t)));
          const j = (sy * w + sx) * 4;
          const A = s[j + 3];
          r += s[j] * A;
          g += s[j + 1] * A;
          b += s[j + 2] * A;
          al += A;
        }
        const i = (y * w + x) * 4;
        if (al > 0) {
          d[i] = r / al;
          d[i + 1] = g / al;
          d[i + 2] = b / al;
        }
        d[i + 3] = al / n;
      }
    }
  },
  surfaceBlur(p, q, env) {
    // Guided filter (He et al.) with each channel as its own guide: O(n), edge-preserving.
    const r = Math.max(1, Math.round(num(q.radius, 8) * env.scale));
    const t = num(q.threshold, 25) / 100;
    const eps = (t * t * 0.25) ** 1.2 + 1e-5;
    const { data: d, width: w, height: h } = p;
    const n = w * h;
    const I = new Float32Array(n);
    const II = new Float32Array(n);
    const boxMean = (src: Float32Array) => {
      const out = new Float32Array(src);
      blurPlane(out, w, h, r * 2);
      return out;
    };
    for (let c = 0; c < 3; c++) {
      for (let j = 0, i = c; j < n; j++, i += 4) {
        const v = d[i] / 255;
        I[j] = v;
        II[j] = v * v;
      }
      const mI = boxMean(I);
      const mII = boxMean(II);
      const A = new Float32Array(n);
      const B = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        const varI = mII[j] - mI[j] * mI[j];
        const a = varI / (varI + eps);
        A[j] = a;
        B[j] = mI[j] - a * mI[j];
      }
      const mA = boxMean(A);
      const mB = boxMean(B);
      for (let j = 0, i = c; j < n; j++, i += 4) d[i] = clamp255((mA[j] * I[j] + mB[j]) * 255);
    }
  },
  sharpen(p, q, env) {
    const amount = num(q.amount, 80) / 100;
    const radius = Math.max(0.3, num(q.radius, 1.2) * env.scale);
    const th = num(q.threshold, 2);
    const blurred = copyPixels(p);
    gaussianBlur(blurred, radius * 2);
    const d = p.data;
    const b = blurred.data;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = d[i + c] - b[i + c];
        if (Math.abs(diff) >= th) d[i + c] = clamp255(d[i + c] + diff * amount);
      }
    }
  },
  clarity(p, q, env) {
    const amount = num(q.amount, 30) / 100;
    const L = blurredLuma(p, Math.max(2, num(q.radius, 24) * env.scale));
    const d = p.data;
    for (let i = 0, j = 0; j < L.length; i += 4, j++) {
      const l = luma(d[i], d[i + 1], d[i + 2]) / 255;
      const mid = 1 - Math.abs(l - 0.5) * 1.6; // midtones mostly
      const k = (l - L[j]) * amount * Math.max(0, mid) * 255 * 1.4;
      d[i] = clamp255(d[i] + k);
      d[i + 1] = clamp255(d[i + 1] + k);
      d[i + 2] = clamp255(d[i + 2] + k);
    }
  },
  noise(p, q, env) {
    const amt = (num(q.amount, 12) / 100) * 110;
    const mono = bool(q.monochrome, true);
    const rnd = mulberry32(Math.round(num(q.seed, 1)) * 7919 + 17);
    const cell = Math.max(1, Math.round(num(q.size, 1) * env.scale));
    const { data: d, width: w, height: h } = p;
    const gw = Math.ceil(w / cell);
    const gh = Math.ceil(h / cell);
    const grain = new Float32Array(gw * gh * 3);
    for (let k = 0; k < gw * gh; k++) {
      const a = rnd() + rnd() - 1;
      grain[k * 3] = a;
      grain[k * 3 + 1] = mono ? a : rnd() + rnd() - 1;
      grain[k * 3 + 2] = mono ? a : rnd() + rnd() - 1;
    }
    for (let y = 0; y < h; y++) {
      const gy = Math.floor(y / cell) * gw;
      for (let x = 0; x < w; x++) {
        const g = (gy + Math.floor(x / cell)) * 3;
        const i = (y * w + x) * 4;
        d[i] = clamp255(d[i] + grain[g] * amt);
        d[i + 1] = clamp255(d[i + 1] + grain[g + 1] * amt);
        d[i + 2] = clamp255(d[i + 2] + grain[g + 2] * amt);
      }
    }
  },
  pixelate(p, q, env) {
    const s = Math.max(1, Math.round(num(q.size, 16) * env.scale));
    if (s < 2) return;
    const { data: d, width: w, height: h } = p;
    for (let by = 0; by < h; by += s) {
      for (let bx = 0; bx < w; bx += s) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let n = 0;
        const ey = Math.min(h, by + s);
        const ex = Math.min(w, bx + s);
        for (let y = by; y < ey; y++)
          for (let x = bx; x < ex; x++) {
            const i = (y * w + x) * 4;
            const A = d[i + 3];
            r += d[i] * A;
            g += d[i + 1] * A;
            b += d[i + 2] * A;
            a += A;
            n++;
          }
        const R = a ? r / a : 0;
        const G = a ? g / a : 0;
        const B = a ? b / a : 0;
        const AA = a / n;
        for (let y = by; y < ey; y++)
          for (let x = bx; x < ex; x++) {
            const i = (y * w + x) * 4;
            d[i] = R;
            d[i + 1] = G;
            d[i + 2] = B;
            d[i + 3] = AA;
          }
      }
    }
  },
  vignette(p, q) {
    const amount = num(q.amount, 40) / 100;
    const size = num(q.size, 50) / 100;
    const feather = Math.max(0.01, num(q.feather, 60) / 100);
    const c = color(q.color, "#000000");
    const target = amount >= 0 ? c : { r: 255, g: 255, b: 255, a: 1 };
    const k = Math.abs(amount);
    const { data: d, width: w, height: h } = p;
    const cx = w / 2;
    const cy = h / 2;
    const inner = size * 0.8;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Elliptical distance: 1 at the corners' inscribed ellipse edge.
        const ex = (x - cx) / cx;
        const ey = (y - cy) / cy;
        const r = Math.sqrt(ex * ex + ey * ey) / Math.SQRT2 * 1.25;
        let f = clamp01((r - inner) / feather);
        f = f * f * (3 - 2 * f) * k;
        const i = (y * w + x) * 4;
        d[i] += (target.r - d[i]) * f;
        d[i + 1] += (target.g - d[i + 1]) * f;
        d[i + 2] += (target.b - d[i + 2]) * f;
      }
    }
  },
  autoTone(p, q) {
    const clip = num(q.clip, 0.5);
    const h = histogram(p);
    if (!h.count) return;
    const [rl, rh] = percentiles(h.r, h.count, clip);
    const [gl, gh] = percentiles(h.g, h.count, clip);
    const [bl, bh] = percentiles(h.b, h.count, clip);
    applyLut(p, stretchLut(rl, rh), stretchLut(gl, gh), stretchLut(bl, bh));
  },
  autoContrast(p, q) {
    const h = histogram(p);
    if (!h.count) return;
    const [lo, hi] = percentiles(h.l, h.count, num(q.clip, 0.5));
    applyLut(p, stretchLut(lo, hi));
  },
  autoColor(p) {
    const d = p.data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    }
    if (!n) return;
    const avg = (r + g + b) / 3 / n;
    const [kr, kg, kb] = [avg / Math.max(1, r / n), avg / Math.max(1, g / n), avg / Math.max(1, b / n)];
    // Damp the correction (grey-world over-corrects strongly coloured scenes).
    const damp = (k: number) => 1 + (Math.min(1.6, Math.max(0.6, k)) - 1) * 0.7;
    applyLut(p, lut((v) => v * damp(kr)), lut((v) => v * damp(kg)), lut((v) => v * damp(kb)));
    FILTER_IMPLS.autoContrast(p, { clip: 0.3 }, { scale: 1 });
  },
  look(p, q) {
    const impl = LOOK_IMPLS[String(q.look)];
    if (impl) impl(p);
  },
};

// Applies the enabled filters in order (each with its `amount` mix).
export function runFilters(p: Pixels, filters: Filter[] | undefined, env: FilterEnv): void {
  for (const f of filters ?? []) {
    if (!f || f.enabled === false) continue;
    const impl = FILTER_IMPLS[f.type];
    if (!impl) continue;
    // Filters with their own "amount" param (sharpen, clarity, noise, vignette) use it as strength, not as the mix.
    const ownAmount = !!filterDef(f.type)?.params.some((p) => p.name === "amount");
    const amount = !ownAmount && typeof f.amount === "number" ? clamp01(f.amount) : 1;
    if (amount <= 0) continue;
    const params = withDefaults(f);
    if (amount >= 1) {
      impl(p, params, env);
      continue;
    }
    const before = new Uint8ClampedArray(p.data);
    impl(p, params, env);
    const d = p.data;
    for (let i = 0; i < d.length; i++) d[i] = before[i] + (d[i] - before[i]) * amount;
  }
}

function withDefaults(f: Filter): Params {
  const def = filterDef(f.type);
  const out: Params = {};
  for (const p of def?.params ?? []) if (p.default !== undefined) out[p.name] = p.default;
  return { ...out, ...f };
}

// Filters that read neighbouring pixels (need the whole layer, not tiles).
export const SPATIAL_FILTERS = new Set(FILTERS.filter((f) => f.group === "blur" || f.group === "detail" || f.id === "shadowsHighlights" || f.id === "pixelate").map((f) => f.id));
