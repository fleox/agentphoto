import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFs } from "./nodeFs";
import { tempDir } from "./testing/tmp";

describe("NodeFs", () => {
  it("reads, writes, lists recursively and removes inside the root", async () => {
    const root = tempDir("agentphoto-fs-");
    const fs = new NodeFs(root);
    await fs.writeText("photo.json", "{}");
    await fs.writeBytes("assets/images/a.png", new Uint8Array([1, 2, 3]));
    await fs.writeText("./assets/masks/m.png", "mask");
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "HEAD"), "x");
    expect(await fs.list()).toEqual(["assets/images/a.png", "assets/masks/m.png", "photo.json"]);
    expect(await fs.list("assets/images")).toEqual(["assets/images/a.png"]);
    expect(await fs.list("assets/")).toEqual(["assets/images/a.png", "assets/masks/m.png"]);
    expect(await fs.size("assets/images/a.png")).toBe(3);
    expect(await fs.exists("assets")).toBe(false);
    expect(await fs.exists("photo.json")).toBe(true);
    expect(await fs.readText("photo.json")).toBe("{}");
    await fs.remove("photo.json");
    await fs.remove("photo.json");
    expect(await fs.exists("photo.json")).toBe(false);
    await expect(fs.readText("nope.json")).rejects.toMatchObject({ name: "FsError", code: "notFound" });
  });

  it("refuses paths that leave the project", async () => {
    const root = tempDir("agentphoto-fs-");
    const outside = tempDir("agentphoto-out-");
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(root, "link"));
    const fs = new NodeFs(root);
    for (const p of ["../x", "a/../../x", "/etc/passwd", "C:/Windows/x", "..\\x", "link/secret.txt"]) {
      await expect(fs.readText(p), p).rejects.toMatchObject({ code: "invalidPath" });
    }
    await expect(fs.writeText("link/new.txt", "x")).rejects.toMatchObject({ code: "invalidPath" });
    await expect(fs.writeText("../escape.txt", "x")).rejects.toMatchObject({ code: "invalidPath" });
  });
});
