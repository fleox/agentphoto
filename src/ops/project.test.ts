import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import type { ImageLayer, PhotoDoc } from "../core/types";
import { tinyPng } from "../test-support/png";
import { addAsset, addAssetFromUrl, listAssets, missingFiles, removeAsset, safeFileName, type FetchLike } from "./assets";
import { AGENTPHOTO_VERSION } from "./context";
import { getDoc } from "./doc";
import { createProject, loadProject, saveDoc } from "./project";
import { findTemplate, instantiateTemplate, listTemplates, parseTemplateInfo, type TemplateIndex } from "./templates";

const TEMPLATE_DOC: PhotoDoc = {
  version: 1,
  id: "tpl",
  title: "Template",
  canvas: { width: 1080, height: 1080, background: "#111111" },
  layers: [
    { id: "slot", type: "image", src: "assets/images/placeholder.png", x: 0, y: 0, width: 1080, height: 1080, fit: "cover" },
    { id: "title", type: "text", text: "Hello", x: 40, y: 40 },
  ],
};
const templateFiles = (slot?: string): Record<string, Uint8Array | string> => ({
  "photo.json": JSON.stringify(TEMPLATE_DOC),
  "template.json": JSON.stringify({ id: "square-post", title: "Square", ...(slot ? { slot } : {}) }),
  "preview.jpg": new Uint8Array([1, 2, 3]),
  "assets/images/placeholder.png": tinyPng(4, 4),
});

