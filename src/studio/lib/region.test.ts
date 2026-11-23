import { describe, expect, it } from "vitest";
import { combine, coverageAt, emptyRaster, featherRegion, fillPolygon, invertRegion, layerPlaneToRegion, modeFromKeys, regionBounds, regionInLayer, toRaster, traceOutline, wandSelect, type Region } from "./region";

const W = 100;
const H = 50;
const rect = (x: number, y: number, w: number, h: number): Region => ({ kind: "rect", x, y, width: w, height: h });
const count = (r: Region) => toRaster(r, W, H).data.reduce((a, v) => a + (v > 127 ? 1 : 0), 0);

describe("pixel selections", () => {
  it("maps modifier keys to combine modes", () => {
    expect([modeFromKeys(false, false), modeFromKeys(true, false), modeFromKeys(false, true), modeFromKeys(true, true)]).toEqual(["replace", "add", "subtract", "intersect"]);
  });
  it("rasterizes polygons (even-odd, pixel centres)", () => {
    const r = fillPolygon(emptyRaster(W, H), [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 20 }, { x: 10, y: 20 }]);
    expect(r.data.reduce((a, v) => a + (v ? 1 : 0), 0)).toBe(200);
    expect(coverageAt({ kind: "raster", raster: r }, 15, 15)).toBe(255);
    expect(coverageAt({ kind: "raster", raster: r }, 35, 15)).toBe(0);
  });
  it("combines: add, subtract, intersect, replace", () => {
    const a = rect(0, 0, 20, 10);
    const b = rect(10, 0, 20, 10);
    expect(count(combine(a, b, "add", W, H)!)).toBe(300);
    expect(count(combine(a, b, "subtract", W, H)!)).toBe(100);
    expect(count(combine(a, b, "intersect", W, H)!)).toBe(100);
    expect(combine(a, b, "replace", W, H)).toBe(b);
    expect(combine(null, b, "subtract", W, H)).toBeNull();
    expect(combine(a, rect(50, 30, 5, 5), "intersect", W, H)).toBeNull();
  });
  it("inverts, feathers and measures bounds", () => {
    expect(invertRegion(null, W, H)).toEqual(rect(0, 0, W, H));
    const inv = invertRegion(rect(0, 0, 50, 50), W, H)!;
    expect(regionBounds(inv)).toEqual({ x: 50, y: 0, width: 50, height: 50 });
    const f = featherRegion(rect(40, 20, 20, 10), 3, W, H);
    expect(coverageAt(f, 50, 25)).toBeGreaterThan(200);
    const edge = coverageAt(f, 40, 25);
    expect(edge).toBeGreaterThan(40);
    expect(edge).toBeLessThan(220);
  });
  it("samples a region in a (rotated) layer's own space", () => {
    const r = rect(0, 0, 50, 50);
    // A 20 × 10 box at (40, 20): its left half is inside x < 50.
    const p = regionInLayer(r, 20, 10, { x: 40, y: 20, width: 20, height: 10, rotation: 0 }, { width: W, height: H });
    expect(p[0]).toBe(255);
    expect(p[19]).toBe(0);
    // Flipped horizontally: the inside half is on the right of the layer's pixels.
    const f = regionInLayer(r, 20, 10, { x: 40, y: 20, width: 20, height: 10, rotation: 0, flipX: true }, { width: W, height: H });
    expect([f[0], f[19]]).toEqual([0, 255]);
    // Back to the canvas grid.
    const back = layerPlaneToRegion(p, 20, 10, { x: 40, y: 20, width: 20, height: 10, rotation: 0 }, W, H)!;
    expect(regionBounds(back)).toEqual({ x: 40, y: 20, width: 10, height: 10 });
  });
  it("magic wand: contiguous flood fill or global colour range", () => {
    // 4 × 1: red, red, blue, red
    const px = new Uint8ClampedArray([255, 0, 0, 255, 250, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255]);
    expect([...wandSelect(px, 4, 1, 0, 0, 10, true)]).toEqual([255, 255, 0, 0]);
    expect([...wandSelect(px, 4, 1, 0, 0, 10, false)]).toEqual([255, 255, 0, 255]);
  });
  it("traces outlines into closed paths", () => {
    const d = new Uint8Array([0, 0, 0, 0, 255, 255, 0, 255, 255]);
    expect(traceOutline(d, 3, 3)).toBe("M1 1L3 1L3 3L1 3L1 1Z");
  });
});
