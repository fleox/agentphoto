import { describe, expect, it } from "vitest";
import type { PhotoDoc } from "../../core/types";
import { applyPatchOps } from "../../ops/doc";
import { groupOps, imageLayer, layerRows, moveOps, newId, nudgeOps } from "./layers";
import { colorAt, colorToHsv, convertPaint, formatColor, hsvToColor, paintColor, paintToCss, stopsOf } from "./paint";
import { adjustmentFromMarquee, cropFromMarquee, marqueeMask } from "./selection";
import { dragRect, handlePoint, resizeBox, rotateBox, snapRect, snapTargets } from "./transform";

const doc = (): PhotoDoc => ({
  version: 1,
  id: "t",
  canvas: { width: 200, height: 100 },
  layers: [
    { id: "bg", type: "fill", fill: "#fff" },
    { id: "g", type: "group", children: [{ id: "a", type: "shape", shape: "rect", x: 10, y: 10, width: 20, height: 20 }] },
    { id: "b", type: "text", text: "B", x: 5, y: 5 },
  ],
});

describe("paint helpers", () => {
  it("round-trips colours through HSV", () => {
    for (const c of ["#ff0000", "#00ff00", "#336699", "#000000", "#ffffff", "#7c8cff"]) expect(hsvToColor(colorToHsv(c))).toBe(c);
    expect(formatColor({ r: 255, g: 0, b: 0, a: 0.5 })).toBe("#ff000080");
    expect(hsvToColor({ ...colorToHsv("#123456"), a: 0.25 })).toBe("#12345640");
  });
  it("previews paints as CSS (document angle 0 = left → right)", () => {
    expect(paintToCss("#abc")).toBe("#abc");
    expect(paintToCss(null)).toBe("transparent");
    expect(paintToCss({ type: "linear", angle: 0, stops: ["#000", "#fff"] })).toBe("linear-gradient(90deg, #000 0%, #fff 100%)");
    expect(paintToCss({ type: "radial", stops: [[0, "red"], [1, "blue"]] })).toBe("radial-gradient(circle at 50% 50%, red 0%, blue 100%)");
  });
  it("edits gradient stops and converts paints", () => {
    expect(stopsOf({ type: "linear", stops: ["#000", "#888", "#fff"] })).toEqual([[0, "#000"], [0.5, "#888"], [1, "#fff"]]);
    expect(colorAt([[0, "#000000"], [1, "#ffffff"]], 0.5)).toBe("#808080");
    const g = convertPaint("#ff0000", "linear");
    expect(g).toMatchObject({ type: "linear", angle: 90, stops: [[0, "#ff0000"], [1, "#000000"]] });
    expect(convertPaint(g, "radial")).toMatchObject({ type: "radial", stops: [[0, "#ff0000"], [1, "#000000"]] });
    expect(convertPaint(g, "solid")).toBe("#ff0000");
    expect(paintColor(undefined, "#111")).toBe("#111");
  });
});

describe("transform math", () => {
  const box = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };
  it("resizes from a corner keeping the opposite corner", () => {
    expect(resizeBox(box, { hx: 1, hy: 1 }, { x: 150, y: 80 }, false)).toEqual({ x: 0, y: 0, width: 150, height: 80 });
    expect(resizeBox(box, { hx: -1, hy: -1 }, { x: -50, y: -10 }, false)).toEqual({ x: -50, y: -10, width: 150, height: 60 });
  });
  it("keeps the ratio with Shift and on side handles scales the other axis around the centre", () => {
    expect(resizeBox(box, { hx: 1, hy: 1 }, { x: 200, y: 60 }, true)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    const r = resizeBox(box, { hx: 1, hy: 0 }, { x: 200, y: 25 }, true);
    expect(r).toEqual({ x: 0, y: -25, width: 200, height: 100 });
  });
  it("resizes rotated boxes in their own frame", () => {
    const rot = { x: 0, y: 0, width: 100, height: 50, rotation: 90 };
    // The right handle of a box rotated 90° points down.
    const h = handlePoint(rot, { hx: 1, hy: 0 });
    expect(h.x).toBeCloseTo(50);
    expect(h.y).toBeCloseTo(75);
    const r = resizeBox(rot, { hx: 1, hy: 0 }, { x: 50, y: 125 }, false);
    expect(r.width).toBeCloseTo(150);
    expect(r.height).toBeCloseTo(50);
  });
  it("rotates around the centre with 15° snapping", () => {
    expect(rotateBox(box, { x: 100, y: 25 }, { x: 50, y: 100 }, false)).toBeCloseTo(90);
    expect(rotateBox(box, { x: 100, y: 25 }, { x: 100, y: 37 }, true)).toBe(15);
  });
  it("snaps to the canvas centre and other layers' edges", () => {
    const t = snapTargets({ width: 200, height: 100 }, [{ x: 150, y: 0, width: 20, height: 20 }]);
    const s = snapRect({ x: 88, y: 3, width: 20, height: 20 }, t, 5);
    expect(s.dx).toBe(2);
    expect(s.dy).toBe(-3);
    expect(s.guides).toEqual([{ axis: "x", at: 100 }, { axis: "y", at: 0 }]);
    expect(snapRect({ x: 60, y: 40, width: 5, height: 5 }, t, 2)).toEqual({ dx: 0, dy: 0, guides: [] });
  });
  it("builds drag rectangles (square, from the centre)", () => {
    expect(dragRect({ x: 10, y: 10 }, { x: 0, y: 30 })).toEqual({ x: 0, y: 10, width: 10, height: 20 });
    expect(dragRect({ x: 10, y: 10 }, { x: 15, y: 30 }, true)).toEqual({ x: 10, y: 10, width: 20, height: 20 });
    expect(dragRect({ x: 50, y: 50 }, { x: 60, y: 55 }, false, true)).toEqual({ x: 40, y: 45, width: 20, height: 10 });
  });
});

