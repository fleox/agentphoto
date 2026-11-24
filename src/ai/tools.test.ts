import { describe, expect, it } from "vitest";
import { CATALOG } from "../core/catalog";
import { MemoryFs } from "../core/fs";
import type { LibraryProvider } from "../core/library";
import type { GroupLayer, ImageLayer, PhotoDoc } from "../core/types";
import { getDoc } from "../ops/doc";
import { readAssetManifest } from "../ops/assets";
import { createProject } from "../ops/project";
import { findLayer } from "../ops/tree";
import { tinyPng } from "../test-support/png";
import { coverCuts } from "./imageTools";
import { AI_TOOLS, callAiTool, findAiTool, listAiTools, resultImages, TOOL_ORDER } from "./tools";
import { checkInput } from "./shared";
import type { EncodedImage, EngineHost, JsonSchema, SegmentPrompt, ToolContext, ToolHost } from "./types";

const READ_ONLY = ["project_info", "doc_summary", "doc_get", "doc_validate", "layer_list", "image_analyze", "render_preview", "catalog_get", "templates_list", "library_list", "assets_list", "check"];
const ENGINE = ["remove_background", "mask_generate", "image_analyze", "render_preview", "export"];

function checkSchema(s: JsonSchema, path: string): void {
  const types = ["object", "array", "string", "number", "integer", "boolean", "null"];
  if (s.type) for (const t of Array.isArray(s.type) ? s.type : [s.type]) expect(types, `${path}.type`).toContain(t);
  for (const k of Object.keys(s)) expect(["type", "description", "properties", "required", "items", "enum", "additionalProperties", "default", "minimum", "maximum", "minItems", "maxItems"], `${path}: ${k}`).toContain(k);
  for (const r of s.required ?? []) expect(Object.keys(s.properties ?? {}), `${path}.required`).toContain(r);
  for (const [k, p] of Object.entries(s.properties ?? {})) checkSchema(p, `${path}.${k}`);
  if (s.items) checkSchema(s.items, `${path}[]`);
}

// ─── fakes ──────────────────────────────────────────────────────────────

interface Calls {
  render: { only?: string[]; layers: string[]; filters: number }[];
  export: { width: number; height: number; format: string }[];
  background: { id: string; model?: string }[];
  segment: { id: string; prompt: SegmentPrompt }[];
  color: { id: string; color: string; tolerance?: number }[];
}

function fakeEngine(opts: { mimeFor?: (mime: string) => string; bbox?: EncodedImage["bbox"] } = {}): { engine: EngineHost; calls: Calls } {
  const calls: Calls = { render: [], export: [], background: [], segment: [], color: [] };
  const img = (w = 4, h = 4, mime = "image/png"): EncodedImage => ({ bytes: tinyPng(w, h), mime, width: w, height: h });
  const countFilters = (doc: PhotoDoc) => {
    let n = 0;
    const visit = (ls: PhotoDoc["layers"]) => ls.forEach((l) => ((n += l.filters?.length ?? 0), l.type === "group" && visit(l.children)));
    visit(doc.layers);
    return n;
  };
  const engine: EngineHost = {
    async render(doc, o) {
      calls.render.push({ only: o.only, layers: doc.layers.map((l) => l.id), filters: countFilters(doc) });
      return img(Math.min(doc.canvas.width, 8), Math.min(doc.canvas.height, 8));
    },
    async exportImage(_doc, job) {
      calls.export.push({ width: job.width, height: job.height, format: job.format });
      return { bytes: tinyPng(), mime: opts.mimeFor ? opts.mimeFor(job.mime) : job.mime, width: job.width, height: job.height };
    },
    async analyze() {
      return { width: 1, height: 1, transparent: 0, brightness: 50, contrast: 10, range: [0, 255], clippedShadows: 0, clippedHighlights: 0, saturation: 10, cast: { warm: 0, magenta: 0 }, sharpness: 100, dominant: [], suggestions: [] };
    },
    async backgroundMask(_doc, id, o) {
      calls.background.push({ id, model: o.model });
      return { ...img(10, 10), bbox: opts.bbox };
    },
    async segmentMask(_doc, id, prompt) {
      calls.segment.push({ id, prompt });
      return img(10, 10);
    },
    async colorRangeMask(_doc, id, o) {
      calls.color.push({ id, color: o.color, tolerance: o.tolerance });
      return img(10, 10);
    },
  };
  return { engine, calls };
}

const library: LibraryProvider = {
  index: {
    assets: [
      { id: "portrait", kind: "image", path: "images/portrait.jpg", width: 1600, height: 1200, license: "CC0", tags: ["person", "face"], title: "Portrait", description: "Woman smiling", kb: 100 },
      { id: "beach", kind: "image", path: "images/beach.jpg", width: 1600, height: 1000, license: "CC0", tags: ["sea"], description: "Sunny beach", kb: 100 },
      { id: "inter", kind: "font", family: "Inter", license: "OFL", tags: ["sans"], description: "Inter", kb: 50 },
    ],
  },
  read: async () => tinyPng(16, 12),
};

