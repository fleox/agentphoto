import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import type { LibraryIndex } from "../core/library";
import type { Layer, PhotoDoc } from "../core/types";
import { tinyPng } from "../test-support/png";
import { addAsset } from "./assets";
import { checkProject } from "./check";
import { planExport } from "./export";
import { createProject, saveDoc } from "./project";

const library: LibraryIndex = {
  assets: [
    { id: "portrait", kind: "image", path: "images/portrait.jpg", width: 1600, height: 1200, license: "CC0", author: "Jane", source: "unsplash", tags: [], description: "A portrait", kb: 200 },
    { id: "inter", kind: "font", family: "Inter", files: [], license: "OFL", tags: [], description: "Inter", kb: 100 },
  ],
};

async function projectWith(layers: Layer[], opts: { width?: number; height?: number } = {}) {
  const fs = new MemoryFs();
  await createProject(fs, { name: "c", width: opts.width ?? 200, height: opts.height ?? 100 });
  await addAsset(fs, { name: "small.png", bytes: tinyPng(20, 10), source: "user", license: "CC-BY-4.0", author: "Bob" });
  await addAsset(fs, { name: "other.png", bytes: tinyPng(20, 10), source: "user", license: "CC0" });
  const doc: PhotoDoc = { version: 1, id: "c", canvas: { width: opts.width ?? 200, height: opts.height ?? 100 }, layers };
  await saveDoc(fs, doc, { allowInvalid: true });
  return fs;
}
const codes = (r: Awaited<ReturnType<typeof checkProject>>) => r.issues.map((i) => `${i.severity}:${i.code}:${i.path}`);

