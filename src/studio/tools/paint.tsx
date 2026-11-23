// Painting tools: brush (B), eraser (E), clone stamp (S, Alt-click sets the
// source). Non-destructive: a stroke paints on the layer's pixels in layer
// space (at source resolution, ≤ 4096 px), live in an overlay; on release a
// NEW PNG is written to assets/edits/ and the layer points to it (one
// undoable doc_patch — undo restores the previous file, files are never
// deleted). Text / shape / fill layers get a new "Paint" image layer above.
// With the mask targeted (click the mask chip), the brush paints the mask
// (hide / reveal) into a new assets/masks/ PNG. The pixel selection clips.

import clsx from "clsx";
import { Brush, Eraser, Stamp } from "lucide-react";
import type { Layer } from "../../core/types";
import { encode, type AnyCanvas } from "../../engine";
import { findLayer } from "../../ops/tree";
import { NumberField, SliderField } from "../components/ui/NumberField";
import { toast } from "../components/ui/Toast";
import { t, useI18n } from "../i18n";
import { newId } from "../lib/layers";
import { regionInLayer, type LayerFrame } from "../lib/region";
import { rotate } from "../lib/transform";
import { freePath, frameOf, planeSize } from "../actions/region";
import { maskPlane, planeToCanvas } from "../render/masks";
import { maskTint, Painter, type PaintMode } from "../render/painter";
import { sideEngine } from "../render/sideEngine";
import { useEditor, useSelectedLayer, useUi, type EditorApi } from "../state/context";
import type { DragSession, PointerInfo, Pt, ToolCtx, ToolDef, ToolId } from "./types";

const MAX_EDIT = 4096;

// Rasters already known for (layer, source) — the next stroke starts from them without re-rendering.
const rasterCache = new Map<string, AnyCanvas>();
const remember = (key: string, c: AnyCanvas) => {
  rasterCache.delete(key);
  rasterCache.set(key, c);
  // Keep a few (large) rasters only.
  while (rasterCache.size > 6) rasterCache.delete(rasterCache.keys().next().value as string);
};
// Clone stamp: offset source − stroke start (aligned), set by the first stroke after Alt-click.
let cloneOffset: Pt | null = null;

interface Target {
  kind: "pixels" | "mask" | "new";
  layer: Layer | null;
  frame: LayerFrame;
  base: AnyCanvas;
}

const canvasFrame = (api: EditorApi): LayerFrame => ({ x: 0, y: 0, width: api.store.doc!.canvas.width, height: api.store.doc!.canvas.height, rotation: 0 });

export function paintTarget(api: EditorApi): { kind: Target["kind"]; layer: Layer | null } {
  const doc = api.store.doc!;
  const layer = api.store.primary ? (findLayer(doc.layers, api.store.primary)?.layer ?? null) : null;
  if (layer && api.ui.get().maskTarget === layer.id) return { kind: "mask", layer };
  if (layer?.type === "image" && !layer.locked) return { kind: "pixels", layer };
  return { kind: "new", layer };
}

async function prepare(api: EditorApi): Promise<Target> {
  const doc = api.store.doc!;
  const { kind, layer } = paintTarget(api);
  if (kind === "mask" && layer) {
    const frame = frameOf(api, layer) ?? canvasFrame(api);
    const key = `${layer.id}|mask|${JSON.stringify(layer.mask ?? null)}`;
    let base = rasterCache.get(key);
    if (!base) {
      const { w, h } = planeSize(frame.width, frame.height);
      base = planeToCanvas(await maskPlane(api.engine.loader, layer.mask ?? null, w, h, frame.width, frame.height), w, h);
      remember(key, base);
    }
    return { kind, layer, frame, base };
  }
  if (kind === "pixels" && layer?.type === "image") {
    const frame = frameOf(api, layer)!;
    const key = `${layer.id}|${layer.src}|${JSON.stringify(layer.crop ?? null)}|${layer.fit ?? ""}|${frame.width}x${frame.height}`;
    let base = rasterCache.get(key);
    if (!base) {
      base = await sideEngine(api).layerPixels(doc, layer.id, { maxSide: MAX_EDIT, withFilters: false });
      remember(key, base);
    }
    return { kind, layer, frame, base };
  }
  const frame = canvasFrame(api);
  const { w, h } = planeSize(frame.width, frame.height, MAX_EDIT);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { kind: "new", layer, frame, base: c };
}

