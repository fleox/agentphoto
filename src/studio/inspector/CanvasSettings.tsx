// Canvas settings (nothing selected): size with presets + anchor (resize the
// canvas), background, title / description, rotate / flip / resize the image.

import clsx from "clsx";
import { FlipHorizontal2, FlipVertical2, Link2, Link2Off, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { SIZE_PRESETS } from "../../core/catalog";
import { ANCHORS, type Anchor } from "../../ops/geometry";
import { Button, IconButton, Row, Section, Select, TextField } from "../components/ui/controls";
import { NumberField } from "../components/ui/NumberField";
import { PaintField } from "../components/ui/PaintEditor";
import { useI18n } from "../i18n";
import { sizeTitle } from "../lib/labels";
import { useDoc, useEditor } from "../state/context";

export function CanvasSettings() {
  const { t } = useI18n();
  const api = useEditor();
  const doc = useDoc();
  const { width: W, height: H } = doc.canvas;
  const [size, setSize] = useState({ w: W, h: H });
  const [anchor, setAnchor] = useState<Anchor>("center");
  const [img, setImg] = useState({ w: W, h: H });
  const [lock, setLock] = useState(true);
  useEffect(() => {
    setSize({ w: W, h: H });
    setImg({ w: W, h: H });
  }, [W, H]);
  const preset = SIZE_PRESETS.find((p) => p.width === size.w && p.height === size.h)?.id ?? "";
  const refit = () => api.ui.set((s) => ({ fitRequest: s.fitRequest + 1 }));

  return (
    <div>
      <div className="border-b border-line px-3 py-2">
        <div className="text-sm font-semibold">{t("canvas.title")}</div>
        <div className="text-2xs text-fg-faint">{t("canvas.subtitle")}</div>
      </div>
      <Section title={t("canvas.size")} id="canvas-size">
        <Row label={t("canvas.preset")}>
          <Select value={preset} placeholder={t("canvas.custom")} options={SIZE_PRESETS.map((p) => ({ value: p.id, label: `${sizeTitle(p.id)} · ${p.width}×${p.height}` }))} onChange={(id) => {
            const p = SIZE_PRESETS.find((x) => x.id === id);
            if (p) setSize({ w: p.width, h: p.height });
          }} ariaLabel={t("canvas.preset")} />
        </Row>
        <Row label={t("props.size")}>
          <NumberField label="W" value={size.w} min={1} max={16384} integer onChange={(v) => setSize((s) => ({ ...s, w: v }))} />
          <NumberField label="H" value={size.h} min={1} max={16384} integer onChange={(v) => setSize((s) => ({ ...s, h: v }))} />
        </Row>
        <Row label={t("canvas.anchor")} align="start">
          <div className="grid grid-cols-3 gap-0.5 rounded-md bg-ink-2 p-0.5">
            {ANCHORS.map((a) => (
              <button key={a} type="button" aria-label={t(`anchors.${a}`)} title={t(`anchors.${a}`)} onClick={() => setAnchor(a)} className={clsx("flex h-5 w-6 items-center justify-center rounded-[3px]", anchor === a ? "bg-accent/80" : "hover:bg-ink-4")}>
                <span className={clsx("h-1.5 w-1.5 rounded-full", anchor === a ? "bg-ink-0" : "bg-fg-faint")} />
              </button>
            ))}
          </div>
          <Button size="xs" variant="primary" className="ml-auto self-end" disabled={size.w === W && size.h === H} onClick={() => api.edit([{ op: "resizeCanvas", width: size.w, height: size.h, anchor }]) && refit()}>
            {t("canvas.apply")}
          </Button>
        </Row>
      </Section>
      <Section title={t("canvas.background")} id="canvas-bg">
        <Row label={t("props.paint")}>
          <PaintField value={doc.canvas.background ?? null} allowNone onChange={(p, final) => api.edit([{ op: "set", path: "canvas.background", value: p }], final ? {} : { coalesce: "canvas-bg" })} />
        </Row>
      </Section>
      <Section title={t("canvas.image")} id="canvas-image">
        <Row label={t("canvas.transform")}>
          <div className="flex gap-0.5">
            <IconButton label={t("canvas.rotateLeft")} className="h-6 w-6" onClick={() => api.edit([{ op: "rotateCanvas", angle: -90 }]) && refit()}>
              <RotateCcw size={13} />
            </IconButton>
            <IconButton label={t("canvas.rotateRight")} className="h-6 w-6" onClick={() => api.edit([{ op: "rotateCanvas", angle: 90 }]) && refit()}>
              <RotateCw size={13} />
            </IconButton>
            <IconButton label={t("canvas.flipH")} className="h-6 w-6" onClick={() => api.edit([{ op: "flipCanvas", axis: "horizontal" }])}>
              <FlipHorizontal2 size={13} />
            </IconButton>
            <IconButton label={t("canvas.flipV")} className="h-6 w-6" onClick={() => api.edit([{ op: "flipCanvas", axis: "vertical" }])}>
              <FlipVertical2 size={13} />
            </IconButton>
          </div>
        </Row>
        <Row label={t("canvas.resizeImage")}>
          <NumberField label="W" value={img.w} min={1} max={16384} integer onChange={(v) => setImg({ w: v, h: lock ? Math.round((v * H) / W) : img.h })} />
          <NumberField label="H" value={img.h} min={1} max={16384} integer onChange={(v) => setImg({ h: v, w: lock ? Math.round((v * W) / H) : img.w })} />
          <IconButton label={lock ? t("props.unlockRatio") : t("props.lockRatio")} active={lock} onClick={() => setLock((x) => !x)} className="h-6 w-6">
            {lock ? <Link2 size={12} /> : <Link2Off size={12} />}
          </IconButton>
        </Row>
        <div className="flex justify-end px-3 pb-1">
          <Button size="xs" variant="subtle" disabled={img.w === W && img.h === H} onClick={() => api.edit([{ op: "resizeImage", width: img.w, height: img.h }]) && refit()}>
            {t("canvas.resample")}
          </Button>
        </div>
      </Section>
      <Section title={t("canvas.document")} id="canvas-doc">
        <Row label={t("canvas.docTitle")}>
          <TextField value={doc.title ?? ""} onCommit={(v) => api.edit([v.trim() ? { op: "set", path: "title", value: v.trim() } : { op: "remove", path: "title" }])} ariaLabel={t("canvas.docTitle")} />
        </Row>
        <Row label={t("canvas.description")} align="start">
          <TextField value={doc.description ?? ""} multiline onCommit={(v) => api.edit([v.trim() ? { op: "set", path: "description", value: v.trim() } : { op: "remove", path: "description" }])} ariaLabel={t("canvas.description")} placeholder={t("canvas.descriptionHint")} />
        </Row>
      </Section>
    </div>
  );
}
