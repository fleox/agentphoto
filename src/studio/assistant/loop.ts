// Assistant tool-use loop over the Claude Messages API, called from the
// browser with the user's own key (header
// anthropic-dangerous-direct-browser-access). The tools are the AgentPhoto AI
// tool catalog (src/ai/tools.ts, GET ./api/tools); calls run through the
// Studio backend so validation applies exactly as for the CLI / MCP. The
// images a tool result points at (render_preview) are attached so the model
// sees the render. Pure apart from the injected fetch / callTool / readImage,
// so it is unit-tested.

import { resultImages } from "../../ai/tools";
import type { ToolInfo } from "../backend/types";

export const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] as const;
export type ModelId = (typeof MODELS)[number];
export const DEFAULT_MODEL: ModelId = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: ({ type: "text"; text: string } | ImageBlock)[]; is_error?: boolean }
  | ImageBlock
  | { type: string; [k: string]: unknown };
export type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg" | "image/webp"; data: string } };
export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export type LoopEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_end"; id: string; name: string; result?: unknown; error?: string; images?: string[] }
  | { type: "refusal"; explanation?: string };

export interface LoopOptions {
  apiKey: string;
  model: string;
  system: string;
  messages: Message[];
  tools: ToolInfo[];
  callTool(name: string, input: Record<string, unknown>): Promise<unknown>;
  // Returns a project image file as base64 (render_preview images).
  readImage?(path: string): Promise<string | null>;
  onEvent(ev: LoopEvent): void;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  maxIterations?: number;
  maxTokens?: number;
  // Server-side refusal fallback ("default" routing); retried without it if the API rejects it.
  fallbacks?: boolean;
}

