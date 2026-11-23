import { describe, expect, it } from "vitest";
import { CATALOG, COMMON_FILTER_PARAMS, DEFAULT_MODELS, EFFECTS, FILTERS, FONTS, LAYER_TYPES, LOOKS, MODELS, SHAPES, SIZE_PRESETS, effectDef, filterDef, fontDef, modelDef, sizePreset, type ParamDef } from "./catalog";
import { isValidColor } from "./color";
import { BLEND_MODES } from "./types";
import { MAX_CANVAS } from "./validate";

const unique = (ids: string[]) => new Set(ids).size === ids.length;

function checkParam(p: ParamDef, where: string) {
  expect(p.name, where).toMatch(/^[a-z][a-zA-Z]*$/);
  expect(p.description.length, `${where} description`).toBeGreaterThan(2);
  if (p.type === "number" || p.type === "int") {
    expect(typeof p.min, `${where} min`).toBe("number");
    expect(typeof p.max, `${where} max`).toBe("number");
    expect(p.min!, where).toBeLessThan(p.max!);
    if (p.default !== undefined) {
      expect(typeof p.default, where).toBe("number");
      expect(p.default as number, `${where} default ≥ min`).toBeGreaterThanOrEqual(p.min!);
      expect(p.default as number, `${where} default ≤ max`).toBeLessThanOrEqual(p.max!);
      if (p.type === "int") expect(Number.isInteger(p.default), where).toBe(true);
    }
  }
  if (p.type === "enum") {
    expect(p.options?.length, where).toBeGreaterThan(0);
    expect(p.options, `${where} default in options`).toContain(p.default);
  }
  if (p.type === "color") expect(isValidColor(p.default), where).toBe(true);
  if (p.type === "boolean") expect(typeof p.default, where).toBe("boolean");
  if (p.type === "rgb") expect(p.default).toEqual([0, 0, 0]);
  if (p.type === "stops" && p.default !== undefined) expect((p.default as string[]).every(isValidColor), where).toBe(true);
  if (p.type === "curve" && p.default !== undefined) expect(Array.isArray(p.default), where).toBe(true);
  if (p.px) expect(["number", "int"], where).toContain(p.type);
}

describe("catalog", () => {
  it("has unique ids in every section", () => {
    expect(unique(FILTERS.map((f) => f.id))).toBe(true);
    expect(unique(LOOKS.map((f) => f.id))).toBe(true);
    expect(unique(EFFECTS.map((f) => f.id))).toBe(true);
    expect(unique(FONTS.map((f) => f.id))).toBe(true);
    expect(unique(SIZE_PRESETS.map((f) => f.id))).toBe(true);
    expect(unique(MODELS.map((f) => f.id))).toBe(true);
    expect(unique(LAYER_TYPES.map((f) => f.id))).toBe(true);
    expect(unique([...BLEND_MODES])).toBe(true);
    expect(unique([...SHAPES])).toBe(true);
    for (const f of FILTERS) expect(unique(f.params.map((p) => p.name)), f.id).toBe(true);
  });

  it("filter params are consistent (defaults within ranges, enum defaults in options)", () => {
    for (const f of FILTERS) {
      expect(f.cost, f.id).toBeGreaterThan(0);
      expect(f.title.length).toBeGreaterThan(1);
      for (const p of f.params) checkParam(p, `${f.id}.${p.name}`);
      if (f.example) expect(f.example.type, f.id).toBe(f.id);
    }
    for (const p of COMMON_FILTER_PARAMS) checkParam(p, `common.${p.name}`);
    for (const e of EFFECTS) for (const p of e.params) checkParam(p, `${e.id}.${p.name}`);
  });

  it("the look filter enumerates exactly LOOKS", () => {
    const look = filterDef("look")!;
    expect(look.params[0].options).toEqual(LOOKS.map((l) => l.id));
    expect(LOOKS.map((l) => l.id)).toContain(look.params[0].default);
  });

  it("colorOverlay blend options are the blend modes", () => {
    expect(effectDef("colorOverlay")!.params.find((p) => p.name === "blend")!.options).toEqual(BLEND_MODES);
  });

  it("fonts, sizes and models are sane", () => {
    for (const f of FONTS) {
      expect(f.id).toMatch(/^[a-z0-9-]+$/);
      expect(f.weights.length).toBeGreaterThan(0);
      for (const w of f.weights) expect(w % 100).toBe(0);
    }
    for (const s of SIZE_PRESETS) {
      expect(s.width).toBeGreaterThan(0);
      expect(s.width).toBeLessThanOrEqual(MAX_CANVAS);
      expect(s.height).toBeLessThanOrEqual(MAX_CANVAS);
    }
    for (const m of MODELS) {
      expect(m.license.length).toBeGreaterThan(2);
      expect(m.repo).toContain("/");
    }
    for (const [task, id] of Object.entries(DEFAULT_MODELS)) expect(modelDef(id)?.task).toBe(task);
  });

  it("lookups and CATALOG sections", () => {
    expect(filterDef("blur")?.group).toBe("blur");
    expect(filterDef("nope")).toBeUndefined();
    expect(fontDef("inter")?.family).toBe("Inter");
    expect(sizePreset("og")).toMatchObject({ width: 1200, height: 630 });
    expect(Object.keys(CATALOG).sort()).toEqual(["blendModes", "commonFilterParams", "effects", "filters", "fonts", "layerTypes", "looks", "models", "shapes", "sizes"]);
    expect(LAYER_TYPES.map((t) => t.id)).toEqual(["image", "text", "shape", "fill", "adjustment", "group"]);
  });
});
