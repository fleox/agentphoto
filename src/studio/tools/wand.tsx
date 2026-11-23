// Magic wand (W): selects similar colours on the selected layer as rendered
// (or on the whole picture) — contiguous flood fill or global colour range,
// with a tolerance. Quick AI select (Q): click points on a photo layer (Alt =
// exclude) and Segment Anything proposes the object, shown as a tint until
// applied. Both run in the page (in CLI mode the models come through the
// CLI's local model cache). Shift adds, Alt subtracts (wand).

import { Check, MousePointerClick, RotateCcw, Wand2 } from "lucide-react";
import { DEFAULT_MODELS } from "../../core/catalog";
import type { Layer } from "../../core/types";
import { readPixels } from "../../engine";
import { findLayer } from "../../ops/tree";
import { Button, Toggle } from "../components/ui/controls";
import { SliderField } from "../components/ui/NumberField";
import { toast } from "../components/ui/Toast";
import { t, useI18n } from "../i18n";
import { hitTest } from "../lib/hit";
import { combine, emptyRaster, layerPlaneToRegion, modeFromKeys, wandSelect } from "../lib/region";
import { rotate } from "../lib/transform";
import { decodePlane, sideEngine } from "../render/sideEngine";
import { useEditor, useUi, type EditorApi } from "../state/context";
import { frameOf } from "../actions/region";
import { commitRegion } from "./marquee";
import { RegionBar } from "./regionBar";
import type { ToolDef } from "./types";

export const wandTool: ToolDef = {
  id: "wand",
  icon: Wand2,
  label: "tools.wand",
  shortcut: "W",
  group: "select",
  cursor: () => "crosshair",
  down(ctx, p) {
    const { api } = ctx;
    const doc = api.store.doc!;
    const { tolerance, contiguous, sampleAll } = api.ui.get().wand;
    const mode = modeFromKeys(p.shift, p.alt);
    const layer = !sampleAll && api.store.primary ? api.store.primary : null;
    const grid = emptyRaster(doc.canvas.width, doc.canvas.height);
    void (async () => {
      const c = await sideEngine(api).render(doc, { scale: grid.scale, ...(layer ? { only: new Set([layer]), background: false } : {}) });
      const px = readPixels(c);
      const data = wandSelect(px.data, px.width, px.height, Math.floor(p.doc.x * grid.scale), Math.floor(p.doc.y * grid.scale), tolerance, contiguous);
      const raster = { w: px.width, h: px.height, scale: grid.scale, data: new Uint8Array(data) };
      commitRegion(ctx, { kind: "raster", raster }, mode);
    })().catch((e) => toast({ tone: "error", title: t("region.failed"), detail: (e as Error).message }));
    return null;
  },
  key(ctx, e) {
    if (e.key === "Escape" && ctx.api.ui.get().region) {
      ctx.api.ui.set({ region: null });
      return true;
    }
    return false;
  },
  Options: WandOptions,
};

function WandOptions() {
  const { t } = useI18n();
  const api = useEditor();
  const wand = useUi((s) => s.wand);
  const region = useUi((s) => s.region);
  const set = (v: Partial<typeof wand>) => api.ui.set((s) => ({ wand: { ...s.wand, ...v } }));
  return (
    <div className="flex items-center gap-2 text-xs text-fg-muted">
      <span>{t("wand.tolerance")}</span>
      <div className="w-[150px]">
        <SliderField value={wand.tolerance} min={0} max={100} integer onChange={(v) => set({ tolerance: v })} ariaLabel={t("wand.tolerance")} />
      </div>
      <Toggle checked={wand.contiguous} onChange={(v) => set({ contiguous: v })} ariaLabel={t("wand.contiguous")} />
      <span>{t("wand.contiguous")}</span>
      <Toggle checked={wand.sampleAll} onChange={(v) => set({ sampleAll: v })} ariaLabel={t("wand.sampleAll")} />
      <span>{t("wand.sampleAll")}</span>
      <div className="ml-2">{region ? <RegionBar /> : <span className="text-fg-faint">{t("wand.hint")}</span>}</div>
    </div>
  );
}

// ─── quick AI select ─────────────────────────────────────────────────────

const SAM = DEFAULT_MODELS.segmentation;

