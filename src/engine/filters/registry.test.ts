import { describe, expect, it } from "vitest";
import { FILTERS, LOOKS, filterDef } from "../../core/catalog";
import { validateDoc } from "../../core/validate";
import { analyzePixels } from "../analyze";
import { FILTER_IMPLS, runFilters, SPATIAL_FILTERS } from "./index";
import { LOOK_IMPLS } from "./looks";
import { blurAlpha, copyPixels, curveLut, gaussianBlur, histogram, hslToRgb, luma, makePixels, mulberry32, percentiles, rgbToHsl, type Pixels } from "./pixels";

const ENV = { scale: 1 };

// A deterministic 16 × 12 test image: gradients + a few saturated patches + some transparency.
function sample(opts: { alpha?: boolean } = {}): Pixels {
  const w = 16;
  const h = 12;
  const p = makePixels(w, h);
  const rnd = mulberry32(42);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      p.data[i] = (x * 255) / (w - 1);
      p.data[i + 1] = (y * 255) / (h - 1);
      p.data[i + 2] = Math.round(rnd() * 255);
      p.data[i + 3] = opts.alpha && x < 3 ? (x === 0 ? 0 : 128) : 255;
    }
  return p;
}
const uniform = (rgba: [number, number, number, number], w = 12, h = 10) => makePixels(w, h, rgba);
const run = (p: Pixels, f: Record<string, unknown>, env = ENV) => {
  runFilters(p, [f as never], env);
  return p;
};
const maxDiff = (a: Pixels, b: Pixels, channels = [0, 1, 2, 3]) => {
  let m = 0;
  for (let i = 0; i < a.data.length; i += 4) for (const c of channels) m = Math.max(m, Math.abs(a.data[i + c] - b.data[i + c]));
  return m;
};
const alphaOf = (p: Pixels) => Array.from(p.data.filter((_, i) => i % 4 === 3));
const px = (p: Pixels, x: number, y: number) => Array.from(p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4));

describe("filter registry", () => {
  it("every catalog filter has an implementation and vice versa", () => {
    expect(Object.keys(FILTER_IMPLS).sort()).toEqual(FILTERS.map((f) => f.id).sort());
  });
  it("every look has an implementation and vice versa", () => {
    expect(Object.keys(LOOK_IMPLS).sort()).toEqual(LOOKS.map((l) => l.id).sort());
  });
  it("spatial filters are catalog filters", () => {
    for (const id of SPATIAL_FILTERS) expect(filterDef(id), id).toBeTruthy();
    expect(SPATIAL_FILTERS.has("blur")).toBe(true);
    expect(SPATIAL_FILTERS.has("invert")).toBe(false);
  });
});

describe("every filter on synthetic pixels", () => {
  const ALPHA_CHANGING = new Set(["blur", "motionBlur", "pixelate"]);
  for (const f of FILTERS) {
    it(`${f.id}: example runs, stays finite and keeps alpha`, () => {
      const p = sample({ alpha: true });
      const before = copyPixels(p);
      run(p, f.example ?? { type: f.id });
      for (const v of p.data) expect(Number.isFinite(v)).toBe(true);
      if (ALPHA_CHANGING.has(f.id)) {
        // Alpha may only change when transparent pixels are involved: on an opaque image it stays 255.
        const opaque = run(sample(), f.example ?? { type: f.id });
        expect(alphaOf(opaque).every((a) => a === 255), f.id).toBe(true);
      } else expect(alphaOf(p)).toEqual(alphaOf(before));
      // Not a no-op (except where the example is neutral on this image).
      if (!["autoColor"].includes(f.id)) expect(maxDiff(p, before), f.id).toBeGreaterThan(0);
    });
    it(`${f.id}: defaults alone run`, () => {
      const p = sample();
      FILTER_IMPLS[f.id](p, Object.fromEntries(f.params.filter((x) => x.default !== undefined).map((x) => [x.name, x.default])), ENV);
      for (const v of p.data) expect(Number.isNaN(v)).toBe(false);
    });
  }
  it("every look runs and keeps alpha", () => {
    for (const l of LOOKS) {
      const p = sample({ alpha: true });
      const before = copyPixels(p);
      run(p, { type: "look", look: l.id });
      expect(alphaOf(p), l.id).toEqual(alphaOf(before));
      expect(maxDiff(p, before), l.id).toBeGreaterThan(0);
    }
    const p = sample();
    run(p, { type: "look", look: "unknown" });
    expect(maxDiff(p, sample())).toBe(0);
  });
  it("filters survive 1 × 1 and fully transparent images", () => {
    for (const f of FILTERS) {
      const one = uniform([10, 20, 30, 255], 1, 1);
      run(one, f.example ?? { type: f.id });
      for (const v of one.data) expect(Number.isFinite(v), f.id).toBe(true);
      const clear = uniform([0, 0, 0, 0], 4, 4);
      run(clear, f.example ?? { type: f.id });
      expect(alphaOf(clear).every((a) => a === 0), f.id).toBe(true);
    }
  });
});