describe("checkProject", () => {
  it("is ok for a clean project", async () => {
    const fs = await projectWith([{ id: "photo", type: "image", src: "assets/images/small.png", x: 0, y: 0, width: 20, height: 10 }]);
    const r = await checkProject(fs);
    expect(r).toMatchObject({ ok: true, counts: { errors: 0, warnings: 0, infos: 0 }, canvas: { width: 200, height: 100, megapixels: 0.02 }, layers: 1 });
    expect(r.licences).toEqual([{ path: "assets/images/small.png", license: "CC-BY-4.0", author: "Bob", attribution: undefined, source: "user" }]);
    expect(r.assetsKb).toBeGreaterThan(0);
  });

  it("reports missing files, bad images and unknown library images", async () => {
    const fs = await projectWith([
      { id: "gone", type: "image", src: "assets/images/gone.png", width: 10, height: 10, mask: { src: "assets/masks/gone.png" } },
      { id: "lib", type: "image", src: "library:portrait", width: 100, height: 75 },
      { id: "unk", type: "image", src: "library:nope", width: 10, height: 10 },
      { id: "txt", type: "image", src: "assets/notes.txt", width: 10, height: 10 },
    ]);
    await fs.writeText("assets/notes.txt", "plain text, not an image");
    const r = await checkProject(fs, { library });
    expect(r.ok).toBe(false);
    const c = codes(r);
    expect(c).toContain("error:missing-file:layers#gone.src");
    expect(c).toContain("error:missing-file:layers#gone.mask.src");
    expect(c).toContain("error:unknown-library:library:nope");
    expect(c).toContain("error:bad-image:assets/notes.txt");
    expect(c.some((x) => x.includes("library:portrait"))).toBe(false);
    expect(r.licences).toContainEqual({ path: "library:portrait", license: "CC0", author: "Jane", attribution: undefined, source: "unsplash" });
    // Without a library index, library refs are not judged.
    expect(codes(await checkProject(fs)).some((x) => x.includes("unknown-library"))).toBe(false);
  });

  it("finds off-canvas layers, text overflow, opacity 0 and empty documents", async () => {
    const fs = await projectWith([
      { id: "off", type: "shape", shape: "rect", x: 300, y: 0, width: 10, height: 10, fill: "red" },
      { id: "left", type: "shape", shape: "rect", x: -20, y: 0, width: 20, height: 10, fill: "red" },
      { id: "turned", type: "shape", shape: "rect", x: 300, y: 0, width: 10, height: 10, fill: "red", rotation: 45 },
      { id: "hidden", type: "shape", shape: "rect", x: 300, y: 0, width: 10, height: 10, fill: "red", visible: false },
      { id: "long", type: "text", text: "A very long headline that runs off", x: 10, y: 10, size: 40 },
      { id: "ghost", type: "fill", fill: "red", opacity: 0 },
    ]);
    const c = codes(await checkProject(fs));
    expect(c).toContain("warning:off-canvas:layers#off");
    expect(c).toContain("warning:off-canvas:layers#left");
    expect(c).not.toContain("warning:off-canvas:layers#turned");
    expect(c).not.toContain("warning:off-canvas:layers#hidden");
    expect(c).toContain("info:text-may-overflow:layers#long");
    expect(c).toContain("info:invisible:layers#ghost");
    expect(codes(await checkProject(await projectWith([])))).toContain("warning:empty:layers");
  });

  it("flags upscaled photos (fill / cover / contain / crop)", async () => {
    const img = (id: string, extra: Partial<Layer>) => ({ id, type: "image", src: "assets/images/small.png", x: 0, y: 0, ...extra }) as Layer;
    const fs = await projectWith([
      img("ok", { width: 30, height: 15 }), // 1.5×
      img("big", { width: 100, height: 50 }), // 5×
      img("stretched", { width: 20, height: 40 }), // 4× vertically
      // cover of a 2:1 source into a square box: scale = max(10/20, 10/10) = 1 → fine.
      img("cover-ok", { width: 10, height: 10, fit: "cover" }),
      // contain of a 2:1 source into a 40 × 80 box: scale = min(2, 8) = 2.
      img("contain", { width: 40, height: 80, fit: "contain" }),
      // contain of a 2:1 source into 30 × 200: scale = min(1.5, 20) = 1.5 → fine.
      img("contain-ok", { width: 30, height: 200, fit: "contain" }),
      img("crop", { width: 20, height: 10, crop: { x: 0, y: 0, width: 5, height: 5 } }), // 4×
      img("natural", {}),
    ]);
    const c = codes(await checkProject(fs)).filter((x) => x.includes("upscaled"));
    expect(c.sort()).toEqual(["warning:upscaled:layers#big", "warning:upscaled:layers#contain", "warning:upscaled:layers#crop", "warning:upscaled:layers#stretched"]);
  });

  it("estimates the render cost of filters", async () => {
    const heavy: Layer = { id: "adj", type: "adjustment", filters: Array.from({ length: 20 }, () => ({ type: "surfaceBlur" })) };
    const r = await checkProject(await projectWith([heavy], { width: 1000, height: 1000 }));
    expect(r.cost).toBe(120);
    expect(codes(r)).toContain("info:heavy:");
    const off: Layer = { id: "adj", type: "adjustment", filters: [{ type: "blur", enabled: false }, { type: "blur" }] };
    expect((await checkProject(await projectWith([off], { width: 1000, height: 1000 }))).cost).toBe(3);
  });
});

