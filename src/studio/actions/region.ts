// What the pixel selection can become: a layer mask (shape mask for a
// marquee, PNG in layer space for freeform selections), a hole in the mask
// (Delete), a copy on a new layer (pixels baked into assets/edits/), a colour
// fill, a masked adjustment layer, a crop. Also invert / feather / clear.
// Every document change is one undoable edit; files are only ever added.

import { hasBox, type Layer, type Mask } from "../../core/types";
import { encode, encodeMask, createCanvas, ctx2d } from "../../engine";
import type { PatchOp } from "../../ops/doc";
import { findLayer } from "../../ops/tree";
import { toast } from "../components/ui/Toast";
import { t } from "../i18n";
import { newId } from "../lib/layers";
import { featherRegion, invertRegion, regionBounds, regionInLayer, type LayerFrame, type Region } from "../lib/region";
import { marqueeMask } from "../lib/selection";
import { clampRect } from "../lib/transform";
import { maskPlane } from "../render/masks";
import { sideEngine } from "../render/sideEngine";
import type { EditorApi } from "../state/context";

const MAX_MASK = 2048;
const MAX_EDIT = 4096;

// The next unused "<dir>/<base>-<n>.<ext>" (files are never overwritten).
export async function freePath(api: EditorApi, dir: string, base: string, ext = "png"): Promise<string> {
  const taken = new Set(await api.backend.listFiles(`${dir}/`).catch(() => [] as string[]));
  for (let n = 1; ; n++) {
    const p = `${dir}/${base}-${n}.${ext}`;
    if (!taken.has(p)) return p;
  }
}

// A box layer's frame (document px, with rotation / flip); null for canvas-space layers.
export function frameOf(api: EditorApi, layer: Layer): LayerFrame | null {
  if (!hasBox(layer)) return null;
  const b = api.boxes.get(layer.id);
  const nat = layer.type === "image" ? api.naturalSize(layer.src) : undefined;
  return {
    x: b?.x ?? layer.x ?? 0,
    y: b?.y ?? layer.y ?? 0,
    width: b?.width ?? layer.width ?? nat?.width ?? 1,
    height: b?.height ?? layer.height ?? nat?.height ?? 1,
    rotation: b?.rotation ?? layer.rotation ?? 0,
    flipX: layer.flipX,
    flipY: layer.flipY,
  };
}

// Mask plane size for a frame: its own size, capped.
export function planeSize(fw: number, fh: number, max = MAX_MASK): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(fw, fh));
  return { w: Math.max(1, Math.round(fw * k)), h: Math.max(1, Math.round(fh * k)) };
}

export async function writeAlphaPng(api: EditorApi, path: string, alpha: Uint8ClampedArray, w: number, h: number): Promise<string> {
  const png = await encodeMask(alpha, w, h);
  await api.backend.writeFile(path, png.bytes);
  return path;
}

// The region as a mask for `layer` (in its own coordinates).
export async function regionMask(api: EditorApi, layer: Layer, region: Region): Promise<Mask> {
  const doc = api.store.doc!;
  const frame = frameOf(api, layer);
  if (region.kind !== "raster" && !frame?.rotation && !frame?.flipX && !frame?.flipY) {
    const box = frame ? { x: frame.x, y: frame.y, width: frame.width, height: frame.height, rotation: 0 } : undefined;
    return marqueeMask(layer, region, box);
  }
  const fw = frame?.width ?? doc.canvas.width;
  const fh = frame?.height ?? doc.canvas.height;
  const { w, h } = planeSize(fw, fh);
  const alpha = regionInLayer(region, w, h, frame, doc.canvas);
  const path = await freePath(api, "assets/masks", `${layer.id}-selection`);
  return { src: await writeAlphaPng(api, path, alpha, w, h) };
}

function need(api: EditorApi): { region: Region; layer: Layer | null } | null {
  const region = api.ui.get().region;
  if (!region) return null;
  const id = api.store.primary;
  const layer = id && api.store.doc ? (findLayer(api.store.doc.layers, id)?.layer ?? null) : null;
  return { region, layer };
}

async function guarded(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    toast({ tone: "error", title: label, detail: (e as Error).message });
  }
}

export function maskFromRegion(api: EditorApi): Promise<void> {
  return guarded(t("region.failed"), async () => {
    const n = need(api);
    if (!n?.layer) return void toast({ tone: "info", title: t("region.needLayer") });
    const mask = await regionMask(api, n.layer, n.region);
    if (api.edit([{ op: "setMask", id: n.layer.id, mask }])) api.ui.set({ region: null });
  });
}

// Delete: hide the selected pixels (the selection is subtracted from the layer's mask).
export function deleteRegion(api: EditorApi): Promise<void> {
  return guarded(t("region.failed"), async () => {
    const n = need(api);
    if (!n?.layer) return void toast({ tone: "info", title: t("region.needLayer") });
    const doc = api.store.doc!;
    const frame = frameOf(api, n.layer);
    const fw = frame?.width ?? doc.canvas.width;
    const fh = frame?.height ?? doc.canvas.height;
    const { w, h } = planeSize(fw, fh);
    const cur = n.layer.mask && n.layer.mask.enabled !== false ? n.layer.mask : null;
    const plane = await maskPlane(api.engine.loader, cur, w, h, fw, fh);
    const sel = regionInLayer(n.region, w, h, frame, doc.canvas);
    for (let i = 0; i < plane.length; i++) plane[i] = Math.min(plane[i], 255 - sel[i]);
    const path = await writeAlphaPng(api, await freePath(api, "assets/masks", `${n.layer.id}-erase`), plane, w, h);
    const keep = cur ? { ...(cur.feather ? { feather: cur.feather } : {}), ...(cur.density !== undefined ? { density: cur.density } : {}) } : {};
    api.edit([{ op: "setMask", id: n.layer.id, mask: { src: path, ...keep } }]);
  });
}

