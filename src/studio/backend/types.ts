// The Studio talks to a project through a Backend: the CLI's local REST API
// (`agentphoto studio`) or in-browser projects (MemoryFs persisted to
// IndexedDB, the AI tools and the engine run in the page).

import type { JsonSchema } from "../../ai/types";
import type { LibraryIndex } from "../../core/library";
import type { PhotoDoc } from "../../core/types";
import type { EngineOptions } from "../../engine";
import type { TemplateInfo } from "../../ops/templates";

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  mutating: boolean;
  needsEngine?: boolean;
}

export class ToolCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ToolCallError";
  }
}

export interface ProjectRef {
  id: string;
  title: string;
  updatedAt?: string;
  // Small preview (data URL) of in-browser projects.
  thumb?: string;
}

// How a new project starts.
export interface CreateOptions {
  title: string;
  // Blank canvas.
  width?: number;
  height?: number;
  background?: string | null;
  // A photo the user picked (its bytes) — the canvas takes its size.
  image?: { name: string; bytes: Uint8Array };
  // A built-in sample photo (library id).
  libraryImage?: string;
  template?: string;
}

export interface AiProgress {
  model: string;
  progress: number;
  label: string;
}

export interface Backend {
  readonly mode: "cli" | "local";
  readonly version?: string;
  // Folder of the project (CLI) or its in-browser id.
  readonly location: string | null;
  hasProject(): boolean;
  canCreate(): boolean;
  projectTitle(): string;
  loadDoc(): Promise<PhotoDoc>;
  tools(): Promise<ToolInfo[]>;
  call<T = unknown>(name: string, input: Record<string, unknown>): Promise<T>;
  library(): Promise<LibraryIndex>;
  // URL prefix of library/ files (sample photos, fonts).
  libraryBase(): string;
  templates(): Promise<TemplateInfo[]>;
  templatePreview(id: string): string | null;
  // URL of a project file for <img> / downloads.
  fileUrl(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  // Project files under a prefix (project-relative paths).
  listFiles(prefix: string): Promise<string[]>;
  // Imports an image into assets/images/ and returns its project path.
  addImage(name: string, bytes: Uint8Array): Promise<string>;
  // Project files changed (paths relative to the project).
  onChange(cb: (paths: string[]) => void): () => void;
  // Options for the page's own engine (live rendering, export previews).
  engineOptions(): EngineOptions;
  // Where AI models come from (consent notice).
  modelSource: "hub" | "cli";
  onAiProgress(cb: (p: AiProgress) => void): () => void;
  createProject(opts: CreateOptions): Promise<void>;
  recent(): Promise<ProjectRef[]>;
  open(id: string): Promise<void>;
  remove?(id: string): Promise<void>;
  // Saves a small preview for the start screen (in-browser projects).
  saveThumb?(dataUrl: string): Promise<void>;
  close(): void;
}
