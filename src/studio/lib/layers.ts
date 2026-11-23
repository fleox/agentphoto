// Layer helpers for the Studio (pure, tested): new layers, ids, names,
// reordering and grouping ops for the layers panel.

import { uniqueId, slugify } from "../../core/ids";
import type { Filter, Layer, PhotoDoc, ShapeLayer, TextLayer } from "../../core/types";
import type { PatchOp } from "../../ops/doc";
import { allLayerIds, findLayer, isDescendant } from "../../ops/tree";

export function newId(doc: PhotoDoc, base: string): string {
  return uniqueId(slugify(base, "layer"), allLayerIds(doc));
}

const TYPE_NAMES: Record<Layer["type"], string> = { image: "Image", text: "Text", shape: "Shape", fill: "Fill", adjustment: "Adjustment", group: "Group" };

// Name shown in the layers panel.
export function layerLabel(l: Layer): string {
  if (l.name) return l.name;
  if (l.type === "text") return l.text.split("\n")[0].slice(0, 40) || TYPE_NAMES.text;
  return l.id;
}

export function defaultName(type: Layer["type"]): string {
  return TYPE_NAMES[type];
}

export function textLayer(doc: PhotoDoc, at: { x: number; y: number }, text: string, opts: { color?: string; font?: string; size?: number } = {}): TextLayer {
  const size = opts.size ?? Math.max(24, Math.round(Math.min(doc.canvas.width, doc.canvas.height) / 12));
  return { id: newId(doc, "text"), type: "text", text, font: opts.font ?? "inter", size, weight: 700, color: opts.color ?? "#ffffff", x: Math.round(at.x), y: Math.round(at.y) };
}

export function shapeLayer(doc: PhotoDoc, kind: ShapeLayer["shape"], rect: { x: number; y: number; width: number; height: number }, color: string): ShapeLayer {
  const base: ShapeLayer = { id: newId(doc, kind), type: "shape", shape: kind, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
  if (kind === "line") return { ...base, fill: null, stroke: { color, width: Math.max(2, Math.round(Math.min(doc.canvas.width, doc.canvas.height) / 200)) } };
  return { ...base, fill: color, ...(kind === "polygon" ? { sides: 6 } : kind === "star" ? { sides: 5, innerRadius: 0.5 } : {}) };
}

// An image placed inside the canvas (fitted, centred on `at` or the canvas).
export function imageLayer(doc: PhotoDoc, src: string, size: { width: number; height: number }, name: string, at?: { x: number; y: number }): Layer {
  const W = doc.canvas.width;
  const H = doc.canvas.height;
  const k = Math.min(1, W / size.width, H / size.height);
  const w = Math.max(1, Math.round(size.width * k));
  const h = Math.max(1, Math.round(size.height * k));
  const cx = at?.x ?? W / 2;
  const cy = at?.y ?? H / 2;
  return { id: newId(doc, name.replace(/\.[^.]+$/, "") || "image"), type: "image", name: name.replace(/\.[^.]+$/, ""), src, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: w, height: h };
}

// Where a new layer goes: above the primary selection (inside its group), else on top.
export function insertPosition(doc: PhotoDoc, selected: string | null): { above?: string } {
  return selected && findLayer(doc.layers, selected) ? { above: selected } : {};
}

export type DropWhere = "above" | "below" | "inside";

// Ops to move `ids` relative to `target` (layers panel drag & drop).
export function moveOps(doc: PhotoDoc, ids: string[], target: string, where: DropWhere): PatchOp[] | null {
  const t = findLayer(doc.layers, target);
  if (!t) return null;
  const moving = ids.filter((id) => id !== target && findLayer(doc.layers, id));
  // Never into itself / its own children.
  for (const id of moving) {
    const loc = findLayer(doc.layers, id)!;
    if (isDescendant(loc.layer, target)) return null;
  }
  if (!moving.length) return null;
  if (where === "inside") {
    if (t.layer.type !== "group") return null;
    return moving.map((id) => ({ op: "moveLayer", id, parent: target }) as PatchOp);
  }
  // Keep the moved layers' relative order: process so that the final stack matches.
  const ordered = where === "above" ? [...moving].reverse() : moving;
  return ordered.map((id) => ({ op: "moveLayer", id, [where]: target }) as PatchOp);
}

// Selected layers that can be grouped (siblings), in stack order.
export function groupable(doc: PhotoDoc, ids: string[]): string[] | null {
  const locs = ids.map((id) => findLayer(doc.layers, id)).filter((l): l is NonNullable<typeof l> => !!l);
  if (!locs.length) return null;
  const c = locs[0].container;
  if (locs.some((l) => l.container !== c)) return null;
  return locs.sort((a, b) => a.index - b.index).map((l) => l.layer.id);
}

export function groupOps(doc: PhotoDoc, ids: string[]): { ops: PatchOp[]; id: string } | null {
  const list = groupable(doc, ids);
  if (!list) return null;
  const id = newId(doc, "group");
  return { ops: [{ op: "groupLayers", ids: list, id, name: `Group ${allLayerIds(doc).filter((x) => x.startsWith("group")).length + 1}` }], id };
}

// Index of the first filter of a type on a layer (-1 when absent).
export function filterIndex(l: Layer, type: string): number {
  return (l.filters ?? []).findIndex((f: Filter) => f.type === type);
}

// Flat top → bottom rows for the layers panel (collapsed groups hide their children).
export interface LayerRow {
  layer: Layer;
  depth: number;
  parent: string | null;
}

export function layerRows(layers: Layer[], collapsed: ReadonlySet<string>, depth = 0, parent: string | null = null): LayerRow[] {
  const out: LayerRow[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    out.push({ layer: l, depth, parent });
    if (l.type === "group" && !collapsed.has(l.id)) out.push(...layerRows(l.children ?? [], collapsed, depth + 1, l.id));
  }
  return out;
}

// Arrow-key nudge of the selected layers (groups move their children).
export function nudgeOps(doc: PhotoDoc, ids: string[], dx: number, dy: number): PatchOp[] {
  const out: PatchOp[] = [];
  const seen = new Set<string>();
  const visit = (l: Layer) => {
    if (l.locked || seen.has(l.id)) return;
    seen.add(l.id);
    if (l.type === "image" || l.type === "text" || l.type === "shape") out.push({ op: "updateLayer", id: l.id, set: { x: (l.x ?? 0) + dx, y: (l.y ?? 0) + dy } });
    else if (l.type === "group") (l.children ?? []).forEach(visit);
  };
  for (const id of ids) {
    const loc = findLayer(doc.layers, id);
    if (loc) visit(loc.layer);
  }
  return out;
}
