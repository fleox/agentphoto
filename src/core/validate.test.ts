import { describe, expect, it } from "vitest";
import { FILTERS, LOOKS } from "./catalog";
import { isValidColor, parseColor, readableTextOn, toHex } from "./color";
import { isValidId, slugify, uniqueId } from "./ids";
import { closest, didYouMean, levenshtein, listOptions } from "./suggest";
import type { Issue, Layer, PhotoDoc } from "./types";
import { defaultDoc, errorsOf, LARGE_CANVAS_MP, MAX_CANVAS, normalizeDoc, validateDoc } from "./validate";

// A document using every layer type, valid with no warnings.
const full = (): PhotoDoc => ({
  version: 1,
  id: "summer-sale",
  title: "Summer sale",
  description: "A sale banner",
  canvas: { width: 1200, height: 630, background: { type: "linear", angle: 90, stops: ["#ff7a59", [1, "#1b1340"]] } },
  layers: [
    { id: "bg", type: "fill", fill: { type: "radial", cx: 0.5, cy: 0.4, radius: 0.8, stops: [[0, "#fff"], [1, "rgba(0,0,0,0.5)"]] } },
    {
      id: "photo",
      type: "image",
      name: "Photo",
      src: "assets/images/photo.jpg",
      x: 0,
      y: 0,
      width: 1200,
      height: 630,
      rotation: 3,
      flipX: true,
      crop: { x: 10, y: 10, width: 800, height: 600 },
      fit: "cover",
      focus: [0.5, 0.3],
      opacity: 0.9,
      blend: "multiply",
      mask: { src: "assets/masks/photo.png", feather: 4, invert: false, density: 1, enabled: true },
      filters: [
        { type: "brightnessContrast", brightness: 10, contrast: 15 },
        { type: "curves", rgb: [[0, 0], [64, 52], [192, 206], [255, 255]], red: [[0, 10], [255, 250]] },
        { type: "colorBalance", shadows: [-10, 0, 10], highlights: [10, 0, -10] },
        { type: "gradientMap", stops: ["#1b1340", "#ff7a59"], amount: 0.5, enabled: false },
        { type: "look", look: "cinema", amount: 0.7 },
      ],
      effects: { dropShadow: { color: "#000", opacity: 0.4, blur: 20, distance: 10, angle: 90 }, stroke: { width: 4, position: "inside" }, outerGlow: null },
    },
    {
      id: "deco",
      type: "group",
      opacity: 0.8,
      mask: { shape: "ellipse", x: 0, y: 0, width: 600, height: 400, feather: 20 },
      children: [
        { id: "badge", type: "shape", shape: "star", x: 900, y: 40, width: 200, height: 200, fill: "#ffd700", stroke: { color: "#000", width: 2, dash: [6, 3] }, sides: 7, innerRadius: 0.4 },
        { id: "box", type: "shape", shape: "rect", x: 40, y: 40, width: 300, height: 120, fill: null, stroke: { color: "white" }, radius: 16, clip: true },
        {
          id: "title",
          type: "text",
          text: "SUMMER\nSALE",
          x: 60,
          y: 200,
          width: 600,
          font: "bebas-neue",
          size: 120,
          weight: 700,
          italic: false,
          color: { type: "linear", stops: ["#fff", "#ffd"] },
          align: "center",
          valign: "middle",
          lineHeight: 1.1,
          letterSpacing: 2,
          transform: "uppercase",
          background: { color: "#000000aa", padding: [12, 6], radius: 8 },
          effects: { colorOverlay: { color: "#ff3366", blend: "screen" } },
        },
      ],
    },
    { id: "grade", type: "adjustment", filters: [{ type: "vibrance", vibrance: 20 }], mask: { gradient: { type: "linear", angle: 90, stops: ["white", "black"] } } },
  ],
  export: { format: "jpeg", quality: 85, width: 1200, background: "#ffffff", name: "summer-sale" },
});

const issues = (d: unknown) => validateDoc(d);
const find = (list: Issue[], path: string, code?: string) => list.find((i) => i.path === path && (!code || i.code === code));
const withLayer = (l: unknown): PhotoDoc => ({ ...defaultDoc(), layers: [l as Layer] });

