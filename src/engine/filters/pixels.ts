// Pixel primitives shared by the filters. They work on plain RGBA buffers
// ({ data, width, height }, straight alpha like ImageData) so they run (and are
// tested) without a DOM.

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function makePixels(width: number, height: number, fill?: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { data, width, height };
}

export function copyPixels(p: Pixels): Pixels {
  return { data: new Uint8ClampedArray(p.data), width: p.width, height: p.height };
}

// Per-channel lookup tables (rgb only, alpha kept).
export function applyLut(p: Pixels, r: Uint8ClampedArray, g: Uint8ClampedArray = r, b: Uint8ClampedArray = r): void {
  const d = p.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r[d[i]];
    d[i + 1] = g[d[i + 1]];
    d[i + 2] = b[d[i + 2]];
  }
}

export function lut(fn: (v: number) => number): Uint8ClampedArray {
  const t = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) t[v] = Math.round(clamp255(fn(v)));
  return t;
}

export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

// sRGB <-> linear (0..1)
export const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

// ─── blur ───────────────────────────────────────────────────────────────

// Box blur of one float channel plane, horizontal then vertical (in place).
function boxBlurPlane(src: Float32Array, w: number, h: number, r: number, tmp: Float32Array): void {
  if (r < 1) return;
  const iarr = 1 / (r + r + 1);
  // horizontal: src → tmp
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const first = src[row];
    const last = src[row + w - 1];
    let acc = (r + 1) * first;
    for (let x = 0; x < r; x++) acc += src[row + Math.min(x, w - 1)];
    for (let x = 0; x < w; x++) {
      const add = src[row + Math.min(x + r, w - 1)] ?? last;
      acc += add;
      tmp[row + x] = acc * iarr;
      const rem = x - r >= 0 ? src[row + x - r] : first;
      acc -= rem;
    }
  }
  // vertical: tmp → src
  for (let x = 0; x < w; x++) {
    const first = tmp[x];
    let acc = (r + 1) * first;
    for (let y = 0; y < r; y++) acc += tmp[Math.min(y, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      acc += tmp[Math.min(y + r, h - 1) * w + x];
      src[y * w + x] = acc * iarr;
      acc -= y - r >= 0 ? tmp[(y - r) * w + x] : first;
    }
  }
}

// Box radii approximating a gaussian of std-dev sigma with n passes.
function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  return Array.from({ length: n }, (_, i) => Math.max(0, ((i < m ? wl : wu) - 1) / 2));
}

export function blurPlane(plane: Float32Array, w: number, h: number, radius: number): void {
  if (radius < 0.5) return;
  const tmp = new Float32Array(plane.length);
  for (const r of boxesForGauss(radius / 2)) boxBlurPlane(plane, w, h, Math.round(r), tmp);
}

// Gaussian-like blur of an RGBA buffer (premultiplied, so transparent pixels don't darken edges).
export function gaussianBlur(p: Pixels, radius: number): void {
  if (radius < 0.5) return;
  const { data: d, width: w, height: h } = p;
  const n = w * h;
  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  const A = new Float32Array(n);
  let opaque = true;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const a = d[i + 3] / 255;
    if (a < 1) opaque = false;
    R[j] = d[i] * a;
    G[j] = d[i + 1] * a;
    B[j] = d[i + 2] * a;
    A[j] = a;
  }
  blurPlane(R, w, h, radius);
  blurPlane(G, w, h, radius);
  blurPlane(B, w, h, radius);
  if (!opaque) blurPlane(A, w, h, radius);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const a = A[j];
    if (a <= 1e-6) {
      d[i + 3] = 0;
      continue;
    }
    d[i] = R[j] / a;
    d[i + 1] = G[j] / a;
    d[i + 2] = B[j] / a;
    d[i + 3] = a * 255;
  }
}

// Blurred luminance plane (0..1).
export function blurredLuma(p: Pixels, radius: number): Float32Array {
  const { data: d, width: w, height: h } = p;
  const L = new Float32Array(w * h);
  for (let i = 0, j = 0; j < L.length; i += 4, j++) L[j] = luma(d[i], d[i + 1], d[i + 2]) / 255;
  blurPlane(L, w, h, radius);
  return L;
}

// Single-channel alpha blur (masks, effects).
export function blurAlpha(alpha: Uint8ClampedArray, w: number, h: number, radius: number): void {
  if (radius < 0.5) return;
  const f = new Float32Array(alpha.length);
  for (let i = 0; i < f.length; i++) f[i] = alpha[i];
  blurPlane(f, w, h, radius);
  for (let i = 0; i < f.length; i++) alpha[i] = f[i];
}

// ─── deterministic random ───────────────────────────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── colour helpers ─────────────────────────────────────────────────────

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

// Monotone cubic interpolation (Fritsch–Carlson) through points → 256 LUT.
export function curveLut(points: [number, number][]): Uint8ClampedArray {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const out = new Uint8ClampedArray(256);
  if (n === 0) return lut((v) => v);
  if (n === 1) return lut(() => pts[0][1]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i]);
    m.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1));
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  for (let v = 0; v < 256; v++) {
    if (v <= xs[0]) {
      out[v] = ys[0];
      continue;
    }
    if (v >= xs[n - 1]) {
      out[v] = ys[n - 1];
      continue;
    }
    let i = 0;
    while (i < n - 2 && v > xs[i + 1]) i++;
    const h = dx[i];
    const u = (v - xs[i]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    out[v] = clamp255(Math.round(h00 * ys[i] + h10 * h * t[i] + h01 * ys[i + 1] + h11 * h * t[i + 1]));
  }
  return out;
}

// Histogram of luminance and channels (alpha-weighted: transparent pixels don't count).
export function histogram(p: Pixels): { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array; count: number } {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const l = new Uint32Array(256);
  const d = p.data;
  let count = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    r[d[i]]++;
    g[d[i + 1]]++;
    b[d[i + 2]]++;
    l[Math.round(luma(d[i], d[i + 1], d[i + 2]))]++;
    count++;
  }
  return { r, g, b, l, count };
}

// [low, high] values clipping `clip` % at each end of a histogram channel.
export function percentiles(h: Uint32Array, count: number, clip: number): [number, number] {
  const cut = (count * clip) / 100;
  let lo = 0;
  let acc = 0;
  while (lo < 255 && acc + h[lo] <= cut) acc += h[lo++];
  let hi = 255;
  acc = 0;
  while (hi > 0 && acc + h[hi] <= cut) acc += h[hi--];
  return hi <= lo ? [0, 255] : [lo, hi];
}

export const stretchLut = (lo: number, hi: number) => lut((v) => ((v - lo) * 255) / Math.max(1, hi - lo));
