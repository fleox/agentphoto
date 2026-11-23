// Properties of the selected layer: transform, type-specific fields (image,
// text, shape, fill, adjustment, group) and the mask section. Canvas settings
// when nothing is selected.

import clsx from "clsx";
import { AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, FlipHorizontal2, FlipVertical2, FoldVertical, ImageUp, Link2, Link2Off, Maximize, SlidersHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { fontDef, SHAPES } from "../../core/catalog";
import { imageInfo } from "../../core/imageInfo";
import type { ImageLayer, Layer, ShapeLayer, TextLayer } from "../../core/types";
import { hasBox } from "../../core/types";
import { Button, IconButton, Row, Section, Select, TextField, Toggle } from "../components/ui/controls";
import { NumberField, SliderField } from "../components/ui/NumberField";
import { ColorField } from "../components/ui/ColorPicker";
import { PaintField } from "../components/ui/PaintEditor";
import { useI18n, type MessageKey } from "../i18n";
import { layerLabel } from "../lib/layers";
import { useEditor, useSelectedLayer, useSnapshot } from "../state/context";
import { readFiles } from "../panels/Viewport";
import { CanvasSettings } from "./CanvasSettings";
import { FontPicker } from "./FontPicker";
import { MaskSection } from "./MaskSection";

export type SetFn = (v: Record<string, unknown>, final?: boolean) => void;

// updateLayer with drag coalescing (one undo step per gesture).
export function useLayerSet(layer: Layer | null): SetFn {
  const api = useEditor();
  return (v, final = true) => {
    if (!layer) return;
    api.edit([{ op: "updateLayer", id: layer.id, set: v }], final ? {} : { coalesce: `props:${layer.id}:${Object.keys(v).join(",")}` });
  };
}

export function Properties() {
  const { t } = useI18n();
  const layer = useSelectedLayer();
  const sel = useSnapshot().selection;
  if (!layer) return <CanvasSettings />;
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{layerLabel(layer)}</div>
          <div className="truncate text-2xs text-fg-faint">
            {t(`layerTypes.${layer.type}`)} · {layer.id}
            {sel.length > 1 && ` · ${t("props.multi", { n: sel.length })}`}
          </div>
        </div>
      </div>
      {hasBox(layer) && <TransformSection layer={layer} />}
      {layer.type === "image" && <ImageSection layer={layer} />}
      {layer.type === "text" && <TextSection layer={layer} />}
      {layer.type === "shape" && <ShapeSection layer={layer} />}
      {layer.type === "fill" && (
        <Section title={t("props.fill")} id="fill">
          <FillRow layer={layer} />
        </Section>
      )}
      {layer.type === "adjustment" && <AdjustmentInfo />}
      {layer.type === "group" && (
        <Section title={t("props.group")} id="group">
          <div className="px-3 text-xs text-fg-muted">{t("props.groupInfo", { n: layer.children?.length ?? 0 })}</div>
        </Section>
      )}
      <MaskSection layer={layer} />
    </div>
  );
}

function FillRow({ layer }: { layer: Extract<Layer, { type: "fill" }> }) {
  const { t } = useI18n();
  const set = useLayerSet(layer);
  return (
    <Row label={t("props.paint")}>
      <PaintField value={layer.fill} onChange={(p, final) => set({ fill: p ?? "#ffffff" }, final)} />
    </Row>
  );
}

function AdjustmentInfo() {
  const { t } = useI18n();
  const { ui } = useEditor();
  return (
    <Section title={t("props.adjustment")} id="adjustment">
      <div className="space-y-2 px-3 text-xs text-fg-muted">
        <p>{t("props.adjustmentInfo")}</p>
        <Button size="xs" onClick={() => ui.set({ rightTab: "filters" })}>
          <SlidersHorizontal size={12} /> {t("props.editFilters")}
        </Button>
      </div>
    </Section>
  );
}

