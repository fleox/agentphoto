// Pixel selections ("regions") — pure and tested. A region is either a shape
// (marquee rectangle / ellipse: exact, becomes a shape mask) or a raster
// coverage plane over the whole canvas at a reduced resolution (lasso, magic
// wand, AI select, combinations). Combine modes follow Photoshop: Shift adds,
// Alt subtracts, Shift+Alt intersects.

export type CombineMode = "replace" | "add" | "subtract" | "intersect";

export interface Raster {
  // Plane size (px) and plane px per document px.
  w: number;
  h: number;
  scale: number;
  // Coverage 0..255, row-major.
  data: Uint8Array;
}

export interface ShapeRegion {
  kind: "rect" | "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RasterRegion {
  kind: "raster";
  raster: Raster;
}

export type Region = ShapeRegion | RasterRegion;

export interface DocRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MAX_REGION_SIDE = 2048;

export function modeFromKeys(shift: boolean, alt: boolean): CombineMode {
  if (shift && alt) return "intersect";
  if (shift) return "add";
  if (alt) return "subtract";
  return "replace";
}

export function emptyRaster(W: number, H: number, maxSide = MAX_REGION_SIDE): Raster {
  const scale = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));
  return { w, h, scale, data: new Uint8Array(w * h) };
}

export function fillShape(r: Raster, s: ShapeRegion, value = 255): Raster {
  const x0 = Math.max(0, Math.floor(s.x * r.scale));
  const y0 = Math.max(0, Math.floor(s.y * r.scale));
  const x1 = Math.min(r.w, Math.ceil((s.x + s.width) * r.scale));
  const y1 = Math.min(r.h, Math.ceil((s.y + s.height) * r.scale));
  const cx = (s.x + s.width / 2) * r.scale;
  const cy = (s.y + s.height / 2) * r.scale;
  const rx = (s.width / 2) * r.scale;
  const ry = (s.height / 2) * r.scale;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (s.kind === "ellipse") {
        const dx = (x + 0.5 - cx) / (rx || 1);
        const dy = (y + 0.5 - cy) / (ry || 1);
        if (dx * dx + dy * dy > 1) continue;
      }
      r.data[y * r.w + x] = value;
    }
  return r;
}

// Even-odd scanline fill of a polygon given in document px (pixel centres).
export function fillPolygon(r: Raster, pts: { x: number; y: number }[], value = 255): Raster {
  if (pts.length < 3) return r;
  const P = pts.map((p) => ({ x: p.x * r.scale, y: p.y * r.scale }));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of P) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const ys = Math.max(0, Math.floor(minY));
  const ye = Math.min(r.h - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = ys; y <= ye; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const a = P[i];
      const b = P[j];
      if (a.y > cy !== b.y > cy) xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(r.w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) r.data[y * r.w + x] = value;
    }
  }
  return r;
}

export function toRaster(region: Region, W: number, H: number): Raster {
  if (region.kind === "raster") return region.raster;
  return fillShape(emptyRaster(W, H), region);
}

// Combine a new region with the current one (replace / add / subtract / intersect).
export function combine(base: Region | null, fresh: Region, mode: CombineMode, W: number, H: number): Region | null {
  if (mode === "replace") return fresh;
  if (!base) return mode === "add" ? fresh : null;
  const a = toRaster(base, W, H);
  const b = sameGrid(toRaster(fresh, W, H), a);
  const out = new Uint8Array(a.data.length);
  for (let i = 0; i < out.length; i++) {
    const x = a.data[i];
    const y = b.data[i];
    out[i] = mode === "add" ? Math.max(x, y) : mode === "subtract" ? Math.min(x, 255 - y) : Math.min(x, y);
  }
  const r: Raster = { ...a, data: out };
  return isEmpty(r) ? null : { kind: "raster", raster: r };
}

// Resample `r` onto the grid of `like` (nearest).
function sameGrid(r: Raster, like: Raster): Raster {
  if (r.w === like.w && r.h === like.h) return r;
  const out = new Uint8Array(like.w * like.h);
  for (let y = 0; y < like.h; y++)
    for (let x = 0; x < like.w; x++) out[y * like.w + x] = r.data[Math.min(r.h - 1, Math.floor((y * r.h) / like.h)) * r.w + Math.min(r.w - 1, Math.floor((x * r.w) / like.w))];
  return { ...like, data: out };
}

