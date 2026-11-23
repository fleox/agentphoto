// Layer tree helpers (pure): find / walk / flatten the layers of a document
// (groups nest layers in `children`).

import type { Layer, PhotoDoc } from "../core/types";
import { hasBox, isGradientMask, isImageMask, isShapeMask } from "../core/types";

export interface LayerLocation {
  layer: Layer;
  parent: Layer | null; // the group holding it, null at the root
  container: Layer[]; // doc.layers or parent.children
  index: number; // 0 = bottom
  depth: number;
}

export function findLayer(layers: Layer[] | undefined, id: string, parent: Layer | null = null, depth = 0): LayerLocation | null {
  if (!Array.isArray(layers)) return null;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l && l.id === id) return { layer: l, parent, container: layers, index: i, depth };
  }
  for (const l of layers) {
    const found = l && l.type === "group" && Array.isArray(l.children) ? findLayer(l.children, id, l, depth + 1) : null;
    if (found) return found;
  }
  return null;
}

// Depth-first, bottom → top, groups before their children. Return false from `fn` to skip children.
export function walkLayers(layers: Layer[] | undefined, fn: (layer: Layer, parent: Layer | null, depth: number) => void | boolean, parent: Layer | null = null, depth = 0): void {
  if (!Array.isArray(layers)) return;
  for (const l of layers) {
    if (!l || typeof l !== "object") continue;
    if (fn(l, parent, depth) === false) continue;
    if (l.type === "group") walkLayers(l.children, fn, l, depth + 1);
  }
}

export function allLayerIds(doc: Pick<PhotoDoc, "layers">): string[] {
  const ids: string[] = [];
  walkLayers(doc.layers, (l) => void ids.push(l.id));
  return ids;
}

export function isDescendant(ancestor: Layer, id: string): boolean {
  return ancestor.type === "group" && !!findLayer(ancestor.children, id);
}

const short = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// One-line description ("image assets/photo.jpg", "text \"Summer sale\" (montserrat 96)").
export function layerDetail(l: Layer): string {
  switch (l.type) {
    case "image":
      return `${l.src}${l.fit && l.fit !== "fill" ? ` (${l.fit})` : ""}`;
    case "text":
      return `${JSON.stringify(short(String(l.text ?? "")))} (${l.font ?? "inter"} ${l.size ?? 64})`;
    case "shape":
      return `${l.shape}${typeof l.fill === "string" ? ` ${l.fill}` : l.fill ? " gradient" : ""}`;
    case "fill":
      return typeof l.fill === "string" ? l.fill : `${l.fill?.type ?? "?"} gradient`;
    case "adjustment":
      return (l.filters ?? []).map((f) => (f.type === "look" ? `look:${String(f.look)}` : f.type)).join(", ") || "(empty)";
    case "group":
      return `${l.children?.length ?? 0} layers`;
    default:
      return "";
  }
}

export function maskKind(l: Layer): "image" | "shape" | "gradient" | undefined {
  const m = l.mask;
  if (!m) return undefined;
  return isImageMask(m) ? "image" : isShapeMask(m) ? "shape" : isGradientMask(m) ? "gradient" : undefined;
}

export interface FlatLayer {
  id: string;
  type: Layer["type"];
  name?: string;
  detail: string;
  parent: string | null;
  depth: number;
  // Position in its container, 0 = bottom.
  index: number;
  box?: [number, number, number | null, number | null];
  rotation?: number;
  opacity?: number;
  blend?: string;
  hidden?: true;
  locked?: true;
  clip?: true;
  mask?: string;
  filters?: string[];
  effects?: string[];
}

export function flatLayer(l: Layer, parent: Layer | null, depth: number, index: number): FlatLayer {
  const out: FlatLayer = { id: l.id, type: l.type, detail: layerDetail(l), parent: parent?.id ?? null, depth, index };
  if (l.name) out.name = l.name;
  if (hasBox(l)) {
    out.box = [l.x ?? 0, l.y ?? 0, l.width ?? null, l.height ?? null];
    if (l.rotation) out.rotation = l.rotation;
  }
  if (l.opacity !== undefined && l.opacity !== 1) out.opacity = l.opacity;
  if (l.blend && l.blend !== "normal") out.blend = l.blend;
  if (l.visible === false) out.hidden = true;
  if (l.locked) out.locked = true;
  if (l.clip) out.clip = true;
  const mk = maskKind(l);
  if (mk) out.mask = l.mask && (l.mask as { enabled?: boolean }).enabled === false ? `${mk} (disabled)` : mk;
  if (l.type !== "adjustment" && l.filters?.length) out.filters = l.filters.map((f) => (f.type === "look" ? `look:${String(f.look)}` : f.type) + (f.enabled === false ? " (off)" : ""));
  if (l.effects) {
    const fx = Object.entries(l.effects).filter(([, v]) => v).map(([k]) => k);
    if (fx.length) out.effects = fx;
  }
  return out;
}

// Top → bottom (the order of a layers panel).
export function flattenLayers(doc: Pick<PhotoDoc, "layers">): FlatLayer[] {
  const out: FlatLayer[] = [];
  const visit = (layers: Layer[], parent: Layer | null, depth: number) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l || typeof l !== "object") continue;
      out.push(flatLayer(l, parent, depth, i));
      if (l.type === "group" && Array.isArray(l.children)) visit(l.children, l, depth + 1);
    }
  };
  visit(Array.isArray(doc.layers) ? doc.layers : [], null, 0);
  return out;
}

// Project files a document references (image sources, image masks).
export function referencedFiles(doc: Pick<PhotoDoc, "layers">): { path: string; by: string; role: "src" | "mask" }[] {
  const out: { path: string; by: string; role: "src" | "mask" }[] = [];
  walkLayers(doc.layers, (l) => {
    if (l.type === "image" && typeof l.src === "string") out.push({ path: l.src, by: l.id, role: "src" });
    if (l.mask && isImageMask(l.mask) && typeof l.mask.src === "string") out.push({ path: l.mask.src, by: l.id, role: "mask" });
  });
  return out;
}
