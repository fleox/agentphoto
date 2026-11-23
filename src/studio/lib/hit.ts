// Hit testing and selection geometry on measured layer boxes (pure).

import type { Layer } from "../../core/types";
import { hasBox } from "../../core/types";
import { aabb, boxContains, type BoxMap } from "../render/boxes";

// Topmost visible, unlocked box layer under a document point (groups are searched inside).
export function hitTest(layers: Layer[], boxes: BoxMap, p: { x: number; y: number }): string | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.visible === false || l.locked) continue;
    if (l.type === "group") {
      const hit = hitTest(l.children ?? [], boxes, p);
      if (hit) return hit;
      continue;
    }
    if (!hasBox(l)) continue;
    const b = boxes.get(l.id);
    if (b && boxContains(b, p)) return l.id;
  }
  return null;
}

// Box layers moved when the given layers are dragged (groups move their children).
export function movableLayers(layers: Layer[], ids: string[]): Layer[] {
  const out: Layer[] = [];
  const visit = (l: Layer) => {
    if (l.locked) return;
    if (hasBox(l)) out.push(l);
    else if (l.type === "group") (l.children ?? []).forEach(visit);
  };
  const find = (list: Layer[]) => {
    for (const l of list) {
      if (ids.includes(l.id)) visit(l);
      else if (l.type === "group") find(l.children ?? []);
    }
  };
  find(layers);
  return [...new Map(out.map((l) => [l.id, l])).values()];
}

// Union of the axis-aligned bounds of some layers (document px).
export function unionBox(boxes: BoxMap, layers: Layer[]): { x: number; y: number; width: number; height: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const l of layers) {
    const b = boxes.get(l.id);
    if (!b) continue;
    const a = aabb(b);
    x0 = Math.min(x0, a.x);
    y0 = Math.min(y0, a.y);
    x1 = Math.max(x1, a.x + a.width);
    y1 = Math.max(y1, a.y + a.height);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}