describe("identity parameters", () => {
  const cases: Record<string, unknown>[] = [
    { type: "brightnessContrast", brightness: 0, contrast: 0 },
    { type: "exposure", exposure: 0, offset: 0, gamma: 1 },
    { type: "levels" },
    { type: "curves" },
    { type: "curves", rgb: [[0, 0], [255, 255]], red: [[0, 0], [128, 128], [255, 255]] },
    { type: "hueSaturation", hue: 0, saturation: 0, lightness: 0 },
    { type: "vibrance", vibrance: 0, saturation: 0 },
    { type: "temperature", temperature: 0, tint: 0 },
    { type: "colorBalance" },
    { type: "photoFilter", density: 0 },
    { type: "sepia", intensity: 0 },
    { type: "shadowsHighlights", shadows: 0, highlights: 0 },
    { type: "blur", radius: 0 },
    { type: "motionBlur", distance: 0 },
    { type: "sharpen", amount: 0 },
    { type: "clarity", amount: 0 },
    { type: "noise", amount: 0 },
    { type: "pixelate", size: 1 },
    { type: "vignette", amount: 0 },
    { type: "gradientMap", stops: ["#000000", "#ffffff"] }, // on a grey image
    { type: "blur", radius: 50, amount: 0 },
    { type: "invert", enabled: false },
  ];
  for (const c of cases) {
    it(`${JSON.stringify(c)} leaves pixels (nearly) unchanged`, () => {
      const p = c.type === "gradientMap" ? uniform([90, 90, 90, 255]) : sample();
      const before = copyPixels(p);
      run(p, c);
      expect(maxDiff(p, before)).toBeLessThanOrEqual(c.type === "hueSaturation" ? 1 : 1);
    });
  }
});

