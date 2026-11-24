import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import type { FillLayer, GroupLayer, ImageLayer, Layer, LinearGradient, PhotoDoc, RadialGradient, TextLayer } from "../core/types";
import { tinyPng } from "../test-support/png";
import { OpsError } from "./context";
import { applyDoc, applyPatchOps, diffDocs, getDoc, PATCH_OPS, patchDoc, summarizeDoc, type PatchOp } from "./doc";
import { estimateTextBox, layerBox } from "./geometry";
import { findLayer } from "./tree";

const base = (): PhotoDoc => ({
  version: 1,
  id: "test",
  canvas: { width: 200, height: 100, background: "#ffffff" },
  layers: [
    { id: "bg", type: "fill", fill: "#000000", mask: { shape: "rect", x: 0, y: 0, width: 100, height: 50, feather: 4 } },
    { id: "photo", type: "image", src: "assets/images/photo.png", x: 10, y: 20, width: 40, height: 30, filters: [{ type: "blur", radius: 4 }, { type: "invert" }], effects: { dropShadow: { distance: 10, blur: 20, opacity: 0.5 } }, mask: { shape: "ellipse", x: 0, y: 0, width: 40, height: 30, feather: 2 } },
    {
      id: "g",
      type: "group",
      children: [
        { id: "title", type: "text", text: "Hello", x: 100, y: 10, width: 80, size: 20, letterSpacing: 2, background: { color: "#000", padding: [4, 2], radius: 3 } },
        { id: "badge", type: "shape", shape: "rect", x: 150, y: 60, width: 20, height: 20, fill: "#f00", radius: 4, stroke: { color: "#000", width: 2 } },
      ],
    },
    { id: "adj", type: "adjustment", filters: [{ type: "vibrance", vibrance: 20 }] },
  ],
});

const ids = (layers: Layer[]) => layers.map((l) => l.id);
const layer = <T extends Layer = Layer>(doc: PhotoDoc, id: string) => findLayer(doc.layers, id)!.layer as T;
const apply = (ops: PatchOp[], doc = base()) => applyPatchOps(doc, ops);
function opError(fn: () => unknown): OpsError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(OpsError);
    return e as OpsError;
  }
  throw new Error("expected an OpsError");
}

async function project(doc: PhotoDoc = base(), extra: Record<string, string | Uint8Array> = {}): Promise<MemoryFs> {
  return new MemoryFs({ "agentphoto.json": JSON.stringify({ name: "t", createdAt: "x", updatedAt: "x", agentphoto: "0" }), "photo.json": JSON.stringify(doc), ...extra });
}

describe("summarizeDoc", () => {
  it("lists layers top → bottom with children, counts and sources", () => {
    const s = summarizeDoc(base());
    expect(s.canvas).toEqual({ width: 200, height: 100, background: "#ffffff" });
    expect(s.layers.map((l) => l.id)).toEqual(["adj", "g", "photo", "bg"]);
    expect(s.layers[1].children!.map((l) => l.id)).toEqual(["badge", "title"]);
    expect(s.layers[2]).toMatchObject({ type: "image", box: [10, 20, 40, 30], mask: "shape", filters: ["blur", "invert"], effects: ["dropShadow"] });
    expect(s.layers[2]).not.toHaveProperty("parent");
    // Adjustment layers list their filters in the same column as any layer.
    expect(s.layers[0]).toMatchObject({ type: "adjustment", detail: "filters the layers below", filters: ["vibrance"] });
    expect(s.counts).toEqual({ layers: 6, byType: { fill: 1, image: 1, group: 1, text: 1, shape: 1, adjustment: 1 }, hidden: 0, masks: 2, filters: 3 });
    expect(s.sources).toEqual(["assets/images/photo.png"]);
    const d = base();
    d.canvas.background = { type: "linear", stops: ["#000", "#fff"] };
    d.layers[0].visible = false;
    const s2 = summarizeDoc(d);
    expect(s2.canvas.background).toBe("linear gradient");
    expect(s2.counts.hidden).toBe(1);
    expect(s2.layers[3].hidden).toBe(true);
    d.canvas.background = null;
    expect(summarizeDoc(d).canvas.background).toBe("transparent");
  });
});

describe("diffDocs", () => {
  it("reports added, removed, changed, moved and sections", () => {
    const a = base();
    expect(diffDocs(a, base())).toMatchObject({ empty: true, summary: "No change." });
    const b = apply([{ op: "removeLayer", id: "adj" }, { op: "addLayer", layer: { id: "new", type: "text", text: "x" } }, { op: "set", path: "layers#title.size", value: 30 }, { op: "set", path: "canvas.width", value: 300 }]);
    const p = diffDocs(a, b);
    expect(p.layers.added).toEqual(["new"]);
    expect(p.layers.removed).toEqual(["adj"]);
    expect(p.layers.changed).toEqual([{ id: "title", fields: ["size"] }]);
    expect(p.sections).toEqual(["canvas"]);
    expect(p.summary).toContain("added new");
    const moved = diffDocs(a, apply([{ op: "moveLayer", id: "photo", parent: "g" }]));
    expect(moved.layers.moved.map((m) => m.id)).toContain("photo");
    expect(moved.layers.moved.find((m) => m.id === "photo")).toEqual({ id: "photo", from: "root[1]", to: "g[2]" });
    const fresh = diffDocs(null, a);
    expect(fresh.layers.added).toHaveLength(6);
    expect(fresh.sections).toContain("canvas");
  });
});