describe("validateDoc — valid documents", () => {
  it("accepts a document using every layer type without any issue", () => {
    expect(issues(full())).toEqual([]);
  });

  it("accepts the default document and minimal layers of each type", () => {
    expect(issues(defaultDoc())).toEqual([]);
    const minimal: Layer[] = [
      { id: "a", type: "image", src: "library:portrait" },
      { id: "b", type: "text", text: "Hi" },
      { id: "c", type: "shape", shape: "ellipse", width: 10, height: 10, fill: "red" },
      { id: "d", type: "fill", fill: "#123" },
      { id: "e", type: "adjustment", filters: [{ type: "invert" }] },
      { id: "f", type: "group", children: [] },
    ];
    expect(issues({ ...defaultDoc(), layers: minimal })).toEqual([]);
  });

  it("accepts every catalog filter example and every look", () => {
    for (const f of FILTERS) {
      const doc = withLayer({ id: "x", type: "adjustment", filters: [f.example ?? { type: f.id }] });
      expect(issues(doc), f.id).toEqual([]);
    }
    for (const l of LOOKS) expect(issues(withLayer({ id: "x", type: "adjustment", filters: [{ type: "look", look: l.id }] })), l.id).toEqual([]);
  });
});

describe("validateDoc — structure", () => {
  it("rejects non-objects", () => {
    for (const v of [null, 1, "doc", []]) expect(errorsOf(issues(v))[0]).toMatchObject({ code: "type", path: "" });
  });

  it("requires id, canvas and layers; checks version", () => {
    const list = issues({ version: 2 });
    expect(find(list, "version", "version")?.severity).toBe("error");
    expect(find(list, "id", "id")).toBeTruthy();
    expect(find(list, "canvas", "missing")).toBeTruthy();
    expect(find(list, "layers", "missing")).toBeTruthy();
    const noVersion = issues({ id: "a", canvas: { width: 10, height: 10 }, layers: [] });
    expect(noVersion).toEqual([expect.objectContaining({ severity: "warning", code: "version", path: "version" })]);
  });

  it("warns on unknown root / canvas fields with did-you-mean", () => {
    const d = { ...defaultDoc(), titel: "x", canvas: { width: 10, height: 10, backgroud: "#fff" } };
    const list = issues(d);
    const t = find(list, "titel", "unknown-field")!;
    expect(t.severity).toBe("warning");
    expect(t.hint).toContain('Did you mean "title"');
    expect(find(list, "canvas.backgroud", "unknown-field")?.hint).toContain('Did you mean "background"');
    expect(errorsOf(list)).toEqual([]);
  });

  it("checks canvas limits", () => {
    const at = (width: unknown, height: unknown) => issues({ ...defaultDoc(), canvas: { width, height } });
    expect(find(at(0, 10), "canvas.width", "range")).toBeTruthy();
    expect(find(at(MAX_CANVAS + 1, 10), "canvas.width", "range")).toBeTruthy();
    expect(find(at(10.5, 10), "canvas.width", "type")?.message).toContain("integer");
    expect(find(at("100", 10), "canvas.width", "type")).toBeTruthy();
    expect(find(at(10, undefined), "canvas.height", "missing")).toBeTruthy();
    expect(errorsOf(at(MAX_CANVAS, 1))).toEqual([]);
    const big = at(10000, 5000);
    expect(LARGE_CANVAS_MP).toBeLessThan(50);
    expect(find(big, "canvas", "large-canvas")?.severity).toBe("warning");
    expect(find(issues({ ...defaultDoc(), canvas: { width: 10, height: 10, background: "nope" } }), "canvas.background", "color")).toBeTruthy();
    expect(issues({ ...defaultDoc(), canvas: { width: 10, height: 10, background: null } })).toEqual([]);
  });

  it("checks title / description types", () => {
    const list = issues({ ...defaultDoc(), title: 3, description: false });
    expect(find(list, "title", "type")).toBeTruthy();
    expect(find(list, "description", "type")).toBeTruthy();
  });
});

