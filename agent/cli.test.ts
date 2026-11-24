import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands";
import { renderFailure } from "./commands/meta";
import { parseScalar, setPairs, shownDir } from "./commands/util";
import { CliError } from "./output";
import { cli, ok } from "./testing/cli";
import { tempDir } from "./testing/tmp";

// The JSON contract agents rely on: exactly one {ok,data} / {ok:false,
// error:{code,message,hint}} object on stdout, exit 2 for usage /
// validation errors, help --json listing every command with its arguments.
// Nothing here needs Chrome (pixel commands: e2e.test.ts).

const REQUIRED = ["help", "version", "doctor", "new", "info", "doc", "layer", "filter", "mask", "remove-bg", "analyze", "render", "export", "check", "catalog", "templates", "assets", "models", "studio", "tools", "mcp"];
const PHOTO = resolve(__dirname, "..", "library", "images", "product.jpg");

const tmp = () => tempDir("agentphoto-cli-");

describe("CLI contract", () => {
  it("help --json lists every command with usage, options and subcommands", async () => {
    const r = await cli(["help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toHaveLength(1);
    const names = r.body.data.commands.map((c: { name: string }) => c.name);
    expect(names).toEqual(REQUIRED);
    const sub = (n: string) => r.body.data.commands.find((c: { name: string }) => c.name === n).subcommands.map((s: { name: string }) => s.name);
    expect(sub("doc")).toEqual(["get", "summary", "apply", "patch", "validate"]);
    expect(sub("layer")).toEqual(["list", "get", "add", "update", "remove", "move"]);
    expect(sub("filter")).toEqual(["add", "update", "remove"]);
    expect(sub("mask")).toEqual(["set", "clear", "generate"]);
    expect(sub("models")).toEqual(["list", "pull", "remove"]);
    const layer = r.body.data.commands.find((c: { name: string }) => c.name === "layer");
    expect(layer.options.map((o: { name: string }) => o.name)).toEqual(expect.arrayContaining(["project", "layer", "set", "above", "below", "parent", "index", "yes"]));
    for (const c of r.body.data.commands) {
      expect(c.usage.startsWith(c.name)).toBe(true);
      expect(c.summary.length).toBeGreaterThan(10);
    }
    expect((await cli(["help", "render"])).body.data.commands).toHaveLength(1);
    expect((await cli(["render", "--help"])).body.data.commands[0].name).toBe("render");
  });

  it("every subcommand usage starts with its command", () => {
    for (const c of COMMANDS) for (const s of c.subcommands ?? []) expect(s.usage.startsWith(`${c.name} `) || s.usage === `${c.name} ${s.name}`).toBe(true);
  });

  it("prints the version", async () => {
    expect((await cli(["version"])).body).toMatchObject({ ok: true, data: { version: expect.stringMatching(/^\d+\.\d+\.\d+/) } });
    expect((await cli(["--version"])).body.ok).toBe(true);
  });

  it("exits 2 with one error object on usage errors", async () => {
    const dir = tmp();
    const cases: [string[], string][] = [
      [["nope"], "unknown-command"],
      [["help", "--bogus"], "usage"],
      [["new"], "usage"],
      [["new", join(dir, "x"), "--size", "billboard"], "invalid"],
      [["catalog", "nope"], "usage"],
      [["models", "pull", "nope"], "notFound"],
    ];
    for (const [args, code] of cases) {
      const r = await cli(args);
      expect({ args, exit: r.code }).toEqual({ args, exit: 2 });
      expect(r.stdout).toHaveLength(1);
      expect(r.body).toMatchObject({ ok: false, error: { code, message: expect.any(String), hint: expect.any(String) } });
    }
  });

  it("fails with no-project + a hint outside a project", async () => {
    const r = await cli(["doc", "summary", "--project", tmp()]);
    expect(r.code).toBe(1);
    expect(r.body.error).toMatchObject({ code: "no-project", hint: expect.stringContaining("agentphoto new") });
  });

  it("doctor reports its checks", async () => {
    const r = await cli(["doctor", "--no-render"]);
    expect(r.stdout).toHaveLength(1);
    const checks = (r.body.ok ? r.body.data.checks : r.body.error!.details.checks) as { id: string; ok: boolean; optional?: boolean; hint?: string }[];
    expect(checks.map((c) => c.id)).toEqual(["node", "browser", "engine", "studio", "library", "templates", "models"]);
    for (const c of checks) if (!c.ok && !c.optional) expect(c.hint).toBeTruthy();
    const failed = checks.some((c) => !c.ok && !c.optional);
    expect(r.body.ok).toBe(!failed);
    expect(r.code).toBe(failed ? 1 : 0);
  });

  it("doctor only blames the browser when the browser failed", () => {
    expect(renderFailure(new CliError("browser-launch", "boom", "Could not start Chrome")).hint).toBe("Could not start Chrome");
    expect(renderFailure(new CliError("no-browser", "none")).hint).toMatch(/Chrome/);
    expect(renderFailure(new Error("ENOENT")).hint).not.toMatch(/AGENTPHOTO_CHROME/);
  });

  it("documents the catalog, the library and the models", async () => {
    expect(Object.keys((await ok(["catalog"])).sections)).toEqual(expect.arrayContaining(["filters", "looks", "sizes", "models"]));
    expect((await ok(["catalog", "filters", "exposure"])).entry).toMatchObject({ id: "exposure" });
    expect((await ok(["catalog", "sizes"])).entries.length).toBeGreaterThan(3);
    expect((await cli(["catalog", "filters", "exposur"])).body.error).toMatchObject({ code: "notFound", hint: expect.stringContaining("exposure") });
    const lib = await ok(["assets", "library", "--kind", "image"]);
    expect(lib.assets.map((a: { ref: string }) => a.ref)).toContain("library:product");
    const models = await ok(["models", "list"]);
    expect(models.models.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining(["rmbg-1.4", "slimsam"]));
    expect((await ok(["templates", "list"])).templates).toEqual(expect.any(Array));
  });
});

describe("project workflow (new → doc → layer → filter → mask → check)", () => {
  it("creates, edits and validates a project without Chrome", async () => {
    const dir = join(tmp(), "shot");
    const created = await ok(["new", dir, "--image", PHOTO, "--title", "Mug"]);
    expect(created.canvas).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
    expect(created.layers.map((l: { id: string }) => l.id)).toEqual(["photo"]);
    expect(created.files).toEqual(expect.arrayContaining(["agentphoto.json", "photo.json"]));
    expect((await cli(["new", dir])).body.error?.code).toBe("conflict");

    const blank = join(tmp(), "blank");
    expect((await ok(["new", blank, "--size", "og", "--background", "#101820"])).canvas).toMatchObject({ width: 1200, height: 630, background: "#101820" });

    expect((await cli(["doc", "validate", "--project", dir])).code).toBe(0);
    expect((await ok(["--project", dir, "doc", "summary"])).title).toBe("Mug");
    expect((await ok(["doc", "get", "--project", dir, "--path", "layers#photo.type"])).value).toBe("image");
    expect((await ok(["info", "--project", dir])).manifest.title).toBe("Mug");

    // Layers: add with shortcuts, update one key, read it back, move.
    const add = await ok(["layer", "add", "--project", dir, "--id", "title", "--text", "Summer sale", "--set", "x=80", "--set", "y=60", "--set", "size=96", "--set", "color=#ffffff"]);
    expect(add).toMatchObject({ status: "applied", applied: true });
    expect(add.plan.layers.added).toEqual(["title"]);
    await ok(["layer", "update", "title", "--project", dir, "--set", "effects.dropShadow.blur=24"]);
    const title = await ok(["layer", "get", "title", "--project", dir]);
    expect(title.layer).toMatchObject({ id: "title", type: "text", text: "Summer sale", x: 80, effects: { dropShadow: { blur: 24 } } });
    await ok(["layer", "add", "--project", dir, "--layer", '{"id":"bg","type":"fill","fill":"#101820"}', "--below", "photo"]);
    expect((await ok(["layer", "list", "--project", dir])).layers.map((l: { id: string }) => l.id)).toEqual(["title", "photo", "bg"]);
    await ok(["layer", "move", "title", "--project", dir, "--below", "photo"]);
    expect((await ok(["layer", "list", "--project", dir])).layers.map((l: { id: string }) => l.id)).toEqual(["photo", "title", "bg"]);

    // Invalid change → exit 2 with issues, nothing written.
    const before = readFileSync(join(dir, "photo.json"), "utf8");
    const bad = await cli(["layer", "update", "title", "--project", dir, "--set", "blend=sparkle"]);
    expect(bad.code).toBe(2);
    expect(bad.body.error).toMatchObject({ code: "validation", details: { issues: expect.any(Array) } });
    expect(readFileSync(join(dir, "photo.json"), "utf8")).toBe(before);

    // Filters.
    await ok(["filter", "add", "photo", "--project", dir, "--type", "exposure", "--set", "exposure=0.3"]);
    await ok(["filter", "add", "photo", "--project", dir, "--filter", '{"type":"hueSaturation","saturation":20}']);
    expect((await ok(["layer", "get", "photo", "--project", dir])).layer.filters).toEqual([expect.objectContaining({ type: "exposure", exposure: 0.3 }), expect.objectContaining({ type: "hueSaturation" })]);
    await ok(["filter", "update", "photo", "0", "--project", dir, "--set", "exposure=0.5"]);
    await ok(["filter", "remove", "photo", "1", "--project", dir]);
    expect((await ok(["layer", "get", "photo", "--project", dir])).layer.filters).toEqual([expect.objectContaining({ type: "exposure", exposure: 0.5 })]);
    expect((await cli(["filter", "add", "photo", "--project", dir, "--type", "nope"])).code).toBe(2);

    // Masks.
    await ok(["mask", "set", "photo", "--project", dir, "--mask", '{"shape":"ellipse","x":0,"y":0,"width":400,"height":300,"feather":20}']);
    expect((await ok(["layer", "get", "photo", "--project", dir])).layer.mask).toMatchObject({ shape: "ellipse" });
    await ok(["mask", "clear", "photo", "--project", dir]);
    expect((await ok(["layer", "get", "photo", "--project", dir])).layer.mask).toBeUndefined();
    expect((await cli(["mask", "generate", "photo", "--project", dir])).code).toBe(2);

    // Patch from a file.
    const ops = join(dir, "..", "ops.json");
    writeFileSync(ops, JSON.stringify([{ op: "set", path: "canvas.background", value: "#000000" }]));
    expect((await ok(["doc", "patch", "--project", dir, "--file", ops])).applied).toBe(true);

    // Removing needs --yes.
    const after = readFileSync(join(dir, "photo.json"), "utf8");
    const plan = await ok(["layer", "remove", "title", "--project", dir]);
    expect(plan).toMatchObject({ needsConfirmation: true, plan: { layers: { removed: ["title"] } } });
    expect(readFileSync(join(dir, "photo.json"), "utf8")).toBe(after);
    expect((await ok(["layer", "remove", "title", "--project", dir, "--yes"])).applied).toBe(true);

    // doc apply: plan unless --yes when it removes layers.
    const doc = JSON.parse(readFileSync(join(dir, "photo.json"), "utf8"));
    doc.layers = doc.layers.filter((l: { id: string }) => l.id !== "bg");
    writeFileSync(join(dir, "..", "next.json"), JSON.stringify(doc));
    expect((await ok(["doc", "apply", "--project", dir, "--file", join(dir, "..", "next.json")])).needsConfirmation).toBe(true);
    expect((await ok(["doc", "apply", "--project", dir, "--file", join(dir, "..", "next.json"), "--yes"])).applied).toBe(true);

    // Assets.
    const assets = await ok(["assets", "list", "--project", dir]);
    const photoFile = assets.assets.find((a: { kind: string }) => a.kind === "image").path;
    expect((await cli(["assets", "remove", photoFile, "--project", dir])).body.error?.code).toBe("conflict");
    const added = await ok(["assets", "add", PHOTO, "--name", "second.jpg", "--add-layer", "--layer-id", "second", "--project", dir]);
    expect(added).toMatchObject({ asset: { path: "assets/images/second.jpg" }, layer: "second" });

    const check = await cli(["check", "--project", dir]);
    expect(check.stdout).toHaveLength(1);
    expect(check.body.data).toMatchObject({ ok: expect.any(Boolean), canvas: { width: expect.any(Number) } });

    // AI tools through the CLI (same catalog as MCP).
    const tools = (await ok(["tools", "list"])).tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["doc_patch", "render_preview", "export", "remove_background"]));
    expect((await ok(["tools", "call", "doc_summary", "--project", dir])).result).toMatchObject({ title: "Mug" });
    expect((await cli(["tools", "call", "nope", "--project", dir])).code).toBe(2);
  });
});