function TransformSection({ layer }: { layer: ImageLayer | TextLayer | ShapeLayer }) {
  const { t } = useI18n();
  const api = useEditor();
  const set = useLayerSet(layer);
  const box = api.boxes.get(layer.id);
  const [lock, setLock] = useState(layer.type === "image");
  const w = layer.type === "text" ? (layer.width ?? box?.width ?? 0) : (layer.width ?? box?.width ?? 0);
  const h = layer.type === "text" ? (box?.height ?? 0) : (layer.height ?? box?.height ?? 0);
  const ratio = w && h ? w / h : 1;
  return (
    <Section title={t("props.transform")} id="transform">
      <Row label={t("props.position")}>
        <NumberField label="X" value={Math.round((layer.x ?? 0) * 10) / 10} onChange={(v, final) => set({ x: v }, final)} step={1} />
        <NumberField label="Y" value={Math.round((layer.y ?? 0) * 10) / 10} onChange={(v, final) => set({ y: v }, final)} step={1} />
      </Row>
      <Row label={t("props.size")}>
        <NumberField label="W" value={Math.round(w)} min={1} step={1} empty={layer.type === "text" && !layer.width} onChange={(v, final) => set(layer.type === "text" ? { width: v } : lock ? { width: v, height: Math.round(v / ratio) } : { width: v, height: Math.round(h) }, final)} />
        {layer.type !== "text" && <NumberField label="H" value={Math.round(h)} min={1} step={1} onChange={(v, final) => set(lock ? { height: v, width: Math.round(v * ratio) } : { height: v, width: Math.round(w) }, final)} />}
        {layer.type !== "text" && (
          <IconButton label={lock ? t("props.unlockRatio") : t("props.lockRatio")} active={lock} onClick={() => setLock((x) => !x)} className="h-6 w-6">
            {lock ? <Link2 size={12} /> : <Link2Off size={12} />}
          </IconButton>
        )}
      </Row>
      <Row label={t("props.rotation")}>
        <NumberField label="°" value={layer.rotation ?? 0} min={-360} max={360} step={1} onChange={(v, final) => set({ rotation: v || null }, final)} />
        <IconButton label={t("props.flipH")} active={!!layer.flipX} onClick={() => set({ flipX: layer.flipX ? null : true })} className="h-6 w-6">
          <FlipHorizontal2 size={13} />
        </IconButton>
        <IconButton label={t("props.flipV")} active={!!layer.flipY} onClick={() => set({ flipY: layer.flipY ? null : true })} className="h-6 w-6">
          <FlipVertical2 size={13} />
        </IconButton>
      </Row>
      <Row label={t("props.align")}>
        <div className="flex gap-0.5">
          {(
            [
              ["left", AlignLeft],
              ["hcenter", AlignCenter],
              ["right", AlignRight],
              ["top", ArrowUpToLine],
              ["vcenter", FoldVertical],
              ["bottom", ArrowDownToLine],
            ] as const
          ).map(([k, Icon]) => (
            <IconButton
              key={k}
              label={t(`props.alignTo.${k}`)}
              className="h-6 w-6"
              onClick={() => {
                const doc = api.store.doc!;
                const b = box ?? { x: layer.x ?? 0, y: layer.y ?? 0, width: w, height: h };
                const W = doc.canvas.width;
                const H = doc.canvas.height;
                const v = k === "left" ? { x: 0 } : k === "hcenter" ? { x: Math.round((W - b.width) / 2) } : k === "right" ? { x: Math.round(W - b.width) } : k === "top" ? { y: 0 } : k === "vcenter" ? { y: Math.round((H - b.height) / 2) } : { y: Math.round(H - b.height) };
                set(v);
              }}
            >
              <Icon size={13} />
            </IconButton>
          ))}
        </div>
      </Row>
    </Section>
  );
}