describe("planExport", () => {
  const doc = (extra: Partial<PhotoDoc> = {}): PhotoDoc => ({ version: 1, id: "my-photo", canvas: { width: 1200, height: 600 }, layers: [], ...extra });

  it("defaults to a PNG at canvas size", () => {
    expect(planExport(doc())).toEqual({ format: "png", mime: "image/png", quality: 100, width: 1200, height: 600, scale: 1, source: { x: 0, y: 0, width: 1200, height: 600 }, dest: { x: 0, y: 0, width: 1200, height: 600 }, background: null, file: "dist/my-photo.png" });
  });

  it("uses the document's export settings, overridden by the request", () => {
    const d = doc({ export: { format: "webp", quality: 70, name: "hero" } });
    expect(planExport(d)).toMatchObject({ format: "webp", mime: "image/webp", quality: 70, file: "dist/hero.webp" });
    expect(planExport(d, { format: "avif", quality: undefined })).toMatchObject({ format: "avif", quality: 70, file: "dist/hero.avif" });
  });

  it("JPEG flattens on white by default", () => {
    expect(planExport(doc(), { format: "jpeg" })).toMatchObject({ mime: "image/jpeg", quality: 88, background: "#ffffff", file: "dist/my-photo.jpg" });
    expect(planExport(doc(), { format: "jpeg", background: "#000" }).background).toBe("#000");
    expect(planExport(doc(), { background: "red" }).background).toBe("red");
    expect(planExport(doc(), { format: "jpeg", background: "transparent" }).background).toBe("#ffffff");
    expect(planExport(doc(), { format: "jpeg", background: "rgba(0,0,0,0)" }).background).toBe("#ffffff");
    expect(planExport(doc(), { format: "png", background: "transparent" }).background).toBe("transparent");
    expect(() => planExport(doc(), { background: "nope" })).toThrow(expect.objectContaining({ code: "invalid" }));
  });

  it("cover crops a preset, contain pads it, stretch distorts", () => {
    // 1200 × 600 → square 1080: cover scale = max(0.9, 1.8) = 1.8 → source 600 × 600 centred.
    const cover = planExport(doc(), { preset: "square" });
    expect(cover).toMatchObject({ width: 1080, height: 1080, source: { x: 300, y: 0, width: 600, height: 600 }, dest: { x: 0, y: 0, width: 1080, height: 1080 }, file: "dist/my-photo-square.png" });
    expect(cover.scale).toBeCloseTo(1.8);
    const contain = planExport(doc(), { preset: "square", fit: "contain" });
    expect(contain).toMatchObject({ source: { x: 0, y: 0, width: 1200, height: 600 }, dest: { x: 0, y: 270, width: 1080, height: 540 } });
    expect(contain.scale).toBeCloseTo(0.9);
    const stretch = planExport(doc(), { preset: "square", fit: "stretch" });
    expect(stretch).toMatchObject({ source: { x: 0, y: 0, width: 1200, height: 600 }, dest: { x: 0, y: 0, width: 1080, height: 1080 } });
  });

  it("width / height keep the aspect; scale multiplies", () => {
    expect(planExport(doc(), { width: 600 })).toMatchObject({ width: 600, height: 300, scale: 0.5, file: "dist/my-photo-600x300.png" });
    expect(planExport(doc(), { height: 300 })).toMatchObject({ width: 600, height: 300 });
    expect(planExport(doc(), { scale: 2 })).toMatchObject({ width: 2400, height: 1200, scale: 2, file: "dist/my-photo-2400x1200.png" });
    expect(planExport(doc(), { width: 600, height: 600 })).toMatchObject({ width: 600, height: 600, source: { x: 300, y: 0, width: 600, height: 600 } });
    expect(planExport(doc(), { out: "exports/final.png", name: "x" }).file).toBe("exports/final.png");
    expect(planExport(doc(), { name: "My Photo!" }).file).toBe("dist/My-Photo-.png");
    expect(planExport(doc(), { quality: 150, format: "jpeg" }).quality).toBe(100);
  });

  it("rejects invalid inputs", () => {
    const bad = (req: Parameters<typeof planExport>[1]) => () => planExport(doc(), req);
    expect(bad({ format: "gif" as never })).toThrow(expect.objectContaining({ code: "invalid", hint: expect.stringContaining("png") }));
    expect(bad({ preset: "instagram" })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(bad({ preset: "storyy" })).toThrow(expect.objectContaining({ hint: expect.stringContaining('Did you mean "story"') }));
    expect(bad({ scale: 20 })).toThrow(/exceeds/);
    expect(bad({ width: -100 })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(bad({ scale: -1 })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(bad({ height: Number.NaN })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(bad({ fit: "fill" as never })).toThrow(expect.objectContaining({ code: "invalid" }));
  });
});