describe("paths in human output", () => {
  it("shows the project folder as typed, else relative to the cwd, else absolute", () => {
    expect(shownDir("/home/me/work/shop", "shop", "/home/me/work")).toBe("shop");
    expect(shownDir("/home/me/work/shop", undefined, "/home/me/work")).toBe("shop");
    expect(shownDir("/home/me/work", undefined, "/home/me/work")).toBe(".");
    expect(shownDir("/tmp/shop", undefined, "/home/me/work")).toBe("/tmp/shop");
    expect(shownDir("/home/me/work/my shop", "my shop", "/home/me/work")).toBe('"my shop"');
  });
});

describe("option parsing", () => {
  it("parses scalars and dotted --set keys", () => {
    expect(parseScalar("42")).toBe(42);
    expect(parseScalar("#ff0000")).toBe("#ff0000");
    expect(parseScalar("[0,1,0]")).toEqual([0, 1, 0]);
    expect(setPairs({ set: ["effects.dropShadow.blur=24", "x=40", "color=#fff"] })).toEqual({ effects: { dropShadow: { blur: 24 } }, x: 40, color: "#fff" });
  });

  it("keeps text-like fields as strings", () => {
    expect(setPairs({ set: ["text=2026", "name=true", "font=inter", "size=48"] })).toEqual({ text: "2026", name: "true", font: "inter", size: 48 });
  });
});
