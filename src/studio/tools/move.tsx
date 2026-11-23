// Move / transform tool (V): click to select the topmost layer under the
// cursor (Shift / Cmd adds), drag to move with smart guides (Cmd disables
// snapping, Shift locks the axis), 8 resize handles (Shift keeps the ratio),
// rotation handle above the box (Shift snaps to 15°). Double-click a text
// layer to edit it in place.

import { MousePointer2 } from "lucide-react";
import type { LayerBoxInfo } from "../../engine";
import { hasBox, type Layer, type TextLayer } from "../../core/types";
import { findLayer } from "../../ops/tree";
import type { PatchOp } from "../../ops/doc";
import { Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { hitTest, movableLayers, unionBox } from "../lib/hit";
import { aabb } from "../render/boxes";
import { HANDLES, handlePoint, resizeBox, rotate, rotateBox, snapRect, snapTargets, type Handle } from "../lib/transform";
import { useEditor, useUi } from "../state/context";
import type { DragSession, PointerInfo, Pt, ToolCtx, ToolDef } from "./types";

const HANDLE_HIT = 7;
const ROT_OFFSET = 22;

let sessionSeq = 0;

export function handlesFor(layer: Layer): Handle[] {
  // Text: corners scale the type, sides set the wrap width.
  if (layer.type === "text") return HANDLES.filter((h) => h.hx !== 0);
  return HANDLES;
}

export function rotationHandle(b: LayerBoxInfo, zoom: number): Pt {
  const top = handlePoint(b, { hx: 0, hy: -1 });
  const o = rotate({ x: 0, y: -ROT_OFFSET / zoom }, b.rotation);
  return { x: top.x + o.x, y: top.y + o.y };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

type HandleHit = { kind: "rotate" } | { kind: "resize"; handle: Handle };

// The handle of the primary selection under a viewport point.
export function handleAt(ctx: ToolCtx, screen: Pt): { layer: Layer; box: LayerBoxInfo; hit: HandleHit } | null {
  const { store, boxes } = ctx.api;
  const snap = store.getSnapshot();
  if (snap.selection.length !== 1 || !snap.doc) return null;
  const loc = findLayer(snap.doc.layers, snap.selection[0]);
  if (!loc || !hasBox(loc.layer) || loc.layer.locked) return null;
  const b = boxes.get(loc.layer.id);
  if (!b) return null;
  const zoom = ctx.view().zoom;
  if (dist(ctx.toScreen(rotationHandle(b, zoom)), screen) <= HANDLE_HIT + 1) return { layer: loc.layer, box: b, hit: { kind: "rotate" } };
  for (const h of handlesFor(loc.layer)) if (dist(ctx.toScreen(handlePoint(b, h)), screen) <= HANDLE_HIT) return { layer: loc.layer, box: b, hit: { kind: "resize", handle: h } };
  return null;
}

const RESIZE_CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
export function resizeCursor(h: Handle, rotation: number): string {
  const angle = (Math.atan2(h.hy, h.hx) * 180) / Math.PI + rotation;
  const k = Math.round((((angle % 180) + 180) % 180) / 45) % 4;
  return RESIZE_CURSORS[k];
}

export const ROTATE_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.4' stroke-linecap='round'%3E%3Cpath d='M21 12a9 9 0 1 1-3-6.7L21 8'/%3E%3Cpath d='M21 3v5h-5'/%3E%3C/svg%3E") 11 11, crosshair`;

function moveSession(ctx: ToolCtx, start: PointerInfo, ids: string[]): DragSession {
  const { api } = ctx;
  const doc = api.store.doc!;
  const layers = movableLayers(doc.layers, ids);
  const starts = layers.map((l) => ({ id: l.id, x: (l as { x?: number }).x ?? 0, y: (l as { y?: number }).y ?? 0 }));
  const boxes = api.boxes.getSnapshot();
  const ub = unionBox(boxes, layers);
  const moving = new Set(layers.map((l) => l.id));
  const others = [...boxes.entries()].filter(([id]) => !moving.has(id)).map(([, b]) => aabb(b));
  const targets = snapTargets(doc.canvas, others);
  const key = `move:${++sessionSeq}`;
  let moved = false;
  return {
    cursor: "move",
    move(p) {
      let dx = p.doc.x - start.doc.x;
      let dy = p.doc.y - start.doc.y;
      if (!moved && Math.hypot(p.screen.x - start.screen.x, p.screen.y - start.screen.y) < 3) return;
      moved = true;
      if (p.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (ub && !p.mod && api.ui.get().smartGuides) {
        const s = snapRect({ ...ub, x: ub.x + dx, y: ub.y + dy }, targets, 6 / ctx.view().zoom);
        dx += s.dx;
        dy += s.dy;
        ctx.setGuides(s.guides);
      } else ctx.setGuides([]);
      if (starts.length) api.edit(starts.map((s) => ({ op: "updateLayer", id: s.id, set: { x: Math.round(s.x + dx), y: Math.round(s.y + dy) } }) as PatchOp), { coalesce: key });
    },
    up() {
      ctx.setGuides([]);
    },
    cancel() {
      ctx.setGuides([]);
    },
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function resizeSession(ctx: ToolCtx, layer: Layer, b: LayerBoxInfo, h: Handle): DragSession {
  const key = `resize:${++sessionSeq}`;
  const text = layer.type === "text" ? (layer as TextLayer) : null;
  return {
    cursor: resizeCursor(h, b.rotation),
    move(p) {
      const corner = h.hx !== 0 && h.hy !== 0;
      const r = resizeBox(b, h, p.doc, p.shift || (!!text && corner));
      let set: Record<string, unknown>;
      if (text && corner) {
        // Never below a readable minimum (the document refuses size < 1).
        const k = Math.max(r.width / b.width, 4 / (text.size ?? 64));
        set = { x: Math.round(r.x), y: Math.round(r.y), size: r1((text.size ?? 64) * k), ...(text.width ? { width: Math.round(text.width * k) } : {}), ...(text.letterSpacing ? { letterSpacing: r1(text.letterSpacing * k) } : {}) };
      } else if (text) set = { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(8, Math.round(r.width)) };
      else set = { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
      ctx.api.edit([{ op: "updateLayer", id: layer.id, set }], { coalesce: key });
    },
    up() {},
  };
}

function rotateSession(ctx: ToolCtx, layer: Layer, b: LayerBoxInfo, start: PointerInfo): DragSession {
  const key = `rotate:${++sessionSeq}`;
  return {
    cursor: ROTATE_CURSOR,
    move(p) {
      ctx.api.edit([{ op: "updateLayer", id: layer.id, set: { rotation: rotateBox(b, start.doc, p.doc, p.shift) } }], { coalesce: key });
    },
    up() {},
  };
}

export const moveTool: ToolDef = {
  id: "move",
  icon: MousePointer2,
  label: "tools.move",
  shortcut: "V",
  group: "select",
  cursor(ctx, p) {
    if (!p) return "default";
    const h = handleAt(ctx, p.screen);
    if (h) return h.hit.kind === "rotate" ? ROTATE_CURSOR : resizeCursor(h.hit.handle, h.box.rotation);
    return "default";
  },
  down(ctx, p) {
    const { api } = ctx;
    const snap = api.store.getSnapshot();
    const doc = snap.doc;
    if (!doc) return null;
    const h = handleAt(ctx, p.screen);
    if (h) return h.hit.kind === "rotate" ? rotateSession(ctx, h.layer, h.box, p) : resizeSession(ctx, h.layer, h.box, h.hit.handle);
    const boxes = api.boxes.getSnapshot();
    const hit = hitTest(doc.layers, boxes, p.doc);
    if (p.clicks >= 2 && hit) {
      const l = findLayer(doc.layers, hit)?.layer;
      if (l?.type === "text") {
        api.store.select(hit);
        api.ui.set({ textEdit: { id: hit } });
        return null;
      }
    }
    // Inside the current selection: move it (even when another layer is on top).
    const selLayers = movableLayers(doc.layers, snap.selection);
    const ub = selLayers.length ? unionBox(boxes, selLayers) : null;
    const insideSel = ub && p.doc.x >= ub.x && p.doc.x <= ub.x + ub.width && p.doc.y >= ub.y && p.doc.y <= ub.y + ub.height;
    if (insideSel && !(p.shift || p.mod)) return moveSession(ctx, p, snap.selection);
    if (!hit) {
      if (!p.shift && !p.mod) api.store.select(null);
      return null;
    }
    if (p.shift || p.mod) {
      api.store.toggleSelect(hit);
      return null;
    }
    api.store.select(hit);
    return moveSession(ctx, p, [hit]);
  },
  Options: MoveOptions,
};

function MoveOptions() {
  const { t } = useI18n();
  const { ui } = useEditor();
  const guides = useUi((s) => s.smartGuides);
  return (
    <div className="flex items-center gap-2 text-xs text-fg-muted">
      <Toggle checked={guides} onChange={(v) => ui.set({ smartGuides: v })} ariaLabel={t("tools.smartGuides")} />
      <span>{t("tools.smartGuides")}</span>
      <span className="ml-3 text-fg-faint">{t("tools.moveHint")}</span>
    </div>
  );
}