// Document point → raster px of the target.
function toRaster(target: Target, p: Pt): Pt {
  const f = target.frame;
  const l = rotate({ x: p.x - (f.x + f.width / 2), y: p.y - (f.y + f.height / 2) }, -f.rotation);
  const lx = f.flipX ? -l.x : l.x;
  const ly = f.flipY ? -l.y : l.y;
  return { x: (lx / f.width + 0.5) * target.base.width, y: (ly / f.height + 0.5) * target.base.height };
}

async function commit(api: EditorApi, target: Target, painted: HTMLCanvasElement): Promise<void> {
  const doc = api.store.doc!;
  const png = await encode(painted, "image/png");
  if (target.kind === "mask" && target.layer) {
    const path = await freePath(api, "assets/masks", `${target.layer.id}-paint`);
    await api.backend.writeFile(path, png.bytes);
    const cur = target.layer.mask;
    const mask = { src: path, ...(cur?.feather ? { feather: cur.feather } : {}), ...(cur?.density !== undefined ? { density: cur.density } : {}), ...(cur?.enabled === false ? { enabled: false } : {}) };
    remember(`${target.layer.id}|mask|${JSON.stringify(mask)}`, painted);
    api.edit([{ op: "setMask", id: target.layer.id, mask }]);
    return;
  }
  if (target.kind === "pixels" && target.layer?.type === "image") {
    const l = target.layer;
    const path = await freePath(api, "assets/edits", l.id);
    await api.backend.writeFile(path, png.bytes);
    const f = target.frame;
    remember(`${l.id}|${path}|null||${f.width}x${f.height}`, painted);
    api.edit([{ op: "updateLayer", id: l.id, set: { src: path, crop: null, fit: null, focus: null, width: f.width, height: f.height } }]);
    return;
  }
  const id = newId(doc, "paint");
  const path = await freePath(api, "assets/edits", id);
  await api.backend.writeFile(path, png.bytes);
  const f = target.frame;
  remember(`${id}|${path}|null||${f.width}x${f.height}`, painted);
  const layer: Layer = { id, type: "image", name: t("brush.layerName"), src: path, x: 0, y: 0, width: f.width, height: f.height };
  api.edit([{ op: "addLayer", layer, ...(target.layer ? { above: target.layer.id } : {}) }], { select: id });
}

function strokeSession(ctx: ToolCtx, p: PointerInfo, tool: ToolId): DragSession | null {
  const { api } = ctx;
  const ui = api.ui.get();
  if (tool === "clone") {
    if (p.alt) {
      api.ui.set({ cloneSource: p.doc });
      cloneOffset = null;
      toast({ tone: "info", title: t("brush.sourceSet") }, 1600);
      return null;
    }
    if (!ui.cloneSource) {
      toast({ tone: "info", title: t("brush.needSource") });
      return null;
    }
    if (!cloneOffset) cloneOffset = { x: ui.cloneSource.x - p.doc.x, y: ui.cloneSource.y - p.doc.y };
  }
  const pending: Pt[] = [p.doc];
  let painter: Painter | null = null;
  let target: Target | null = null;
  let tint: HTMLCanvasElement | null = null;
  let raf = 0;
  let ended = false;
  let failed = false;
  const flush = () => {
    raf = 0;
    if (!painter || !target) return;
    const r = painter.flush();
    if (r && tint) maskTint(painter.display, tint, r);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(flush);
  };
  const ready = prepare(api)
    .then((tg) => {
      target = tg;
      const z = tg.base.width / tg.frame.width;
      const brush = { radius: (ui.brush.size / 2) * z, hardness: ui.brush.hardness, opacity: ui.brush.opacity, flow: ui.brush.flow };
      const reveal = ui.maskPaint === "reveal";
      const mode: PaintMode = tg.kind === "mask" ? (tool === "clone" ? "clone" : "paint") : tool === "eraser" ? "erase" : tool === "clone" ? "clone" : "paint";
      const color = tg.kind === "mask" ? ((tool === "eraser" ? !reveal : reveal) ? "#ffffff" : "#000000") : ui.fg;
      const region = api.ui.get().region;
      const clip = region ? regionInLayer(region, tg.base.width, tg.base.height, tg.kind === "new" ? null : tg.frame, api.store.doc!.canvas) : null;
      const off = cloneOffset ? { dx: cloneOffset.x * z, dy: cloneOffset.y * z } : undefined;
      painter = new Painter(tg.base, mode, brush, color, clip, off);
      if (tg.kind === "mask") {
        tint = document.createElement("canvas");
        maskTint(painter.display, tint);
      }
      ctx.setOverlay({ canvas: tint ?? painter.display, frame: tg.frame, hide: tg.kind === "pixels" ? tg.layer!.id : undefined });
      for (const q of pending) painter.lineTo(toRaster(tg, q).x, toRaster(tg, q).y);
      pending.length = 0;
      schedule();
    })
    .catch((e) => {
      failed = true;
      toast({ tone: "error", title: t("brush.failed"), detail: (e as Error).message });
    });
  return {
    cursor: "none",
    move(q) {
      if (painter && target) {
        const r = toRaster(target, q.doc);
        painter.lineTo(r.x, r.y);
        schedule();
      } else pending.push(q.doc);
    },
    up() {
      if (ended) return;
      ended = true;
      void (async () => {
        await ready;
        if (failed || !painter || !target) return ctx.setOverlay(null);
        if (raf) cancelAnimationFrame(raf);
        flush();
        try {
          await commit(api, target, painter.display);
          await ctx.nextFrame();
        } catch (e) {
          toast({ tone: "error", title: t("brush.failed"), detail: (e as Error).message });
        } finally {
          ctx.setOverlay(null);
        }
      })();
    },
    cancel() {
      ended = true;
      ctx.setOverlay(null);
    },
  };
}