// Copy the selected pixels (of the selected layer, or of the whole picture) to a new image layer.
export function copyRegionToLayer(api: EditorApi): Promise<void> {
  return guarded(t("region.failed"), async () => {
    const n = need(api);
    if (!n) return;
    const doc = api.store.doc!;
    const b = regionBounds(n.region);
    const bounds = b && clampRect(b, doc.canvas.width, doc.canvas.height);
    if (!bounds || bounds.width < 1 || bounds.height < 1) return void toast({ tone: "info", title: t("marquee.empty") });
    const k = Math.min(1, MAX_EDIT / Math.max(doc.canvas.width, doc.canvas.height));
    const src = await sideEngine(api).render(doc, { scale: k, ...(n.layer ? { only: new Set([n.layer.id]), background: false } : {}) });
    const W = src.width;
    const H = src.height;
    const sel = regionInLayer(n.region, W, H, null, doc.canvas);
    const ctx = ctx2d(src);
    const img = ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < sel.length; i++) img.data[i * 4 + 3] = (img.data[i * 4 + 3] * sel[i]) / 255;
    ctx.putImageData(img, 0, 0);
    const x = Math.floor(bounds.x);
    const y = Math.floor(bounds.y);
    const w = Math.ceil(bounds.x + bounds.width) - x;
    const h = Math.ceil(bounds.y + bounds.height) - y;
    const out = createCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
    ctx2d(out).drawImage(src as CanvasImageSource, -x * k, -y * k);
    const png = await encode(out, "image/png");
    const base = n.layer?.id ?? "picture";
    const path = await freePath(api, "assets/edits", `${base}-copy`);
    await api.backend.writeFile(path, png.bytes);
    const id = newId(doc, `${base}-copy`);
    const layer: Layer = { id, type: "image", name: t("region.copyName"), src: path, x, y, width: w, height: h };
    if (api.edit([{ op: "addLayer", layer, ...(n.layer ? { above: n.layer.id } : {}) }], { select: id })) api.ui.set({ region: null });
  });
}

async function canvasMask(api: EditorApi, region: Region, base: string): Promise<Mask> {
  const doc = api.store.doc!;
  if (region.kind !== "raster") return { shape: region.kind, x: region.x, y: region.y, width: region.width, height: region.height };
  const { w, h } = planeSize(doc.canvas.width, doc.canvas.height);
  const alpha = regionInLayer(region, w, h, null, doc.canvas);
  return { src: await writeAlphaPng(api, await freePath(api, "assets/masks", base), alpha, w, h) };
}

// A new colour fill (foreground colour) limited to the selection.
export function fillRegion(api: EditorApi): Promise<void> {
  return guarded(t("region.failed"), async () => {
    const n = need(api);
    if (!n) return;
    const doc = api.store.doc!;
    const id = newId(doc, "fill");
    const mask = await canvasMask(api, n.region, `${id}-selection`);
    const layer: Layer = { id, type: "fill", name: t("region.fillName"), fill: api.ui.get().fg, mask };
    if (api.edit([{ op: "addLayer", layer, ...(n.layer ? { above: n.layer.id } : {}) }], { select: id })) api.ui.set({ region: null });
  });
}

// A new adjustment layer that only affects the selection.
export function adjustmentFromRegion(api: EditorApi): Promise<void> {
  return guarded(t("region.failed"), async () => {
    const n = need(api);
    if (!n) return;
    const doc = api.store.doc!;
    const id = newId(doc, "adjustment");
    const mask = await canvasMask(api, n.region, `${id}-selection`);
    const layer: Layer = { id, type: "adjustment", name: t("layers.adjustmentName"), filters: [{ type: "brightnessContrast", brightness: 0, contrast: 0 }], mask: { ...mask, feather: 2 } };
    if (api.edit([{ op: "addLayer", layer, ...(n.layer ? { above: n.layer.id } : {}) }], { select: id })) api.ui.set({ region: null, rightTab: "filters" });
  });
}

export function cropToRegion(api: EditorApi): void {
  const region = api.ui.get().region;
  const doc = api.store.doc;
  if (!region || !doc) return;
  const b = regionBounds(region);
  const c = b && clampRect(b, doc.canvas.width, doc.canvas.height);
  if (!c || c.width < 1 || c.height < 1) return void toast({ tone: "info", title: t("marquee.empty") });
  const op: PatchOp = { op: "crop", x: Math.round(c.x), y: Math.round(c.y), width: Math.max(1, Math.round(c.width)), height: Math.max(1, Math.round(c.height)) };
  if (api.edit([op])) api.ui.set((s) => ({ region: null, fitRequest: s.fitRequest + 1 }));
}

export function invertSelection(api: EditorApi): void {
  const doc = api.store.doc;
  if (!doc) return;
  api.ui.set((s) => ({ region: invertRegion(s.region, doc.canvas.width, doc.canvas.height) }));
}

export function featherSelection(api: EditorApi, radius: number): void {
  const doc = api.store.doc;
  const r = api.ui.get().region;
  if (!doc || !r || radius <= 0) return;
  api.ui.set({ region: featherRegion(r, radius, doc.canvas.width, doc.canvas.height) });
}

export function selectAll(api: EditorApi): void {
  const doc = api.store.doc;
  if (doc) api.ui.set({ region: { kind: "rect", x: 0, y: 0, width: doc.canvas.width, height: doc.canvas.height } });
}