describe("specific behaviours", () => {
  it("invert twice is the identity", () => {
    const p = sample();
    runFilters(p, [{ type: "invert" }, { type: "invert" }], ENV);
    expect(maxDiff(p, sample())).toBe(0);
    const once = run(sample(), { type: "invert" });
    expect(px(once, 0, 0).slice(0, 2)).toEqual([255, 255]);
  });
  it("grayscale makes r = g = b", () => {
    const p = run(sample(), { type: "grayscale" });
    for (let i = 0; i < p.data.length; i += 4) {
      expect(p.data[i]).toBe(p.data[i + 1]);
      expect(p.data[i]).toBe(p.data[i + 2]);
    }
    expect(px(run(uniform([255, 0, 0, 255]), { type: "grayscale", red: 100, green: 0, blue: 0 }), 0, 0)).toEqual([255, 255, 255, 255]);
  });
  it("threshold is binary", () => {
    const p = run(sample(), { type: "threshold", level: 100 });
    for (let i = 0; i < p.data.length; i += 4) expect([0, 255]).toContain(p.data[i]);
    expect(new Set(Array.from(p.data.filter((_, i) => i % 4 === 0))).size).toBe(2);
  });
  it("posterize keeps `levels` tones per channel", () => {
    const p = makePixels(256, 1);
    for (let v = 0; v < 256; v++) p.data.set([v, v, v, 255], v * 4);
    run(p, { type: "posterize", levels: 4 });
    expect([...new Set(Array.from(p.data.filter((_, i) => i % 4 === 0)))].sort((a, b) => a - b)).toEqual([0, 85, 170, 255]);
  });
  it("blur of a uniform image is uniform; premultiplied: no dark halo next to transparency", () => {
    const u = run(uniform([200, 100, 50, 255]), { type: "blur", radius: 6 });
    for (let i = 0; i < u.data.length; i += 4) expect(Math.abs(u.data[i] - 200) + Math.abs(u.data[i + 1] - 100) + Math.abs(u.data[i + 2] - 50) + Math.abs(u.data[i + 3] - 255)).toBeLessThanOrEqual(3);
    // Red opaque on the left, transparent black on the right.
    const p = makePixels(20, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 10; x++) p.data.set([255, 0, 0, 255], (y * 20 + x) * 4);
    gaussianBlur(p, 6);
    for (let x = 0; x < 20; x++) {
      const [r, g, b, a] = px(p, x, 1);
      if (a > 0) {
        expect(r, `x=${x}`).toBeGreaterThanOrEqual(250);
        expect(g + b).toBeLessThanOrEqual(2);
      }
    }
    expect(px(p, 9, 1)[3]).toBeLessThan(255);
    expect(px(p, 10, 1)[3]).toBeGreaterThan(0);
  });
  it("blur conserves the mean and spreads a point", () => {
    const a = new Uint8ClampedArray(21 * 21);
    a[10 * 21 + 10] = 255;
    blurAlpha(a, 21, 21, 4);
    expect(a[10 * 21 + 10]).toBeLessThan(255);
    expect(a[10 * 21 + 12]).toBeGreaterThan(0);
    const flat = new Uint8ClampedArray(64).fill(100);
    blurAlpha(flat, 8, 8, 10);
    expect([...new Set(flat)]).toEqual([100]);
  });
  it("sharpen increases edge contrast", () => {
    const p = makePixels(20, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 20; x++) p.data.set(x < 10 ? [80, 80, 80, 255] : [160, 160, 160, 255], (y * 20 + x) * 4);
    run(p, { type: "sharpen", amount: 150, radius: 2, threshold: 0 });
    expect(px(p, 9, 1)[0]).toBeLessThan(80);
    expect(px(p, 10, 1)[0]).toBeGreaterThan(160);
    expect(px(p, 0, 1)[0]).toBe(80);
  });
  it("noise is deterministic per seed and monochrome by default", () => {
    const a = run(uniform([128, 128, 128, 255]), { type: "noise", amount: 50, seed: 7 });
    const b = run(uniform([128, 128, 128, 255]), { type: "noise", amount: 50, seed: 7 });
    const c = run(uniform([128, 128, 128, 255]), { type: "noise", amount: 50, seed: 8 });
    expect(maxDiff(a, b)).toBe(0);
    expect(maxDiff(a, c)).toBeGreaterThan(0);
    for (let i = 0; i < a.data.length; i += 4) expect(a.data[i]).toBe(a.data[i + 1]);
    const color = run(uniform([128, 128, 128, 255]), { type: "noise", amount: 50, monochrome: false });
    let differs = false;
    for (let i = 0; i < color.data.length; i += 4) if (color.data[i] !== color.data[i + 1]) differs = true;
    expect(differs).toBe(true);
  });
  it("autoTone / autoContrast stretch a low-contrast image", () => {
    const p = makePixels(100, 1);
    for (let x = 0; x < 100; x++) p.data.set([100 + x / 2, 100 + x / 2, 110 + x / 3, 255], x * 4);
    const t = run(copyPixels(p), { type: "autoTone", clip: 0 });
    expect(px(t, 0, 0).slice(0, 3)).toEqual([0, 0, 0]);
    expect(px(t, 99, 0).slice(0, 3)).toEqual([255, 255, 255]);
    const c = run(copyPixels(p), { type: "autoContrast", clip: 0 });
    expect(px(c, 0, 0)[0]).toBeLessThan(5);
    expect(px(c, 99, 0)[0]).toBeGreaterThan(250);
  });
  it("autoColor neutralises a cast", () => {
    const p = sample();
    for (let i = 0; i < p.data.length; i += 4) p.data[i] = Math.min(255, p.data[i] + 60);
    const before = analyzePixels(p).cast.warm;
    run(p, { type: "autoColor" });
    expect(Math.abs(analyzePixels(p).cast.warm)).toBeLessThan(Math.abs(before));
  });
  it("curveLut is monotone for monotone points and hits the points", () => {
    const lutS = curveLut([[0, 0], [64, 40], [192, 220], [255, 255]]);
    for (let v = 1; v < 256; v++) expect(lutS[v]).toBeGreaterThanOrEqual(lutS[v - 1]);
    expect([lutS[0], lutS[64], lutS[192], lutS[255]]).toEqual([0, 40, 220, 255]);
    const steep = curveLut([[0, 0], [10, 200], [20, 210], [255, 255]]);
    for (let v = 1; v < 256; v++) expect(steep[v]).toBeGreaterThanOrEqual(steep[v - 1]);
    // Unsorted input, flat ends.
    const u = curveLut([[200, 255], [50, 0]]);
    expect([u[0], u[50], u[200], u[255]]).toEqual([0, 0, 255, 255]);
    expect(Array.from(curveLut([]))).toEqual(Array.from({ length: 256 }, (_, i) => i));
    expect(new Set(curveLut([[0, 77]]))).toEqual(new Set([77]));
  });
  it("hue rotation and colorize", () => {
    const red = run(uniform([255, 0, 0, 255]), { type: "hueSaturation", hue: 120 });
    expect(px(red, 0, 0)).toEqual([0, 255, 0, 255]);
    const grey = run(uniform([128, 128, 128, 255]), { type: "hueSaturation", saturation: -100 });
    expect(px(grey, 0, 0)).toEqual([128, 128, 128, 255]);
    const tint = run(uniform([128, 128, 128, 255]), { type: "hueSaturation", colorize: true, hue: 240, saturation: 50 });
    const [r, g, b] = px(tint, 0, 0);
    expect(b).toBeGreaterThan(r);
    expect(r).toBe(g);
    const [h, s, l] = rgbToHsl(10, 200, 100);
    expect(hslToRgb(h, s, l).map(Math.round)).toEqual([10, 200, 100]);
  });
  it("temperature warms / cools, gradientMap maps luminance", () => {
    const warm = run(uniform([128, 128, 128, 255]), { type: "temperature", temperature: 50 });
    expect(px(warm, 0, 0)[0]).toBeGreaterThan(px(warm, 0, 0)[2]);
    const map = run(uniform([0, 0, 0, 255]), { type: "gradientMap", stops: ["#ff0000", "#0000ff"] });
    expect(px(map, 0, 0)).toEqual([255, 0, 0, 255]);
    const white = run(uniform([255, 255, 255, 255]), { type: "gradientMap", stops: [[0, "#000"], [0.5, "#f00"], [1, "#00f"]] });
    expect(px(white, 0, 0)).toEqual([0, 0, 255, 255]);
  });
  it("levels maps black / white points", () => {
    const p = makePixels(3, 1);
    p.data.set([20, 20, 20, 255, 128, 128, 128, 255, 230, 230, 230, 255]);
    run(p, { type: "levels", black: 20, white: 230 });
    expect([p.data[0], p.data[8]]).toEqual([0, 255]);
    run(p, { type: "levels", outBlack: 50, outWhite: 200 });
    expect([p.data[0], p.data[8]]).toEqual([50, 200]);
  });
  it("vignette darkens corners, not the centre", () => {
    const p = run(uniform([200, 200, 200, 255], 21, 21), { type: "vignette", amount: 80 });
    expect(px(p, 0, 0)[0]).toBeLessThan(150);
    expect(px(p, 10, 10)[0]).toBe(200);
    const light = run(uniform([100, 100, 100, 255], 21, 21), { type: "vignette", amount: -80 });
    expect(px(light, 0, 0)[0]).toBeGreaterThan(150);
  });
  it("pixelate averages cells (alpha-weighted)", () => {
    const p = makePixels(4, 4);
    p.data.set([255, 0, 0, 255], 0);
    p.data.set([0, 0, 255, 0], 4); // transparent blue must not tint
    run(p, { type: "pixelate", size: 2 });
    expect(px(p, 1, 1)).toEqual([255, 0, 0, 64]);
  });
});

