// Crop tool (C): a crop rectangle over the canvas with rule-of-thirds and
// handles (aspect presets), Enter commits (doc_patch crop), Esc cancels.

import { Check, Crop, X } from "lucide-react";
import { Button, Select } from "../components/ui/controls";
import { NumberField } from "../components/ui/NumberField";
import { useI18n } from "../i18n";
import { clampRect, dragRect, HANDLES, resizeBox, type Handle } from "../lib/transform";
import { useEditor, useUi, type EditorApi, type Rect } from "../state/context";
import type { ToolCtx, ToolDef } from "./types";

const full = (api: EditorApi): Rect => ({ x: 0, y: 0, width: api.store.doc!.canvas.width, height: api.store.doc!.canvas.height });

export function commitCrop(api: EditorApi): void {
  const c = api.ui.get().crop;
  const doc = api.store.doc;
  if (!c || !doc) return;
  const r = clampRect(c, doc.canvas.width, doc.canvas.height);
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const width = Math.max(1, Math.round(r.width));
  const height = Math.max(1, Math.round(r.height));
  if (x === 0 && y === 0 && width === doc.canvas.width && height === doc.canvas.height) return void api.ui.set({ tool: "move", crop: null });
  if (api.edit([{ op: "crop", x, y, width, height }])) api.ui.set((s) => ({ tool: "move", crop: null, fitRequest: s.fitRequest + 1 }));
}

function withRatio(r: Rect, ratio: number | null, h: Handle | null): Rect {
  if (!ratio) return r;
  // Keep the width, derive the height (vertical-only handles keep the height).
  if (h && h.hx === 0) return { ...r, width: r.height * ratio };
  return { ...r, height: r.width / ratio };
}

const handleHit = (ctx: ToolCtx, c: Rect, screen: { x: number; y: number }): Handle | null => {
  for (const h of HANDLES) {
    const p = ctx.toScreen({ x: c.x + ((h.hx + 1) / 2) * c.width, y: c.y + ((h.hy + 1) / 2) * c.height });
    if (Math.hypot(p.x - screen.x, p.y - screen.y) <= 8) return h;
  }
  return null;
};

export const cropTool: ToolDef = {
  id: "crop",
  icon: Crop,
  label: "tools.crop",
  shortcut: "C",
  group: "select",
  activate(api) {
    if (api.store.doc && !api.ui.get().crop) api.ui.set({ crop: full(api), region: null });
  },
  deactivate(api) {
    api.ui.set({ crop: null });
  },
  cursor(ctx, p) {
    const c = ctx.api.ui.get().crop;
    if (!c || !p) return "crosshair";
    const h = handleHit(ctx, c, p.screen);
    if (h) return h.hx && h.hy ? (h.hx === h.hy ? "nwse-resize" : "nesw-resize") : h.hx ? "ew-resize" : "ns-resize";
    const inside = p.doc.x >= c.x && p.doc.x <= c.x + c.width && p.doc.y >= c.y && p.doc.y <= c.y + c.height;
    return inside ? "move" : "crosshair";
  },
  down(ctx, p) {
    const { ui } = ctx.api;
    const c = ui.get().crop ?? full(ctx.api);
    const ratio = ui.get().cropRatio;
    const h = handleHit(ctx, c, p.screen);
    if (h) {
      return {
        move(q) {
          const r = resizeBox({ ...c, rotation: 0 }, h, q.doc, q.shift || !!ratio);
          ui.set({ crop: withRatio(r, ratio, h) });
        },
        up() {},
      };
    }
    const inside = p.doc.x >= c.x && p.doc.x <= c.x + c.width && p.doc.y >= c.y && p.doc.y <= c.y + c.height;
    if (inside) {
      return {
        cursor: "move",
        move(q) {
          ui.set({ crop: { ...c, x: c.x + q.doc.x - p.doc.x, y: c.y + q.doc.y - p.doc.y } });
        },
        up() {},
      };
    }
    return {
      move(q) {
        const r = dragRect(p.doc, q.doc, q.shift);
        ui.set({ crop: withRatio(r, ratio, null) });
      },
      up() {},
    };
  },
  key(ctx, e) {
    if (e.key === "Enter") {
      commitCrop(ctx.api);
      return true;
    }
    if (e.key === "Escape") {
      ctx.api.ui.set({ tool: "move", crop: null });
      return true;
    }
    return false;
  },
  Options: CropOptions,
};

const RATIOS = ["free", "original", "1:1", "4:5", "3:2", "16:9", "9:16", "2:3"];

function CropOptions() {
  const { t } = useI18n();
  const api = useEditor();
  const c = useUi((s) => s.crop);
  const ratio = useUi((s) => s.cropRatio);
  const ratioId = useUi((s) => s.cropRatioId);
  const doc = api.store.doc;
  if (!doc) return null;
  const setRatio = (id: string) => {
    const r = id === "free" ? null : id === "original" ? doc.canvas.width / doc.canvas.height : Number(id.split(":")[0]) / Number(id.split(":")[1]);
    const cur = c ?? full(api);
    let next = cur;
    if (r) {
      // Largest rectangle of that ratio centred in the current one.
      const w = Math.min(cur.width, cur.height * r);
      const h = w / r;
      next = { x: cur.x + (cur.width - w) / 2, y: cur.y + (cur.height - h) / 2, width: w, height: h };
    }
    api.ui.set({ cropRatio: r, cropRatioId: id, crop: next });
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-fg-muted">{t("crop.ratio")}</span>
      <Select value={ratioId} onChange={setRatio} options={RATIOS.map((r) => ({ value: r, label: r === "free" ? t("crop.free") : r === "original" ? t("crop.original") : r }))} className="w-[104px]" ariaLabel={t("crop.ratio")} />
      {c && (
        <div className="flex w-[180px] gap-1">
          <NumberField label="W" value={Math.round(c.width)} min={1} integer onChange={(v) => api.ui.set({ crop: { ...c, width: v, ...(ratio ? { height: v / ratio } : {}) } })} />
          <NumberField label="H" value={Math.round(c.height)} min={1} integer onChange={(v) => api.ui.set({ crop: { ...c, height: v, ...(ratio ? { width: v * ratio } : {}) } })} />
        </div>
      )}
      <div className="ml-2 flex gap-1">
        <Button size="xs" variant="primary" onClick={() => commitCrop(api)}>
          <Check size={13} /> {t("crop.apply")}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => api.ui.set({ tool: "move", crop: null })}>
          <X size={13} /> {t("crop.cancel")}
        </Button>
      </div>
      <span className="ml-2 text-2xs text-fg-faint">{t("crop.hint")}</span>
    </div>
  );
}
