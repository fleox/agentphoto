// Types shared by the AI tool catalog (src/ai/tools.ts) and its hosts
// (CLI `agentphoto tools`, MCP server, Studio assistant).

import type { ProjectFs } from "../core/fs";
import type { LibraryProvider } from "../core/library";
import type { PhotoDoc } from "../core/types";
import type { FetchLike } from "../ops/assets";
import type { ExportJob } from "../ops/export";
import type { TemplateIndex } from "../ops/templates";
import type { ImageStats } from "../engine/analyze";

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly unknown[];
  additionalProperties?: boolean | JsonSchema;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
};

export interface EncodedImage {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  // Masks: bounding box of the kept pixels, in mask px.
  bbox?: { x: number; y: number; width: number; height: number } | null;
  // Layers that failed to render (missing source…).
  errors?: { layer: string; message: string }[];
}

export interface SegmentPrompt {
  points?: [number, number, number][];
  box?: [number, number, number, number];
}

// What renders pixels: headless Chrome (CLI / MCP / Studio API) or the page itself (Studio, in-browser projects).
export interface EngineHost {
  render(doc: PhotoDoc, opts: { backdrop?: string; scale?: number; maxWidth?: number; maxHeight?: number; format?: "png" | "jpeg"; only?: string[] }): Promise<EncodedImage>;
  exportImage(doc: PhotoDoc, job: ExportJob): Promise<EncodedImage>;
  analyze(doc: PhotoDoc, opts: { layer?: string }): Promise<ImageStats>;
  backgroundMask(doc: PhotoDoc, id: string, opts: { model?: string; feather?: number; threshold?: number }): Promise<EncodedImage>;
  segmentMask(doc: PhotoDoc, id: string, prompt: SegmentPrompt, opts: { model?: string; feather?: number }): Promise<EncodedImage>;
  colorRangeMask(doc: PhotoDoc, id: string, opts: { color: string; tolerance?: number; feather?: number }): Promise<EncodedImage>;
  // Measured layer boxes (text with real font metrics), document px. `ink`
  // (text layers): the area its lines and background actually paint.
  layerBoxes?(doc: PhotoDoc): Promise<Record<string, { x: number; y: number; width: number; height: number; rotation: number; ink?: { x: number; y: number; width: number; height: number } }>>;
}

export interface ToolHost {
  // Enables render_preview, export, image_analyze, remove_background, mask_generate.
  engine?: EngineHost;
  // The built-in library (fonts, sample photos).
  library?: LibraryProvider;
  // Starter templates (templates/<id>/).
  templates?: { index: TemplateIndex; files(id: string): Promise<Record<string, Uint8Array | string>> };
  // Reads a file from the user's disk (CLI / MCP) — assets_add { file }, project_create { image }.
  readLocalFile?(path: string): Promise<Uint8Array>;
}

export interface ToolContext {
  fs: ProjectFs; // the project root
  fetch?: FetchLike; // network for assets_add { url } (omit = offline)
  host?: ToolHost;
}

export interface AiTool<I = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  // Writes project files (MCP annotates it; read-only mode hides it).
  mutating: boolean;
  // Needs host.engine (listed only when the host can render).
  needsEngine?: boolean;
  handler(ctx: ToolContext, input: I): Promise<unknown> | unknown;
}