export function invertRegion(region: Region | null, W: number, H: number): Region | null {
  if (!region) return { kind: "rect", x: 0, y: 0, width: W, height: H };
  const r = toRaster(region, W, H);
  const out = new Uint8Array(r.data.length);
  for (let i = 0; i < out.length; i++) out[i] = 255 - r.data[i];
  const next: Raster = { ...r, data: out };
  return isEmpty(next) ? null : { kind: "raster", raster: next };
}

// Soft edge: separable box blur ×3 (≈ gaussian), radius in document px.
export function featherRegion(region: Region, radius: number, W: number, H: number): Region {
  const r = toRaster(region, W, H);
  const rad = Math.round(radius * r.scale);
  if (rad < 1) return { kind: "raster", raster: r };
  const cur = Float32Array.from(r.data);
  const tmp = new Float32Array(cur.length);
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const n = horizontal ? r.w : r.h;
    const lines = horizontal ? r.h : r.w;
    const at = (line: number, i: number) => (horizontal ? line * r.w + i : i * r.w + line);
    for (let l = 0; l < lines; l++) {
      let acc = 0;
      for (let i = -rad; i <= rad; i++) acc += src[at(l, Math.min(n - 1, Math.max(0, i)))];
      for (let i = 0; i < n; i++) {
        dst[at(l, i)] = acc / (rad * 2 + 1);
        acc += src[at(l, Math.min(n - 1, i + rad + 1))] - src[at(l, Math.max(0, i - rad))];
      }
    }
  };
  for (let k = 0; k < 3; k++) {
    pass(cur, tmp, true);
    pass(tmp, cur, false);
  }
  const out = new Uint8Array(cur.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(cur[i]);
  return { kind: "raster", raster: { ...r, data: out } };
}

export function isEmpty(r: Raster): boolean {
  for (let i = 0; i < r.data.length; i++) if (r.data[i] > 0) return false;
  return true;
}

// Bounds of the selected area, document px (null = nothing selected).
export function regionBounds(region: Region): DocRect | null {
  if (region.kind !== "raster") return region.width > 0 && region.height > 0 ? { x: region.x, y: region.y, width: region.width, height: region.height } : null;
  const r = region.raster;
  let x0 = r.w;
  let y0 = r.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++)
      if (r.data[y * r.w + x] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  return { x: x0 / r.scale, y: y0 / r.scale, width: (x1 - x0 + 1) / r.scale, height: (y1 - y0 + 1) / r.scale };
}

// Coverage 0..255 of the region at a document point.
export function coverageAt(region: Region, x: number, y: number): number {
  if (region.kind === "rect") return x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height ? 255 : 0;
  if (region.kind === "ellipse") {
    const dx = (x - (region.x + region.width / 2)) / (region.width / 2 || 1);
    const dy = (y - (region.y + region.height / 2)) / (region.height / 2 || 1);
    return dx * dx + dy * dy <= 1 ? 255 : 0;
  }
  const r = (region as RasterRegion).raster;
  const px = Math.floor(x * r.scale);
  const py = Math.floor(y * r.scale);
  return px < 0 || py < 0 || px >= r.w || py >= r.h ? 0 : r.data[py * r.w + px];
}

export interface LayerFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX?: boolean;
  flipY?: boolean;
}

// The region sampled in a layer's own space (out w × h px over its box,
// rotation / flip undone): what a layer mask or a paint clip needs.
// `frame` null = canvas space (plane stretched over the canvas).
export function regionInLayer(region: Region, outW: number, outH: number, frame: LayerFrame | null, canvas: { width: number; height: number }): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outW * outH);
  const f = frame ?? { x: 0, y: 0, width: canvas.width, height: canvas.height, rotation: 0 };
  const cx = f.x + f.width / 2;
  const cy = f.y + f.height / 2;
  const rad = (f.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const fx = f.flipX ? -1 : 1;
  const fy = f.flipY ? -1 : 1;
  for (let j = 0; j < outH; j++) {
    const ly = ((j + 0.5) / outH - 0.5) * f.height * fy;
    for (let i = 0; i < outW; i++) {
      const lx = ((i + 0.5) / outW - 0.5) * f.width * fx;
      out[j * outW + i] = coverageAt(region, cx + lx * cos - ly * sin, cy + lx * sin + ly * cos);
    }
  }
  return out;
}