const paintDef = (id: "brush" | "eraser" | "clone", icon: ToolDef["icon"], shortcut: string): ToolDef => ({
  id,
  icon,
  label: `tools.${id}`,
  shortcut,
  group: "paint",
  cursor: () => "none",
  down: (ctx, p) => strokeSession(ctx, p, id),
  Options: PaintOptions,
});

export const brushTool = paintDef("brush", Brush, "B");
export const eraserTool = paintDef("eraser", Eraser, "E");
export const cloneTool = paintDef("clone", Stamp, "S");
export const PAINT_TOOLS = new Set<ToolId>(["brush", "eraser", "clone"]);

export function resetClone(): void {
  cloneOffset = null;
}

function PaintOptions() {
  const { t } = useI18n();
  const api = useEditor();
  const brush = useUi((s) => s.brush);
  const tool = useUi((s) => s.tool);
  const maskTarget = useUi((s) => s.maskTarget);
  const maskPaint = useUi((s) => s.maskPaint);
  const region = useUi((s) => s.region);
  useSelectedLayer();
  const target = paintTarget(api);
  const set = (v: Partial<typeof brush>) => api.ui.set((s) => ({ brush: { ...s.brush, ...v } }));
  return (
    <div className="flex items-center gap-2 text-xs text-fg-muted">
      <span>{t("brush.size")}</span>
      <div className="w-[64px]">
        <NumberField value={brush.size} min={1} max={2000} integer suffix="px" onChange={(v) => set({ size: v })} ariaLabel={t("brush.size")} />
      </div>
      <span>{t("brush.hardness")}</span>
      <div className="w-[110px]">
        <SliderField value={Math.round(brush.hardness * 100)} min={0} max={100} integer onChange={(v) => set({ hardness: v / 100 })} ariaLabel={t("brush.hardness")} />
      </div>
      <span>{t("brush.opacity")}</span>
      <div className="w-[110px]">
        <SliderField value={Math.round(brush.opacity * 100)} min={1} max={100} integer onChange={(v) => set({ opacity: v / 100 })} ariaLabel={t("brush.opacity")} />
      </div>
      <span>{t("brush.flow")}</span>
      <div className="w-[110px]">
        <SliderField value={Math.round(brush.flow * 100)} min={1} max={100} integer onChange={(v) => set({ flow: v / 100 })} ariaLabel={t("brush.flow")} />
      </div>
      <div className="mx-1 h-4 w-px bg-line" />
      {maskTarget && target.kind === "mask" ? (
        <div className="flex items-center gap-1">
          <span className="rounded bg-danger/15 px-1.5 py-0.5 text-2xs font-semibold uppercase text-danger">{t("brush.maskMode")}</span>
          <div className="flex rounded-md bg-ink-2 p-0.5">
            {(["hide", "reveal"] as const).map((k) => (
              <button key={k} type="button" onClick={() => api.ui.set({ maskPaint: k })} className={clsx("h-6 rounded px-2", maskPaint === k ? "bg-ink-4 text-fg" : "text-fg-muted hover:text-fg")}>
                {t(`brush.${k}`)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => api.ui.set({ maskTarget: null })} className="ml-1 text-accent hover:underline">
            {t("brush.paintPixels")}
          </button>
        </div>
      ) : (
        <span className="text-fg-faint">{tool === "clone" ? t("brush.cloneHint") : target.kind === "new" ? t("brush.newLayerHint") : t("brush.hint")}</span>
      )}
      {region && <span className="text-2xs text-accent">{t("brush.clipped")}</span>}
    </div>
  );
}
