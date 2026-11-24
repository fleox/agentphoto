import { describe, expect, it } from "vitest";
import { isDoubleTap, pinchView, tapTracker } from "./touch";

describe("pinchView", () => {
  const start = { zoom: 1, x: 100, y: 50 };

  it("zooms by the ratio of finger distances, keeping the point under the fingers", () => {
    const v = pinchView(start, { x: 200, y: 200 }, { x: 300, y: 200 }, { x: 150, y: 200 }, { x: 350, y: 200 });
    expect(v.zoom).toBe(2);
    // Document point under the midpoint (250, 200) stays there: (250 - 100) / 1 = 150 → 250 - 150 * 2.
    expect(v.x).toBe(-50);
    expect(v.y).toBe(200 - 150 * 2);
  });

  it("pans with the midpoint when the distance does not change", () => {
    const v = pinchView(start, { x: 200, y: 200 }, { x: 300, y: 200 }, { x: 230, y: 260 }, { x: 330, y: 260 });
    expect(v).toEqual({ zoom: 1, x: 130, y: 110 });
  });

  it("stays within the zoom limits", () => {
    const v = pinchView(start, { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: 0 }, { x: 501, y: 0 });
    expect(v.zoom).toBeGreaterThan(0);
    expect(v.zoom).toBeGreaterThanOrEqual(0.02);
  });
});

describe("double tap", () => {
  const touch = (t: number, x = 10, y = 10) => ({ pointerType: "touch", clientX: x, clientY: y, timeStamp: t });

  it("needs the same target, close in time and place", () => {
    const a = { key: "k", t: 0, x: 0, y: 0 };
    expect(isDoubleTap(a, { key: "k", t: 300, x: 10, y: 10 })).toBe(true);
    expect(isDoubleTap(a, { key: "other", t: 300, x: 0, y: 0 })).toBe(false);
    expect(isDoubleTap(a, { key: "k", t: 500, x: 0, y: 0 })).toBe(false);
    expect(isDoubleTap(a, { key: "k", t: 100, x: 60, y: 0 })).toBe(false);
    expect(isDoubleTap(null, a)).toBe(false);
  });

  it("tracks taps: the second one is a double tap, a third one starts over; the mouse is ignored", () => {
    const tap = tapTracker();
    expect(tap("canvas", touch(0))).toBe(false);
    expect(tap("canvas", touch(200))).toBe(true);
    expect(tap("canvas", touch(300))).toBe(false);
    const mouse = tapTracker();
    expect(mouse("canvas", { ...touch(0), pointerType: "mouse" })).toBe(false);
    expect(mouse("canvas", { ...touch(100), pointerType: "mouse" })).toBe(false);
  });
});
