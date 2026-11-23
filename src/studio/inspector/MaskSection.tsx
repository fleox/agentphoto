// Mask of the selected layer: kind, enabled, invert, feather, density, shape
// geometry, delete; new masks from the marquee, a shape, a fade, or local AI
// (remove background / select subject).

import { Brush, Circle, Eye, EyeOff, ScanFace, Square, SquareDashed, SunDim, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { DEFAULT_MODELS, MODELS } from "../../core/catalog";
import { hasBox, isGradientMask, isImageMask, isShapeMask, type Layer, type Mask } from "../../core/types";
import { Button, IconButton, Row, Section, Select, Toggle } from "../components/ui/controls";
import { NumberField, SliderField } from "../components/ui/NumberField";
import { useI18n } from "../i18n";
import { regionMask } from "../actions/region";
import { useEditor, useUi } from "../state/context";
import { removeBackground, selectSubject } from "../tools/registry";
import { setTool } from "../state/shortcuts";

export function MaskSection({ layer }: { layer: Layer }) {
  const { t } = useI18n();
  const api = useEditor();
  const region = useUi((s) => s.region);
  const showMask = useUi((s) => s.showMask);
  const maskTarget = useUi((s) => s.maskTarget);
  const busy = useUi((s) => s.busy);
  const [model, setModel] = useState<string>(DEFAULT_MODELS["background-removal"]);
  const m = layer.mask ?? null;
  const setMask = (mask: Mask | null, final = true) => api.edit([{ op: "setMask", id: layer.id, mask }], final ? {} : { coalesce: `mask:${layer.id}` });
  const patch = (v: Record<string, unknown>, final = true) => m && setMask({ ...m, ...v } as Mask, final);
  const box = api.boxes.get(layer.id);
  const W = hasBox(layer) ? (box?.width ?? 100) : api.store.doc!.canvas.width;
  const H = hasBox(layer) ? (box?.height ?? 100) : api.store.doc!.canvas.height;
  const kind = m ? (isImageMask(m) ? "image" : isShapeMask(m) ? "shape" : "gradient") : null;
  const bgModels = MODELS.filter((x) => x.task === "background-removal");

  return (
    <Section
      title={t("mask.title")}
      id="mask"
      actions={
        m ? (
          <div className="flex">
            <IconButton label={showMask === layer.id ? t("mask.hidePreview") : t("mask.showPreview")} active={showMask === layer.id} onClick={() => api.ui.set({ showMask: showMask === layer.id ? null : layer.id })} className="h-6 w-6">
              {showMask === layer.id ? <EyeOff size={12} /> : <Eye size={12} />}
            </IconButton>
            <IconButton label={t("mask.delete")} onClick={() => setMask(null)} className="h-6 w-6 hover:text-danger">
              <Trash2 size={12} />
            </IconButton>
          </div>
        ) : undefined
      }
    >
      {m ? (
        <>
          <Row label={t("mask.kind")}>
            <span className="text-xs text-fg-muted">
              {t(`mask.kinds.${kind!}`)}
              {isImageMask(m) && <span className="ml-1 font-mono text-2xs text-fg-faint">{m.src.split("/").pop()}</span>}
            </span>
          </Row>
          <Row label={t("mask.enabled")}>
            <Toggle checked={m.enabled !== false} onChange={(v) => patch({ enabled: v ? undefined : false })} ariaLabel={t("mask.enabled")} />
            <span className="ml-3 text-xs text-fg-muted">{t("mask.invert")}</span>
            <Toggle checked={!!m.invert} onChange={(v) => patch({ invert: v || undefined })} ariaLabel={t("mask.invert")} />
          </Row>
          <Row label={t("mask.feather")}>
            <SliderField value={m.feather ?? 0} min={0} max={200} onChange={(v, final) => patch({ feather: v || undefined }, final)} ariaLabel={t("mask.feather")} />
          </Row>
          <Row label={t("mask.density")}>
            <SliderField value={Math.round((m.density ?? 1) * 100)} min={0} max={100} integer onChange={(v, final) => patch({ density: v >= 100 ? undefined : v / 100 }, final)} ariaLabel={t("mask.density")} />
          </Row>
          <div className="px-3 py-1">
            <Button size="xs" variant={maskTarget === layer.id ? "primary" : "subtle"} onClick={() => (api.ui.set({ maskTarget: layer.id }), setTool(api, "brush"))}>
              <Brush size={12} /> {t("mask.paint")}
            </Button>
          </div>
          {isShapeMask(m) && (
            <>
              <Row label={t("mask.shape")}>
                <Select value={m.shape} options={[{ value: "rect", label: t("shapes.rect") }, { value: "ellipse", label: t("shapes.ellipse") }]} onChange={(v) => patch({ shape: v })} ariaLabel={t("mask.shape")} />
              </Row>
              <Row label={t("props.position")}>
                <NumberField label="X" value={Math.round(m.x)} integer onChange={(v, final) => patch({ x: v }, final)} />
                <NumberField label="Y" value={Math.round(m.y)} integer onChange={(v, final) => patch({ y: v }, final)} />
              </Row>
              <Row label={t("props.size")}>
                <NumberField label="W" value={Math.round(m.width)} min={1} integer onChange={(v, final) => patch({ width: v }, final)} />
                <NumberField label="H" value={Math.round(m.height)} min={1} integer onChange={(v, final) => patch({ height: v }, final)} />
              </Row>
            </>
          )}
          {isGradientMask(m) && (
            <Row label={t("paint.angle")}>
              <SliderField value={m.gradient.type === "linear" ? (m.gradient.angle ?? 90) : 0} min={-180} max={180} integer onChange={(v, final) => m.gradient.type === "linear" && patch({ gradient: { ...m.gradient, angle: v } }, final)} ariaLabel={t("paint.angle")} />
            </Row>
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-1 px-3 pb-1">
          <Button size="xs" variant="subtle" disabled={!region} title={region ? undefined : t("mask.needMarquee")} onClick={() => region && void regionMask(api, layer, region).then((mask) => (setMask(mask), api.ui.set({ region: null })))}>
            <SquareDashed size={12} /> {t("mask.fromSelection")}
          </Button>
          <Button size="xs" variant="subtle" onClick={() => setMask({ shape: "ellipse", x: W * 0.15, y: H * 0.15, width: W * 0.7, height: H * 0.7, feather: Math.round(Math.min(W, H) / 20) })}>
            <Circle size={12} /> {t("mask.ellipse")}
          </Button>
          <Button size="xs" variant="subtle" onClick={() => setMask({ shape: "rect", x: W * 0.1, y: H * 0.1, width: W * 0.8, height: H * 0.8, radius: 0 })}>
            <Square size={12} /> {t("mask.rect")}
          </Button>
          <Button size="xs" variant="subtle" onClick={() => setMask({ gradient: { type: "linear", angle: 90, stops: ["#ffffff", "#000000"] } })}>
            <SunDim size={12} /> {t("mask.fade")}
          </Button>
        </div>
      )}
      {layer.type === "image" && (
        <div className="mx-3 mt-2 space-y-1.5 rounded-md border border-agent/20 bg-agent/[0.04] p-2">
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-agent/90">{t("mask.ai")}</div>
          <div className="flex gap-1">
            <Select value={model} options={bgModels.map((x) => ({ value: x.id, label: `${x.id} · ${x.sizeMb} MB` }))} onChange={setModel} ariaLabel={t("mask.model")} />
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Button size="xs" variant="subtle" disabled={!!busy} onClick={() => void removeBackground(api, layer.id, model)}>
              <Wand2 size={12} /> {t("ai.removeBg")}
            </Button>
            <Button size="xs" variant="subtle" disabled={!!busy} onClick={() => void selectSubject(api, layer.id, model)}>
              <ScanFace size={12} /> {t("ai.selectSubject")}
            </Button>
          </div>
          <p className="text-2xs leading-snug text-fg-faint">{t("mask.aiNote")}</p>
        </div>
      )}
    </Section>
  );
}
