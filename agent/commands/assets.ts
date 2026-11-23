import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { CliError, printResult } from "../output";
import type { Command } from "./types";
import { boolOpt, confirmOrPlan, positional, PROJECT_OPTION, projectFs, strOpt, table, tool, usage, YES_OPTION } from "./util";
import { NodeFs } from "../nodeFs";
import { projectDir } from "./util";

interface Listed {
  assets: { path: string; kind: string; bytes?: number; source: string; license?: string; usedBy?: string[] }[];
  untracked: string[];
  totalKb: number;
}

export const assetsCommand: Command = {
  name: "assets",
  usage: "assets <list|add|remove|library> [--project <dir>]",
  summary: "Project files (assets/images, masks, edits + manifest with sources and licences): list, add a local image or a URL (optionally as a layer), remove, and browse the built-in library (CC0 sample photos, fonts).",
  subcommands: [
    { name: "list", usage: "assets list", summary: "The project's files with kind, size, source, licence and the layers using them." },
    { name: "add", usage: "assets add (<file> | --url <url>) [--name <file>] [--license <id>] [--author <name>] [--add-layer [--layer-id <id>]]", summary: "Copy an image into assets/images/ (a URL is downloaded once). --add-layer also adds it as an image layer fitted inside the canvas.", writes: true },
    { name: "remove", usage: "assets remove <path> [--force] [--yes]", summary: "Delete a project file (plan + needsConfirmation unless --yes; refused while a layer uses it unless --force).", writes: true, destructive: true },
    { name: "library", usage: "assets library [--kind image|font] [--query <text>]", summary: 'Built-in assets: sample photos (use "library:<id>" as an image src) and fonts (use the id as a text font).' },
  ],
  options: [
    PROJECT_OPTION,
    { name: "url", type: "string", description: "add: http(s) URL of an image." },
    { name: "name", type: "string", description: "add: file name to store it as." },
    { name: "license", type: "string", description: "add: the image's licence (e.g. CC0-1.0, proprietary)." },
    { name: "author", type: "string", description: "add: author / attribution." },
    { name: "add-layer", type: "boolean", description: "add: also add it as an image layer." },
    { name: "layer-id", type: "string", description: "add --add-layer: id of the new layer." },
    { name: "force", type: "boolean", description: "remove: even when layers still use it." },
    { name: "kind", type: "string", description: "library: image or font." },
    { name: "query", type: "string", description: "library: words to look for." },
    YES_OPTION,
  ],
  async run({ io, options, positionals }) {
    const [action = "list", ...rest] = positionals;
    if (action === "library") {
      const kind = strOpt(options, "kind");
      if (kind && kind !== "image" && kind !== "font") usage(`Unknown --kind "${kind}".`, "Use image or font.");
      const r = await tool<{ assets: Record<string, unknown>[]; total: number }>(new NodeFs(projectDir(options)), "library_list", { ...(kind ? { kind } : {}), ...(strOpt(options, "query") ?? rest[0] ? { query: strOpt(options, "query") ?? rest.join(" ") } : {}) });
      return printResult(io, r, () => `${table(r.assets, ["ref", "kind", "size", "license", "description"])}\n${r.total} asset(s)`);
    }
    const fs = projectFs(options);
    if (action === "list") {
      const r = await tool<Listed>(fs, "assets_list", {});
      return printResult(io, r, () => `${table(r.assets.map((a) => ({ ...a, usedBy: a.usedBy?.join(",") })) as unknown as Record<string, unknown>[], ["path", "kind", "bytes", "source", "license", "usedBy"])}${r.untracked.length ? `\nUntracked: ${r.untracked.join(", ")}` : ""}\nTotal ${r.totalKb} KB`);
    }
    if (action === "add") {
      const url = strOpt(options, "url");
      const file = rest[0];
      if (!url && !file) usage("assets add needs a file or --url.", "e.g. agentphoto assets add ~/Pictures/logo.png --add-layer");
      const input: Record<string, unknown> = {};
      if (url) input.url = url;
      else if (/^https?:\/\//.test(file)) input.url = file;
      else {
        const abs = resolve(file);
        if (!existsSync(abs) || !statSync(abs).isFile()) throw new CliError("notFound", `${file} does not exist.`, "Give the path of a local image file, or --url <http(s) URL>.");
        input.file = abs;
      }
      for (const [opt, key] of [["name", "name"], ["license", "license"], ["author", "author"], ["layer-id", "layerId"]] as const) if (strOpt(options, opt)) input[key] = strOpt(options, opt);
      if (boolOpt(options, "add-layer")) input.addLayer = true;
      const r = await tool<{ asset: { path: string; width?: number; height?: number }; layer?: string; hint?: string }>(fs, "assets_add", input);
      return printResult(io, r, () => `Added ${r.asset.path}${r.asset.width ? ` (${r.asset.width}×${r.asset.height})` : ""}${r.layer ? ` as layer "${r.layer}"` : ""}.`);
    }
    if (action === "remove") {
      const path = positional(rest, 0, "asset path", "assets remove <path>");
      const { assets } = await tool<Listed>(fs, "assets_list", {});
      const entry = assets.find((a) => a.path === path);
      if (!entry && !(await fs.exists(path))) throw new CliError("notFound", `No asset "${path}".`, "`agentphoto assets list` lists them.");
      const force = boolOpt(options, "force");
      if (entry?.usedBy?.length && !force) throw new CliError("conflict", `${path} is used by ${entry.usedBy.join(", ")}.`, "Remove or change those layers first, or pass --force (the layers will show a missing file).");
      if (!confirmOrPlan(io, options, { remove: [path], entry: entry ?? null, usedBy: entry?.usedBy ?? [] }, () => `Delete ${path}${entry ? ` (${entry.kind}${entry.license ? `, ${entry.license}` : ""})` : ""}`)) return;
      const r = await tool<{ removed: string; usedBy: string[] }>(fs, "assets_remove", { path, ...(force ? { force: true } : {}) });
      return printResult(io, r, () => `Removed ${path}.${r.usedBy.length ? ` Still referenced by: ${r.usedBy.join(", ")} — fix those layers.` : ""}`);
    }
    usage(`Unknown assets action "${action}".`, "Use list, add, remove or library.");
  },
};
