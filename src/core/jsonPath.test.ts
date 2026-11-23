import { describe, expect, it } from "vitest";
import { clone, deepEqual, findById, formatPath, getAt, hasAt, mergePatch, parsePath, PathError, removeAt, setAt, stableStringify } from "./jsonPath";

const doc = () => ({
  canvas: { width: 100, height: 50 },
  layers: [
    { id: "bg", type: "fill", fill: "#fff" },
    { id: "g", type: "group", children: [{ id: "inner", type: "group", children: [{ id: "title", type: "text", text: "Hi", filters: [{ type: "blur", radius: 2 }] }] }] },
  ],
});

describe("parsePath / formatPath", () => {
  it("parses keys, indexes and refs", () => {
    expect(parsePath("canvas.width")).toEqual([{ key: "canvas" }, { key: "width" }]);
    expect(parsePath("layers[0].opacity")).toEqual([{ key: "layers" }, { index: 0 }, { key: "opacity" }]);
    expect(parsePath("layers#title.filters[0][1]")).toEqual([{ key: "layers" }, { ref: "title", tree: true }, { key: "filters" }, { index: 0 }, { index: 1 }]);
    expect(parsePath("stops#a")).toEqual([{ key: "stops" }, { ref: "a", tree: false }]);
    expect(formatPath(parsePath("layers#title.filters[0].radius"))).toBe("layers#title.filters[0].radius");
  });
  it("rejects bad paths", () => {
    for (const p of ["", "  ", "a..b", "a[x]", "a]"]) expect(() => parsePath(p), p).toThrow(PathError);
  });
});

describe("get / set / remove", () => {
  it("finds layers by id anywhere in the tree", () => {
    const d = doc();
    expect(getAt(d, "layers#title.text")).toBe("Hi");
    expect(getAt(d, "layers#title.filters[0].radius")).toBe(2);
    expect(getAt(d, "layers#g.children#title.type")).toBe("text");
    expect(findById(d.layers, "title", false)).toBeNull();
    expect(findById(d.layers, "title", true)?.index).toBe(0);
    expect(hasAt(d, "layers#nope.x")).toBe(false);
    expect(hasAt(d, "layers#bg.fill")).toBe(true);
    expect(() => getAt(d, "layers#nope.x")).toThrow(/No element with id "nope"/);
    expect(() => getAt(d, "canvas#x")).toThrow(/not an array/);
    expect(() => getAt(d, "layers[5]")).toThrow(/out of range/);
    expect(() => getAt(d, "canvas.width.x")).toThrow(/not an object/);
  });
  it("sets values, creating containers and appending at length", () => {
    const d = doc() as Record<string, unknown>;
    setAt(d, "layers#title.size", 96);
    expect(getAt(d, "layers#title.size")).toBe(96);
    setAt(d, "export.format", "png");
    expect(d.export).toEqual({ format: "png" });
    setAt(d, "layers#title.filters[1]", { type: "invert" });
    expect(getAt(d, "layers#title.filters[1].type")).toBe("invert");
    setAt(d, "extra.deep.x", 1);
    expect(d.extra).toEqual({ deep: { x: 1 } });
    // Array elements are never created implicitly in the middle of a path.
    expect(() => setAt(d, "more.list[0].x", 1)).toThrow(/out of range/);
    expect(() => setAt(d, "layers#title.filters[5]", {})).toThrow(/out of range/);
    expect(() => setAt(d, "layers[9].x", 1)).toThrow(/out of range/);
  });
  it("removes keys and array elements", () => {
    const d = doc();
    expect(removeAt(d, "layers#title.filters[0]")).toBe(true);
    expect(getAt(d, "layers#title.filters")).toEqual([]);
    expect(removeAt(d, "layers#title.text")).toBe(true);
    expect(removeAt(d, "layers#title.text")).toBe(false);
    expect(removeAt(d, "layers#bg")).toBe(true);
    expect(d.layers.map((l) => l.id)).toEqual(["g"]);
  });
});

describe("mergePatch / clone / stable", () => {
  it("merges per RFC 7396", () => {
    const a = { x: 1, o: { a: 1, b: 2 }, arr: [1, 2] };
    expect(mergePatch(a, { o: { b: null, c: 3 }, arr: [3], x: null })).toEqual({ o: { a: 1, c: 3 }, arr: [3] });
    expect(a).toEqual({ x: 1, o: { a: 1, b: 2 }, arr: [1, 2] });
    expect(mergePatch(5, { a: 1 })).toEqual({ a: 1 });
    expect(mergePatch({ a: 1 }, "s")).toBe("s");
  });
  it("compares with sorted keys and ignores undefined", () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: undefined }] })).toBe('{"a":[{"d":1}],"b":1}');
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    const o = { a: [1] };
    const c = clone(o);
    c.a.push(2);
    expect(o.a).toEqual([1]);
    expect(clone(undefined)).toBeUndefined();
  });
});