describe("runFilters", () => {
  it("skips disabled filters and unknown types", () => {
    const p = sample();
    runFilters(p, [{ type: "invert", enabled: false }, { type: "nope" }, null as never], ENV);
    expect(maxDiff(p, sample())).toBe(0);
    runFilters(p, undefined, ENV);
  });
  it("mixes by amount", () => {
    const p = run(uniform([0, 100, 200, 255]), { type: "invert", amount: 0.5 });
    expect(px(p, 0, 0)).toEqual([128, 128, 128, 255]);
    const q = run(uniform([0, 100, 200, 255]), { type: "invert", amount: 2 });
    expect(px(q, 0, 0)).toEqual([255, 155, 55, 255]);
  });
  it("filters with their own `amount` param use it as strength, not as a mix", () => {
    // Negative clarity / vignette used to be skipped (amount clamped to 0).
    const v = run(uniform([100, 100, 100, 255], 21, 21), { type: "vignette", amount: -80 });
    expect(px(v, 0, 0)[0]).toBeGreaterThan(150);
    const s1 = run(makeEdge(), { type: "sharpen", amount: 300, radius: 2, threshold: 0 });
    const s2 = run(makeEdge(), { type: "sharpen", amount: 0.5, radius: 2, threshold: 0 });
    expect(px(s1, 9, 1)[0]).toBeLessThan(px(s2, 9, 1)[0]);
    // ...and validation accepts them.
    const doc = { version: 1, id: "d", canvas: { width: 1, height: 1 }, layers: [{ id: "a", type: "adjustment", filters: [{ type: "sharpen", amount: 300 }, { type: "clarity", amount: -40 }, { type: "noise", amount: 20 }, { type: "vignette", amount: -50 }] }] };
    expect(validateDoc(doc)).toEqual([]);
    expect(validateDoc({ ...doc, layers: [{ id: "a", type: "adjustment", filters: [{ type: "sharpen", amount: 600 }] }] }).map((i) => i.code)).toEqual(["range"]);
  });
  it("px params scale with env.scale", () => {
    const edge = () => {
      const p = makePixels(40, 3);
      for (let y = 0; y < 3; y++) for (let x = 0; x < 40; x++) p.data.set(x < 20 ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * 40 + x) * 4);
      return p;
    };
    // blur 8 at scale 0.5 == blur 4 at scale 1
    const half = run(edge(), { type: "blur", radius: 8 }, { scale: 0.5 });
    const full = run(edge(), { type: "blur", radius: 4 }, { scale: 1 });
    expect(maxDiff(half, full)).toBe(0);
    expect(maxDiff(run(edge(), { type: "blur", radius: 8 }, { scale: 1 }), full)).toBeGreaterThan(0);
    const pixHalf = run(sample(), { type: "pixelate", size: 8 }, { scale: 0.5 });
    const pixFull = run(sample(), { type: "pixelate", size: 4 }, { scale: 1 });
    expect(maxDiff(pixHalf, pixFull)).toBe(0);
  });
});