async function runQuick(api: EditorApi, layerId: string, points: [number, number, number][]): Promise<void> {
  const doc = api.store.doc!;
  const loc = findLayer(doc.layers, layerId);
  if (!loc) return;
  api.ui.set((s) => ({ quick: { layer: layerId, points, region: s.quick?.layer === layerId ? s.quick.region : null, busy: true }, busy: { label: t("quick.running") } }));
  try {
    const png = await sideEngine(api).segmentMask(doc, layerId, { points }, { model: SAM });
    const plane = await decodePlane(png.bytes);
    const frame = frameOf(api, loc.layer)!;
    const region = layerPlaneToRegion(plane.data, plane.w, plane.h, frame, doc.canvas.width, doc.canvas.height);
    api.ui.set((s) => (s.quick?.layer === layerId && s.quick.points === points ? { quick: { ...s.quick, region, busy: false } } : {}));
  } catch (e) {
    api.ui.set((s) => ({ quick: s.quick ? { ...s.quick, busy: false } : null }));
    toast({ tone: "error", title: t("quick.failed"), detail: (e as Error).message }, 8000);
  } finally {
    api.ui.set({ busy: null });
  }
}

export function applyQuick(api: EditorApi): void {
  const q = api.ui.get().quick;
  const doc = api.store.doc;
  if (!q?.region || !doc) return;
  api.ui.set((s) => ({ region: combine(s.region, q.region!, "replace", doc.canvas.width, doc.canvas.height), quick: null }));
}

export const quickTool: ToolDef = {
  id: "quick",
  icon: MousePointerClick,
  label: "tools.quick",
  shortcut: "Q",
  group: "select",
  cursor: () => "crosshair",
  deactivate(api) {
    api.ui.set({ quick: null });
  },
  down(ctx, p) {
    const { api } = ctx;
    const doc = api.store.doc!;
    if (api.ui.get().quick?.busy) return null;
    // The selected photo layer, else the topmost one under the click.
    let layer: Layer | null = api.store.primary ? (findLayer(doc.layers, api.store.primary)?.layer ?? null) : null;
    if (layer?.type !== "image") {
      const hit = hitTest(doc.layers, api.boxes.getSnapshot(), p.doc);
      layer = hit ? (findLayer(doc.layers, hit)?.layer ?? null) : null;
      if (layer?.type !== "image") {
        toast({ tone: "info", title: t("quick.needImage") });
        return null;
      }
      api.store.select(layer.id);
    }
    const frame = frameOf(api, layer)!;
    // Document point → layer px (unrotated, relative to the box's top-left).
    const c = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
    const l = rotate({ x: p.doc.x - c.x, y: p.doc.y - c.y }, -frame.rotation);
    const pt: [number, number, number] = [(frame.flipX ? -l.x : l.x) + frame.width / 2, (frame.flipY ? -l.y : l.y) + frame.height / 2, p.alt ? 0 : 1];
    const q = api.ui.get().quick;
    const points = q && q.layer === layer.id ? [...q.points, pt] : [pt];
    const id = layer.id;
    void api.ensureModel(SAM).then((ok) => (ok ? runQuick(api, id, points) : undefined));
    return null;
  },
  key(ctx, e) {
    const q = ctx.api.ui.get().quick;
    if (q && e.key === "Enter") {
      applyQuick(ctx.api);
      return true;
    }
    if (e.key === "Escape" && (q || ctx.api.ui.get().region)) {
      ctx.api.ui.set(q ? { quick: null } : { region: null });
      return true;
    }
    return false;
  },
  Options: QuickOptions,
};

function QuickOptions() {
  const { t } = useI18n();
  const api = useEditor();
  const q = useUi((s) => s.quick);
  const region = useUi((s) => s.region);
  return (
    <div className="flex items-center gap-1.5 text-xs text-fg-muted">
      {q ? (
        <>
          <span className="tabular-nums">{t("quick.points", { n: q.points.length })}</span>
          <Button size="xs" variant="primary" disabled={!q.region || q.busy} onClick={() => applyQuick(api)}>
            <Check size={13} /> {t("quick.apply")}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => api.ui.set({ quick: null })}>
            <RotateCcw size={13} /> {t("quick.reset")}
          </Button>
        </>
      ) : region ? (
        <RegionBar />
      ) : null}
      <span className="ml-2 text-fg-faint">{t("quick.hint")}</span>
    </div>
  );
}