describe("validateDoc — layers", () => {
  it("uses layers#id paths for typed / ranged / enum errors", () => {
    const d = full();
    const title = (d.layers[2] as { children: Layer[] }).children[2] as unknown as Record<string, unknown>;
    title.size = "big";
    title.weight = 1000;
    title.align = "middle";
    const list = issues(d);
    expect(find(list, "layers#title.size", "type")?.message).toContain("must be a number");
    expect(find(list, "layers#title.weight", "range")?.message).toContain("≤ 900");
    expect(find(list, "layers#title.align", "enum")).toBeTruthy();
  });

  it("falls back to the index path when the id is invalid", () => {
    const list = issues(withLayer({ id: "2bad", type: "fill", fill: "red" }));
    expect(find(list, "layers[0].id", "id")?.severity).toBe("error");
    expect(issues(withLayer("str"))[0]).toMatchObject({ code: "type", path: "layers[0]" });
  });

  it("detects duplicate ids across groups", () => {
    const d = withLayer({ id: "g", type: "group", children: [{ id: "a", type: "fill", fill: "red" }] });
    d.layers.push({ id: "a", type: "text", text: "x" });
    const dup = find(issues(d), "layers#a.id", "duplicate-id")!;
    expect(dup.severity).toBe("error");
    expect(dup.hint).toContain("groups included");
  });

  it("reports unknown layer types and fields with did-you-mean", () => {
    const t = find(issues(withLayer({ id: "a", type: "imgae", src: "x" })), "layers#a.type", "layer-type")!;
    expect(t.hint).toContain('Did you mean "image"');
    const u = find(issues(withLayer({ id: "a", type: "text", text: "x", colour: "red" })), "layers#a.colour", "unknown-field")!;
    expect(u.severity).toBe("warning");
    expect(u.hint).toContain('Did you mean "color"');
    // Placement keys are not allowed on fill layers.
    expect(find(issues(withLayer({ id: "a", type: "fill", fill: "red", x: 3 })), "layers#a.x", "unknown-field")).toBeTruthy();
  });

  it("explains opacity given as a percentage", () => {
    const op = find(issues(withLayer({ id: "a", type: "fill", fill: "red", opacity: 80 })), "layers#a.opacity", "range")!;
    expect(op.message).toContain("0..1");
    expect(op.hint).toContain("0.8");
    expect(find(issues(withLayer({ id: "a", type: "fill", fill: "red", opacity: 150 })), "layers#a.opacity", "range")?.message).toContain("≤ 1");
    expect(find(issues(withLayer({ id: "a", type: "fill", fill: "red", opacity: -0.1 })), "layers#a.opacity", "range")).toBeTruthy();
  });

  it("checks common flags and blend modes", () => {
    const list = issues(withLayer({ id: "a", type: "fill", fill: "red", visible: "yes", locked: 1, clip: "no", blend: "multipy", name: 4 }));
    for (const k of ["visible", "locked", "clip", "name"]) expect(find(list, `layers#a.${k}`, "type"), k).toBeTruthy();
    expect(find(list, "layers#a.blend", "enum")?.hint).toContain('Did you mean "multiply"');
  });

  it("checks image layers", () => {
    const list = issues(withLayer({ id: "a", type: "image", src: " ", crop: { x: -1, y: 0, width: 0 }, fit: "stretch", focus: [2, 0], width: -1 }));
    expect(find(list, "layers#a.src", "missing")).toBeTruthy();
    expect(find(list, "layers#a.crop.x", "range")).toBeTruthy();
    expect(find(list, "layers#a.crop.width", "range")).toBeTruthy();
    expect(find(list, "layers#a.crop.height", "missing")).toBeTruthy();
    expect(find(list, "layers#a.fit", "enum")).toBeTruthy();
    expect(find(list, "layers#a.focus", "type")).toBeTruthy();
    expect(find(list, "layers#a.width", "range")).toBeTruthy();
    expect(find(issues(withLayer({ id: "a", type: "image", src: "x.png", crop: 5 })), "layers#a.crop", "type")).toBeTruthy();
  });

  it("checks text layers", () => {
    const list = issues(withLayer({ id: "a", type: "text", text: "  ", font: "Comic Sans", size: 0, lineHeight: 20, letterSpacing: -500, valign: "center", transform: "caps", italic: "y", color: "nope", background: { color: "red", padding: [1], radius: -1, margin: 3 } }));
    expect(find(list, "layers#a.text", "empty-text")?.severity).toBe("warning");
    expect(find(list, "layers#a.font", "system-font")?.severity).toBe("info");
    for (const [k, c] of [["size", "range"], ["lineHeight", "range"], ["letterSpacing", "range"], ["valign", "enum"], ["transform", "enum"], ["italic", "type"], ["color", "color"]]) expect(find(list, `layers#a.${k}`, c), k).toBeTruthy();
    expect(find(list, "layers#a.background.padding", "type")).toBeTruthy();
    expect(find(list, "layers#a.background.radius", "range")).toBeTruthy();
    expect(find(list, "layers#a.background.margin", "unknown-field")).toBeTruthy();
    expect(find(issues(withLayer({ id: "a", type: "text" })), "layers#a.text", "missing")).toBeTruthy();
    expect(find(issues(withLayer({ id: "a", type: "text", text: "x", font: "interr" })), "layers#a.font", "system-font")?.hint).toContain('Did you mean "inter"');
    expect(find(issues(withLayer({ id: "a", type: "text", text: "x", background: { padding: 3 } })), "layers#a.background.color", "missing")).toBeTruthy();
  });

  it("checks shape layers", () => {
    const list = issues(withLayer({ id: "a", type: "shape", shape: "circle", x: 0, y: 0, sides: 2.5, innerRadius: 2, stroke: { width: -1, dash: [3, -1] } }));
    expect(find(list, "layers#a.shape", "enum")?.hint).toBeUndefined();
    expect(find(list, "layers#a.width", "missing")).toBeTruthy();
    expect(find(list, "layers#a.height", "missing")).toBeTruthy();
    expect(list.filter((i) => i.path === "layers#a.sides").map((i) => i.code).sort()).toEqual(["range", "type"]);
    expect(find(list, "layers#a.innerRadius", "range")).toBeTruthy();
    expect(find(list, "layers#a.stroke.color", "missing")).toBeTruthy();
    expect(find(list, "layers#a.stroke.width", "range")).toBeTruthy();
    expect(find(list, "layers#a.stroke.dash", "type")).toBeTruthy();
    expect(find(issues(withLayer({ id: "a", type: "shape", shape: "elipse", width: 1, height: 1 })), "layers#a.shape", "enum")?.hint).toContain('Did you mean "ellipse"');
    expect(find(issues(withLayer({ id: "a", type: "shape", shape: "rect", width: 1, height: 1 })), "layers#a", "invisible-shape")?.severity).toBe("info");
    expect(find(issues(withLayer({ id: "a", type: "shape", shape: "line", width: 1, height: 1 })), "layers#a", "line-stroke")?.severity).toBe("info");
  });

  it("checks fill, adjustment and group layers", () => {
    expect(find(issues(withLayer({ id: "a", type: "fill" })), "layers#a.fill", "missing")).toBeTruthy();
    expect(find(issues(withLayer({ id: "a", type: "fill", fill: null })), "layers#a.fill", "type")).toBeTruthy();
    expect(find(issues(withLayer({ id: "a", type: "adjustment" })), "layers#a.filters", "missing")).toBeTruthy();
    expect(find(issues(withLayer({ id: "a", type: "adjustment", filters: [] })), "layers#a.filters", "empty-adjustment")?.severity).toBe("warning");
    expect(find(issues(withLayer({ id: "a", type: "group" })), "layers#a.children", "missing")).toBeTruthy();
    expect(find(issues(withLayer({ id: "a", type: "text", text: "x", filters: {} })), "layers#a.filters", "type")).toBeTruthy();
    // Errors inside a group child use the child's id.
    expect(find(issues(withLayer({ id: "g", type: "group", children: [{ id: "kid", type: "fill", fill: "nope" }] })), "layers#kid.fill", "color")).toBeTruthy();
  });
});

