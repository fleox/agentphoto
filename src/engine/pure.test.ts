// The DOM-free parts of the engine (canvas work is covered by headless renders).
import { describe, expect, it } from "vitest";
import { compositeOp } from "./canvas";
import { imageBoxSize } from "./compositor";
import { effectsPad, hasEffects } from "./effects";
import { alphaBBox } from "./index";
import { normStops } from "./paint";

describe("engine helpers", () => {
  it("imageBoxSize: explicit, natural, aspect from one side, crop", () => {
    const l = { id: "i", type: "image" as const, src: "a.png" };
    expect(imageBoxSize({ ...l, width: 10, height: 20 }, { width: 100, height: 50 })).toEqual({ w: 10, h: 20 });
    expect(imageBoxSize(l, { width: 100, height: 50 })).toEqual({ w: 100, h: 50 });
    expect(imageBoxSize({ ...l, width: 50 }, { width: 100, height: 50 })).toEqual({ w: 50, h: 25 });
    expect(imageBoxSize({ ...l, height: 10 }, { width: 100, height: 50 })).toEqual({ w: 20, h: 10 });
    expect(imageBoxSize({ ...l, width: 40, crop: { x: 0, y: 0, width: 20, height: 20 } }, { width: 100, height: 50 })).toEqual({ w: 40, h: 40 });
    expect(imageBoxSize(l, null)).toEqual({ w: 1, h: 1 });
  });
  it("effectsPad covers the reach of outside effects, scaled", () => {
    expect(effectsPad(undefined, 1)).toBe(0);
    expect(effectsPad({ colorOverlay: { color: "#fff" }, innerShadow: { blur: 50 } }, 1)).toBe(0);
    expect(effectsPad({ dropShadow: { distance: 10, blur: 20, spread: 2 } }, 1)).toBe(42 + 2);
    expect(effectsPad({ dropShadow: {} }, 0.5)).toBe(Math.ceil((12 + 24) * 0.5) + 2);
    expect(effectsPad({ stroke: { width: 8 } }, 1)).toBe(10);
    expect(effectsPad({ stroke: { width: 8, position: "inside" } }, 1)).toBe(0);
    expect(effectsPad({ outerGlow: { blur: 10 }, stroke: { width: 40 } }, 1)).toBe(42);
    expect(hasEffects({ dropShadow: null })).toBe(false);
    expect(hasEffects({ dropShadow: null, stroke: {} })).toBe(true);
  });
  it("compositeOp / normStops", () => {
    expect(compositeOp(undefined)).toBe("source-over");
    expect(compositeOp("normal")).toBe("source-over");
    expect(compositeOp("multiply")).toBe("multiply");
    expect(normStops(["#000", "#f00", "#fff"])).toEqual([[0, "#000"], [0.5, "#f00"], [1, "#fff"]]);
    expect(normStops([[2, "#000"], [-1, "#fff"]])).toEqual([[1, "#000"], [0, "#fff"]]);
    expect(normStops([])).toEqual([[0, "#000"], [1, "#fff"]]);
  });
  it("alphaBBox: kept pixels (≥ 50 %) or null", () => {
    const a = new Uint8ClampedArray(6 * 4);
    expect(alphaBBox(a, 6, 4)).toBeNull();
    a[1 * 6 + 2] = 200;
    a[2 * 6 + 4] = 128;
    a[3 * 6 + 5] = 127;
    expect(alphaBBox(a, 6, 4)).toEqual({ x: 2, y: 1, width: 3, height: 2 });
  });
});