async function ctx(host: ToolHost = {}): Promise<ToolContext & { fs: MemoryFs }> {
  const fs = new MemoryFs();
  await createProject(fs, { name: "Tool Test", width: 400, height: 200, image: { name: "photo.png", bytes: tinyPng(40, 20) } });
  return { fs, host };
}
const doc = (c: ToolContext) => getDoc(c.fs);
const layerOf = async (c: ToolContext, id: string) => findLayer((await doc(c)).layers, id)?.layer;

// ─── catalog ────────────────────────────────────────────────────────────

describe("AI tool catalog", () => {
  it("exposes exactly TOOL_ORDER, with unique names", () => {
    expect(AI_TOOLS.map((t) => t.name)).toEqual([...TOOL_ORDER]);
    expect(new Set(TOOL_ORDER).size).toBe(TOOL_ORDER.length);
  });

  it("has valid object schemas and useful descriptions", () => {
    for (const t of AI_TOOLS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.properties, t.name).toBeTypeOf("object");
      expect(t.description.length, t.name).toBeGreaterThan(40);
      checkSchema(t.inputSchema, t.name);
      expect(JSON.parse(JSON.stringify(t.inputSchema))).toEqual(t.inputSchema);
    }
  });

  it("flags mutating and engine tools", () => {
    for (const t of AI_TOOLS) {
      expect(t.mutating, t.name).toBe(!READ_ONLY.includes(t.name));
      expect(!!t.needsEngine, t.name).toBe(ENGINE.includes(t.name));
    }
    const ro = listAiTools({ engine: fakeEngine().engine }, { readOnly: true }).map((t) => t.name);
    expect(ro).toEqual(READ_ONLY.filter((n) => TOOL_ORDER.includes(n as never)).sort((a, b) => TOOL_ORDER.indexOf(a as never) - TOOL_ORDER.indexOf(b as never)));
    expect(ro).not.toContain("doc_patch");
  });

  it("hides engine tools without an engine", async () => {
    const names = listAiTools().map((t) => t.name);
    for (const n of ENGINE) expect(names).not.toContain(n);
    expect(listAiTools({ engine: fakeEngine().engine }).map((t) => t.name)).toEqual([...TOOL_ORDER]);
    expect(() => findAiTool("render_preview")).toThrow(expect.objectContaining({ code: "unavailable" }));
    expect(() => findAiTool("doc_sumary")).toThrow(expect.objectContaining({ code: "notFound", hint: expect.stringContaining('Did you mean "doc_summary"') }));
    const c = await ctx();
    await expect(callAiTool(c, "export", {})).rejects.toMatchObject({ code: "unavailable" });
  });

  it("checks inputs against the schema", async () => {
    const c = await ctx();
    await expect(callAiTool(c, "layer_remove", {})).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining('"id"') });
    await expect(callAiTool(c, "layer_remove", { id: 3 })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("must be string") });
    await expect(callAiTool(c, "catalog_get", { section: "nope" })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("one of") });
    await expect(callAiTool(c, "doc_summary", [])).rejects.toMatchObject({ code: "invalid" });
    expect(checkInput({ type: "object", properties: { n: { type: "number" } } }, { n: 3 }, "t")).toEqual({ n: 3 });
    expect(() => checkInput({ type: "object", properties: { n: { type: "integer" } } }, { n: 1.5 }, "t")).toThrow(/must be integer/);
    expect(checkInput({ type: "object" }, null, "t")).toEqual({});
  });

  it("resultImages points at render_preview images only", () => {
    expect(resultImages("render_preview", { preview: "a.png", images: ["b.png", "a.png"] })).toEqual(["b.png", "a.png"]);
    expect(resultImages("render_preview", { preview: "a.png" })).toEqual(["a.png"]);
    expect(resultImages("export", { images: ["a.png"] })).toEqual([]);
    expect(resultImages("render_preview", null)).toEqual([]);
  });
});

// ─── document tools ─────────────────────────────────────────────────────

