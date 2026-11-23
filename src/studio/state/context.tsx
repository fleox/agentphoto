import { createContext, useContext, useSyncExternalStore } from "react";
import type { LibraryIndex } from "../../core/library";
import type { Layer, PhotoDoc } from "../../core/types";
import type { Compositor, Engine } from "../../engine";
import type { PatchOp } from "../../ops/doc";
import { findLayer } from "../../ops/tree";
import type { Backend, ToolInfo } from "../backend/types";
import type { MessageKey } from "../i18n";
import type { BoxTracker } from "../render/boxes";
import type { ToolId } from "../tools/types";
import type { Region, ShapeRegion } from "../lib/region";
import type { EditorSnapshot, EditorStore } from "./editorStore";
import { useStore, type TinyStore } from "./tinyStore";

export type RightTab = "properties" | "filters" | "looks" | "effects";
export type DialogId = null | "export" | "shortcuts";
export type ShapeKind = "rect" | "ellipse" | "line" | "polygon" | "star";

export interface View {
  // Screen px per document px.
  zoom: number;
  // Position of the canvas' top-left corner in the viewport, screen px.
  x: number;
  y: number;
}

// Marquee selection (shape region), document px.
export type Marquee = ShapeRegion;
export type { Region };

export interface BrushSettings {
  // Diameter, document px.
  size: number;
  // 0..1: hard edge … soft.
  hardness: number;
  // 0..1: max coverage of one stroke.
  opacity: number;
  // 0..1: coverage added per dab.
  flow: number;
}

// Quick AI select session: prompt points on a layer and the live result.
export interface QuickSelect {
  layer: string;
  points: [number, number, number][];
  region: Region | null;
  busy: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Inline text editing: an existing layer, or a new one at a point (text tool).
export type TextEdit = { id: string } | { id: null; x: number; y: number };

export interface CheckIssue {
  severity: "error" | "warning" | "info";
  code: string;
  path: string;
  message: string;
  hint?: string;
}
export interface CheckResult {
  ok: boolean;
  counts?: { errors: number; warnings: number; infos: number };
  issues: CheckIssue[];
  at: number;
}

export interface AiConsentRequest {
  model: string;
  resolve(ok: boolean): void;
}

export interface UiState {
  tool: ToolId;
  shapeKind: ShapeKind;
  marqueeKind: "rect" | "ellipse";
  view: View;
  // Bumped to ask the viewport to fit the canvas.
  fitRequest: number;
  rightTab: RightTab;
  assistant: boolean;
  panelsHidden: boolean;
  dialog: DialogId;
  flash: { ids: string[]; at: number } | null;
  agentPulse: number;
  // The pixel selection (marquee, lasso, wand, AI select).
  region: Region | null;
  crop: Rect | null;
  textEdit: TextEdit | null;
  // Foreground colour (new text / shapes, eyedropper).
  fg: string;
  cursor: { x: number; y: number } | null;
  renderMs: number;
  busy: { label: string; progress?: number } | null;
  consent: AiConsentRequest | null;
  check: CheckResult | null;
  checkRunning: boolean;
  // Alt-click on a mask chip: show the mask itself.
  showMask: string | null;
  smartGuides: boolean;
  cropRatio: number | null;
  cropRatioId: string;
  // Bumped when project files change (re-render).
  filesVersion: number;
  collapsed: string[];
  lassoKind: "free" | "poly";
  // Paint into this layer's mask instead of its pixels (mask chip targeted).
  maskTarget: string | null;
  brush: BrushSettings;
  // Mask painting: the brush hides (black) or reveals (white).
  maskPaint: "hide" | "reveal";
  cloneSource: { x: number; y: number } | null;
  wand: { tolerance: number; contiguous: boolean; sampleAll: boolean };
  quick: QuickSelect | null;
}

export interface EditorApi {
  backend: Backend;
  store: EditorStore;
  ui: TinyStore<UiState>;
  tools: ToolInfo[];
  library: LibraryIndex;
  // Live rendering engine (viewport, export preview).
  engine: Engine;
  // Second compositor (own cache) for thumbnails / look previews.
  thumbs: Compositor;
  boxes: BoxTracker;
  // Applies ops (local + debounced save); toast when an op fails.
  edit(ops: PatchOp[], opts?: { coalesce?: string; select?: string | string[] | null }): boolean;
  runCheck(): Promise<void>;
  // Re-reads photo.json after a tool changed it, with the agent highlight.
  reloadDoc(opts?: { toast?: boolean }): Promise<void>;
  // Runs a tool on the project (flushes local edits first, reloads after mutating ones).
  runTool<T = unknown>(name: string, input: Record<string, unknown>, opts?: { busy?: MessageKey; model?: string; flash?: boolean }): Promise<T | null>;
  // Asks once for the AI model download (consent); false = declined.
  ensureModel(model: string): Promise<boolean>;
  importImages(files: { name: string; bytes: Uint8Array }[], at?: { x: number; y: number }): Promise<void>;
  closeProject(): void;
  // Natural size of image sources (known after they load).
  naturalSize(src: string): { width: number; height: number } | undefined;
}

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const v = useContext(EditorContext);
  if (!v) throw new Error("useEditor outside EditorContext");
  return v;
}

export function useSnapshot(): EditorSnapshot {
  const { store } = useEditor();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useDoc(): PhotoDoc {
  return useSnapshot().doc!;
}

export function useUi<U>(select: (s: UiState) => U): U {
  return useStore(useEditor().ui, select);
}

// The primary selected layer (inspector target).
export function useSelectedLayer(): Layer | null {
  const snap = useSnapshot();
  const id = snap.selection[snap.selection.length - 1];
  if (!id || !snap.doc) return null;
  return findLayer(snap.doc.layers, id)?.layer ?? null;
}
