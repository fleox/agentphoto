// The tool registry: the rail, the shortcuts and the viewport read it.
// A tool = one ToolDef (pointer sessions, keys, options bar); add new ones here.

import { ScanFace, Wand2 } from "lucide-react";
import { DEFAULT_MODELS } from "../../core/catalog";
import { findLayer } from "../../ops/tree";
import type { EditorApi } from "../state/context";
import { cropTool } from "./crop";
import { shapeTool, textTool } from "./draw";
import { lassoTool } from "./lasso";
import { marqueeTool } from "./marquee";
import { brushTool, cloneTool, eraserTool } from "./paint";
import { quickTool, wandTool } from "./wand";
import { moveTool } from "./move";
import type { ToolAction, ToolDef, ToolId } from "./types";
import { eyedropperTool, handTool, zoomTool } from "./view";

export const TOOLS: ToolDef[] = [moveTool, marqueeTool, lassoTool, wandTool, quickTool, cropTool, textTool, shapeTool, brushTool, eraserTool, cloneTool, eyedropperTool, handTool, zoomTool];

export const toolById = (id: ToolId): ToolDef => TOOLS.find((t) => t.id === id) ?? moveTool;

export const toolByShortcut = (key: string): ToolDef | undefined => TOOLS.find((t) => t.shortcut.toLowerCase() === key.toLowerCase());

const selectedImage = (api: EditorApi): string | null => {
  const id = api.store.primary;
  const doc = api.store.doc;
  const l = id && doc ? findLayer(doc.layers, id)?.layer : null;
  return l && l.type === "image" ? l.id : null;
};

export function removeBackground(api: EditorApi, id: string, model: string = DEFAULT_MODELS["background-removal"]): Promise<unknown> {
  return api.runTool("remove_background", { id, model }, { busy: "ai.removingBg", model });
}

export function selectSubject(api: EditorApi, id: string, model: string = DEFAULT_MODELS["background-removal"]): Promise<unknown> {
  return api.runTool("mask_generate", { id, method: "subject", target: "copy", model }, { busy: "ai.selectingSubject", model });
}

export const AI_ACTIONS: ToolAction[] = [
  {
    id: "remove-background",
    icon: Wand2,
    label: "ai.removeBg",
    hint: "ai.removeBgHint",
    enabled: (api) => !!selectedImage(api),
    run: (api) => void removeBackground(api, selectedImage(api)!),
  },
  {
    id: "select-subject",
    icon: ScanFace,
    label: "ai.selectSubject",
    hint: "ai.selectSubjectHint",
    enabled: (api) => !!selectedImage(api),
    run: (api) => void selectSubject(api, selectedImage(api)!),
  },
];
