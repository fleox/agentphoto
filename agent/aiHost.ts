import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ToolContext, ToolHost } from "../src/ai/types";
import { libraryProvider, readTemplateFiles, readTemplatesIndex } from "./host";
import type { NodeFs } from "./nodeFs";
import { CliError } from "./output";
import { engineSession, sessionEngineHost } from "./render/session";

// Glue between the AI tool catalog (src/ai/tools.ts) and the Node front
// doors (CLI commands, `tools`, `mcp`, the Studio API): the ToolHost with the
// headless engine (lazy: Chrome starts on the first pixel tool), the library,
// the templates and local file reads.

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
  mutating: boolean;
  needsEngine: boolean;
}

export function nodeHost(fs: NodeFs | null): ToolHost {
  return {
    // Always present: pixel tools are listed everywhere and fail at call time
    // with a hint when Chrome or the engine build is missing.
    engine: sessionEngineHost(() => {
      if (!fs) throw new CliError("no-project", "Pixel tools need a project folder.", "Pass --project <dir>.");
      return engineSession(fs.root);
    }),
    library: libraryProvider(),
    templates: { index: readTemplatesIndex(), files: async (id) => readTemplateFiles(id) },
    async readLocalFile(path) {
      const abs = isAbsolute(path) ? path : resolve(path);
      try {
        return new Uint8Array(readFileSync(abs));
      } catch {
        throw new CliError("notFound", `Cannot read ${abs}.`, "Give the path of an existing local image file (absolute, or relative to the current directory).");
      }
    },
  };
}

export function toolContext(fs: NodeFs): ToolContext {
  return { fs, fetch: fetch as unknown as ToolContext["fetch"], host: nodeHost(fs) };
}

export async function listTools(opts: { readOnly?: boolean } = {}): Promise<ToolInfo[]> {
  const { listAiTools } = await import("../src/ai/tools");
  return listAiTools(nodeHost(null), opts).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, mutating: !!t.mutating, needsEngine: !!t.needsEngine }));
}

export async function callTool(fs: NodeFs, name: string, input: Record<string, unknown>): Promise<unknown> {
  const { callAiTool } = await import("../src/ai/tools");
  return callAiTool(toolContext(fs), name, input);
}

// render_preview → its image files (resultImages of src/ai/tools.ts) as base64
// with their mimeType; paths are relative to the project folder.
export async function previewImages(name: string, result: unknown, root: string): Promise<{ data: string; mimeType: string }[]> {
  const { resultImages } = await import("../src/ai/tools");
  const out: { data: string; mimeType: string }[] = [];
  for (const file of resultImages(name, result)) {
    try {
      const mimeType = /\.jpe?g$/i.test(file) ? "image/jpeg" : /\.webp$/i.test(file) ? "image/webp" : "image/png";
      out.push({ data: readFileSync(resolve(root, file)).toString("base64"), mimeType });
    } catch {
      /* a missing file is simply not attached */
    }
  }
  return out;
}
