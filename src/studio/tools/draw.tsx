// Text (T) and shape (U) tools.

import clsx from "clsx";
import { Circle, Hexagon, Minus, Shapes, Square, Star, Type } from "lucide-react";
import { FONTS } from "../../core/catalog";
import type { TextLayer } from "../../core/types";
import { findLayer } from "../../ops/tree";
import { ColorField } from "../components/ui/ColorPicker";
import { NumberField } from "../components/ui/NumberField";
import { Select } from "../components/ui/controls";
import { t, useI18n, type MessageKey } from "../i18n";
import { hitTest } from "../lib/hit";
import { shapeLayer } from "../lib/layers";
import { paintColor } from "../lib/paint";
import { dragRect } from "../lib/transform";
import { useEditor, useSelectedLayer, useUi, type ShapeKind } from "../state/context";
import type { ToolDef } from "./types";

export const textTool: ToolDef = {
  id: "text",
  icon: Type,
  label: "tools.text",
  shortcut: "T",
  group: "draw",
  cursor: () => "text",
  down(ctx, p) {
    const { api } = ctx;
    const doc = api.store.doc;
    if (!doc) return null;
    if (api.ui.get().textEdit) return null; // the editor's blur commits first
    const hit = hitTest(doc.layers, api.boxes.getSnapshot(), p.doc);
    const l = hit ? findLayer(doc.layers, hit)?.layer : null;
    if (l?.type === "text") {
      api.store.select(hit);
      api.ui.set({ textEdit: { id: hit! } });
    } else api.ui.set({ textEdit: { id: null, x: p.doc.x, y: p.doc.y } });
    return null;
  },
  Options: TextOptions,
};

function TextOptions() {
  const { t } = useI18n();
  const api = useEditor();
  const sel = useSelectedLayer();
  const fg = useUi((s) => s.fg);
  const text = sel?.type === "text" ? (sel as TextLayer) : null;
  const set = (v: Record<string, unknown>, final = true) => text && api.edit([{ op: "updateLayer", id: text.id, set: v }], final ? {} : { coalesce: `text-opt:${text.id}` });
  return (
    <div className="flex items-center gap-1.5">
      {text ? (
        <>
          <Select value={text.font ?? "inter"} options={FONTS.map((f) => ({ value: f.id, label: f.family }))} onChange={(v) => set({ font: v })} className="w-[150px]" ariaLabel={t("props.font")} />
          <div className="w-[84px]">
            <NumberField label="Aa" value={text.size ?? 64} min={1} max={2000} onChange={(v, final) => set({ size: v }, final)} ariaLabel={t("props.size")} />
          </div>
          <div className="w-[120px]">
            <ColorField value={paintColor(text.color, "#ffffff")} onChange={(v, final) => set({ color: v }, final)} />
          </div>
        </>
      ) : (
        <>
          <span className="text-xs text-fg-muted">{t("tools.color")}</span>
          <div className="w-[120px]">
            <ColorField value={fg} onChange={(v) => api.ui.set({ fg: v })} />
          </div>
        </>
      )}
      <span className="ml-2 text-2xs text-fg-faint">{t("tools.textHint")}</span>
    </div>
  );
}

export const SHAPE_ICONS: Record<ShapeKind, typeof Square> = { rect: Square, ellipse: Circle, line: Minus, polygon: Hexagon, star: Star };

export const shapeTool: ToolDef = {
  id: "shape",
  icon: Shapes,
  label: "tools.shape",
  shortcut: "U",
  group: "draw",
  cursor: () => "crosshair",
  down(ctx, p) {
    const { api } = ctx;
    const kind = api.ui.get().shapeKind;
    let rect = { x: p.doc.x, y: p.doc.y, width: 0, height: 0 };
    return {
      move(q) {
        rect = kind === "line" ? { x: p.doc.x, y: p.doc.y, width: q.doc.x - p.doc.x, height: q.doc.y - p.doc.y } : dragRect(p.doc, q.doc, q.shift, q.alt);
        ctx.setDraft({ kind: kind === "ellipse" ? "ellipse" : kind === "line" ? "line" : "rect", ...rect });
      },
      up() {
        ctx.setDraft(null);
        const doc = api.store.doc;
        if (!doc) return;
        let r = rect;
        if (kind === "line") {
          // Line layers are drawn corner to corner of their box.
          r = { x: Math.min(rect.x, rect.x + rect.width), y: Math.min(rect.y, rect.y + rect.height), width: Math.abs(rect.width), height: Math.abs(rect.height) };
        }
        if (Math.max(r.width, r.height) * ctx.view().zoom < 4) {
          // A click: a default-size shape centred there.
          const s = Math.round(Math.min(doc.canvas.width, doc.canvas.height) / 4);
          r = { x: p.doc.x - s / 2, y: p.doc.y - s / 2, width: s, height: kind === "line" ? 0 : s };
        }
        const layer = { ...shapeLayer(doc, kind, { ...r, height: Math.max(1, r.height) }, api.ui.get().fg), name: t(`shapes.${kind}`) };
        // An up-right line is a down-right one mirrored.
        if (kind === "line" && rect.width < 0 !== rect.height < 0) layer.flipX = true;
        api.edit([{ op: "addLayer", layer }], { select: layer.id });
      },
      cancel() {
        ctx.setDraft(null);
      },
    };
  },
  Options: ShapeOptions,
};

export function ShapeKindPicker({ value, onChange }: { value: ShapeKind; onChange(k: ShapeKind): void }) {
  const { t } = useI18n();
  return (
    <div className="flex rounded-md bg-ink-2 p-0.5">
      {(Object.keys(SHAPE_ICONS) as ShapeKind[]).map((k) => {
        const Icon = SHAPE_ICONS[k];
        return (
          <button key={k} type="button" title={t(`shapes.${k}` as MessageKey)} aria-label={t(`shapes.${k}` as MessageKey)} onClick={() => onChange(k)} className={clsx("flex h-6 w-7 items-center justify-center rounded", value === k ? "bg-ink-4 text-fg" : "text-fg-muted hover:text-fg")}>
            <Icon size={13} />
          </button>
        );
      })}
    </div>
  );
}

function ShapeOptions() {
  const { t } = useI18n();
  const api = useEditor();
  const kind = useUi((s) => s.shapeKind);
  const fg = useUi((s) => s.fg);
  return (
    <div className="flex items-center gap-1.5">
      <ShapeKindPicker value={kind} onChange={(k) => api.ui.set({ shapeKind: k })} />
      <span className="ml-2 text-xs text-fg-muted">{t("tools.fill")}</span>
      <div className="w-[120px]">
        <ColorField value={fg} onChange={(v) => api.ui.set({ fg: v })} />
      </div>
      <span className="ml-2 text-2xs text-fg-faint">{t("tools.shapeHint")}</span>
    </div>
  );
}
