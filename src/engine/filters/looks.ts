// Looks: one-click grades (catalog LOOKS). Ported from Photo Touch-up's
// effects gallery and extended. Pure pixel math on straight-alpha RGBA.

import { clamp255, luma, mulberry32, type Pixels } from "./pixels";

type D = Uint8ClampedArray;

function shift(d: D, ar: number, ag: number, ab: number, mr = 1, mg = 1, mb = 1): void {
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp255((d[i] + ar) * mr);
    d[i + 1] = clamp255((d[i + 1] + ag) * mg);
    d[i + 2] = clamp255((d[i + 2] + ab) * mb);
  }
}
function contrast(d: D, k: number): void {
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp255((d[i] - 128) * k + 128);
    d[i + 1] = clamp255((d[i + 1] - 128) * k + 128);
    d[i + 2] = clamp255((d[i + 2] - 128) * k + 128);
  }
}
function saturate(d: D, k: number): void {
  for (let i = 0; i < d.length; i += 4) {
    const g = luma(d[i], d[i + 1], d[i + 2]);
    d[i] = clamp255(g + (d[i] - g) * k);
    d[i + 1] = clamp255(g + (d[i + 1] - g) * k);
    d[i + 2] = clamp255(g + (d[i + 2] - g) * k);
  }
}
function gamma(d: D, gr: number, gg: number, gb: number): void {
  const t = (g: number) => {
    const a = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) a[v] = 255 * (v / 255) ** (1 / g);
    return a;
  };
  const [R, G, B] = [t(gr), t(gg), t(gb)];
  for (let i = 0; i < d.length; i += 4) {
    d[i] = R[d[i]];
    d[i + 1] = G[d[i + 1]];
    d[i + 2] = B[d[i + 2]];
  }
}
function vignette(p: Pixels, k: number): void {
  const { data: d, width: w, height: h } = p;
  const cx = w / 2;
  const cy = h / 2;
  const max = Math.hypot(cx, cy) || 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.hypot(x - cx, y - cy) / max;
      const f = 1 - k * r * r;
      const i = (y * w + x) * 4;
      d[i] *= f;
      d[i + 1] *= f;
      d[i + 2] *= f;
    }
  }
}
function lift(d: D, black: number, scale: number): void {
  for (let i = 0; i < d.length; i += 4) {
    d[i] = black + d[i] * scale;
    d[i + 1] = black + d[i + 1] * scale;
    d[i + 2] = black + d[i + 2] * scale;
  }
}
function splitTone(d: D, shadow: [number, number, number], high: [number, number, number]): void {
  for (let i = 0; i < d.length; i += 4) {
    const l = luma(d[i], d[i + 1], d[i + 2]) / 255;
    const s = 1 - l;
    d[i] = clamp255(d[i] + high[0] * l + shadow[0] * s);
    d[i + 1] = clamp255(d[i + 1] + high[1] * l + shadow[1] * s);
    d[i + 2] = clamp255(d[i + 2] + high[2] * l + shadow[2] * s);
  }
}

export const LOOK_IMPLS: Record<string, (p: Pixels) => void> = {
  bw: (p) => saturate(p.data, 0),
  noir: (p) => {
    saturate(p.data, 0);
    contrast(p.data, 1.55);
    gamma(p.data, 0.85, 0.85, 0.85);
    vignette(p, 0.45);
  },
  sepia: (p) => {
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      d[i] = clamp255(r * 0.393 + g * 0.769 + b * 0.189);
      d[i + 1] = clamp255(r * 0.349 + g * 0.686 + b * 0.168);
      d[i + 2] = clamp255(r * 0.272 + g * 0.534 + b * 0.131);
    }
  },
  vintage: (p) => {
    shift(p.data, 8, -6, -16, 1, 1, 0.92);
    saturate(p.data, 0.7);
    contrast(p.data, 0.92);
    gamma(p.data, 1.05, 1, 0.9);
    vignette(p, 0.35);
  },
  polaroid: (p) => {
    shift(p.data, 12, 4, -8);
    saturate(p.data, 0.85);
    contrast(p.data, 0.95);
  },
  lomo: (p) => {
    saturate(p.data, 1.45);
    contrast(p.data, 1.25);
    vignette(p, 0.55);
  },
  warm: (p) => {
    shift(p.data, 18, 6, -14);
    saturate(p.data, 1.1);
  },
  cool: (p) => {
    shift(p.data, -10, 0, 16);
    saturate(p.data, 0.95);
  },
  sunset: (p) => {
    shift(p.data, 28, -4, -24, 1, 1, 0.95);
    saturate(p.data, 1.2);
  },
  fade: (p) => {
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 40 + d[i] * 0.78;
      d[i + 1] = 40 + d[i + 1] * 0.78;
      d[i + 2] = 50 + d[i + 2] * 0.74;
    }
    saturate(d, 0.85);
  },
  punch: (p) => {
    saturate(p.data, 1.4);
    contrast(p.data, 1.2);
  },
  cinema: (p) => {
    splitTone(p.data, [-6, 2, 14], [20, 6, -14]);
    contrast(p.data, 1.1);
  },
  cyberpunk: (p) => {
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp255(d[i] * 1.05 + 18);
      d[i + 1] = clamp255(d[i + 1] * 0.85);
      d[i + 2] = clamp255(d[i + 2] * 1.1 + 22);
    }
    contrast(d, 1.25);
    saturate(d, 1.5);
  },
  "cross-process": (p) => {
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp255(d[i] * 1.1);
      d[i + 1] = clamp255(d[i + 1] + (255 - d[i + 1]) * 0.15);
      d[i + 2] = clamp255(d[i + 2] * 0.85);
    }
    contrast(d, 1.18);
    saturate(d, 1.15);
  },
  dramatic: (p) => {
    contrast(p.data, 1.5);
    gamma(p.data, 0.85, 0.85, 0.85);
    saturate(p.data, 0.6);
    vignette(p, 0.4);
  },
  dreamy: (p) => {
    shift(p.data, 14, 8, 16);
    saturate(p.data, 0.85);
    contrast(p.data, 0.88);
    gamma(p.data, 1.1, 1.05, 1.1);
  },
  matte: (p) => {
    lift(p.data, 28, 0.86);
    saturate(p.data, 0.82);
    splitTone(p.data, [0, 4, 8], [6, 2, -4]);
  },
  "golden-hour": (p) => {
    splitTone(p.data, [6, -2, -10], [26, 12, -20]);
    saturate(p.data, 1.12);
    gamma(p.data, 1.06, 1.02, 0.96);
  },
  film: (p) => {
    lift(p.data, 14, 0.92);
    contrast(p.data, 1.06);
    splitTone(p.data, [-4, 2, 8], [10, 4, -6]);
    saturate(p.data, 0.92);
    const rnd = mulberry32(7);
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 14;
      d[i] = clamp255(d[i] + n);
      d[i + 1] = clamp255(d[i + 1] + n);
      d[i + 2] = clamp255(d[i + 2] + n);
    }
  },
  clean: (p) => {
    gamma(p.data, 1.08, 1.08, 1.1);
    shift(p.data, -2, 0, 4);
    contrast(p.data, 1.06);
    saturate(p.data, 1.05);
  },
};