describe("validateDoc — masks", () => {
  const mask = (m: unknown) => issues(withLayer({ id: "a", type: "fill", fill: "red", mask: m }));
  it("needs exactly one kind", () => {
    expect(find(mask({ invert: true }), "layers#a.mask", "mask")?.message).toContain("has none");
    expect(find(mask({ src: "a.png", gradient: { type: "linear", stops: ["#fff", "#000"] } }), "layers#a.mask", "mask")?.message).toContain("src, gradient");
    expect(mask(null)).toEqual([]);
    expect(find(mask("a.png"), "layers#a.mask", "type")).toBeTruthy();
  });
  it("checks each kind's fields", () => {
    expect(find(mask({ src: "" }), "layers#a.mask.src", "type")).toBeTruthy();
    expect(find(mask({ src: "a.png", x: 1 }), "layers#a.mask.x", "unknown-field")).toBeTruthy();
    const shape = mask({ shape: "star", x: 0, width: -1, height: 2, radius: -2, feather: 2000, density: 2, invert: 1 });
    expect(find(shape, "layers#a.mask.shape", "enum")).toBeTruthy();
    expect(find(shape, "layers#a.mask.y", "missing")).toBeTruthy();
    expect(find(shape, "layers#a.mask.width", "range")).toBeTruthy();
    expect(find(shape, "layers#a.mask.radius", "range")).toBeTruthy();
    expect(find(shape, "layers#a.mask.feather", "range")).toBeTruthy();
    expect(find(shape, "layers#a.mask.density", "range")).toBeTruthy();
    expect(find(shape, "layers#a.mask.invert", "type")).toBeTruthy();
    expect(find(mask({ gradient: "white" }), "layers#a.mask.gradient", "paint")).toBeTruthy();
    expect(find(mask({ gradient: { type: "conic", stops: ["#fff", "#000"] } }), "layers#a.mask.gradient.type", "paint")).toBeTruthy();
  });
});

