// Marquee tool (M): rectangle / ellipse selection. Shift adds, Alt
// subtracts, Shift+Alt intersects (keys at press time); while drawing a new
// selection Shift = square, Alt = from the centre. Drag inside to move it.

import clsx from "clsx";
import { Circle, Square, SquareDashed } from "lucide-react";
import { useI18n } from "../i18n";
import { combine, modeFromKeys, regionBounds, type Region } from "../lib/region";
import { dragRect } from "../lib/transform";
import { useEditor, useUi } from "../state/context";
import { RegionBar } from "./regionBar";
import type { DragSession, PointerInfo, ToolCtx, ToolDef } from "./types";

// Drag-to-move an existing selection (any kind); null when the press is outside it.
export function moveRegionSession(ctx: ToolCtx, p: PointerInfo): DragSession | null {
  const { ui } = ctx.api;
  const r = ui.get().region;
  if (!r || p.shift || p.alt) return null;
  const b = regionBounds(r);
  if (!b || p.doc.x < b.x || p.doc.x > b.x + b.width || p.doc.y < b.y || p.doc.y > b.y + b.height) return null;
  if (r.kind === "raster") return null;
  return {
    cursor: "move",
    move(q) {
      ui.set({ region: { ...r, x: r.x + q.doc.x - p.doc.x, y: r.y + q.doc.y - p.doc.y } });
    },
    up() {},
  };
}

// Applies a freshly drawn region with the combine mode of the press.
export function commitRegion(ctx: ToolCtx, fresh: Region, mode: ReturnType<typeof modeFromKeys>): void {
  const doc = ctx.api.store.doc!;
  ctx.api.ui.set((s) => ({ region: combine(s.region, fresh, mode, doc.canvas.width, doc.canvas.height) }));
}

export const marqueeTool: ToolDef = {
  id: "marquee",
  icon: SquareDashed,
  label: "tools.marquee",
  shortcut: "M",
  group: "select",
  cursor: () => "crosshair",
  down(ctx, p) {
    const moving = moveRegionSession(ctx, p);
    if (moving) return moving;
    const mode = modeFromKeys(p.shift, p.alt);
    const kind = ctx.api.ui.get().marqueeKind;
    let moved = false;
    let rect = { x: 0, y: 0, width: 0, height: 0 };
    return {
      move(q) {
        if (!moved && Math.hypot(q.screen.x - p.screen.x, q.screen.y - p.screen.y) < 3) return;
        moved = true;
        rect = mode === "replace" ? dragRect(p.doc, q.doc, q.shift, q.alt) : dragRect(p.doc, q.doc);
        if (mode === "replace") ctx.api.ui.set({ region: { kind, ...rect } });
        else ctx.setDraft({ kind, ...rect });
      },
      up() {
        ctx.setDraft(null);
        if (!moved) {
          if (mode === "replace") ctx.api.ui.set({ region: null });
          return;
        }
        if (mode !== "replace") commitRegion(ctx, { kind, ...rect }, mode);
      },
      cancel() {
        ctx.setDraft(null);
      },
    };
  },
  key(ctx, e) {
    if (e.key === "Escape" && ctx.api.ui.get().region) {
      ctx.api.ui.set({ region: null });
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
  const region = useUi((s) => s.region);
  return (
    <div className="flex items-center gap-1">
      <div className="flex rounded-md bg-ink-2 p-0.5">
        {(["rect", "ellipse"] as const).map((k) => (
          <button key={k} type="button" title={t(`marquee.${k}`)} aria-label={t(`marquee.${k}`)} onClick={() => api.ui.set({ marqueeKind: k, ...(region && region.kind !== "raster" ? { region: { ...region, kind: k } } : {}) })} className={clsx("flex h-6 w-7 items-center justify-center rounded", kind === k ? "bg-ink-4 text-fg" : "text-fg-muted hover:text-fg")}>
            {k === "rect" ? <Square size={13} /> : <Circle size={13} />}
          </button>
        ))}
      </div>
      <div className="ml-2">{region ? <RegionBar /> : <span className="text-xs text-fg-faint">{t("marquee.hint")}</span>}</div>
    </div>
  );
}