describe("applyPatchOps — paths", () => {
  it("set / merge / remove", () => {
    const d = apply([
      { op: "set", path: "layers#title.color", value: "#ff0000" },
      { op: "merge", path: "layers#photo.effects", value: { dropShadow: { blur: 5 }, stroke: { width: 3 } } },
      { op: "merge", path: "export", value: { format: "png" } },
      { op: "remove", path: "layers#photo.filters[1]" },
      { op: "merge", path: "layers#title.background", value: { radius: null } },
    ]);
    expect(layer<TextLayer>(d, "title").color).toBe("#ff0000");
    expect(layer<ImageLayer>(d, "photo").effects).toEqual({ dropShadow: { distance: 10, blur: 5, opacity: 0.5 }, stroke: { width: 3 } });
    expect(d.export).toEqual({ format: "png" });
    expect(layer(d, "photo").filters).toEqual([{ type: "blur", radius: 4 }]);
    expect(layer<TextLayer>(d, "title").background).toEqual({ color: "#000", padding: [4, 2] });
  });
  it("path errors carry the op index", () => {
    const e = opError(() => apply([{ op: "set", path: "canvas.width", value: 5 }, { op: "set", path: "layers#nope.x", value: 1 }]));
    expect(e.code).toBe("invalid");
    expect(e.details).toEqual({ opIndex: 1 });
    expect(e.message).toMatch(/^ops\[1\] \(set\)/);
    expect(opError(() => apply([{ op: "remove", path: "layers#title.nothing" }])).code).toBe("notFound");
    expect(opError(() => apply([{ op: "set" } as unknown as PatchOp])).message).toContain('"path" is required');
  });
  it("rejects unknown ops with a suggestion, and non-arrays", () => {
    const e = opError(() => apply([{ op: "addlayer" } as unknown as PatchOp]));
    expect(e.hint).toContain('Did you mean "addLayer"');
    expect(opError(() => apply([5 as unknown as PatchOp])).details).toEqual({ opIndex: 0 });
    expect(opError(() => applyPatchOps(base(), {} as unknown as PatchOp[])).code).toBe("invalid");
  });
  it("covers every op of PATCH_OPS in this file", () => {
    expect(PATCH_OPS).toHaveLength(20);
  });
  it("never mutates its input", () => {
    const d = base();
    const before = JSON.stringify(d);
    apply([{ op: "set", path: "layers#title.size", value: 3 }, { op: "rotateCanvas", angle: 90 }, { op: "removeLayer", id: "g" }], d);
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe("applyPatchOps — layers", () => {
  it("addLayer: default top, above / below / parent / index", () => {
    const t = (id: string): Layer => ({ id, type: "fill", fill: "red" });
    expect(ids(apply([{ op: "addLayer", layer: t("n") }]).layers)).toEqual(["bg", "photo", "g", "adj", "n"]);
    expect(ids(apply([{ op: "addLayer", layer: t("n"), above: "bg" }]).layers)).toEqual(["bg", "n", "photo", "g", "adj"]);
    expect(ids(apply([{ op: "addLayer", layer: t("n"), below: "bg" }]).layers)).toEqual(["n", "bg", "photo", "g", "adj"]);
    expect(ids(apply([{ op: "addLayer", layer: t("n"), index: 1 }]).layers)).toEqual(["bg", "n", "photo", "g", "adj"]);
    expect(ids(apply([{ op: "addLayer", layer: t("n"), index: 99 }]).layers)).toEqual(["bg", "photo", "g", "adj", "n"]);
    expect(ids(layer<GroupLayer>(apply([{ op: "addLayer", layer: t("n"), parent: "g", index: 0 }]), "g").children)).toEqual(["n", "title", "badge"]);
    expect(ids(layer<GroupLayer>(apply([{ op: "addLayer", layer: t("n"), above: "title" }]), "g").children)).toEqual(["title", "n", "badge"]);
  });
  it("addLayer: refuses taken / invalid ids (also in children) and non-group parents", () => {
    const taken = opError(() => apply([{ op: "addLayer", layer: { id: "title", type: "text", text: "x" } }]));
    expect(taken.code).toBe("conflict");
    expect(taken.hint).toContain("title-2");
    expect(opError(() => apply([{ op: "addLayer", layer: { id: "ng", type: "group", children: [{ id: "badge", type: "fill", fill: "red" }] } }])).code).toBe("conflict");
    expect(opError(() => apply([{ op: "addLayer", layer: { id: "ng", type: "group", children: [{ id: "x", type: "fill", fill: "red" }, { id: "x", type: "fill", fill: "red" }] } }])).code).toBe("conflict");
    expect(opError(() => apply([{ op: "addLayer", layer: { id: "1x", type: "fill", fill: "red" } }])).code).toBe("invalid");
    expect(opError(() => apply([{ op: "addLayer", layer: { id: "n", type: "fill", fill: "red" }, parent: "photo" }])).message).toContain("not a group");
    expect(opError(() => apply([{ op: "addLayer", layer: { id: "n", type: "fill", fill: "red" }, above: "nope" }])).code).toBe("notFound");
    expect(opError(() => apply([{ op: "addLayer" } as unknown as PatchOp])).code).toBe("invalid");
  });
  it("updateLayer: deep merge, null deletes, forbidden keys", () => {
    const d = apply([{ op: "updateLayer", id: "photo", set: { x: 5, mask: null, effects: { dropShadow: { blur: 1 }, outerGlow: { blur: 3 } } } }]);
    const p = layer<ImageLayer>(d, "photo");
    expect(p.x).toBe(5);
    expect(p).not.toHaveProperty("mask");
    expect(p.effects).toEqual({ dropShadow: { distance: 10, blur: 1, opacity: 0.5 }, outerGlow: { blur: 3 } });
    expect(p.width).toBe(40);
    // A layer inside a group.
    expect(layer<TextLayer>(apply([{ op: "updateLayer", id: "title", set: { size: 50 } }]), "title").size).toBe(50);
    for (const k of ["id", "type", "children"]) expect(opError(() => apply([{ op: "updateLayer", id: "g", set: { [k]: "x" } }])).message).toContain(`cannot change "${k}"`);
    expect(opError(() => apply([{ op: "updateLayer", id: "g" } as unknown as PatchOp])).code).toBe("invalid");
    const nf = opError(() => apply([{ op: "updateLayer", id: "titel", set: {} }]));
    expect(nf.code).toBe("notFound");
    expect(nf.hint).toContain('Did you mean "title"');
  });
  it("removeLayer removes a layer with its children", () => {
    expect(ids(apply([{ op: "removeLayer", id: "g" }]).layers)).toEqual(["bg", "photo", "adj"]);
    expect(ids(layer<GroupLayer>(apply([{ op: "removeLayer", id: "title" }]), "g").children)).toEqual(["badge"]);
    expect(opError(() => apply([{ op: "removeLayer" } as unknown as PatchOp])).code).toBe("invalid");
  });
  it("moveLayer within and between groups", () => {
    expect(ids(apply([{ op: "moveLayer", id: "bg" }]).layers)).toEqual(["photo", "g", "adj", "bg"]);
    expect(ids(apply([{ op: "moveLayer", id: "adj", index: 0 }]).layers)).toEqual(["adj", "bg", "photo", "g"]);
    expect(ids(apply([{ op: "moveLayer", id: "bg", above: "g" }]).layers)).toEqual(["photo", "g", "bg", "adj"]);
    expect(ids(apply([{ op: "moveLayer", id: "adj", below: "photo" }]).layers)).toEqual(["bg", "adj", "photo", "g"]);
    const into = apply([{ op: "moveLayer", id: "photo", parent: "g", index: 1 }]);
    expect(ids(into.layers)).toEqual(["bg", "g", "adj"]);
    expect(ids(layer<GroupLayer>(into, "g").children)).toEqual(["title", "photo", "badge"]);
    const out = apply([{ op: "moveLayer", id: "title", parent: null, index: 0 }]);
    expect(ids(out.layers)).toEqual(["title", "bg", "photo", "g", "adj"]);
    const rel = apply([{ op: "moveLayer", id: "photo", below: "badge" }]);
    expect(ids(layer<GroupLayer>(rel, "g").children)).toEqual(["title", "photo", "badge"]);
  });
  it("moveLayer refuses cycles", () => {
    const d = apply([{ op: "addLayer", layer: { id: "inner", type: "group", children: [] }, parent: "g" }]);
    expect(opError(() => apply([{ op: "moveLayer", id: "g", parent: "g" }], d)).message).toContain("into itself");
    expect(opError(() => apply([{ op: "moveLayer", id: "g", parent: "inner" }], d)).message).toContain("into itself");
    expect(opError(() => apply([{ op: "moveLayer", id: "g", above: "title" }], d)).message).toContain("its own child");
    expect(opError(() => apply([{ op: "moveLayer", id: "g", below: "g" }], d)).code).toBe("invalid");
  });
  it("duplicateLayer gives unique ids to the copy and its children", () => {
    const d = apply([{ op: "duplicateLayer", id: "g", offset: [5, 5] }]);
    expect(ids(d.layers)).toEqual(["bg", "photo", "g", "g-copy", "adj"]);
    expect(ids(layer<GroupLayer>(d, "g-copy").children)).toEqual(["title-copy", "badge-copy"]);
    // The offset moves the group's children too.
    expect(layer(d, "title-copy")).toMatchObject({ x: 105, y: 15 });
    expect(layer(d, "badge-copy")).toMatchObject({ x: 155, y: 65 });
    expect(layer(d, "title")).toMatchObject({ x: 100, y: 10 });
    expect(layer(apply([{ op: "duplicateLayer", id: "bg", offset: [3, 4] }]), "bg-copy").mask).toMatchObject({ x: 3, y: 4 });
    expect(opError(() => apply([{ op: "duplicateLayer", id: "bg", offset: ["a", 1] } as unknown as PatchOp])).code).toBe("invalid");
    const twice = apply([{ op: "duplicateLayer", id: "photo", offset: [5, -5] }, { op: "duplicateLayer", id: "photo", newId: "photo-b" }]);
    expect(ids(twice.layers)).toEqual(["bg", "photo", "photo-b", "photo-copy", "g", "adj"]);
    expect(layer<ImageLayer>(twice, "photo-copy")).toMatchObject({ x: 15, y: 15, width: 40 });
    const named = apply([{ op: "updateLayer", id: "title", set: { name: "Title" } }, { op: "duplicateLayer", id: "title" }]);
    expect(layer(named, "title-copy").name).toBe("Title copy");
    expect(opError(() => apply([{ op: "duplicateLayer", id: "photo", newId: "bg" }])).code).toBe("conflict");
    expect(opError(() => apply([{ op: "duplicateLayer", id: "photo", newId: "9" }])).code).toBe("conflict");
  });
  it("groupLayers / ungroup", () => {
    const d = apply([{ op: "groupLayers", ids: ["adj", "photo"], id: "pair", name: "Pair" }]);
    expect(ids(d.layers)).toEqual(["bg", "pair", "g"]);
    expect(layer<GroupLayer>(d, "pair")).toMatchObject({ type: "group", name: "Pair" });
    expect(ids(layer<GroupLayer>(d, "pair").children)).toEqual(["photo", "adj"]);
    // Duplicate ids are grouped once (no neighbour lost).
    const dup = apply([{ op: "groupLayers", ids: ["photo", "photo"], id: "solo" }]);
    expect(ids(dup.layers)).toEqual(["bg", "solo", "g", "adj"]);
    expect(ids(layer<GroupLayer>(dup, "solo").children)).toEqual(["photo"]);
    expect(opError(() => apply([{ op: "groupLayers", ids: ["photo", "title"], id: "x" }])).message).toContain("siblings");
    expect(opError(() => apply([{ op: "groupLayers", ids: ["photo"], id: "g" }])).code).toBe("conflict");
    expect(opError(() => apply([{ op: "groupLayers", ids: [], id: "x" }])).code).toBe("invalid");
    const un = apply([{ op: "ungroup", id: "g" }]);
    expect(ids(un.layers)).toEqual(["bg", "photo", "title", "badge", "adj"]);
    expect(opError(() => apply([{ op: "ungroup", id: "photo" }])).message).toContain("not a group");
  });
  it("addFilter / updateFilter / removeFilter", () => {
    const d = apply([
      { op: "addFilter", id: "title", filter: { type: "blur", radius: 2 } },
      { op: "addFilter", id: "photo", filter: { type: "sepia" }, index: 0 },
      { op: "updateFilter", id: "photo", index: 1, set: { radius: 8, amount: 0.5 } },
      { op: "removeFilter", id: "photo", index: 2 },
      { op: "updateFilter", id: "adj", index: 0, set: { saturation: 10, vibrance: null } },
    ]);
    expect(layer(d, "title").filters).toEqual([{ type: "blur", radius: 2 }]);
    expect(layer(d, "photo").filters).toEqual([{ type: "sepia" }, { type: "blur", radius: 8, amount: 0.5 }]);
    expect(layer(d, "adj").filters).toEqual([{ type: "vibrance", saturation: 10 }]);
    for (const index of [5, -1, 0.5, "0"]) {
      const e = opError(() => apply([{ op: "updateFilter", id: "photo", index, set: {} } as unknown as PatchOp]));
      expect(e.message).toContain("has no filter at index");
      expect(e.details).toEqual({ opIndex: 0 });
    }
    expect(opError(() => apply([{ op: "removeFilter", id: "title", index: 0 }])).message).toContain("it has 0");
    expect(opError(() => apply([{ op: "addFilter", id: "photo", filter: { radius: 3 } } as unknown as PatchOp])).code).toBe("invalid");
    expect(opError(() => apply([{ op: "updateFilter", id: "photo", index: 0 } as unknown as PatchOp])).code).toBe("invalid");
  });
  it("setMask sets and clears", () => {
    const d = apply([{ op: "setMask", id: "title", mask: { gradient: { type: "linear", stops: ["white", "black"] } } }, { op: "setMask", id: "photo", mask: null }]);
    expect(layer(d, "title").mask).toEqual({ gradient: { type: "linear", stops: ["white", "black"] } });
    expect(layer(d, "photo")).not.toHaveProperty("mask");
  });
});

describe("applyPatchOps — geometry", () => {
  it("crop translates boxes and canvas-space masks", () => {
    const d = apply([{ op: "crop", x: 10, y: 5, width: 100.4, height: 50 }]);
    expect(d.canvas).toMatchObject({ width: 100, height: 50 });
    expect(layer<ImageLayer>(d, "photo")).toMatchObject({ x: 0, y: 15, width: 40 });
    expect(layer<TextLayer>(d, "title")).toMatchObject({ x: 90, y: 5 });
    expect(layer(d, "bg").mask).toMatchObject({ x: -10, y: -5, width: 100 });
    // Layer-local masks do not move.
    expect(layer(d, "photo").mask).toMatchObject({ x: 0, y: 0 });
    expect(opError(() => apply([{ op: "crop", x: 0, y: 0, width: 0, height: 5 }])).details).toEqual({ opIndex: 0 });
  });
  it("resizeCanvas keeps content at the anchor", () => {
    const at = (anchor?: string) => layer<ImageLayer>(apply([{ op: "resizeCanvas", width: 300, height: 200, anchor } as PatchOp]), "photo");
    expect(at()).toMatchObject({ x: 60, y: 70 });
    expect(at("center")).toMatchObject({ x: 60, y: 70 });
    expect(at("top-left")).toMatchObject({ x: 10, y: 20 });
    expect(at("bottom-right")).toMatchObject({ x: 110, y: 120 });
    expect(at("top")).toMatchObject({ x: 60, y: 20 });
    expect(at("left")).toMatchObject({ x: 10, y: 70 });
    expect(apply([{ op: "resizeCanvas", width: 300, height: 200 }]).canvas).toMatchObject({ width: 300, height: 200, background: "#ffffff" });
    expect(opError(() => apply([{ op: "resizeCanvas", width: 300, height: 200, anchor: "middle" } as unknown as PatchOp])).hint).toContain("top-left");
    expect(opError(() => apply([{ op: "resizeCanvas", width: 0, height: 200 }])).code).toBe("invalid");
  });
  it("resizeImage scales boxes, text, px params, effects and masks", () => {
    const d = apply([{ op: "resizeImage", scale: 0.5 }]);
    expect(d.canvas).toMatchObject({ width: 100, height: 50 });
    const p = layer<ImageLayer>(d, "photo");
    expect(p).toMatchObject({ x: 5, y: 10, width: 20, height: 15 });
    expect(p.filters).toEqual([{ type: "blur", radius: 2 }, { type: "invert" }]);
    expect(p.effects!.dropShadow).toEqual({ distance: 5, blur: 10, opacity: 0.5 });
    expect(p.mask).toEqual({ shape: "ellipse", x: 0, y: 0, width: 20, height: 15, feather: 1 });
    const t = layer<TextLayer>(d, "title");
    expect(t).toMatchObject({ x: 50, y: 5, width: 40, size: 10, letterSpacing: 1, background: { padding: [2, 1], radius: 1.5 } });
    expect(layer(d, "badge")).toMatchObject({ width: 10, radius: 2, stroke: { width: 1 } });
    expect(layer(d, "bg").mask).toEqual({ shape: "rect", x: 0, y: 0, width: 50, height: 25, feather: 2 });
    // Non-px params are untouched.
    expect(layer(d, "adj").filters).toEqual([{ type: "vibrance", vibrance: 20 }]);
  });
  it("resizeImage by width / height / both", () => {
    expect(apply([{ op: "resizeImage", width: 400 }]).canvas).toMatchObject({ width: 400, height: 200 });
    expect(apply([{ op: "resizeImage", height: 50 }]).canvas).toMatchObject({ width: 100, height: 50 });
    const both = apply([{ op: "resizeImage", width: 400, height: 100 }]);
    expect(both.canvas).toMatchObject({ width: 400, height: 100 });
    expect(layer<ImageLayer>(both, "photo")).toMatchObject({ x: 20, y: 20, width: 80, height: 30 });
    expect(opError(() => apply([{ op: "resizeImage" }])).code).toBe("invalid");
    expect(opError(() => apply([{ op: "resizeImage", scale: 0 }])).details).toEqual({ opIndex: 0 });
  });
  it("rotateCanvas maps layer centres and swaps the canvas", () => {
    // photo box (10, 20, 40, 30): centre (30, 35) on a 200 × 100 canvas.
    const r90 = apply([{ op: "rotateCanvas", angle: 90 }]);
    expect(r90.canvas).toMatchObject({ width: 100, height: 200 });
    expect(layer<ImageLayer>(r90, "photo")).toMatchObject({ x: 45, y: 15, width: 40, height: 30, rotation: 90 });
    const r180 = apply([{ op: "rotateCanvas", angle: 180 }]);
    expect(r180.canvas).toMatchObject({ width: 200, height: 100 });
    expect(layer<ImageLayer>(r180, "photo")).toMatchObject({ x: 150, y: 50 });
    expect(Math.abs(layer<ImageLayer>(r180, "photo").rotation!)).toBe(180);
    const r270 = apply([{ op: "rotateCanvas", angle: -90 }]);
    expect(r270.canvas).toMatchObject({ width: 100, height: 200 });
    expect(layer<ImageLayer>(r270, "photo")).toMatchObject({ x: 15, y: 155, rotation: -90 });
    expect(layer<ImageLayer>(apply([{ op: "rotateCanvas", angle: 270 }]), "photo")).toMatchObject({ x: 15, y: 155, rotation: -90 });
    // Canvas-space shape mask: box (0, 0, 100, 50) → rotated 90: (50, 0, 50, 100).
    expect(layer(r90, "bg").mask).toMatchObject({ x: 50, y: 0, width: 50, height: 100 });
    // Four quarter turns are the identity.
    const four = apply([{ op: "rotateCanvas", angle: 90 }, { op: "rotateCanvas", angle: 90 }, { op: "rotateCanvas", angle: 90 }, { op: "rotateCanvas", angle: 90 }]);
    expect(layer(four, "photo")).toEqual(layer(base(), "photo"));
    expect(four.canvas).toEqual(base().canvas);
    expect(apply([{ op: "rotateCanvas", angle: 0 }])).toEqual(base());
    expect(opError(() => apply([{ op: "rotateCanvas", angle: 45 }])).hint).toContain("rotation");
  });
  it("rotateCanvas keeps rotations in (-180, 180]", () => {
    const d = base();
    (d.layers[1] as ImageLayer).rotation = -170;
    expect(layer<ImageLayer>(apply([{ op: "rotateCanvas", angle: 90 }], d), "photo").rotation).toBe(-80);
    (d.layers[1] as ImageLayer).rotation = -350;
    expect(layer<ImageLayer>(apply([{ op: "rotateCanvas", angle: 90 }], d), "photo").rotation).toBe(100);
    (d.layers[1] as ImageLayer).rotation = 90;
    expect(layer<ImageLayer>(apply([{ op: "rotateCanvas", angle: 90 }], d), "photo").rotation).toBe(180);
    expect(layer<ImageLayer>(apply([{ op: "rotateCanvas", angle: -90 }], d), "photo")).not.toHaveProperty("rotation");
  });
  it("rotate / flip turn canvas-wide gradients with the picture", () => {
    const d = base();
    d.canvas.background = { type: "linear", angle: 0, stops: ["#000", "#fff"] };
    (d.layers[0] as FillLayer).fill = { type: "radial", cx: 0.2, cy: 0.1, stops: ["#000", "#fff"] };
    d.layers[3].mask = { gradient: { type: "linear", stops: ["white", "black"] } };
    const r = apply([{ op: "rotateCanvas", angle: 90 }], d);
    expect((r.canvas.background as LinearGradient).angle).toBe(90);
    expect(layer<FillLayer>(r, "bg").fill).toMatchObject({ cx: 0.9, cy: 0.2 });
    expect((layer(r, "adj").mask as { gradient: LinearGradient }).gradient.angle).toBe(180);
    const h = apply([{ op: "flipCanvas", axis: "horizontal" }], d);
    expect((h.canvas.background as LinearGradient).angle).toBe(180);
    expect(layer<FillLayer>(h, "bg").fill).toMatchObject({ cx: 0.8, cy: 0.1 });
    const v = apply([{ op: "flipCanvas", axis: "vertical" }], d);
    expect((v.canvas.background as LinearGradient).angle).toBe(0);
    expect((layer<FillLayer>(v, "bg").fill as RadialGradient).cy).toBe(0.9);
    expect((layer(v, "adj").mask as { gradient: LinearGradient }).gradient.angle).toBe(-90);
  });
  it("flipCanvas mirrors boxes, toggles flips (not for text) and negates rotation", () => {
    const d = base();
    (d.layers[1] as ImageLayer).rotation = 30;
    const h = apply([{ op: "flipCanvas", axis: "horizontal" }], d);
    expect(layer<ImageLayer>(h, "photo")).toMatchObject({ x: 150, y: 20, flipX: true, rotation: -30 });
    expect(layer<TextLayer>(h, "title")).toMatchObject({ x: 20 });
    expect(layer<TextLayer>(h, "title")).not.toHaveProperty("flipX");
    expect(layer(h, "bg").mask).toMatchObject({ x: 100, y: 0 });
    const v = apply([{ op: "flipCanvas", axis: "vertical" }]);
    expect(layer<ImageLayer>(v, "photo")).toMatchObject({ x: 10, y: 50, flipY: true });
    const twice = apply([{ op: "flipCanvas", axis: "horizontal" }, { op: "flipCanvas", axis: "horizontal" }], d);
    expect(layer(twice, "photo")).toEqual(layer(d, "photo"));
    expect(opError(() => apply([{ op: "flipCanvas", axis: "diagonal" } as unknown as PatchOp])).code).toBe("invalid");
  });
  it("fitLayer scales and moves a layer so its subject fits a box, on an anchor", () => {
    const r = apply([{ op: "fitLayer", id: "photo", subject: { x: 20, y: 30, width: 10, height: 10 }, box: { x: 100, y: 0, width: 50, height: 100 }, anchor: "bottom" }]);
    const p = layer<ImageLayer>(r, "photo");
    expect(p).toMatchObject({ x: 50, y: 0, width: 200, height: 150 });
    expect(p.filters?.[0]).toMatchObject({ type: "blur", radius: 20 });
    expect(p.effects?.dropShadow).toMatchObject({ distance: 50, blur: 100 });
    expect(p.mask).toMatchObject({ width: 200, height: 150, feather: 10 });
    // The subject now sits at the bottom of the box: (100, 50) 50 × 50.
    expect([p.x! + 10 * 5, p.y! + 10 * 5]).toEqual([100, 50]);
    // Default subject = the whole layer, centred; layers inside groups too.
    expect(layer<ImageLayer>(apply([{ op: "fitLayer", id: "photo", box: { x: 0, y: 0, width: 80, height: 80 } }]), "photo")).toMatchObject({ x: 0, y: 10, width: 80, height: 60 });
    expect(layer(apply([{ op: "fitLayer", id: "badge", box: { x: 0, y: 0, width: 10, height: 10 }, anchor: "top-left" }]), "badge")).toMatchObject({ x: 0, y: 0, width: 10, height: 10, radius: 2 });
    expect(opError(() => apply([{ op: "fitLayer", id: "bg", box: { x: 0, y: 0, width: 10, height: 10 } }])).code).toBe("invalid");
    expect(opError(() => apply([{ op: "fitLayer", id: "nope", box: { x: 0, y: 0, width: 10, height: 10 } }])).code).toBe("notFound");
    expect(opError(() => apply([{ op: "fitLayer", id: "photo", box: { x: 0, y: 0, width: 0, height: 10 } }])).code).toBe("invalid");
    expect(opError(() => apply([{ op: "fitLayer", id: "photo", box: { x: 0, y: 0, width: 10, height: 10 }, anchor: "middle" as never }])).code).toBe("invalid");
  });
  it("geometry ops need image sizes: from sizes, from crop, or an error", () => {
    const d = base();
    const p = d.layers[1] as ImageLayer;
    delete p.width;
    delete p.height;
    expect(opError(() => applyPatchOps(d, [{ op: "set", path: "title", value: "x" }, { op: "rotateCanvas", angle: 90 }])).details).toEqual({ opIndex: 1 });
    const r = applyPatchOps(d, [{ op: "rotateCanvas", angle: 90 }], { "assets/images/photo.png": { width: 40, height: 30 } });
    expect(layer<ImageLayer>(r, "photo")).toMatchObject({ x: 45, y: 15, width: 40, height: 30 });
    p.crop = { x: 0, y: 0, width: 20, height: 10 };
    p.width = 40;
    expect(layer<ImageLayer>(applyPatchOps(d, [{ op: "flipCanvas", axis: "horizontal" }]), "photo")).toMatchObject({ width: 40, height: 20 });
  });
  it("layerBox / estimateTextBox", () => {
    expect(layerBox(layer(base(), "bg"))).toBeNull();
    expect(layerBox({ id: "i", type: "image", src: "a.png", height: 50 }, { "a.png": { width: 200, height: 100 } })).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(layerBox({ id: "i", type: "image", src: "a.png" })).toBeNull();
    const est = estimateTextBox({ id: "t", type: "text", text: "ab\nabcd", size: 10 });
    expect(est.width).toBeCloseTo(4 * 10 * 0.55);
    expect(est.height).toBeCloseTo(2 * 10 * 1.2);
  });
});

describe("patchDoc / applyDoc on a project", () => {
  it("writes valid patches and bumps the manifest", async () => {
    const fs = await project();
    const r = await patchDoc(fs, [{ op: "set", path: "layers#title.size", value: 30 }]);
    expect(r.applied).toBe(true);
    expect(((await getDoc(fs)).layers[2] as GroupLayer).children[0]).toMatchObject({ size: 30 });
    expect(JSON.parse(await fs.readText("agentphoto.json")).updatedAt).not.toBe("x");
  });
  it("is atomic: a failing op writes nothing", async () => {
    const fs = await project();
    const before = await fs.readText("photo.json");
    await expect(patchDoc(fs, [{ op: "set", path: "layers#title.size", value: 30 }, { op: "removeLayer", id: "ghost" }])).rejects.toMatchObject({ code: "notFound", details: { opIndex: 1 } });
    expect(await fs.readText("photo.json")).toBe(before);
  });
  it("refuses invalid results, reports unchanged and dry runs", async () => {
    const fs = await project();
    const before = await fs.readText("photo.json");
    const bad = await patchDoc(fs, [{ op: "set", path: "layers#title.size", value: "huge" }]);
    expect(bad.applied).toBe(false);
    expect(bad.issues.some((i) => i.severity === "error" && i.path === "layers#title.size")).toBe(true);
    expect(bad.doc).toEqual(JSON.parse(before));
    expect(await fs.readText("photo.json")).toBe(before);
    const same = await patchDoc(fs, [{ op: "set", path: "layers#title.size", value: 20 }]);
    expect(same).toMatchObject({ applied: false, plan: { empty: true } });
    const dry = await patchDoc(fs, [{ op: "removeLayer", id: "adj" }], { dryRun: true });
    expect(dry.applied).toBe(false);
    expect(dry.plan.layers.removed).toEqual(["adj"]);
    expect(await fs.readText("photo.json")).toBe(before);
  });
  it("reads image sizes from the asset header for geometry ops", async () => {
    const d = base();
    const p = d.layers[1] as ImageLayer;
    delete p.width;
    delete p.height;
    const fs = await project(d, { "assets/images/photo.png": tinyPng(40, 30) });
    const r = await patchDoc(fs, [{ op: "rotateCanvas", angle: 90 }]);
    expect(r.applied).toBe(true);
    expect(layer<ImageLayer>(await getDoc(fs), "photo")).toMatchObject({ x: 45, y: 15, width: 40, height: 30, rotation: 90 });
    // library: refs use readLibrary.
    const d2 = base();
    (d2.layers[1] as ImageLayer).src = "library:portrait";
    delete (d2.layers[1] as ImageLayer).width;
    delete (d2.layers[1] as ImageLayer).height;
    const fs2 = await project(d2);
    await expect(patchDoc(fs2, [{ op: "resizeImage", scale: 2 }])).rejects.toMatchObject({ code: "invalid", details: { opIndex: 0 } });
    const asked: string[] = [];
    await patchDoc(fs2, [{ op: "resizeImage", scale: 2 }], { readLibrary: async (id) => (asked.push(id), tinyPng(10, 10)) });
    expect(asked).toEqual(["portrait"]);
    expect(layer<ImageLayer>(await getDoc(fs2), "photo")).toMatchObject({ width: 20, height: 20 });
  });
  it("applyDoc validates, diffs and never throws on invalid documents", async () => {
    const fs = await project();
    const before = await fs.readText("photo.json");
    const bad = await applyDoc(fs, { ...base(), canvas: { width: -1, height: 10 } });
    expect(bad.applied).toBe(false);
    expect(bad.issues.some((i) => i.path === "canvas.width")).toBe(true);
    expect(await fs.readText("photo.json")).toBe(before);
    expect((await applyDoc(fs, base())).applied).toBe(false);
    const next = { ...base(), title: "New" };
    expect((await applyDoc(fs, next, { dryRun: true })).applied).toBe(false);
    const ok = await applyDoc(fs, next);
    expect(ok).toMatchObject({ applied: true, plan: { sections: ["title"] } });
    expect((await getDoc(fs)).title).toBe("New");
    const empty = new MemoryFs();
    expect((await applyDoc(empty, base())).applied).toBe(true);
  });
  it("getDoc errors are actionable", async () => {
    await expect(getDoc(new MemoryFs())).rejects.toMatchObject({ code: "notFound" });
    await expect(getDoc(new MemoryFs({ "photo.json": "{ nope" }))).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("diffDocs — moves", () => {
  const flat = (): PhotoDoc => ({ version: 1, id: "t", canvas: { width: 10, height: 10 }, layers: ["a", "b", "c", "d"].map((id) => ({ id, type: "fill", fill: "red" }) as Layer).concat([{ id: "g", type: "group", children: [] }]) });
  const moved = (ops: PatchOp[]) => diffDocs(flat(), applyPatchOps(flat(), ops)).layers.moved.map((m) => m.id);
  it("reports only the layers that actually moved", () => {
    expect(moved([{ op: "moveLayer", id: "a" }])).toEqual(["a"]);
    expect(moved([{ op: "moveLayer", id: "d", index: 0 }])).toEqual(["d"]);
    expect(moved([{ op: "moveLayer", id: "a", parent: "g" }])).toEqual(["a"]);
    expect(moved([{ op: "removeLayer", id: "a" }, { op: "addLayer", layer: { id: "z", type: "fill", fill: "red" }, index: 0 }])).toEqual([]);
    expect(moved([{ op: "moveLayer", id: "a", above: "c" }, { op: "moveLayer", id: "d", index: 0 }]).sort()).toEqual(["a", "d"]);
    expect(diffDocs(flat(), applyPatchOps(flat(), [{ op: "moveLayer", id: "a" }])).summary).toBe("moved a.");
  });
});

describe("invalid documents", () => {
  it("applyDoc refuses a wrong layers value instead of wiping the layers", async () => {
    const fs = await project();
    const before = await fs.readText("photo.json");
    for (const layers of ["x", { a: 1 }, [{ id: "g", type: "group", children: "nope" }]]) {
      const r = await applyDoc(fs, { ...base(), layers } as unknown as PhotoDoc);
      expect(r.applied, JSON.stringify(layers)).toBe(false);
      expect(r.issues.some((i) => i.severity === "error")).toBe(true);
    }
    expect(await fs.readText("photo.json")).toBe(before);
    expect(summarizeDoc({ ...base(), layers: "x" } as unknown as PhotoDoc).layers).toEqual([]);
  });
});
