// The DOM-free parts of the engine (canvas work is covered by headless renders).
import { afterEach, describe, expect, it, vi } from "vitest";
import { compositeOp } from "./canvas";
import { imageBoxSize } from "./compositor";
import { effectsPad, hasEffects } from "./effects";
import { filtersPad } from "./filters";
import { alphaBBox } from "./index";
import { fillStyle, normStops } from "./paint";
import { textInkBox, type TextLayout } from "./text";

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
  it("filtersPad gives spreading filters room to fade, scaled", () => {
    expect(filtersPad(undefined, 1)).toBe(0);
    expect(filtersPad([{ type: "brightness", value: 20 }, { type: "sharpen" }], 1)).toBe(0);
    expect(filtersPad([{ type: "blur", radius: 40 }], 1)).toBe(62);
    expect(filtersPad([{ type: "blur", radius: 40 }], 0.5)).toBe(32);
    expect(filtersPad([{ type: "blur" }], 1)).toBe(11); // default radius 6
    expect(filtersPad([{ type: "blur", radius: 40, enabled: false }], 1)).toBe(0);
    expect(filtersPad([{ type: "blur", radius: 10 }, { type: "motionBlur", distance: 20 }], 1)).toBe(27);
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

// A recording stand-in for a 2D context (no canvas in the node test runner).
function fakeCtx(width = 100, height = 100) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const rec = (fn: string, ret: unknown = undefined) => (...args: unknown[]) => {
    calls.push({ fn, args });
    return ret;
  };
  const gradient = { addColorStop: rec("addColorStop") };
  const ctx = {
    canvas: { width, height },
    calls,
    createRadialGradient: rec("createRadialGradient", gradient),
    createLinearGradient: rec("createLinearGradient", gradient),
    createPattern: rec("createPattern", { pattern: true }),
    setTransform: rec("setTransform"),
    fillRect: rec("fillRect"),
    fillStyle: null as unknown,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
  };
  return ctx;
}

describe("radial paints", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("square boxes: the same circular gradient as always (radius = half-diagonal × radius)", () => {
    const ctx = fakeCtx();
    fillStyle(ctx as never, { type: "radial", stops: ["#fff", "#000"] }, { x: 10, y: 20, w: 200, h: 200 });
    expect(ctx.calls.find((c) => c.fn === "createRadialGradient")?.args).toEqual([110, 120, 0, 110, 120, Math.hypot(200, 200) * 0.5]);
    expect(ctx.calls.some((c) => c.fn === "createPattern")).toBe(false);
  });
  it("wide boxes: an ellipse following the box (squashed circle painted as a pattern)", () => {
    const pctx = fakeCtx();
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return pctx;
        }
      },
    );
    const ctx = fakeCtx(400, 300);
    const out = fillStyle(ctx as never, { type: "radial", stops: ["#fff", "#000"], radius: 1 }, { x: 0, y: 100, w: 300, h: 60 });
    expect(out).toEqual({ pattern: true });
    const rx = 300 / Math.SQRT2;
    expect(pctx.calls.find((c) => c.fn === "createRadialGradient")?.args).toEqual([0, 0, 0, 0, 0, rx]);
    // y squashed by h / w around the centre (150, 130).
    const [a, b, c, d, e, f] = pctx.calls.find((x) => x.fn === "setTransform")!.args as number[];
    expect([a, b, c, e, f]).toEqual([1, 0, 0, 150, 130]);
    expect(d).toBeCloseTo(60 / 300);
    // Painted over the whole target canvas.
    const [fx, fy, fw, fh] = pctx.calls.find((x) => x.fn === "fillRect")!.args as number[];
    expect([fx, fw]).toEqual([-150, 400]);
    expect(fy * d).toBeCloseTo(-130);
    expect(fh * d).toBeCloseTo(300);
  });
});

describe("textInkBox", () => {
  const lay = (lines: { text: string; width: number }[], width: number, height = 200): TextLayout => ({ font: "", lines, width, height, lineHeight: 60, ascent: 40, descent: 10, textHeight: 60 * lines.length });
  const t = { id: "t", type: "text" as const, text: "x" };
  it("places lines by align and valign inside the box", () => {
    expect(textInkBox({ ...t, align: "center" }, lay([{ text: "Hi", width: 100 }], 500))).toEqual({ x: 200, y: 5, width: 100, height: 50 });
    expect(textInkBox({ ...t, align: "right", valign: "bottom" }, lay([{ text: "Hi", width: 100 }, { text: "there", width: 300 }], 500))).toEqual({ x: 200, y: 85, width: 300, height: 110 });
    expect(textInkBox(t, lay([{ text: "", width: 0 }], 500))).toBeNull();
  });
  it("includes the background with its padding", () => {
    expect(textInkBox({ ...t, background: { color: "#000", padding: [10, 4] } }, lay([{ text: "Hi", width: 100 }], 500, 60))).toEqual({ x: -10, y: -4, width: 520, height: 68 });
  });
});
