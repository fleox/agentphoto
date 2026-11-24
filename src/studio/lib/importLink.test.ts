import { describe, expect, it } from "vitest";
import { BUNDLE_FORMAT, bundleId, classify, ImportError, parseBundle, resolveImport, sessionOf } from "./importLink";

const PAGE = "https://elisa.example/photo/studio/#import=out/lake.agentphoto.json";
const ELISA = { importUrl: "/api/v1/sessions/{session}/workspace/raw?path={path}", sessionFromReferrer: "/s/([^/?#]+)" };
const b64 = (s: string) => btoa(s);
const bundle = (files: Record<string, string>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: BUNDLE_FORMAT, version: 1, title: "Lake", files, ...extra });
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof ImportError ? e.code : "other";
  }
  return null;
};

describe("import links", () => {
  it("finds the conversation from #session or the referrer", () => {
    expect(sessionOf(ELISA, "abc", "")).toBe("abc");
    expect(sessionOf(ELISA, null, "https://elisa.example/s/9f2c?x=1")).toBe("9f2c");
    expect(sessionOf(ELISA, null, "https://elisa.example/")).toBeNull();
    expect(sessionOf({}, null, "https://elisa.example/s/9f2c")).toBeNull();
  });

  it("resolves a workspace path through importUrl, on the same origin", () => {
    expect(resolveImport("out/lake.agentphoto.json", ELISA, "9f2c", PAGE)).toBe(
      "https://elisa.example/api/v1/sessions/9f2c/workspace/raw?path=out%2Flake.agentphoto.json",
    );
    expect(resolveImport("/files/a.png", {}, null, PAGE)).toBe("https://elisa.example/files/a.png");
    expect(code(() => resolveImport("out/a.json", ELISA, null, PAGE))).toBe("noSession");
    expect(code(() => resolveImport("out/a.json", {}, null, PAGE))).toBe("badLink");
    expect(code(() => resolveImport("../secret", ELISA, "s", PAGE))).toBe("badLink");
    expect(code(() => resolveImport("https://evil.example/a.json", ELISA, "s", PAGE))).toBe("badLink");
    expect(code(() => resolveImport("//evil.example/a.json", ELISA, "s", PAGE))).toBe("badLink");
    expect(code(() => resolveImport("a.json", { importUrl: "https://evil.example/{path}" }, null, PAGE))).toBe("badLink");
  });

  it("parses a bundle and refuses bad ones", () => {
    const b = parseBundle(bundle({ "photo.json": b64("{}"), "assets/images/lake.jpg": b64("jpg") }));
    expect(b.title).toBe("Lake");
    expect(new TextDecoder().decode(b.files["assets/images/lake.jpg"])).toBe("jpg");
    expect(code(() => parseBundle("nope"))).toBe("badBundle");
    expect(code(() => parseBundle(bundle({ "assets/a.png": b64("x") })))).toBe("badBundle");
    expect(code(() => parseBundle(bundle({ "photo.json": b64("{}"), "../x": b64("x") })))).toBe("badBundle");
    expect(code(() => parseBundle(bundle({ "photo.json": b64("{}") }, { version: 2 })))).toBe("badBundle");
    expect(parseBundle(bundle({ "photo.json": b64("{}") }, { title: "  " })).title).toBe("Imported project");
  });

  it("tells bundles from images, and gives a bundle a stable id", async () => {
    const bytes = new TextEncoder().encode(bundle({ "photo.json": b64("{}") }));
    expect(classify("out/a.agentphoto.json", "application/octet-stream", bytes).kind).toBe("bundle");
    expect(classify("uploads/lake.jpg", "image/jpeg", new Uint8Array([0xff, 0xd8]))).toMatchObject({ kind: "image", name: "lake.jpg" });
    expect(code(() => classify("a.pdf", "application/pdf", new Uint8Array([0x25])))).toBe("unsupported");
    const id = await bundleId("Lake trip", bytes);
    expect(id).toMatch(/^import-lake-trip-[0-9a-f]{12}$/);
    expect(await bundleId("Lake trip", bytes)).toBe(id);
  });
});
