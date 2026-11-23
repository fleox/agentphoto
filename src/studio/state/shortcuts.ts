// Keyboard shortcuts of the editor (the shortcuts dialog lists them).

import { useEffect } from "react";
import { allLayerIds, findLayer } from "../../ops/tree";
import { uniqueId } from "../../core/ids";
import type { PatchOp } from "../../ops/doc";
import { toast } from "../components/ui/Toast";
import { t } from "../i18n";
import { groupOps, nudgeOps } from "../lib/layers";
import { toolById, toolByShortcut } from "../tools/registry";
import { zoomAt } from "../tools/view";
import { useEditor, type EditorApi } from "./context";
import { toolCtx } from "./toolCtx";

export const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function setTool(api: EditorApi, id: Parameters<typeof toolById>[0]): void {
  const cur = api.ui.get().tool;
  if (cur === id) return;
  toolById(cur).deactivate?.(api);
  api.ui.set({ tool: id, textEdit: null });
  toolById(id).activate?.(api);
}

export function duplicateSelection(api: EditorApi): void {
  const doc = api.store.doc;
  const sel = api.store.getSnapshot().selection;
  if (!doc || !sel.length) return;
  const taken = new Set(allLayerIds(doc));
  const ops: PatchOp[] = [];
  const ids: string[] = [];
  for (const id of sel) {
    const newId = uniqueId(`${id}-copy`, taken);
    taken.add(newId);
    ops.push({ op: "duplicateLayer", id, newId });
    ids.push(newId);
  }
  api.edit(ops, { select: ids });
}

export function deleteSelection(api: EditorApi): void {
  const doc = api.store.doc;
  const sel = api.store.getSnapshot().selection.filter((id) => doc && findLayer(doc.layers, id));
  if (!sel.length) return;
  // Children of a removed group go with it.
  const top = sel.filter((id) => !sel.some((other) => other !== id && findLayer((findLayer(doc!.layers, other)?.layer as { children?: never[] })?.children ?? [], id)));
  api.edit(
    top.map((id) => ({ op: "removeLayer", id }) as PatchOp),
    { select: null },
  );
}

export function groupSelection(api: EditorApi): void {
  const doc = api.store.doc;
  if (!doc) return;
  const g = groupOps(doc, api.store.getSnapshot().selection);
  if (!g) return void toast({ tone: "error", title: t("layers.groupSiblings") });
  api.edit(g.ops, { select: g.id });
}

export function ungroupSelection(api: EditorApi): void {
  const doc = api.store.doc;
  const id = api.store.primary;
  const l = id && doc ? findLayer(doc.layers, id)?.layer : null;
  if (!l || l.type !== "group") return;
  api.edit([{ op: "ungroup", id: l.id }], { select: (l.children ?? []).map((c) => c.id) });
}

export function zoomBy(api: EditorApi, factor: number): void {
  const el = document.querySelector<HTMLElement>("[data-viewport]");
  const r = el?.getBoundingClientRect();
  api.ui.set((s) => ({ view: zoomAt(s.view, factor, { x: (r?.width ?? 800) / 2, y: (r?.height ?? 600) / 2 }) }));
}

export function zoomTo(api: EditorApi, zoom: number): void {
  const v = api.ui.get().view;
  zoomBy(api, zoom / v.zoom);
}

export function useShortcuts(): void {
  const api = useEditor();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const { store, ui } = api;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        if (isTyping(e)) return;
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && key === "y") {
        if (isTyping(e)) return;
        e.preventDefault();
        store.redo();
        return;
      }
      if (mod && key === "s") {
        e.preventDefault();
        void store.flush().then(() => toast({ tone: "success", title: t("save.savedToast") }, 1600));
        return;
      }
      if (isTyping(e)) return;
      if (ui.get().dialog) return;
      // The active tool first (Enter / Escape for crop, marquee…).
      const ctx = toolCtx.current;
      if (ctx && toolById(ui.get().tool).key?.(ctx, e)) {
        e.preventDefault();
        return;
      }
      if (mod) {
        if (key === "d") {
          e.preventDefault();
          duplicateSelection(api);
        } else if (key === "g") {
          e.preventDefault();
          if (e.shiftKey) ungroupSelection(api);
          else groupSelection(api);
        } else if (key === "0") {
          e.preventDefault();
          ui.set((s) => ({ fitRequest: s.fitRequest + 1 }));
        } else if (key === "1") {
          e.preventDefault();
          zoomTo(api, 1);
        } else if (key === "=" || key === "+") {
          e.preventDefault();
          zoomBy(api, 1.25);
        } else if (key === "-") {
          e.preventDefault();
          zoomBy(api, 0.8);
        } else if (key === "a") {
          e.preventDefault();
          const doc = store.doc;
          if (doc) store.select(doc.layers.map((l) => l.id).reverse());
        }
        return;
      }
      const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (arrows[key]) {
        const doc = store.doc;
        const sel = store.getSnapshot().selection;
        if (!doc || !sel.length) return;
        e.preventDefault();
        const k = e.shiftKey ? 10 : 1;
        const ops = nudgeOps(doc, sel, arrows[key][0] * k, arrows[key][1] * k);
        if (ops.length) api.edit(ops, { coalesce: "nudge" });
        return;
      }
      switch (e.key) {
        case "Escape":
          if (ui.get().textEdit) ui.set({ textEdit: null });
          else if (ui.get().marquee) ui.set({ marquee: null });
          else store.select(null);
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          deleteSelection(api);
          break;
        case "Tab":
          e.preventDefault();
          ui.set((s) => ({ panelsHidden: !s.panelsHidden }));
          break;
        case "?":
          ui.set({ dialog: "shortcuts" });
          break;
        case "[":
        case "]":
          // Reserved: brush size (phase 2 painting tools).
          break;
        default: {
          if (e.altKey || e.shiftKey) return;
          const tool = toolByShortcut(e.key);
          if (tool) setTool(api, tool.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);
}
