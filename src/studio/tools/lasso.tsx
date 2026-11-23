// Lasso (L): freehand, or polygonal (click points; click the first point,
// double-click or Enter to close, Esc cancels). Shift adds, Alt subtracts.

import clsx from "clsx";
import { Lasso, Spline } from "lucide-react";
import { useI18n } from "../i18n";
import { emptyRaster, fillPolygon, modeFromKeys, type CombineMode } from "../lib/region";
import { useEditor, useUi } from "../state/context";
import { commitRegion } from "./marquee";
import { RegionBar } from "./regionBar";
import type { Pt, ToolCtx, ToolDef } from "./types";

let poly: { points: Pt[]; mode: CombineMode } | null = null;

function close(ctx: ToolCtx, points: Pt[], mode: CombineMode): void {
  ctx.setPath(null);
  if (points.length < 3) return;
  const doc = ctx.api.store.doc!;
  const r = fillPolygon(emptyRaster(doc.canvas.width, doc.canvas.height), points);
  commitRegion(ctx, { kind: "raster", raster: r }, mode);
}

export const lassoTool: ToolDef = {
  id: "lasso",
  icon: Lasso,
  label: "tools.lasso",
  shortcut: "L",
  group: "select",
  cursor: () => "crosshair",
  deactivate() {
    poly = null;
  },
  down(ctx, p) {
    if (ctx.api.ui.get().lassoKind === "poly") {
      if (!poly) poly = { points: [p.doc], mode: modeFromKeys(p.shift, p.alt) };
      else {
        const first = ctx.toScreen(poly.points[0]);
        if (p.clicks >= 2 || Math.hypot(first.x - p.screen.x, first.y - p.screen.y) < 9) {
          const pts = poly.points;
          const mode = poly.mode;
          poly = null;
          close(ctx, pts, mode);
          return null;
        }
        poly.points.push(p.doc);
      }
      ctx.setPath({ points: poly.points, toCursor: true });
      return null;
    }
    const mode = modeFromKeys(p.shift, p.alt);
    const pts: Pt[] = [p.doc];
    return {
      move(q) {
        const last = pts[pts.length - 1];
        const z = ctx.view().zoom;
        if (Math.hypot((q.doc.x - last.x) * z, (q.doc.y - last.y) * z) < 2) return;
        pts.push(q.doc);
        ctx.setPath({ points: pts });
      },
      up() {
        if (pts.length < 3 && mode === "replace") ctx.api.ui.set({ region: null });
        close(ctx, pts, mode);
      },
      cancel() {
        ctx.setPath(null);
      },
    };
  },
  hover(ctx) {
    if (poly) ctx.setPath({ points: poly.points, toCursor: true });
  },
  key(ctx, e) {
    if (poly && e.key === "Enter") {
      const { points, mode } = poly;
      poly = null;
      close(ctx, points, mode);
      return true;
    }
    if (e.key === "Escape") {
      if (poly) {
        poly = null;
        ctx.setPath(null);
        return true;
      }
      if (ctx.api.ui.get().region) {
        ctx.api.ui.set({ region: null });
        return true;
      }
    }
    if (poly && e.key === "Backspace") {
      poly.points.pop();
      if (!poly.points.length) poly = null;
      ctx.setPath(poly ? { points: poly.points, toCursor: true } : null);
      return true;
    }
    return false;
  },
  Options: LassoOptions,
};

function LassoOptions() {
  const { t } = useI18n();
  const api = useEditor();
  const kind = useUi((s) => s.lassoKind);
  const region = useUi((s) => s.region);
  return (
    <div className="flex items-center gap-1">
      <div className="flex rounded-md bg-ink-2 p-0.5">
        {(["free", "poly"] as const).map((k) => (
          <button key={k} type="button" title={t(`lasso.${k}`)} aria-label={t(`lasso.${k}`)} onClick={() => ((poly = null), api.ui.set({ lassoKind: k }))} className={clsx("flex h-6 items-center gap-1 rounded px-2 text-xs", kind === k ? "bg-ink-4 text-fg" : "text-fg-muted hover:text-fg")}>
            {k === "free" ? <Lasso size={13} /> : <Spline size={13} />}
            {t(`lasso.${k}`)}
          </button>
        ))}
      </div>
      <div className="ml-2">{region ? <RegionBar /> : <span className="text-xs text-fg-faint">{t(kind === "poly" ? "lasso.polyHint" : "lasso.hint")}</span>}</div>
    </div>
  );
}