describe("validateDoc — effects", () => {
  const fx = (e: unknown) => issues(withLayer({ id: "a", type: "text", text: "x", effects: e }));
  it("checks effect ids and params", () => {
    const list = fx({ dropShadow: { opacity: 2, blur: "x", colour: "#000" }, glow: {}, stroke: { position: "around" }, colorOverlay: { opacity: 0.5 }, innerShadow: null, outerGlow: 3 });
    expect(find(list, "layers#a.effects.dropShadow.opacity", "range")).toBeTruthy();
    expect(find(list, "layers#a.effects.dropShadow.blur", "type")).toBeTruthy();
    expect(find(list, "layers#a.effects.dropShadow.colour", "unknown-param")?.hint).toContain('Did you mean "color"');
    expect(find(list, "layers#a.effects.glow", "unknown-effect")?.hint).toContain('Did you mean "outerGlow"');
    expect(find(list, "layers#a.effects.stroke.position", "enum")).toBeTruthy();
    expect(find(list, "layers#a.effects.colorOverlay.color", "missing")).toBeTruthy();
    expect(find(list, "layers#a.effects.outerGlow", "type")).toBeTruthy();
    expect(list.some((i) => i.path.startsWith("layers#a.effects.innerShadow"))).toBe(false);
    expect(find(fx([]), "layers#a.effects", "type")).toBeTruthy();
    expect(find(fx({ colorOverlay: { color: "#fff", blend: "lighter" } }), "layers#a.effects.colorOverlay.blend", "enum")?.hint).toContain('Did you mean "lighten"');
  });
});