describe("document tools on a MemoryFs project", () => {
  it("project_create in an empty folder (blank and from a local file)", async () => {
    const fs = new MemoryFs();
    const r = (await callAiTool({ fs }, "project_create", { name: "Hello", size: "square" })) as { created: boolean; summary: { canvas: { width: number } } };
    expect(r.created).toBe(true);
    expect(r.summary.canvas.width).toBe(1080);
    await expect(callAiTool({ fs }, "project_create", { name: "Again" })).rejects.toMatchObject({ code: "conflict" });
    const read: string[] = [];
    const fs2 = new MemoryFs();
    await callAiTool({ fs: fs2, host: { readLocalFile: async (p) => (read.push(p), tinyPng(30, 10)) } }, "project_create", { name: "Pic", image: "/Users/me/Pictures/Cat.png" });
    expect(read).toEqual(["/Users/me/Pictures/Cat.png"]);
    expect((await getDoc(fs2)).canvas).toMatchObject({ width: 30, height: 10 });
    expect((await getDoc(fs2)).layers[0]).toMatchObject({ id: "photo", src: "assets/images/cat.png" });
    await expect(callAiTool({ fs: new MemoryFs() }, "project_create", { name: "X", image: "/a.png" })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("cannot read local files") });
    await expect(callAiTool({ fs: new MemoryFs() }, "project_create", { name: "X", image: "https://x.test/a.png" })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("no network") });
  });

  it("project_create from a template", async () => {
    const files = { "photo.json": JSON.stringify({ version: 1, id: "t", canvas: { width: 100, height: 100 }, layers: [{ id: "slot", type: "image", src: "assets/images/sample.png", width: 100, height: 100 }] }), "template.json": JSON.stringify({ slot: "slot" }), "assets/images/sample.png": tinyPng() };
    const host: ToolHost = { templates: { index: [{ id: "post", title: "Post", description: "", category: "social", tags: [], width: 100, height: 100, slot: "slot" }], files: async () => files } };
    const fs = new MemoryFs();
    await callAiTool({ fs, host }, "project_create", { name: "From tpl", template: "post" });
    expect((await getDoc(fs)).layers[0].id).toBe("slot");
    await expect(callAiTool({ fs: new MemoryFs(), host }, "project_create", { name: "x", template: "psot" })).rejects.toMatchObject({ code: "notFound" });
    await expect(callAiTool({ fs: new MemoryFs() }, "project_create", { name: "x", template: "post" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("project_info, doc_summary, doc_get, layer_list, doc_validate", async () => {
    const c = await ctx();
    const info = (await callAiTool(c, "project_info", {})) as { manifest: { name: string }; counts: { errors: number } };
    expect(info.manifest.name).toBe("tool-test");
    expect(info.counts.errors).toBe(0);
    const s = (await callAiTool(c, "doc_summary", {})) as { layers: { id: string }[] };
    expect(s.layers.map((l) => l.id)).toEqual(["photo"]);
    expect(((await callAiTool(c, "doc_get", {})) as PhotoDoc).canvas.width).toBe(400);
    expect(((await callAiTool(c, "layer_list", {})) as { layers: { id: string }[] }).layers[0].id).toBe("photo");
    expect(await callAiTool(c, "doc_validate", {})).toMatchObject({ valid: true });
    const bad = (await callAiTool(c, "doc_validate", { doc: { version: 1, id: "x", canvas: { width: 0, height: 1 }, layers: [] } })) as { valid: boolean; issues: { path: string }[] };
    expect(bad.valid).toBe(false);
    expect(bad.issues[0].path).toBe("canvas.width");
  });

  it("layer_add / layer_update / filter_add / mask_set / layer_move / layer_remove", async () => {
    const c = await ctx();
    const add = (await callAiTool(c, "layer_add", { layer: { id: "title", type: "text", text: "Hi", x: 10, y: 10, size: 40 } })) as { status: string; hint: string };
    expect(add.status).toBe("applied");
    expect(add.hint).toContain("render_preview");
    await callAiTool(c, "layer_add", { layer: { id: "g", type: "group", children: [] }, below: "photo" });
    expect((await doc(c)).layers.map((l) => l.id)).toEqual(["g", "photo", "title"]);
    expect(await callAiTool(c, "layer_update", { id: "title", set: { size: 60, effects: { dropShadow: { blur: 10 } } } })).toMatchObject({ status: "applied" });
    expect(await layerOf(c, "title")).toMatchObject({ size: 60, effects: { dropShadow: { blur: 10 } } });
    expect(await callAiTool(c, "layer_update", { id: "title", set: { size: 60 } })).toMatchObject({ status: "unchanged", applied: false });
    await callAiTool(c, "filter_add", { id: "photo", filter: { type: "exposure", exposure: 0.4 } });
    await callAiTool(c, "filter_add", { id: "photo", filter: { type: "sepia" }, index: 0 });
    expect((await layerOf(c, "photo"))!.filters!.map((f) => f.type)).toEqual(["sepia", "exposure"]);
    await callAiTool(c, "mask_set", { id: "photo", mask: { shape: "ellipse", x: 0, y: 0, width: 40, height: 20, feather: 5 } });
    expect((await layerOf(c, "photo"))!.mask).toMatchObject({ shape: "ellipse" });
    await callAiTool(c, "mask_set", { id: "photo", mask: null });
    expect(await layerOf(c, "photo")).not.toHaveProperty("mask");
    await callAiTool(c, "layer_move", { id: "title", parent: "g" });
    expect(((await layerOf(c, "g")) as GroupLayer).children.map((l) => l.id)).toEqual(["title"]);
    await callAiTool(c, "layer_move", { id: "title", parent: null, index: 0 });
    expect((await doc(c)).layers.map((l) => l.id)).toEqual(["title", "g", "photo"]);
    const dry = (await callAiTool(c, "layer_remove", { id: "photo", dryRun: true })) as { status: string; plan: { layers: { removed: string[] } } };
    expect(dry.status).toBe("dry-run");
    expect(dry.plan.layers.removed).toEqual(["photo"]);
    expect(await layerOf(c, "photo")).toBeTruthy();
    await callAiTool(c, "layer_remove", { id: "photo" });
    expect(await layerOf(c, "photo")).toBeUndefined();
    await expect(callAiTool(c, "layer_remove", { id: "photo" })).rejects.toMatchObject({ code: "notFound" });
  });

  it("doc_patch refusal writes nothing", async () => {
    const c = await ctx();
    const before = await c.fs.readText("photo.json");
    const r = (await callAiTool(c, "doc_patch", { ops: [{ op: "set", path: "layers#photo.opacity", value: 80 }, { op: "set", path: "canvas.width", value: 500 }] })) as { status: string; applied: boolean; counts: { errors: number }; issues: { path: string; hint?: string }[]; hint: string };
    expect(r).toMatchObject({ status: "refused", applied: false, counts: { errors: 1 } });
    expect(r.issues[0]).toMatchObject({ path: "layers#photo.opacity", hint: expect.stringContaining("0.8") });
    expect(r.hint).toContain("Nothing was written");
    expect(await c.fs.readText("photo.json")).toBe(before);
    await expect(callAiTool(c, "doc_patch", { ops: [{ op: "set", path: "canvas.width", value: 500 }, { op: "nope" }] })).rejects.toMatchObject({ details: { opIndex: 1 } });
    expect(await c.fs.readText("photo.json")).toBe(before);
    expect(await callAiTool(c, "doc_patch", { ops: [{ op: "resizeImage", scale: 0.5 }] })).toMatchObject({ status: "applied" });
    expect((await doc(c)).canvas).toMatchObject({ width: 200, height: 100 });
  });

  it("doc_apply replaces the document", async () => {
    const c = await ctx();
    const next = { ...(await doc(c)), title: "Replaced" };
    expect(await callAiTool(c, "doc_apply", { doc: next })).toMatchObject({ status: "applied" });
    expect((await doc(c)).title).toBe("Replaced");
    expect(await callAiTool(c, "doc_apply", { doc: { ...next, layers: "x" } })).toMatchObject({ status: "refused" });
  });

  it("catalog_get: overview, section, entry, did-you-mean", async () => {
    const c = await ctx();
    const all = (await callAiTool(c, "catalog_get", {})) as { sections: Record<string, unknown[]> };
    expect(Object.keys(all.sections)).toEqual(["layerTypes", "filters", "looks", "effects", "blendModes", "shapes", "fonts", "sizes", "models"]);
    expect(all.sections.filters).toHaveLength(CATALOG.filters.length);
    const sec = (await callAiTool(c, "catalog_get", { section: "looks" })) as { section: string; entries: unknown[] };
    expect(sec).toMatchObject({ section: "looks" });
    expect(sec.entries).toHaveLength(CATALOG.looks.length);
    expect(await callAiTool(c, "catalog_get", { section: "filters", id: "curves" })).toMatchObject({ section: "filters", entry: { id: "curves", params: expect.any(Array), example: expect.any(Object) } });
    expect(await callAiTool(c, "catalog_get", { section: "blendModes", id: "multiply" })).toEqual({ section: "blendModes", entry: "multiply" });
    await expect(callAiTool(c, "catalog_get", { section: "filters", id: "curvs" })).rejects.toMatchObject({ code: "notFound", hint: expect.stringContaining('Did you mean "curves"') });
    await expect(callAiTool(c, "catalog_get", { section: "shapes", id: "circle" })).rejects.toMatchObject({ code: "notFound" });
  });

  it("library_list, templates_list, check, assets_list", async () => {
    const c = await ctx({ library });
    const lib = (await callAiTool(c, "library_list", { kind: "image" })) as { assets: { id: string; ref: string; size: string }[]; total: number };
    expect(lib.assets.map((a) => a.ref)).toEqual(["library:portrait", "library:beach"]);
    expect(lib.assets[0].size).toBe("1600×1200");
    expect(((await callAiTool(c, "library_list", { query: "smiling" })) as { total: number }).total).toBe(1);
    expect(((await callAiTool(c, "library_list", { kind: "font" })) as { assets: { ref: string }[] }).assets[0].ref).toBe("inter");
    expect(await callAiTool(await ctx(), "library_list", {})).toEqual({ assets: [], total: 0 });
    expect(await callAiTool(c, "templates_list", {})).toEqual({ templates: [] });
    const chk = (await callAiTool(c, "check", {})) as { ok: boolean; issues: unknown[] };
    expect(chk.ok).toBe(true);
    await callAiTool(c, "layer_add", { layer: { id: "lib", type: "image", src: "library:nope", width: 10, height: 10 } });
    expect(((await callAiTool(c, "check", {})) as { ok: boolean }).ok).toBe(false);
    const assets = (await callAiTool(c, "assets_list", {})) as { assets: { path: string; usedBy: string[] }[] };
    expect(assets.assets).toEqual([expect.objectContaining({ path: "assets/images/photo.png", usedBy: ["photo"] })]);
  });

  it("assets_add from a local file (+ addLayer) and assets_remove", async () => {
    const c = await ctx({ readLocalFile: async () => tinyPng(800, 100) });
    const r = (await callAiTool(c, "assets_add", { file: "/tmp/Logo Big.png", addLayer: true, license: "CC0" })) as { asset: { path: string }; layer: string; status: string };
    expect(r.asset.path).toBe("assets/images/logo-big.png");
    expect(r.layer).toBe("logo-big");
    expect(r.status).toBe("applied");
    // Fitted inside the 400 × 200 canvas, centred.
    expect(await layerOf(c, "logo-big")).toEqual({ id: "logo-big", type: "image", src: "assets/images/logo-big.png", x: 0, y: 75, width: 400, height: 50 });
    const r2 = (await callAiTool(c, "assets_add", { file: "/tmp/Logo Big.png", addLayer: true })) as { layer: string; asset: { path: string } };
    expect(r2).toMatchObject({ layer: "logo-big-2", asset: { path: "assets/images/logo-big-2.png" } });
    const plain = (await callAiTool(c, "assets_add", { file: "/tmp/x.png", name: "renamed.png" })) as { asset: { path: string }; hint: string };
    expect(plain.asset.path).toBe("assets/images/renamed.png");
    expect(plain.hint).toContain("assets/images/renamed.png");
    await expect(callAiTool(c, "assets_add", {})).rejects.toMatchObject({ code: "invalid" });
    await expect(callAiTool(c, "assets_remove", { path: "assets/images/logo-big.png" })).rejects.toMatchObject({ code: "conflict" });
    expect(await callAiTool(c, "assets_remove", { path: "assets/images/renamed.png" })).toEqual({ removed: "assets/images/renamed.png", usedBy: [] });
  });

  it("assets_add from a URL uses ctx.fetch", async () => {
    const urls: string[] = [];
    const c = await ctx();
    const b = tinyPng(10, 10);
    c.fetch = async (u) => (urls.push(u), { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => b.slice().buffer as ArrayBuffer });
    const r = (await callAiTool(c, "assets_add", { url: "https://cdn.test/img/dog.png" })) as { asset: { path: string; source: string } };
    expect(r.asset).toMatchObject({ path: "assets/images/dog.png", source: "cdn.test" });
    expect(urls).toEqual(["https://cdn.test/img/dog.png"]);
  });
});

// ─── engine tools with a fake engine ────────────────────────────────────

describe("engine tools with a fake EngineHost", () => {
  it("render_preview writes renders/preview-*.png and returns images (compare → 2)", async () => {
    const { engine, calls } = fakeEngine();
    const c = await ctx({ engine });
    await callAiTool(c, "filter_add", { id: "photo", filter: { type: "sepia" } });
    await callAiTool(c, "layer_add", { layer: { id: "adj", type: "adjustment", filters: [{ type: "invert" }] } });
    const one = (await callAiTool(c, "render_preview", {})) as { preview: string; images: string[]; size: string; canvas: string };
    expect(one.preview).toMatch(/^renders\/preview[\w-]*\.png$/);
    expect(one.images).toEqual([one.preview]);
    expect(one.canvas).toBe("400×200");
    expect(await c.fs.exists(one.preview)).toBe(true);
    expect(resultImages("render_preview", one)).toEqual([one.preview]);
    const two = (await callAiTool(c, "render_preview", { compare: true })) as { images: string[] };
    expect(two.images).toHaveLength(2);
    expect(two.images[0]).toMatch(/-before\.png$/);
    for (const p of two.images) expect(await c.fs.exists(p)).toBe(true);
    // The "before" render has no filters and no adjustment layers.
    expect(calls.render.at(-1)).toEqual({ only: undefined, layers: ["photo"], filters: 0 });
    expect(calls.render.at(-2)).toMatchObject({ layers: ["photo", "adj"], filters: 2 });
    await callAiTool(c, "render_preview", { layer: "photo" });
    expect(calls.render.at(-1)!.only).toEqual(["photo"]);
    await expect(callAiTool(c, "render_preview", { layer: "nope" })).rejects.toMatchObject({ code: "notFound" });
    const z = (await callAiTool(c, "render_preview", { zoom: { x: 10, y: 10, width: 50, height: 40 } })) as { canvas: string };
    expect(z.canvas).toBe("50×40");
  });

  it("export writes the planned files, variants, and handles mime fallback", async () => {
    const { engine, calls } = fakeEngine();
    const c = await ctx({ engine });
    const r = (await callAiTool(c, "export", { format: "jpeg" })) as { files: { path: string; format: string; width: number }[] };
    expect(r.files).toEqual([expect.objectContaining({ path: "dist/tool-test.jpg", format: "jpeg", width: 400, height: 200, kb: expect.any(Number) })]);
    expect(await c.fs.exists("dist/tool-test.jpg")).toBe(true);
    const v = (await callAiTool(c, "export", { format: "png", out: "ignored.png", variants: [{ preset: "og" }, { preset: "square", format: "webp" }, { scale: 0.5 }] })) as { files: { path: string }[] };
    expect(v.files.map((f) => f.path)).toEqual(["dist/tool-test-og.png", "dist/tool-test-square.webp", "dist/tool-test-200x100.png"]);
    for (const f of v.files) expect(await c.fs.exists(f.path)).toBe(true);
    expect(calls.export.slice(-3)).toEqual([{ width: 1200, height: 630, format: "png" }, { width: 1080, height: 1080, format: "webp" }, { width: 200, height: 100, format: "png" }]);
    await expect(callAiTool(c, "export", { preset: "nope" })).rejects.toMatchObject({ code: "invalid" });

    const fallback = fakeEngine({ mimeFor: (m) => (m === "image/avif" ? "image/png" : m) });
    const c2 = await ctx({ engine: fallback.engine });
    const a = (await callAiTool(c2, "export", { format: "avif" })) as { files: { path: string; format: string; note?: string }[] };
    expect(a.files[0]).toMatchObject({ path: "dist/tool-test.png", format: "png", note: expect.stringContaining("AVIF") });
    expect(await c2.fs.exists("dist/tool-test.avif")).toBe(false);
  });

  it("export: the cover-crop note judges text by the glyphs it paints, not its box", async () => {
    const d: PhotoDoc = {
      version: 1,
      id: "t",
      canvas: { width: 1200, height: 630 },
      layers: [
        { id: "title", type: "text", text: "Hi", x: 0, y: 100, width: 1200, align: "center", size: 80 },
        { id: "badge", type: "shape", shape: "rect", x: 0, y: 0, width: 100, height: 100 },
      ],
    };
    const square = { source: { x: 285, y: 0, width: 630, height: 630 } };
    // Box only (no measurements): the 1200 px wide box is "cut".
    expect(coverCuts(d, square)).toEqual(["title", "badge"]);
    // Measured: the centred glyphs (x 540…660) stay inside the square crop.
    const measured = { title: { x: 0, y: 100, width: 1200, height: 96, rotation: 0, ink: { x: 540, y: 108, width: 120, height: 80 } } };
    expect(coverCuts(d, square, measured)).toEqual(["badge"]);
    expect(coverCuts(d, { source: { x: 600, y: 0, width: 600, height: 630 } }, measured)).toEqual(["title", "badge"]);
    expect(coverCuts(d, { source: { x: 0, y: 0, width: 1200, height: 630 } })).toEqual([]);

    // Through the export tool: the engine's layerBoxes feeds it.
    const { engine } = fakeEngine();
    // 400 × 200 canvas → square cover = source x 100…300; the centred glyphs sit at 180…220.
    let ink = { x: 180, y: 28, width: 40, height: 40 };
    const c = await ctx({ engine: { ...engine, layerBoxes: async () => ({ title: { x: 0, y: 20, width: 400, height: 48, rotation: 0, ink } }) } });
    await callAiTool(c, "layer_add", { layer: { id: "title", type: "text", text: "Hi", x: 0, y: 20, width: 400, align: "center", size: 40 } });
    const r = (await callAiTool(c, "export", { preset: "square", fit: "cover" })) as { files: { note?: string }[] };
    expect(r.files[0].note ?? "").not.toContain("title");
    ink = { x: 20, y: 28, width: 360, height: 40 };
    const r2 = (await callAiTool(c, "export", { preset: "square", fit: "cover", name: "wide" })) as { files: { note?: string }[] };
    expect(r2.files[0].note).toContain("cuts layer title");
  });

  it("image_analyze checks the layer id", async () => {
    const c = await ctx({ engine: fakeEngine().engine });
    expect(await callAiTool(c, "image_analyze", {})).toMatchObject({ brightness: 50 });
    await expect(callAiTool(c, "image_analyze", { layer: "nope" })).rejects.toMatchObject({ code: "notFound" });
  });

  it("remove_background writes a mask, sets it, adds a background fill below and a shadow", async () => {
    const { engine, calls } = fakeEngine({ bbox: { x: 2, y: 1, width: 5, height: 5 } });
    const c = await ctx({ engine });
    const r = (await callAiTool(c, "remove_background", { id: "photo", background: "#00ff00", shadow: true })) as { mask: string; status: string; model: string; subject: unknown };
    expect(r).toMatchObject({ mask: "assets/masks/photo-cutout.png", status: "applied", model: "rmbg-1.4" });
    // 10 × 10 mask px over the 400 × 200 photo layer at (0, 0): × 40 horizontally, × 20 vertically.
    expect(r.subject).toEqual({ x: 80, y: 20, width: 200, height: 100 });
    expect(calls.background).toEqual([{ id: "photo", model: "rmbg-1.4" }]);
    expect(await c.fs.exists("assets/masks/photo-cutout.png")).toBe(true);
    const d = await doc(c);
    expect(d.layers.map((l) => l.id)).toEqual(["photo-background", "photo"]);
    expect(d.layers[0]).toMatchObject({ type: "fill", fill: "#00ff00" });
    expect(d.layers[1]).toMatchObject({ mask: { src: "assets/masks/photo-cutout.png" }, effects: { dropShadow: expect.objectContaining({ blur: 30 }) } });
    expect((await readAssetManifest(c.fs)).assets.find((a) => a.path === "assets/masks/photo-cutout.png")).toMatchObject({ kind: "mask", source: "remove_background:rmbg-1.4" });
    // Again: the new mask replaces the old one, which is deleted.
    const again = (await callAiTool(c, "remove_background", { id: "photo", model: "modnet" })) as { mask: string };
    expect(again.mask).toBe("assets/masks/photo-cutout-2.png");
    expect(await c.fs.exists("assets/masks/photo-cutout.png")).toBe(false);
    expect((await readAssetManifest(c.fs)).assets.map((a) => a.path)).not.toContain("assets/masks/photo-cutout.png");
    await callAiTool(c, "layer_add", { layer: { id: "t", type: "text", text: "x" } });
    await expect(callAiTool(c, "remove_background", { id: "t" })).rejects.toMatchObject({ code: "invalid" });
    await expect(callAiTool(c, "remove_background", { id: "photo", model: "sam-base" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("remove_background fit: places the subject in a box (explicit, or the template's subject area once)", async () => {
    const { engine } = fakeEngine({ bbox: { x: 2, y: 1, width: 5, height: 5 } });
    const c = await ctx({ engine });
    const r = (await callAiTool(c, "remove_background", { id: "photo", fit: { x: 0, y: 0, width: 100, height: 100, anchor: "bottom" } })) as { subject: unknown; fitted: unknown; hint: string };
    expect(await layerOf(c, "photo")).toMatchObject({ x: -40, y: 40, width: 200, height: 100 });
    expect(r.subject).toEqual({ x: 0, y: 50, width: 100, height: 50 });
    expect(r.fitted).toMatchObject({ box: { x: 0, y: 0, width: 100, height: 100 }, anchor: "bottom", from: "input" });
    await expect(callAiTool(c, "remove_background", { id: "photo", fit: { x: 0, y: 0, width: 0, height: 10 } })).rejects.toMatchObject({ code: "invalid" });
    await expect(callAiTool(c, "remove_background", { id: "photo", fit: { x: 0, y: 0, width: 10, height: 10, anchor: "middle" } })).rejects.toMatchObject({ code: "invalid" });

    // From a template with a subject area: the first cut-out of the slot fits it.
    const tdoc = { version: 1, id: "shop", canvas: { width: 400, height: 400 }, layers: [{ id: "photo", type: "image", src: "library:portrait", x: 0, y: 0, width: 400, height: 400, fit: "contain", mask: { src: "assets/masks/photo-cutout.png" } }] };
    const files = { "photo.json": JSON.stringify(tdoc), "template.json": JSON.stringify({ id: "shop", slot: "photo" }), "assets/masks/photo-cutout.png": tinyPng(4, 4) };
    const host: ToolHost = { engine, templates: { index: [{ id: "shop", title: "Shop", description: "", category: "product", tags: [], width: 400, height: 400, slot: "photo", subjectArea: { x: 100, y: 100, width: 200, height: 200, anchor: "bottom" } }], files: async () => files } };
    const fs = new MemoryFs();
    await createProject(fs, { name: "shop", template: "shop", templateFiles: files, image: { name: "mug.png", bytes: tinyPng(40, 40) } });
    const t = { fs, host };
    const first = (await callAiTool(t, "remove_background", { id: "photo" })) as { subject: unknown; fitted: unknown; hint: string };
    expect(first.fitted).toMatchObject({ from: "template shop", anchor: "bottom" });
    // Subject 200 × 200 (mask 5/10 of a 400 px box) → exactly the 200 × 200 area.
    expect(first.subject).toEqual({ x: 100, y: 100, width: 200, height: 200 });
    expect(first.hint).toContain("fit: false");
    const before = await layerOf(t, "photo");
    // Already cut out: a second removal leaves the layer where it is.
    const second = (await callAiTool(t, "remove_background", { id: "photo" })) as { fitted?: unknown; hint: string };
    expect(second.fitted).toBeUndefined();
    expect(second.hint).toContain('"op": "fitLayer"');
    expect(await layerOf(t, "photo")).toMatchObject({ x: (before as ImageLayer).x, width: (before as ImageLayer).width });
  });

  it("mask_generate: points / box / color validation, invert, target copy", async () => {
    const { engine, calls } = fakeEngine();
    const c = await ctx({ engine });
    await expect(callAiTool(c, "mask_generate", { id: "photo", method: "points" })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("points") });
    await expect(callAiTool(c, "mask_generate", { id: "photo", method: "points", points: [] })).rejects.toMatchObject({ code: "invalid" });
    await expect(callAiTool(c, "mask_generate", { id: "photo", method: "box", box: [1, 2, 3] })).rejects.toMatchObject({ code: "invalid" });
    await expect(callAiTool(c, "mask_generate", { id: "photo", method: "color" })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("color") });
    await expect(callAiTool(c, "mask_generate", { id: "photo", method: "lasso" })).rejects.toMatchObject({ code: "invalid" });
    await expect(callAiTool(c, "mask_generate", { id: "ghost", method: "subject" })).rejects.toMatchObject({ code: "notFound" });

    const p = (await callAiTool(c, "mask_generate", { id: "photo", method: "points", points: [[5, 5], [1, 1, 0]], invert: true })) as { mask: string };
    expect(calls.segment[0]).toEqual({ id: "photo", prompt: { points: [[5, 5, 1], [1, 1, 0]] } });
    expect(await layerOf(c, "photo")).toMatchObject({ mask: { src: p.mask, invert: true } });
    const b = (await callAiTool(c, "mask_generate", { id: "photo", method: "box", box: [0, 0, 10, 10], feather: 3 })) as { mask: string };
    expect(calls.segment[1].prompt).toEqual({ box: [0, 0, 10, 10] });
    // The previous generated mask is removed when replaced.
    expect(await c.fs.exists(p.mask)).toBe(false);
    expect(await c.fs.exists(b.mask)).toBe(true);
    await callAiTool(c, "mask_generate", { id: "photo", method: "color", color: "#00ff00", tolerance: 30 });
    expect(calls.color).toEqual([{ id: "photo", color: "#00ff00", tolerance: 30 }]);
    expect(await c.fs.exists(b.mask)).toBe(false);

    const copy = (await callAiTool(c, "mask_generate", { id: "photo", method: "subject", target: "copy" })) as { layer: string; mask: string };
    expect(copy.layer).toBe("photo-cutout");
    const d = await doc(c);
    expect(d.layers.map((l) => l.id)).toEqual(["photo", "photo-cutout"]);
    expect((d.layers[1] as ImageLayer).mask).toEqual({ src: copy.mask });
    // The original keeps its own mask (still referenced, so kept on disk).
    const orig = (d.layers[0] as ImageLayer).mask as { src: string };
    expect(orig.src).not.toBe(copy.mask);
    expect(await c.fs.exists(orig.src)).toBe(true);
    const copy2 = (await callAiTool(c, "mask_generate", { id: "photo", method: "subject", target: "copy", copyId: "photo-cutout" })) as { layer: string };
    expect(copy2.layer).toBe("photo-cutout-2");
  });
});

describe("engine tools — refusals", () => {
  it("a refused mask write leaves no orphan mask file", async () => {
    const c = await ctx({ engine: fakeEngine().engine });
    // Make the document invalid on disk (as a hand edit would).
    const d = await getDoc(c.fs);
    (d.layers[0] as ImageLayer).opacity = 50;
    await c.fs.writeText("photo.json", JSON.stringify(d));
    const r = (await callAiTool(c, "remove_background", { id: "photo" })) as { status: string; applied: boolean };
    expect(r).toMatchObject({ status: "refused", applied: false });
    expect(await c.fs.list("assets/masks")).toEqual([]);
    expect((await readAssetManifest(c.fs)).assets.filter((a) => a.kind === "mask")).toEqual([]);
  });
});
