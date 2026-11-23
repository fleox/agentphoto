import { describe, expect, it } from "vitest";
import { enginePageHtml } from "./page";
import { decodeImage } from "./session";

describe("engine session plumbing", () => {
  it("decodes { base64 } results and keeps every other field (bbox, errors, scale)", () => {
    const img = decodeImage({ base64: Buffer.from([1, 2, 3]).toString("base64"), mime: "image/png", width: 3, height: 1, bbox: { x: 1, y: 0, width: 2, height: 1 }, scale: 0.5, errors: [] });
    expect(Array.from(img.bytes)).toEqual([1, 2, 3]);
    expect(img).toMatchObject({ mime: "image/png", width: 3, height: 1, bbox: { x: 1, y: 0, width: 2, height: 1 }, scale: 0.5 });
    expect(img.errors).toBeUndefined();
    expect(decodeImage({ base64: "", mime: "image/png", width: 1, height: 1, bbox: null }).bbox).toBeNull();
  });

  it("builds the engine page with the library inlined safely", () => {
    const html = enginePageHtml({ library: { assets: [{ id: "x", kind: "image", path: "images/x.jpg", license: "CC0", tags: [], description: "</script><b>", kb: 1 }] } });
    expect(html).toContain('import("/__engine/agentphoto-engine.js")');
    expect(html).toContain('assetBase: "/project/"');
    expect(html).toContain('"/__models/"');
    expect(html).toContain('"/__engine/ort/"');
    expect(html).not.toContain("</script><b>");
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});