describe("validateDoc — filters", () => {
  const filt = (f: unknown) => issues(withLayer({ id: "a", type: "adjustment", filters: [f] }));
  it("checks filter ids", () => {
    expect(find(filt({ type: "blurr" }), "layers#a.filters[0].type", "unknown-filter")?.hint).toContain('Did you mean "blur"');
    expect(find(filt({ radius: 3 }), "layers#a.filters[0].type", "missing")).toBeTruthy();
    expect(find(filt("blur"), "layers#a.filters[0]", "type")).toBeTruthy();
  });
  it("checks params, enabled and amount", () => {
    const u = find(filt({ type: "blur", radios: 3 }), "layers#a.filters[0].radios", "unknown-param")!;
    expect(u.severity).toBe("warning");
    expect(u.hint).toContain('Did you mean "radius"');
    expect(find(filt({ type: "blur", radius: 999 }), "layers#a.filters[0].radius", "range")).toBeTruthy();
    expect(find(filt({ type: "blur", amount: 50 }), "layers#a.filters[0].amount", "range")).toBeTruthy();
    expect(find(filt({ type: "blur", enabled: "no" }), "layers#a.filters[0].enabled", "type")).toBeTruthy();
    expect(find(filt({ type: "posterize", levels: 3.5 }), "layers#a.filters[0].levels", "type")).toBeTruthy();
    expect(find(filt({ type: "hueSaturation", colorize: 1 }), "layers#a.filters[0].colorize", "type")).toBeTruthy();
    expect(find(filt({ type: "photoFilter", color: "warm" }), "layers#a.filters[0].color", "color")).toBeTruthy();
  });
  it("checks looks", () => {
    expect(find(filt({ type: "look" }), "layers#a.filters[0].look", "missing")).toBeTruthy();
    expect(find(filt({ type: "look", look: "cinemaa" }), "layers#a.filters[0].look", "enum")?.hint).toContain('Did you mean "cinema"');
  });
  it("checks curve points", () => {
    expect(find(filt({ type: "curves", rgb: [[0, 0]] }), "layers#a.filters[0].rgb", "curve")).toBeTruthy();
    expect(find(filt({ type: "curves", rgb: [[0, 0], [128, 300], [64, 10]] }), "layers#a.filters[0].rgb[1][1]", "range")).toBeTruthy();
    expect(find(filt({ type: "curves", rgb: [[0, 0], [128, 30], [64, 10]] }), "layers#a.filters[0].rgb[2]", "curve")?.message).toContain("strictly increasing");
    expect(find(filt({ type: "curves", rgb: [[0, 0], [0, 10]] }), "layers#a.filters[0].rgb[1]", "curve")).toBeTruthy();
    expect(find(filt({ type: "curves", green: [[0, 0], 5] }), "layers#a.filters[0].green[1]", "curve")).toBeTruthy();
  });
  it("checks stops and rgb params", () => {
    expect(find(filt({ type: "gradientMap", stops: ["#000"] }), "layers#a.filters[0].stops", "stops")).toBeTruthy();
    expect(find(filt({ type: "gradientMap", stops: ["#000", [2, "#fff"]] }), "layers#a.filters[0].stops[1][0]", "range")).toBeTruthy();
    expect(find(filt({ type: "gradientMap", stops: ["#000", [1, "nope"]] }), "layers#a.filters[0].stops[1][1]", "color")).toBeTruthy();
    expect(find(filt({ type: "gradientMap", stops: ["#000", 5] }), "layers#a.filters[0].stops[1]", "stops")).toBeTruthy();
    expect(find(filt({ type: "colorBalance", shadows: [1, 2] }), "layers#a.filters[0].shadows", "type")).toBeTruthy();
    expect(find(filt({ type: "colorBalance", midtones: [0, 200, 0] }), "layers#a.filters[0].midtones[1]", "range")).toBeTruthy();
  });
});

