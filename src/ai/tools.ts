// The AI tool catalog — declared ONCE here (CLAUDE.md). The MCP server
// (agent/mcp/), `agentphoto tools list|call`, the Studio API and the Studio
// assistant expose exactly this list. Handlers call src/ops/ (and the host's
// engine for pixels) only.

import { closest } from "../core/suggest";
import { OpsError } from "../ops/context";
import { DOC_TOOLS } from "./docTools";
import { IMAGE_TOOLS } from "./imageTools";
import { checkInput } from "./shared";
import type { AiTool, ToolContext, ToolHost } from "./types";

export type { AiTool, EngineHost, JsonSchema, ToolContext, ToolHost } from "./types";

export const TOOL_ORDER = [
  "project_info",
  "project_create",
  "doc_summary",
  "doc_get",
  "doc_patch",
  "doc_apply",
  "doc_validate",
  "layer_list",
  "layer_add",
  "layer_update",
  "layer_remove",
  "layer_move",
  "filter_add",
  "mask_set",
  "remove_background",
  "mask_generate",
  "image_analyze",
  "render_preview",
  "catalog_get",
  "templates_list",
  "library_list",
  "assets_list",
  "assets_add",
  "assets_remove",
  "check",
  "export",
] as const;

const BY_NAME = new Map([...DOC_TOOLS, ...IMAGE_TOOLS].map((t) => [t.name, t]));

export const AI_TOOLS: AiTool[] = TOOL_ORDER.map((n) => {
  const t = BY_NAME.get(n);
  if (!t) throw new Error(`AI tool ${n} is not implemented`);
  return t;
});

// The tools a host exposes: pixel tools only when it has an engine.
export function listAiTools(host?: ToolHost, opts: { readOnly?: boolean } = {}): AiTool[] {
  const list = AI_TOOLS.filter((t) => !t.needsEngine || host?.engine);
  return opts.readOnly ? list.filter((t) => !t.mutating) : list;
}

export function findAiTool(name: string, host?: ToolHost): AiTool {
  const tools = listAiTools(host);
  const t = tools.find((x) => x.name === name);
  if (!t) {
    if (BY_NAME.get(name)?.needsEngine) throw new OpsError("unavailable", `Tool "${name}" needs an image engine this host does not have.`, "Use the CLI (needs Google Chrome / Chromium) or the Studio.");
    const s = closest(name, tools.map((x) => x.name));
    throw new OpsError("notFound", `Unknown tool "${name}".`, `${s ? `Did you mean "${s}"? ` : ""}Tools: ${tools.map((x) => x.name).join(", ")}.`);
  }
  return t;
}

// Validates the input against the tool schema (required + top-level types), then runs it.
export async function callAiTool(ctx: ToolContext, name: string, input: unknown): Promise<unknown> {
  const tool = findAiTool(name, ctx.host);
  return tool.handler(ctx, checkInput(tool.inputSchema, input, name));
}

// Image files a tool result points at (render_preview) — hosts attach them for multimodal models.
export function resultImages(name: string, result: unknown): string[] {
  if (name !== "render_preview" || !result || typeof result !== "object") return [];
  const r = result as { images?: string[]; preview?: string };
  return r.images?.length ? r.images : r.preview ? [r.preview] : [];
}
