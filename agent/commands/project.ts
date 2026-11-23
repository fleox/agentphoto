import { existsSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { NodeFs } from "../nodeFs";
import { CliError, printResult } from "../output";
import type { Command } from "./types";
import { absPath, boolOpt, numOpt, paintValue, positional, PROJECT_OPTION, projectFs, strOpt, table, tool } from "./util";

interface Created {
  manifest: { name: string; title?: string };
  files: string[];
  summary: { canvas: { width: number; height: number; background: string }; layers: { id: string; type: string; detail: string }[] };
  issues: unknown[];
}

export const newCommand: Command = {
  name: "new",
  usage: "new <dir> [--image <file|url>] [--size <preset>] [--width <px> --height <px>] [--background <paint>] [--template <id>] [--title <text>] [--force]",
  summary: 'Create a project folder (agentphoto.json, photo.json, assets/): from a photo (it becomes the "photo" layer and sets the canvas size), blank (--size preset or --width / --height), and / or from a template (`templates list`).',
  writes: true,
  options: [
    { name: "image", type: "string", description: "Starting photo: a local file or an http(s) URL (copied into assets/images/)." },
    { name: "size", type: "string", description: "Canvas size preset (`agentphoto catalog sizes`: og, square, story, youtube…)." },
    { name: "width", type: "string", description: "Canvas width in px." },
    { name: "height", type: "string", description: "Canvas height in px." },
    { name: "background", type: "string", description: 'Canvas background: a colour ("#ffffff"), a gradient as JSON, or "transparent".' },
    { name: "template", type: "string", description: "Start from this template (`agentphoto templates list`)." },
    { name: "title", type: "string", description: "Document title." },
    { name: "name", type: "string", description: "Project name (default: the folder name)." },
    { name: "force", type: "boolean", description: "Overwrite an existing project in the folder." },
  ],
  async run({ io, options, positionals }) {
    const dir = resolve(positional(positionals, 0, "project folder", "new <dir> [--image <photo>]"));
    const force = boolOpt(options, "force");
    if (!force && existsSync(resolve(dir, "photo.json")))
      throw new CliError("conflict", `${dir} is already an AgentPhoto project (photo.json exists).`, "Work on it with `--project <dir>` (`agentphoto info --project …`), pick another folder, or pass --force to overwrite it.");
    if (!force && existsSync(dir) && readdirSync(dir).filter((f) => !f.startsWith(".")).length)
      throw new CliError("conflict", `${dir} exists and is not empty.`, "Pick a new or empty folder for the project (or --force).");
    const image = strOpt(options, "image");
    if (image && !/^https?:\/\//.test(image) && !existsSync(resolve(image))) throw new CliError("notFound", `${image} does not exist.`, "Give the path of a local image (JPEG, PNG, WebP…) or an http(s) URL.");
    const fs = new NodeFs(dir);
    const input: Record<string, unknown> = {
      name: strOpt(options, "name") ?? basename(dir),
      ...(strOpt(options, "title") ? { title: strOpt(options, "title") } : {}),
      ...(image ? { image: /^https?:\/\//.test(image) ? image : resolve(image) } : {}),
      ...(strOpt(options, "size") ? { size: strOpt(options, "size") } : {}),
      ...(numOpt(options, "width") !== undefined ? { width: numOpt(options, "width") } : {}),
      ...(numOpt(options, "height") !== undefined ? { height: numOpt(options, "height") } : {}),
      ...(strOpt(options, "background") !== undefined ? { background: paintValue(strOpt(options, "background")) } : {}),
      ...(strOpt(options, "template") ? { template: strOpt(options, "template") } : {}),
      ...(force ? { force: true } : {}),
    };
    const r = await tool<Created>(fs, "project_create", input);
    const files = await fs.list();
    const { canvas, layers } = r.summary;
    printResult(io, { dir, manifest: r.manifest, canvas, layers, files, issues: r.issues }, () =>
      [
        `Created ${dir} (${canvas.width}×${canvas.height}${strOpt(options, "template") ? `, template ${strOpt(options, "template")}` : ""}; layers: ${layers.map((l) => l.id).join(", ") || "none"}).`,
        `Next: agentphoto render --project ${dir}  ·  agentphoto analyze --project ${dir}`,
      ].join("\n"),
    );
  },
};

export const infoCommand: Command = {
  name: "info",
  usage: "info [--project <dir>]",
  summary: "Project overview: manifest, document summary (canvas, layers top → bottom), issue counts, assets and the latest renders / exports.",
  options: [PROJECT_OPTION],
  async run({ io, options }) {
    const fs = projectFs(options);
    const r = await tool<{ manifest: { name: string; title?: string }; summary: { canvas: { width: number; height: number; background: string }; layers: { id: string; type: string; detail: string }[] }; counts: { errors: number; warnings: number } }>(fs, "project_info", {});
    const files = await fs.list();
    const data = {
      dir: fs.root,
      ...r,
      assets: files.filter((f) => f.startsWith("assets/") && f !== "assets/manifest.json").length,
      renders: files.filter((f) => f.startsWith("renders/")).map((f) => absPath(fs, f)),
      exports: files.filter((f) => f.startsWith("dist/")).map((f) => absPath(fs, f)),
    };
    printResult(io, data, () =>
      [
        `${r.manifest.title ?? r.manifest.name} (${r.manifest.name}) — ${fs.root}`,
        `Canvas ${r.summary.canvas.width}×${r.summary.canvas.height}, background ${r.summary.canvas.background}  ·  ${r.counts.errors} errors, ${r.counts.warnings} warnings`,
        table(r.summary.layers as unknown as Record<string, unknown>[], ["id", "type", "detail"]),
        `Assets: ${data.assets}  ·  Renders: ${data.renders.length}  ·  Exports: ${data.exports.length}`,
      ].join("\n"),
    );
  },
};