// A layer-space plane (e.g. an AI mask) mapped onto the canvas grid of a raster region.
export function layerPlaneToRegion(plane: Uint8ClampedArray | Uint8Array, pw: number, ph: number, frame: LayerFrame, W: number, H: number): Region | null {
  const r = emptyRaster(W, H);
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const rad = (-frame.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const dx = (x + 0.5) / r.scale - cx;
      const dy = (y + 0.5) / r.scale - cy;
      let lx = dx * cos - dy * sin;
      let ly = dx * sin + dy * cos;
      if (frame.flipX) lx = -lx;
      if (frame.flipY) ly = -ly;
      const u = Math.floor((lx / frame.width + 0.5) * pw);
      const v = Math.floor((ly / frame.height + 0.5) * ph);
      if (u >= 0 && v >= 0 && u < pw && v < ph) r.data[y * r.w + x] = plane[v * pw + u];
    }
  return isEmpty(r) ? null : { kind: "raster", raster: r };
}

// ─── magic wand ──────────────────────────────────────────────────────────

// Pixels similar to the seed colour (RGBA distance, tolerance 0..100):
// contiguous = flood fill from the seed, else every matching pixel.
export function wandSelect(px: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, tolerance: number, contiguous: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const s = (sy * w + sx) * 4;
  const [r0, g0, b0, a0] = [px[s], px[s + 1], px[s + 2], px[s + 3]];
  const tol = (Math.max(0, Math.min(100, tolerance)) / 100) * 510;
  const match = (i: number) => {
    const j = i * 4;
    const d = Math.abs(px[j] - r0) + Math.abs(px[j + 1] - g0) + Math.abs(px[j + 2] - b0) + Math.abs(px[j + 3] - a0) * 0.5;
    return d <= tol;
  };
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (match(i)) out[i] = 255;
    return out;
  }
  const stack = [sy * w + sx];
  const seen = new Uint8Array(w * h);
  seen[sy * w + sx] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    if (!match(i)) continue;
    out[i] = 255;
    const x = i % w;
    const y = (i - x) / w;
    const n = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const k of n)
      if (k >= 0 && !seen[k]) {
        seen[k] = 1;
        stack.push(k);
      }
  }
  return out;
}

// ─── outline (marching ants) ─────────────────────────────────────────────

// SVG path of the boundary of a coverage plane (≥ 128 = inside), in plane
// px; edges chained into closed sub-paths, collinear runs merged.
// (Adapted from photo-touch-up util/traceMask.ts.)
export function traceOutline(data: Uint8Array, w: number, h: number): string {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] >= 128;
  const enc = (x: number, y: number) => x * (h + 2) + y;
  const edges = new Map<number, [number, number][]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = enc(x0, y0);
    const list = edges.get(k);
    if (list) list.push([x1, y1]);
    else edges.set(k, [[x1, y1]]);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
  let d = "";
  const take = (k: number): [number, number] | null => {
    const list = edges.get(k);
    if (!list?.length) return null;
    const e = list.pop()!;
    if (!list.length) edges.delete(k);
    return e;
  };
  while (edges.size) {
    const k0 = edges.keys().next().value as number;
    const sx = Math.floor(k0 / (h + 2));
    const sy = k0 - sx * (h + 2);
    const pts: [number, number][] = [[sx, sy]];
    let cur = take(k0);
    while (cur) {
      pts.push(cur);
      if (cur[0] === sx && cur[1] === sy) break;
      cur = take(enc(cur[0], cur[1]));
    }
    const s = simplify(pts);
    d += `M${s[0][0]} ${s[0][1]}`;
    for (let i = 1; i < s.length; i++) d += `L${s[i][0]} ${s[i][1]}`;
    d += "Z";
  }
  return d;
}

function simplify(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = out[out.length - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    if ((cx - px) * (ny - cy) - (cy - py) * (nx - cx) === 0) continue;
    out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Outline of a raster region in document px (traced on a ≤ 1024 px grid).
export function regionOutline(r: Raster): { d: string; scale: number } {
  const k = Math.min(1, 1024 / Math.max(r.w, r.h));
  if (k >= 1) return { d: traceOutline(r.data, r.w, r.h), scale: r.scale };
  const w = Math.max(1, Math.round(r.w * k));
  const h = Math.max(1, Math.round(r.h * k));
  const small = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) small[y * w + x] = r.data[Math.min(r.h - 1, Math.floor(y / k)) * r.w + Math.min(r.w - 1, Math.floor(x / k))];
  return { d: traceOutline(small, w, h), scale: r.scale * k };
}