function makeEdge(): Pixels {
  const p = makePixels(20, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 20; x++) p.data.set(x < 10 ? [80, 80, 80, 255] : [160, 160, 160, 255], (y * 20 + x) * 4);
  return p;
}

describe("pixel helpers", () => {
  it("histogram ignores transparent pixels; percentiles clip", () => {
    const p = sample({ alpha: true });
    const h = histogram(p);
    expect(h.count).toBe(16 * 12 - 12);
    const hist = new Uint32Array(256);
    hist[10] = 1;
    hist[50] = 98;
    hist[240] = 1;
    expect(percentiles(hist, 100, 0)).toEqual([10, 240]);
    expect(percentiles(hist, 100, 1.5)).toEqual([0, 255]); // a single tone left: no stretch
    hist[60] = 10;
    expect(percentiles(hist, 110, 1)).toEqual([50, 60]);
    expect(luma(255, 255, 255)).toBeCloseTo(255);
  });
});

describe("analyzePixels", () => {
  it("suggests exposure for a dark image and finds casts", () => {
    const dark = makePixels(20, 20);
    const rnd = mulberry32(3);
    for (let i = 0; i < dark.data.length; i += 4) {
      const v = 20 + rnd() * 40;
      dark.data.set([v + 30, v, v, 255], i);
    }
    const s = analyzePixels(dark);
    expect(s.brightness).toBeLessThan(85);
    expect(s.suggestions.find((x) => x.filter.type === "exposure")?.filter.exposure).toBeGreaterThan(0);
    expect(s.cast.warm).toBeGreaterThan(18);
    expect(s.suggestions.some((x) => x.filter.type === "temperature" && (x.filter.temperature as number) < 0)).toBe(true);
    expect(s.dominant[0].share).toBeGreaterThan(0);
    // The suggested filters are valid filters.
    expect(validateDoc({ version: 1, id: "d", canvas: { width: 1, height: 1 }, layers: [{ id: "a", type: "adjustment", filters: s.suggestions.map((x) => x.filter) }] }).filter((i) => i.severity === "error")).toEqual([]);
  });
  it("detects bright, flat and transparent images", () => {
    const bright = analyzePixels(uniform([240, 240, 240, 255]));
    expect(bright.suggestions.some((x) => x.filter.type === "exposure" && (x.filter.exposure as number) < 0)).toBe(true);
    expect(bright.clippedHighlights).toBe(0);
    const clear = analyzePixels(makePixels(4, 4));
    expect(clear.transparent).toBe(100);
    expect(Number.isFinite(clear.brightness)).toBe(true);
    const green = analyzePixels(uniform([100, 160, 100, 255]));
    expect(green.cast.magenta).toBeLessThan(-12);
    expect(green.suggestions.some((x) => x.filter.type === "temperature" && (x.filter.tint as number) > 0)).toBe(true);
  });
});