describe("createProject", () => {
  it("creates a blank project", async () => {
    const fs = new MemoryFs();
    const r = await createProject(fs, { name: "Summer Sale!" });
    expect(r.manifest).toMatchObject({ name: "summer-sale", title: "Summer Sale!", agentphoto: AGENTPHOTO_VERSION });
    expect(r.doc).toEqual({ version: 1, id: "summer-sale", title: "Summer Sale!", canvas: { width: 1200, height: 630, background: "#ffffff" }, layers: [] });
    expect(r.files).toEqual(["agentphoto.json", "assets/manifest.json", "photo.json"]);
    expect(r.issues).toEqual([]);
    expect(await loadProject(fs)).toEqual({ manifest: r.manifest, doc: r.doc });
    expect(JSON.parse(await fs.readText("assets/manifest.json"))).toEqual({ assets: [] });
  });

  it("uses size presets, explicit sizes and backgrounds", async () => {
    expect((await createProject(new MemoryFs(), { name: "a", size: "story" })).doc.canvas).toEqual({ width: 1080, height: 1920, background: "#ffffff" });
    expect((await createProject(new MemoryFs(), { name: "a", width: 500 })).doc.canvas).toMatchObject({ width: 500, height: 500 });
    expect((await createProject(new MemoryFs(), { name: "a", width: 500.4, height: 300, background: null })).doc.canvas).toEqual({ width: 500, height: 300, background: null });
    await expect(createProject(new MemoryFs(), { name: "a", size: "storry" })).rejects.toMatchObject({ code: "invalid", hint: expect.stringContaining('Did you mean "story"') });
    await expect(createProject(new MemoryFs(), { name: "a", width: 0, height: 10 })).rejects.toMatchObject({ code: "invalid" });
    await expect(createProject(new MemoryFs(), { name: "a", width: 20000, height: 10 })).rejects.toMatchObject({ code: "invalid" });
    await expect(createProject(new MemoryFs(), { name: " " })).rejects.toMatchObject({ code: "invalid" });
    await expect(createProject(new MemoryFs(), { name: "a", background: "nope" })).rejects.toMatchObject({ code: "validation" });
  });

  it("starts from a photo: canvas = image size, a photo layer, the asset recorded", async () => {
    const fs = new MemoryFs();
    const r = await createProject(fs, { name: "trip", image: { name: "IMG 2041.PNG", bytes: tinyPng(64, 48), license: "CC0" } });
    expect(r.doc.canvas).toEqual({ width: 64, height: 48 });
    expect(r.doc.layers).toEqual([{ id: "photo", type: "image", name: "Photo", src: "assets/images/img-2041.png", x: 0, y: 0, width: 64, height: 48 }]);
    expect(r.files).toContain("assets/images/img-2041.png");
    expect((await listAssets(fs)).assets[0]).toMatchObject({ path: "assets/images/img-2041.png", kind: "image", source: "user", license: "CC0", width: 64, height: 48, usedBy: ["photo"] });
    // With a size: the photo covers the canvas.
    const sized = await createProject(new MemoryFs(), { name: "trip", size: "square", image: { name: "a.png", bytes: tinyPng(64, 48) } });
    expect(sized.doc.layers[0]).toMatchObject({ width: 1080, height: 1080, fit: "cover" });
    await expect(createProject(new MemoryFs(), { name: "x", image: { name: "a.txt", bytes: new TextEncoder().encode("hello, this is text") } })).rejects.toMatchObject({ code: "invalid" });
  });

  it("instantiates templates, with the photo in the slot", async () => {
    const fs = new MemoryFs();
    const r = await createProject(fs, { name: "Post", template: "square-post", templateFiles: templateFiles("slot"), image: { name: "me.png", bytes: tinyPng(10, 20) } });
    expect(r.manifest.template).toBe("square-post");
    expect(r.doc).toMatchObject({ id: "post", title: "Post", canvas: { width: 1080, height: 1080 } });
    expect(r.doc.layers.map((l) => l.id)).toEqual(["slot", "title"]);
    expect((r.doc.layers[0] as ImageLayer).src).toBe("assets/images/me.png");
    expect(await fs.exists("assets/images/placeholder.png")).toBe(true);
    expect(await fs.exists("preview.jpg")).toBe(false);
    expect(await fs.exists("template.json")).toBe(false);
    // No slot: the photo goes at the bottom, covering the canvas.
    const r2 = await createProject(new MemoryFs(), { name: "Post", template: "t", templateFiles: templateFiles(), image: { name: "me.png", bytes: tinyPng(10, 20) }, size: "og", background: "#000" });
    expect(r2.doc.layers.map((l) => l.id)).toEqual(["photo", "slot", "title"]);
    expect(r2.doc.canvas).toEqual({ width: 1200, height: 630, background: "#000" });
    expect(r2.doc.layers[0]).toMatchObject({ width: 1200, height: 630, fit: "cover" });
    await expect(createProject(new MemoryFs(), { name: "a", template: "t" })).rejects.toMatchObject({ code: "invalid" });
    await expect(createProject(new MemoryFs(), { name: "a", template: "t", templateFiles: { "template.json": "{}" } })).rejects.toMatchObject({ code: "invalid" });
    await expect(createProject(new MemoryFs(), { name: "a", template: "t", templateFiles: { "photo.json": "{ nope" } })).rejects.toMatchObject({ code: "invalid" });
    const r3 = await instantiateTemplate(new MemoryFs(), "square-post", templateFiles("slot"), { name: "Via helper" });
    expect(r3.manifest).toMatchObject({ name: "via-helper", template: "square-post" });
  });

  it("refuses to overwrite a project unless force", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "a" });
    await expect(createProject(fs, { name: "b" })).rejects.toMatchObject({ code: "conflict" });
    expect((await createProject(fs, { name: "b", force: true })).manifest.name).toBe("b");
    await expect(createProject(new MemoryFs({ "photo.json": "{}" }), { name: "b" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("saveDoc refuses invalid documents unless allowInvalid", async () => {
    const fs = new MemoryFs();
    const { doc } = await createProject(fs, { name: "a" });
    const bad = { ...doc, canvas: { width: 0, height: 1 } };
    await expect(saveDoc(fs, bad)).rejects.toMatchObject({ code: "validation", details: { issues: expect.any(Array) } });
    expect((await getDoc(fs)).canvas.width).toBe(1200);
    await saveDoc(fs, bad, { allowInvalid: true });
    expect((await getDoc(fs)).canvas.width).toBe(0);
  });
});

describe("assets", () => {
  it("names files safely and keeps extensions honest", async () => {
    expect(safeFileName("IMG 2041.JPEG")).toBe("img-2041.jpg");
    expect(safeFileName("../../evil/Été photo.png")).toBe("ete-photo.png");
    expect(safeFileName("noext", "webp")).toBe("noext.webp");
    const fs = new MemoryFs();
    const e = await addAsset(fs, { name: "photo.jpg", bytes: tinyPng(2, 2), source: "user" });
    expect(e.path).toBe("assets/images/photo.png");
    expect(e).toMatchObject({ kind: "image", width: 2, height: 2, bytes: tinyPng(2, 2).byteLength });
  });

  it("picks free names, overwrites on request, routes kinds", async () => {
    const fs = new MemoryFs();
    const a = await addAsset(fs, { name: "x.png", bytes: tinyPng(), source: "user" });
    const b = await addAsset(fs, { name: "x.png", bytes: tinyPng(), source: "user" });
    const c = await addAsset(fs, { name: "x.png", bytes: tinyPng(3, 3), source: "user" });
    expect([a.path, b.path, c.path]).toEqual(["assets/images/x.png", "assets/images/x-2.png", "assets/images/x-3.png"]);
    const o = await addAsset(fs, { name: "assets/images/x.png", bytes: tinyPng(5, 5), source: "user", overwrite: true });
    expect(o.path).toBe("assets/images/x.png");
    expect((await listAssets(fs)).assets.filter((x) => x.path === "assets/images/x.png")).toHaveLength(1);
    expect((await addAsset(fs, { name: "m.png", bytes: tinyPng(), kind: "mask", source: "ai" })).path).toBe("assets/masks/m.png");
    expect((await addAsset(fs, { name: "notes.txt", bytes: new TextEncoder().encode("hello there, text"), source: "user" })).path).toBe("assets/files/notes.txt");
    await expect(addAsset(fs, { name: "e.png", bytes: new Uint8Array(), source: "user" })).rejects.toMatchObject({ code: "invalid" });
    await expect(addAsset(fs, { name: "e.png", bytes: new TextEncoder().encode("not an image at all"), kind: "image", source: "user" })).rejects.toMatchObject({ code: "invalid" });
    await expect(addAsset(fs, { name: "images/e.png", bytes: tinyPng(), source: "user" })).rejects.toMatchObject({ code: "invalid" });
    await expect(addAsset(fs, { name: "assets/../photo.json", bytes: tinyPng(), source: "user" })).rejects.toThrow(/Invalid project path/);
  });

  it("lists usage and untracked files, refuses removing used assets", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "a", image: { name: "p.png", bytes: tinyPng(8, 8) } });
    const m = await addAsset(fs, { name: "p-mask.png", bytes: tinyPng(8, 8), kind: "mask", source: "remove_background" });
    const doc = await getDoc(fs);
    doc.layers[0].mask = { src: m.path };
    doc.layers.push({ id: "copy", type: "image", src: "assets/images/p.png" });
    await saveDoc(fs, doc);
    await fs.writeBytes("assets/edits/stray.png", tinyPng());
    const list = await listAssets(fs);
    expect(list.assets.map((a) => [a.path, a.usedBy])).toEqual([
      ["assets/images/p.png", ["photo", "copy"]],
      ["assets/masks/p-mask.png", ["photo"]],
    ]);
    expect(list.untracked).toEqual(["assets/edits/stray.png"]);
    expect(list.totalKb).toBeGreaterThan(0);
    const e = await removeAsset(fs, "assets/images/p.png").catch((x) => x);
    expect(e).toMatchObject({ code: "conflict", message: expect.stringContaining("photo, copy") });
    expect(await fs.exists("assets/images/p.png")).toBe(true);
    expect(await removeAsset(fs, "assets/images/p.png", { force: true })).toEqual({ removed: "assets/images/p.png", usedBy: ["photo", "copy"] });
    expect(await fs.exists("assets/images/p.png")).toBe(false);
    expect(await missingFiles(fs, await getDoc(fs))).toEqual([
      { path: "assets/images/p.png", by: "photo", role: "src" },
      { path: "assets/images/p.png", by: "copy", role: "src" },
    ]);
    expect(await removeAsset(fs, "assets/edits/stray.png")).toEqual({ removed: "assets/edits/stray.png", usedBy: [] });
    await expect(removeAsset(fs, "assets/nope.png")).rejects.toMatchObject({ code: "notFound" });
  });

  it("imports from URLs through the given fetch only", async () => {
    const calls: string[] = [];
    const fetchOk: FetchLike = async (url) => {
      calls.push(url);
      const b = tinyPng(6, 6);
      return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
    };
    const fs = new MemoryFs();
    const e = await addAssetFromUrl(fs, "https://example.com/pics/My%20Cat.png?x=1", fetchOk, { license: "CC0" });
    expect(e).toMatchObject({ path: "assets/images/my-cat.png", source: "example.com", sourceUrl: "https://example.com/pics/My%20Cat.png?x=1", license: "CC0" });
    expect(calls).toHaveLength(1);
    await expect(addAssetFromUrl(fs, "ftp://x/y.png", fetchOk)).rejects.toMatchObject({ code: "invalid" });
    await expect(addAssetFromUrl(fs, "not a url", fetchOk)).rejects.toMatchObject({ code: "invalid" });
    const fetch404: FetchLike = async () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(addAssetFromUrl(fs, "https://example.com/a.png", fetch404)).rejects.toMatchObject({ code: "io" });
  });
});

