import { CATALOG } from "../../src/core/catalog";
import { callTool, listTools, previewImages, type ToolInfo } from "../aiHost";
import { NodeFs } from "../nodeFs";
import { printResult } from "../output";
import { readVersionInfo } from "../paths";
import type { Command } from "./types";
import { boolOpt, jsonObjectOpt, positional, PROJECT_OPTION, projectDir, table, usage } from "./util";

export const toolsCommand: Command = {
  name: "tools",
  usage: "tools <list|call> [<name>] [--input <json|@file|->] [--project <dir>]",
  summary: "The AI tool catalog (src/ai/tools.ts) — exactly what the MCP server and the Studio assistant expose: list the tools with their JSON schemas, or call one with a JSON input.",
  subcommands: [
    { name: "list", usage: "tools list", summary: "Tools with description, input schema, whether they write and whether they need the engine (Chrome)." },
    { name: "call", usage: "tools call <name> --input <json|@file|->", summary: "Run one tool against the project.", writes: true },
  ],
  options: [PROJECT_OPTION, { name: "input", type: "string", description: "call: the tool input as a JSON object, @file or - (stdin)." }],
  async run({ io, options, positionals }) {
    const [action = "list"] = positionals;
    if (action === "list") {
      const tools = await listTools();
      return printResult(io, { tools }, () => table(tools as unknown as Record<string, unknown>[], ["name", "mutating", "needsEngine", "description"]));
    }
    if (action === "call") {
      const name = positional(positionals, 1, "tool name", "tools call <name> --input <json>");
      const tools = await listTools();
      if (!tools.some((t) => t.name === name)) usage(`Unknown tool "${name}".`, `\`agentphoto tools list\` lists them (${tools.map((t) => t.name).join(", ")}).`);
      const input = jsonObjectOpt(options, "input") ?? {};
      const result = await callTool(new NodeFs(projectDir(options)), name, input);
      return printResult(io, { tool: name, result }, () => JSON.stringify(result ?? null, null, 2), { raw: true });
    }
    usage(`Unknown tools action "${action}".`, "Use list or call.");
  },
};

export const MCP_INSTRUCTIONS = (root: string) =>
  `AgentPhoto — the photo studio you can run (project: ${root}). A picture is a JSON document (photo.json: canvas + a non-destructive layer stack — image, text, shape, fill, adjustment, group — with filters, masks and effects); source photos are never modified. Workflow: doc_summary (or project_info) first; image_analyze to measure the photo (exposure, contrast, cast, sharpness — it suggests filters); then edit with filter_add, layer_add / layer_update, remove_background (local AI cut-out; the model downloads once), mask_generate, doc_patch (atomic, validated; issues come back with JSON paths and hints) — catalog_get documents filters, looks, effects, fonts and size presets; after EVERY visual change call render_preview and LOOK at the returned image (compare: true for before / after, zoom for edges and text); check before export; export writes PNG / JPEG / WebP / AVIF into dist/ (variants for several sizes). Confirm destructive changes (doc_apply removing layers, layer_remove, assets_remove, export over existing files) with the user first.`;

export const mcpCommand: Command = {
  name: "mcp",
  usage: "mcp [--project <dir>] [--read-only]",
  summary: "Run the MCP server on stdio (JSON-RPC 2.0, protocol 2025-06-18 / 2025-03-26 / 2024-11-05): tools = the AI catalog (render_preview returns the image), resources = photo://doc, photo://summary, photo://catalog. For Claude Desktop / Claude Code / Cursor.",
  options: [PROJECT_OPTION, { name: "read-only", type: "boolean", description: "Expose only the tools that don't write." }],
  async run({ options }) {
    const readOnly = boolOpt(options, "read-only");
    const dir = projectDir(options);
    const fs = new NodeFs(dir);
    const log = (msg: string) => void process.stderr.write(`${msg}\n`);
    const { createMcpServer, serveStdio } = await import("../mcp/server");
    const server = createMcpServer(mcpOptions(fs, readOnly, await listTools()));
    log(`[agentphoto mcp] project ${dir}${readOnly ? " (read-only)" : ""} on stdio — ${server.toolNames().length} tools`);
    await serveStdio(server, process.stdin, (line) => process.stdout.write(line + "\n"), log);
    const { closeEngineSessions } = await import("../render/session");
    await closeEngineSessions();
    return 0;
  },
};

export function mcpOptions(fs: NodeFs, readOnly: boolean, tools: ToolInfo[]) {
  return {
    readOnly,
    tools,
    serverName: "agentphoto",
    version: readVersionInfo().version,
    instructions: MCP_INSTRUCTIONS(fs.root),
    call: (name: string, input: Record<string, unknown>) => callTool(fs, name, input),
    images: (name: string, result: unknown) => previewImages(name, result, fs.root),
    resources: [
      { uri: "photo://doc", name: "doc", title: "Document", description: "The project's photo.json (PhotoDoc).", mimeType: "application/json", read: async () => JSON.parse(await fs.readText("photo.json")) },
      {
        uri: "photo://summary",
        name: "summary",
        title: "Document summary",
        description: "Compact outline: canvas, layers top → bottom with type, box, filters, masks, effects.",
        mimeType: "application/json",
        read: async () => {
          const { getDoc, summarizeDoc } = await import("../../src/ops/doc");
          return summarizeDoc(await getDoc(fs));
        },
      },
      { uri: "photo://catalog", name: "catalog", title: "Catalog", description: "Layer types, filters (+ params), looks, effects, blend modes, shapes, fonts, size presets, AI models.", mimeType: "application/json", read: async () => CATALOG },
    ],
  };
}
