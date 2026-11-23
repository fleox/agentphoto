// Marquee tool (M): rectangle / ellipse selection (Shift = square, Alt =
// from the centre, drag inside to move it). The selection becomes a layer
// mask, an adjustment layer masked to it, or a crop.

import clsx from "clsx";
import { Circle, Crop, Layers2, Square, SquareDashed, X } from "lucide-react";
import { Button } from "../components/ui/controls";
import { toast } from "../components/ui/Toast";
import { t, useI18n } from "../i18n";
import { adjustmentFromMarquee, cropFromMarquee, maskFromMarquee } from "../lib/selection";
import { dragRect } from "../lib/transform";
import { useEditor, useUi, type EditorApi } from "../state/context";
import type { ToolDef } from "./types";

export function maskSelected(api: EditorApi): void {
  const m = api.ui.get().marquee;
  const id = api.store.primary;
  const doc = api.store.doc;
  if (!m || !id || !doc) return;
  const ops = maskFromMarquee(doc, id, m, api.boxes.get(id));
  if (ops && api.edit(ops)) api.ui.set({ marquee: null });
}

export function adjustmentFromSelection(api: EditorApi): void {
  const m = api.ui.get().marquee;
  const doc = api.store.doc;
  if (!m || !doc) return;
  const r = adjustmentFromMarquee(doc, m, api.store.primary, t("layers.adjustmentName"));
  if (api.edit(r.ops, { select: r.id })) api.ui.set({ marquee: null, rightTab: "filters" });
}

export function cropToSelection(api: EditorApi): void {
  const m = api.ui.get().marquee;
  const doc = api.store.doc;
  if (!m || !doc) return;
  const ops = cropFromMarquee(doc, m);
  if (!ops) return void toast({ tone: "error", title: t("marquee.empty") });
  if (api.edit(ops)) api.ui.set({ marquee: null, fitRequest: api.ui.get().fitRequest + 1 });
}

export const marqueeTool: ToolDef = {
  id: "marquee",
  icon: SquareDashed,
  label: "tools.marquee",
  shortcut: "M",
  group: "select",
  cursor: () => "crosshair",
  down(ctx, p) {
    const { ui } = ctx.api;
    const m = ui.get().marquee;
    const inside = m && p.doc.x >= m.x && p.doc.x <= m.x + m.width && p.doc.y >= m.y && p.doc.y <= m.y + m.height;
    if (m && inside && !p.shift && !p.alt) {
      const start = { ...m };
      return {
        cursor: "move",
        move(q) {
          ui.set({ marquee: { ...start, x: start.x + q.doc.x - p.doc.x, y: start.y + q.doc.y - p.doc.y } });
        },
        up() {},
      };
    }
    let moved = false;
    const kind = ui.get().marqueeKind;
    return {
      move(q) {
        if (!moved && Math.hypot(q.screen.x - p.screen.x, q.screen.y - p.screen.y) < 3) return;
        moved = true;
        ui.set({ marquee: { kind, ...dragRect(p.doc, q.doc, q.shift, q.alt) } });
      },
      up() {
        if (!moved) ui.set({ marquee: null });
      },
    };
  },
  key(ctx, e) {
    if (e.key === "Escape" && ctx.api.ui.get().marquee) {
      ctx.api.ui.set({ marquee: null });
      return true;
    }
    return false;
  },
  Options: MarqueeOptions,
};

function MarqueeOptions() {
  const { t } = useI18n();
  const api = useEditor();
  const kind = useUi((s) => s.marqueeKind);
  const m = useUi((s) => s.marquee);
  return (
    <div className="flex items-center gap-1">
      <div className="flex rounded-md bg-ink-2 p-0.5">
        {(["rect", "ellipse"] as const).map((k) => (
          <button key={k} type="button" title={t(`marquee.${k}`)} aria-label={t(`marquee.${k}`)} onClick={() => api.ui.set({ marqueeKind: k, ...(m ? { marquee: { ...m, kind: k } } : {}) })} className={clsx("flex h-6 w-7 items-center justify-center rounded", kind === k ? "bg-ink-4 text-fg" : "text-fg-muted hover:text-fg")}>
            {k === "rect" ? <Square size={13} /> : <Circle size={13} />}
          </button>
        ))}
      </div>
      {m ? (
        <>
          <span className="ml-2 mr-1 text-2xs tabular-nums text-fg-faint">
            {Math.round(m.width)} × {Math.round(m.height)}
          </span>
          <Button size="xs" variant="ghost" disabled={!api.store.primary} onClick={() => maskSelected(api)} title={t("marquee.maskHint")}>
            <SquareDashed size={13} /> {t("marquee.mask")}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => adjustmentFromSelection(api)} title={t("marquee.adjustHint")}>
            <Layers2 size={13} /> {t("marquee.adjust")}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => cropToSelection(api)}>
            <Crop size={13} /> {t("marquee.crop")}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => api.ui.set({ marquee: null })}>
            <X size={13} /> {t("marquee.deselect")}
          </Button>
        </>
      ) : (
        <span className="ml-2 text-xs text-fg-faint">{t("marquee.hint")}</span>
      )}
    </div>
  );
}
