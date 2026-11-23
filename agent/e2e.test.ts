import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { engineBuilt } from "./paths";
import { findBrowser } from "./render/browser";
import { closeEngineSessions } from "./render/session";
import { ok } from "./testing/cli";
import { tempDir } from "./testing/tmp";

// End to end through headless Chrome and the real engine build: a project
// from a library photo, a preview render, PNG + JPEG exports. Skipped when
// Chrome or dist/engine is missing (`npm run build:engine`). No network:
// no AI model is involved.

const CAN_RUN = !!findBrowser() && engineBuilt();

afterAll(() => closeEngineSessions());

const isPng = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const pngSize = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];

describe.skipIf(!CAN_RUN)("headless engine (Chrome)", () => {
  it(
    "renders a preview and exports PNG + JPEG",
    async () => {
      const dir = join(tempDir("agentphoto-e2e-"), "shot");
      await ok(["new", dir, "--size", "og", "--background", "#203040"]);
      await ok(["layer", "add", "--project", dir, "--id", "photo", "--src", "library:product", "--set", "x=0", "--set", "y=0", "--set", "width=1200", "--set", "height=630", "--set", "fit=cover"]);
      await ok(["layer", "add", "--project", dir, "--id", "title", "--text", "Hello", "--set", "x=60", "--set", "y=60", "--set", "size=72", "--set", "color=#ffffff"]);

      const r = await ok(["render", "--project", dir, "--max-width", "600"]);
      expect(r.errors).toBeUndefined();
      const preview = readFileSync(r.files[0]);
      expect(isPng(preview)).toBe(true);
      expect(pngSize(preview)).toEqual([600, 315]);
      expect(preview.byteLength).toBeGreaterThan(5000);

      const stats = await ok(["analyze", "--project", dir]);
      expect(stats.width).toBeGreaterThan(0);
      expect(stats.dominant.length).toBeGreaterThan(0);

      const ex = await ok(["export", "--project", dir, "--variants", '[{"format":"png"},{"format":"jpeg","preset":"square"}]']);
      expect(ex.files.map((f: { format: string }) => f.format)).toEqual(["png", "jpg"]);
      const png = readFileSync(ex.files[0].file);
      expect(isPng(png)).toBe(true);
      expect(pngSize(png)).toEqual([1200, 630]);
      const jpg = readFileSync(ex.files[1].file);
      expect([jpg[0], jpg[1], jpg[2]]).toEqual([0xff, 0xd8, 0xff]);
      expect(ex.files[1]).toMatchObject({ width: 1080, height: 1080 });

      // Exporting over existing files needs --yes.
      expect(await ok(["export", "--project", dir])).toMatchObject({ needsConfirmation: true, plan: { overwrite: ["dist/shot.png"] } });
      expect((await ok(["export", "--project", dir, "--yes"])).files).toHaveLength(1);
    },
    120_000,
  );
});