describe("validateDoc — paints and export", () => {
  const paint = (fill: unknown) => issues(withLayer({ id: "a", type: "fill", fill }));
  it("checks gradients", () => {
    expect(find(paint(5), "layers#a.fill", "paint")).toBeTruthy();
    expect(find(paint({ type: "linear", stops: ["#000", "#fff"], angel: 3 }), "layers#a.fill.angel", "unknown-field")?.hint).toContain('Did you mean "angle"');
    expect(find(paint({ type: "linear", stops: ["#000", "#fff"], angle: "up" }), "layers#a.fill.angle", "type")).toBeTruthy();
    expect(find(paint({ type: "radial", stops: ["#000", "#fff"], radius: -1 }), "layers#a.fill.radius", "range")).toBeTruthy();
    expect(find(paint({ type: "radial", stops: "#000" }), "layers#a.fill.stops", "stops")).toBeTruthy();
    expect(paint("hsl(340 100% 60%)")).toEqual([]);
  });
  it("checks export settings", () => {
    const list = issues({ ...defaultDoc(), export: { format: "gif", quality: 0, scale: 10, width: 2.5, height: MAX_CANVAS + 1, background: "nope", name: "a b", dpi: 300 } });
    expect(find(list, "export.format", "enum")).toBeTruthy();
    expect(find(list, "export.quality", "range")).toBeTruthy();
    expect(find(list, "export.scale", "range")).toBeTruthy();
    expect(find(list, "export.width", "type")).toBeTruthy();
    expect(find(list, "export.height", "range")).toBeTruthy();
    expect(find(list, "export.background", "color")).toBeTruthy();
    expect(find(list, "export.name", "type")).toBeTruthy();
    expect(find(list, "export.dpi", "unknown-field")).toBeTruthy();
    expect(find(issues({ ...defaultDoc(), export: [] }), "export", "type")).toBeTruthy();
    expect(issues({ ...defaultDoc(), export: { background: null } })).toEqual([]);
  });
});

describe("normalizeDoc / defaultDoc", () => {
  it("fills structural defaults only", () => {
    const n = normalizeDoc({ id: "a", canvas: { width: 1, height: 1 } } as unknown as PhotoDoc);
    expect(n.version).toBe(1);
    expect(n.layers).toEqual([]);
    expect(defaultDoc({ id: "x", title: "T", width: 10, height: 20, background: null })).toEqual({ version: 1, id: "x", title: "T", canvas: { width: 10, height: 20, background: null }, layers: [] });
  });
});

describe("colour, ids and suggestions", () => {
  it("parses CSS colours", () => {
    expect(parseColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("#ff000080")?.a).toBeCloseTo(0.5, 2);
    expect(parseColor("rgb(255 51 102 / 50%)")).toEqual({ r: 255, g: 51, b: 102, a: 0.5 });
    expect(parseColor("rgba(0,0,0,0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(toHex(parseColor("hsl(120, 100%, 50%)")!)).toBe("#00ff00");
    expect(toHex(parseColor("hsl(0.5turn 100% 50%)")!)).toBe("#00ffff");
    expect(parseColor("RebeccaPurple")).toEqual({ r: 0x66, g: 0x33, b: 0x99, a: 1 });
    expect(parseColor("transparent")?.a).toBe(0);
    for (const bad of ["", "#12", "#ggg", "rgb(1,2)", "hsl(1, 2, 3)", "blurple", 5, null]) expect(isValidColor(bad), String(bad)).toBe(false);
    expect(readableTextOn("#ffffff")).toBe("#111318");
    expect(readableTextOn("#000")).toBe("#ffffff");
  });
  it("makes valid unique ids", () => {
    expect(isValidId("title-2")).toBe(true);
    expect(isValidId("2title")).toBe(false);
    expect(slugify("My Logo 3D!")).toBe("my-logo-3d");
    expect(slugify("Été")).toBe("ete");
    expect(slugify("123", "layer")).toBe("layer-123");
    expect(slugify("!!!", "layer")).toBe("layer");
    expect(uniqueId("title", ["title", "title-2"])).toBe("title-3");
    expect(uniqueId("My Title", [])).toBe("my-title");
  });
  it("suggests close options", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(closest("rot", ["rotate", "scale"])).toBe("rotate");
    expect(closest("zzzzzz", ["rotate", "scale"])).toBeUndefined();
    expect(didYouMean("Blur", ["blur"])).toBe('Did you mean "blur"? ');
    expect(listOptions(["a", "b", "c"], 2)).toBe('"a", "b", … (3 total)');
  });
});