function ImageSection({ layer }: { layer: ImageLayer }) {
  const { t } = useI18n();
  const api = useEditor();
  const set = useLayerSet(layer);
  const input = useRef<HTMLInputElement>(null);
  const nat = api.naturalSize(layer.src);
  return (
    <Section title={t("props.image")} id="image">
      <Row label={t("props.source")}>
        <div className="min-w-0 flex-1 truncate font-mono text-2xs text-fg-muted" title={layer.src}>
          {layer.src.startsWith("library:") ? layer.src : layer.src.split("/").pop()}
        </div>
        <IconButton label={t("props.replace")} onClick={() => input.current?.click()} className="h-6 w-6">
          <ImageUp size={13} />
        </IconButton>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const [file] = await readFiles([f]);
            const info = imageInfo(file.bytes);
            if (!info) return;
            const path = await api.backend.addImage(file.name, file.bytes);
            set({ src: path, crop: null });
          }}
        />
      </Row>
      {nat && (
        <Row label={t("props.natural")}>
          <span className="text-xs tabular-nums text-fg-muted">
            {nat.width} × {nat.height}
          </span>
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => set({ width: nat.width, height: nat.height, crop: null })} title={t("props.naturalHint")}>
            <Maximize size={11} /> {t("props.reset")}
          </Button>
        </Row>
      )}
      <Row label={t("props.fit")}>
        <Select value={layer.fit ?? "fill"} options={["fill", "cover", "contain"].map((v) => ({ value: v, label: t(`props.fits.${v}` as MessageKey) }))} onChange={(v) => set({ fit: v === "fill" ? null : v })} ariaLabel={t("props.fit")} />
      </Row>
      {layer.fit && layer.fit !== "fill" && (
        <Row label={t("props.focus")}>
          <NumberField label="X" value={Math.round((layer.focus?.[0] ?? 0.5) * 100)} min={0} max={100} integer suffix="%" onChange={(v, final) => set({ focus: [v / 100, layer.focus?.[1] ?? 0.5] }, final)} />
          <NumberField label="Y" value={Math.round((layer.focus?.[1] ?? 0.5) * 100)} min={0} max={100} integer suffix="%" onChange={(v, final) => set({ focus: [layer.focus?.[0] ?? 0.5, v / 100] }, final)} />
        </Row>
      )}
      <Row label={t("props.crop")} overridden={!!layer.crop} onReset={() => set({ crop: null })}>
        {layer.crop ? (
          <div className="grid flex-1 grid-cols-2 gap-1">
            {(["x", "y", "width", "height"] as const).map((k) => (
              <NumberField key={k} label={k === "width" ? "W" : k === "height" ? "H" : k.toUpperCase()} value={Math.round(layer.crop![k])} min={k === "width" || k === "height" ? 1 : 0} integer onChange={(v, final) => set({ crop: { ...layer.crop!, [k]: v } }, final)} />
            ))}
          </div>
        ) : (
          <Button size="xs" variant="ghost" disabled={!nat} onClick={() => nat && set({ crop: { x: 0, y: 0, width: nat.width, height: nat.height } })}>
            {t("props.addCrop")}
          </Button>
        )}
      </Row>
    </Section>
  );
}

const TRANSFORMS = ["none", "uppercase", "lowercase"] as const;

function TextSection({ layer }: { layer: TextLayer }) {
  const { t } = useI18n();
  const set = useLayerSet(layer);
  const def = fontDef(layer.font ?? "inter");
  const weights = def?.weights ?? [100, 200, 300, 400, 500, 600, 700, 800, 900];
  const bg = layer.background;
  return (
    <Section title={t("props.text")} id="text">
      <div className="px-3 pb-1.5">
        <TextField value={layer.text} onCommit={(v) => set({ text: v })} multiline ariaLabel={t("props.textContent")} />
      </div>
      <Row label={t("props.font")}>
        <FontPicker value={layer.font ?? "inter"} onChange={(id) => {
          const d = fontDef(id);
          const w = layer.weight ?? 400;
          set({ font: id, ...(d && !d.weights.includes(w) ? { weight: d.weights.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a)) } : {}) });
        }} />
      </Row>
      <Row label={t("props.weight")}>
        <Select value={String(layer.weight ?? 400)} options={weights.map((w) => ({ value: String(w), label: t(`weights.w${w}` as MessageKey) }))} onChange={(v) => set({ weight: Number(v) })} ariaLabel={t("props.weight")} />
        <IconButton label={t("props.italic")} active={!!layer.italic} onClick={() => set({ italic: layer.italic ? null : true })} className="h-6 w-6 font-serif italic">
          I
        </IconButton>
      </Row>
      <Row label={t("props.size")}>
        <SliderField value={layer.size ?? 64} min={6} max={600} integer onChange={(v, final) => set({ size: v }, final)} ariaLabel={t("props.size")} />
      </Row>
      <Row label={t("props.color")}>
        <PaintField value={layer.color ?? "#ffffff"} onChange={(p, final) => set({ color: p ?? "#ffffff" }, final)} />
      </Row>
      <Row label={t("props.alignText")}>
        <div className="flex rounded-md bg-ink-2 p-0.5">
          {(["left", "center", "right"] as const).map((a) => {
            const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
            return (
              <button key={a} type="button" aria-label={t(`props.aligns.${a}`)} title={t(`props.aligns.${a}`)} onClick={() => set({ align: a === "left" ? null : a })} className={clsx("flex h-5 w-7 items-center justify-center rounded", (layer.align ?? "left") === a ? "bg-ink-4 text-fg" : "text-fg-muted hover:text-fg")}>
                <Icon size={12} />
              </button>
            );
          })}
        </div>
        <Select value={layer.valign ?? "top"} options={["top", "middle", "bottom"].map((v) => ({ value: v, label: t(`props.valigns.${v}` as MessageKey) }))} onChange={(v) => set({ valign: v === "top" ? null : v })} ariaLabel={t("props.valign")} />
      </Row>
      <Row label={t("props.lineHeight")}>
        <SliderField value={layer.lineHeight ?? 1.2} min={0.6} max={3} step={0.05} onChange={(v, final) => set({ lineHeight: v }, final)} ariaLabel={t("props.lineHeight")} />
      </Row>
      <Row label={t("props.letterSpacing")}>
        <SliderField value={layer.letterSpacing ?? 0} min={-20} max={100} step={0.5} onChange={(v, final) => set({ letterSpacing: v || null }, final)} ariaLabel={t("props.letterSpacing")} />
      </Row>
      <Row label={t("props.case")}>
        <Select value={layer.transform ?? "none"} options={TRANSFORMS.map((v) => ({ value: v, label: t(`props.cases.${v}`) }))} onChange={(v) => set({ transform: v === "none" ? null : v })} ariaLabel={t("props.case")} />
      </Row>
      <Row label={t("props.wrap")} overridden={!!layer.width} onReset={() => set({ width: null })}>
        <NumberField label="W" value={layer.width ?? 0} empty={!layer.width} min={8} integer onChange={(v, final) => set({ width: v }, final)} ariaLabel={t("props.wrap")} />
      </Row>
      <Row label={t("props.textBox")}>
        <Toggle checked={!!bg} onChange={(v) => set({ background: v ? { color: "#000000b3", padding: [16, 28], radius: 12 } : null })} ariaLabel={t("props.textBox")} />
        {bg && <ColorField value={bg.color} compact onChange={(c, final) => set({ background: { ...bg, color: c } }, final)} />}
        {bg && <NumberField label="P" value={Array.isArray(bg.padding) ? bg.padding[0] : (bg.padding ?? 0)} min={0} integer onChange={(v, final) => set({ background: { ...bg, padding: Array.isArray(bg.padding) ? [v, Math.round(v * 1.75)] : v } }, final)} ariaLabel={t("props.padding")} />}
        {bg && <NumberField label="R" value={bg.radius ?? 0} min={0} integer onChange={(v, final) => set({ background: { ...bg, radius: v } }, final)} ariaLabel={t("props.radius")} />}
      </Row>
    </Section>
  );
}