describe("layer helpers", () => {
  it("lists rows top → bottom with collapsed groups", () => {
    expect(layerRows(doc().layers, new Set()).map((r) => [r.layer.id, r.depth])).toEqual([["b", 0], ["g", 0], ["a", 1], ["bg", 0]]);
    expect(layerRows(doc().layers, new Set(["g"])).map((r) => r.layer.id)).toEqual(["b", "g", "bg"]);
  });
  it("builds valid move ops (above / below / into a group, never into itself)", () => {
    const d = doc();
    const into = applyPatchOps(d, moveOps(d, ["b"], "g", "inside")!);
    expect(into.layers.map((l) => l.id)).toEqual(["bg", "g"]);
    expect((into.layers[1] as { children: { id: string }[] }).children.map((c) => c.id)).toEqual(["a", "b"]);
    const below = applyPatchOps(d, moveOps(d, ["b"], "bg", "below")!);
    expect(below.layers.map((l) => l.id)).toEqual(["b", "bg", "g"]);
    expect(moveOps(d, ["g"], "a", "above")).toBeNull();
    expect(moveOps(d, ["b"], "bg", "inside")).toBeNull();
  });
  it("groups siblings only, with a fresh id", () => {
    const d = doc();
    const g = groupOps(d, ["b", "bg"])!;
    expect(g.id).toBe("group");
    expect(applyPatchOps(d, g.ops).layers.map((l) => l.id)).toEqual(["group", "g"]);
    expect(groupOps(d, ["a", "b"])).toBeNull();
  });
  it("nudges box layers (groups move their children) and fits new images", () => {
    const ops = nudgeOps(doc(), ["g", "b"], 2, -1);
    expect(ops).toEqual([
      { op: "updateLayer", id: "a", set: { x: 12, y: 9 } },
      { op: "updateLayer", id: "b", set: { x: 7, y: 4 } },
    ]);
    expect(newId(doc(), "B")).toBe("b-2");
    expect(imageLayer(doc(), "assets/images/x.png", { width: 400, height: 100 }, "x.png")).toMatchObject({ id: "x", type: "image", x: 0, y: 25, width: 200, height: 50 });
  });
});

describe("marquee selection", () => {
  const m = { kind: "ellipse" as const, x: 20, y: 30, width: 40, height: 20 };
  it("masks box layers in layer px and canvas layers in canvas px", () => {
    const d = doc();
    expect(marqueeMask(d.layers[2], m, { x: 5, y: 5, width: 50, height: 50, rotation: 0 })).toEqual({ shape: "ellipse", x: 15, y: 25, width: 40, height: 20 });
    expect(marqueeMask(d.layers[0], m, undefined)).toEqual({ shape: "ellipse", x: 20, y: 30, width: 40, height: 20 });
  });
  it("becomes an adjustment layer or a crop clamped to the canvas", () => {
    const d = doc();
    const r = adjustmentFromMarquee(d, m, "b", "Adjustment");
    const next = applyPatchOps(d, r.ops);
    expect(next.layers.at(-1)).toMatchObject({ id: r.id, type: "adjustment", mask: { shape: "ellipse", x: 20, y: 30 } });
    expect(cropFromMarquee(d, { kind: "rect", x: -10, y: 50, width: 400, height: 100 })).toEqual([{ op: "crop", x: 0, y: 50, width: 200, height: 50 }]);
    expect(cropFromMarquee(d, { kind: "rect", x: 300, y: 0, width: 10, height: 10 })).toBeNull();
  });
});
