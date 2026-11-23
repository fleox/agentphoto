// Viewport tools: one definition per tool (icon, shortcut, cursor, pointer
// handling, optional overlay and options bar). Painting tools (brush, eraser,
// clone), lasso / magic wand and AI click-select plug into the same registry:
// a pointer-down returns a DragSession that receives the moves and the release.

import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { MessageKey } from "../i18n";
import type { EditorApi, View } from "../state/context";

export type ToolId = "move" | "marquee" | "crop" | "text" | "shape" | "hand" | "zoom" | "eyedropper";

export interface Pt {
  x: number;
  y: number;
}

export interface PointerInfo {
  // Document px.
  doc: Pt;
  // Viewport px (relative to the viewport element).
  screen: Pt;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  button: number;
  clicks: number;
}

export interface ToolCtx {
  api: EditorApi;
  view(): View;
  setView(v: View): void;
  toScreen(p: Pt): Pt;
  // Colour of the rendered pixel under a document point (eyedropper).
  sampleColor(p: Pt): string | null;
  setGuides(g: { axis: "x" | "y"; at: number }[]): void;
  // Draft rectangle drawn by the overlay (shape / marquee preview), document px.
  setDraft(d: { kind: "rect" | "ellipse" | "line"; x: number; y: number; width: number; height: number } | null): void;
}

export interface DragSession {
  move(p: PointerInfo): void;
  up(p: PointerInfo): void;
  cancel?(): void;
  // Cursor while dragging.
  cursor?: string;
}

export interface ToolDef {
  id: ToolId;
  icon: LucideIcon;
  label: MessageKey;
  shortcut: string;
  // Rail grouping (separators between groups).
  group: "select" | "draw" | "view" | "paint";
  cursor(ctx: ToolCtx, p: PointerInfo | null): string;
  down?(ctx: ToolCtx, p: PointerInfo): DragSession | null;
  // Keys while the tool is active (Enter / Escape for crop…); true = handled.
  key?(ctx: ToolCtx, e: KeyboardEvent): boolean;
  // Called when the tool becomes active / inactive.
  activate?(api: EditorApi): void;
  deactivate?(api: EditorApi): void;
  // Tool options shown in the options bar.
  Options?: ComponentType;
}

// One-shot actions in the rail (AI group): act on the selection.
export interface ToolAction {
  id: string;
  icon: LucideIcon;
  label: MessageKey;
  hint: MessageKey;
  enabled(api: EditorApi): boolean;
  run(api: EditorApi): void | Promise<void>;
}
