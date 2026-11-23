// Measured layer boxes (document px) for the viewport overlay: selection
// frames, transform handles, hit testing, snapping. Text is measured with its
// real font, images with their natural size (Compositor.layerBox).

import type { Layer, PhotoDoc } from "../../core/types";
import { hasBox } from "../../core/types";
import type { Compositor, LayerBoxInfo } from "../../engine";
import { walkLayers } from "../../ops/tree";

export type BoxMap = ReadonlyMap<string, LayerBoxInfo>;

export class BoxTracker {
  private boxes: Map<string, LayerBoxInfo> = new Map();
  private listeners = new Set<() => void>();
  private seq = 0;

  constructor(private compositor: Compositor) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): BoxMap => this.boxes;
  get(id: string): LayerBoxInfo | undefined {
    return this.boxes.get(id);
  }

  // Immediate estimate (explicit sizes) then the measured values.
  async update(doc: PhotoDoc): Promise<void> {
    const seq = ++this.seq;
    const layers: Layer[] = [];
    walkLayers(doc.layers, (l) => void layers.push(l));
    const quick = new Map<string, LayerBoxInfo>();
    for (const l of layers) {
      if (!hasBox(l)) continue;
      const prev = this.boxes.get(l.id);
      const w = l.type === "text" ? prev?.width : (l.width ?? prev?.width);
      const h = l.type === "text" ? prev?.height : (l.height ?? prev?.height);
      if (w !== undefined && h !== undefined) quick.set(l.id, { x: l.x ?? 0, y: l.y ?? 0, width: w, height: h, rotation: l.rotation ?? 0 });
    }
    this.set(quick);
    const measured = new Map<string, LayerBoxInfo>();
    await Promise.all(
      layers.filter(hasBox).map(async (l) => {
        const b = await this.compositor.layerBox(l).catch(() => null);
        if (b && b.width > 0 && b.height > 0) measured.set(l.id, b);
      }),
    );
    if (seq === this.seq) this.set(measured);
  }

  private set(next: Map<string, LayerBoxInfo>): void {
    this.boxes = next;
    this.listeners.forEach((l) => l());
  }
}

export interface Pt {
  x: number;
  y: number;
}

// Corners of a rotated box (document px), clockwise from top-left.
export function boxCorners(b: LayerBoxInfo): Pt[] {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const r = (b.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [
    [-b.width / 2, -b.height / 2],
    [b.width / 2, -b.height / 2],
    [b.width / 2, b.height / 2],
    [-b.width / 2, b.height / 2],
  ].map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
}

// Axis-aligned bounds of a rotated box.
export function aabb(b: LayerBoxInfo): { x: number; y: number; width: number; height: number } {
  if (!b.rotation) return { x: b.x, y: b.y, width: b.width, height: b.height };
  const c = boxCorners(b);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// Is the document point inside the (rotated) box?
export function boxContains(b: LayerBoxInfo, p: Pt): boolean {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const r = (-b.rotation * Math.PI) / 180;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= b.width / 2 && Math.abs(ly) <= b.height / 2;
}