describe("templates", () => {
  const index: TemplateIndex = [
    { id: "youtube-thumbnail", title: "YouTube thumbnail", description: "Bold title", category: "thumbnail", tags: ["video"], width: 1280, height: 720, slot: "photo" },
    { id: "sale-banner", title: "Sale banner", description: "Discount", category: "ad", tags: ["shop", "promo"], width: 1200, height: 630 },
  ];
  it("lists, filters and finds", () => {
    expect(listTemplates(index).map((t) => t.id)).toEqual(["youtube-thumbnail", "sale-banner"]);
    expect(listTemplates(index, { category: "ad" }).map((t) => t.id)).toEqual(["sale-banner"]);
    expect(listTemplates(index, { query: "SHOP discount" }).map((t) => t.id)).toEqual(["sale-banner"]);
    expect(listTemplates(index, { query: "video ad" })).toEqual([]);
    expect(findTemplate(index, "sale-banner").width).toBe(1200);
    expect(() => findTemplate(index, "sale-baner")).toThrow(expect.objectContaining({ code: "notFound", hint: expect.stringContaining('Did you mean "sale-banner"') }));
  });
  it("parses template.json with defaults", () => {
    expect(parseTemplateInfo({}, "x")).toEqual({ id: "x", title: "x", description: "", category: "other", tags: [], width: 1200, height: 630 });
    expect(parseTemplateInfo({ id: "y", tags: [1, "a"], slot: "photo", width: 10, height: "20" }, "x")).toMatchObject({ id: "y", tags: ["1", "a"], slot: "photo", width: 10, height: 630 });
    expect(parseTemplateInfo(null, "z").id).toBe("z");
  });
});