export interface LoopResult {
  messages: Message[];
  status: "done" | "aborted" | "error" | "max_iterations" | "refusal";
  error?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function imageMediaType(path: string): ImageBlock["source"]["media_type"] {
  return /\.jpe?g$/i.test(path) ? "image/jpeg" : /\.webp$/i.test(path) ? "image/webp" : "image/png";
}

function truncate(text: string, max = 24000): string {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated, ${text.length - max} more characters)` : text;
}

async function post(opts: LoopOptions, body: Record<string, unknown>, useFallbacks: boolean): Promise<Record<string, unknown>> {
  const f = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": opts.apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (useFallbacks) headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
  const res = await f(API_URL, { method: "POST", headers, body: JSON.stringify(useFallbacks ? { ...body, fallbacks: "default" } : body), signal: opts.signal });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, err);
  }
  return json;
}

export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const messages = [...opts.messages];
  const tools = opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  let fallbacks = opts.fallbacks ?? opts.model !== "claude-haiku-5-5";
  const max = opts.maxIterations ?? 25;
  for (let i = 0; i < max; i++) {
    if (opts.signal?.aborted) return { messages, status: "aborted" };
    const body = { model: opts.model, max_tokens: opts.maxTokens ?? 16000, system: opts.system, tools, messages };
    let res: Record<string, unknown>;
    try {
      try {
        res = await post(opts, body, fallbacks);
      } catch (e) {
        // Older API / account without the fallback beta: retry plainly once.
        if (fallbacks && e instanceof ApiError && e.status === 400 && /fallback|beta/i.test(e.message)) {
          fallbacks = false;
          res = await post(opts, body, false);
        } else throw e;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return { messages, status: "aborted" };
      return { messages, status: "error", error: (e as Error).message };
    }
    const content = (res.content as ContentBlock[]) ?? [];
    // Append the full content (thinking blocks included) unchanged.
    messages.push({ role: "assistant", content });
    for (const b of content) if (b.type === "text" && typeof (b as { text?: string }).text === "string" && (b as { text: string }).text.trim()) opts.onEvent({ type: "text", text: (b as { text: string }).text });
    if (res.stop_reason === "refusal") {
      opts.onEvent({ type: "refusal", explanation: (res.stop_details as { explanation?: string } | null)?.explanation });
      return { messages, status: "refusal" };
    }
    const uses = content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) return { messages, status: "done" };

    const results: ContentBlock[] = [];
    for (const u of uses) {
      if (opts.signal?.aborted) return { messages, status: "aborted" };
      opts.onEvent({ type: "tool_start", id: u.id, name: u.name, input: u.input ?? {} });
      try {
        const result = await opts.callTool(u.name, u.input ?? {});
        const blocks: ({ type: "text"; text: string } | ImageBlock)[] = [{ type: "text", text: truncate(JSON.stringify(result)) }];
        const images: string[] = [];
        for (const path of opts.readImage ? resultImages(u.name, result).slice(0, 4) : []) {
          const data = await opts.readImage!(path).catch(() => null);
          if (data) {
            blocks.push({ type: "image", source: { type: "base64", media_type: imageMediaType(path), data } });
            images.push(path);
          }
        }
        results.push({ type: "tool_result", tool_use_id: u.id, content: blocks });
        opts.onEvent({ type: "tool_end", id: u.id, name: u.name, result, images });
      } catch (e) {
        const err = e as Error & { hint?: string; details?: unknown };
        const text = JSON.stringify({ error: err.message, ...(err.hint ? { hint: err.hint } : {}), ...(err.details ? { details: err.details } : {}) });
        results.push({ type: "tool_result", tool_use_id: u.id, content: [{ type: "text", text: truncate(text) }], is_error: true });
        opts.onEvent({ type: "tool_end", id: u.id, name: u.name, error: err.message });
      }
    }
    // Every tool_result of the turn in one user message.
    messages.push({ role: "user", content: results });
  }
  return { messages, status: "max_iterations" };
}

export const SYSTEM_PROMPT = `You are the assistant inside AgentPhoto Studio, a non-destructive photo editor. The user sees the document live in the Studio while you work; every change you make through the tools is saved to the project's photo.json and shown immediately (each mutating call can be undone from the Studio).

The document (PhotoDoc, photo.json): { version: 1, id, title?, description?, canvas: { width, height, background? (CSS colour | gradient | null = transparent) }, layers: [...] (bottom → top), export? }. Layer common fields: id, type, name?, visible?, locked?, opacity (0..1), blend (normal, multiply, screen, overlay, soft-light…), mask?, clip? (clip to the layer below), filters? ([{ type, ...params, amount?, enabled? }], applied in order), effects? ({ dropShadow, outerGlow, innerShadow, stroke, colorOverlay }). Types: image { src ("assets/…" or "library:<id>"), x, y, width, height, rotation, flipX/Y, crop?, fit: fill|cover|contain, focus? }; text { text, font (catalog id), size, weight, italic, color (colour or gradient), align, valign, lineHeight, letterSpacing, transform, width (wrap), background? (label box) }; shape { shape: rect|ellipse|line|polygon|star, x, y, width, height, fill, stroke, radius, sides, innerRadius }; fill { fill } (covers the canvas); adjustment { filters } (filters everything below it, inside its group); group { children }. Paint = CSS colour | { type: "linear", stops, angle } | { type: "radial", stops, cx, cy, radius }. Masks: { src } (PNG) | { shape: rect|ellipse, x, y, width, height } | { gradient } + invert, feather, density, enabled — layer-local px for image / text / shape layers, canvas px otherwise. Coordinates are canvas px, origin top-left; angles in degrees. Filters, looks, effects, blend modes, fonts, sizes and AI models come from the catalog (catalog_get).

Rules:
- Start with doc_summary to see what exists (layer ids are stable; use them).
- Before colour / exposure corrections, call image_analyze (on the photo layer) and use its measurements and suggested filters instead of guessing.
- Prefer small doc_patch edits (updateLayer, addFilter, updateFilter, setMask, addLayer…) over replacing the whole document. Use catalog_get before any filter, look, font or parameter you are not sure about.
- Prefer non-destructive solutions: adjustment layers and masks rather than heavy filters on the photo; remove_background writes a mask, it does not erase pixels.
- After every visual change, call render_preview and look at the image you get back: check exposure, colours, skin tones, edges of cut-outs (render_preview { zoom } on hair / fingers), text legibility and placement (nothing cut at the edges), then fix and render again. Use compare: true to see before / after.
- The user may have a layer selected in the Studio: the context message says which; act on it when the request is ambiguous.
- Run check before suggesting an export; export only when asked (variants: og, square, story…).
- Be concise: say what you changed in one or two sentences.`;