function ShapeSection({ layer }: { layer: ShapeLayer }) {
  const { t } = useI18n();
  const set = useLayerSet(layer);
  const stroke = layer.stroke;
  return (
    <Section title={t("props.shape")} id="shape">
      <Row label={t("props.shapeKind")}>
        <Select value={layer.shape} options={SHAPES.map((s) => ({ value: s, label: t(`shapes.${s}`) }))} onChange={(v) => set({ shape: v })} ariaLabel={t("props.shapeKind")} />
      </Row>
      <Row label={t("props.fill")}>
        <PaintField value={layer.fill ?? null} allowNone onChange={(p, final) => set({ fill: p }, final)} />
      </Row>
      <Row label={t("props.stroke")}>
        <Toggle checked={!!stroke} onChange={(v) => set({ stroke: v ? { color: "#ffffff", width: 4 } : null })} ariaLabel={t("props.stroke")} />
        {stroke && <ColorField value={stroke.color} compact onChange={(c, final) => set({ stroke: { ...stroke, color: c } }, final)} />}
        {stroke && <NumberField label="W" value={stroke.width ?? 4} min={0} max={500} onChange={(v, final) => set({ stroke: { ...stroke, width: v } }, final)} ariaLabel={t("props.strokeWidth")} />}
        {stroke && <Toggle checked={!!stroke.dash?.length} onChange={(v) => set({ stroke: { ...stroke, dash: v ? [12, 8] : null } })} ariaLabel={t("props.dashed")} />}
      </Row>
      {layer.shape === "rect" && (
        <Row label={t("props.radius")}>
          <SliderField value={layer.radius ?? 0} min={0} max={Math.round(Math.min(layer.width ?? 100, layer.height ?? 100) / 2)} integer onChange={(v, final) => set({ radius: v || null }, final)} ariaLabel={t("props.radius")} />
        </Row>
      )}
      {(layer.shape === "polygon" || layer.shape === "star") && (
        <Row label={layer.shape === "star" ? t("props.points") : t("props.sides")}>
          <SliderField value={layer.sides ?? (layer.shape === "star" ? 5 : 6)} min={3} max={24} integer onChange={(v, final) => set({ sides: v }, final)} ariaLabel={t("props.sides")} />
        </Row>
      )}
      {layer.shape === "star" && (
        <Row label={t("props.innerRadius")}>
          <SliderField value={layer.innerRadius ?? 0.5} min={0.05} max={0.95} step={0.01} onChange={(v, final) => set({ innerRadius: v }, final)} ariaLabel={t("props.innerRadius")} />
        </Row>
      )}
    </Section>
  );
}
