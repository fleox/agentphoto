// Hand (H), zoom (Z) and eyedropper (I).

import { Hand, Pipette, ZoomIn } from "lucide-react";
import { toast } from "../components/ui/Toast";
import { ColorField } from "../components/ui/ColorPicker";
import { t, useI18n } from "../i18n";
import { copyText } from "../lib/download";
import { useEditor, useUi, type View } from "../state/context";
import type { DragSession, PointerInfo, ToolCtx, ToolDef } from "./types";

export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 32;

// Zoom around a viewport point (keeps the document point under it in place).
export function zoomAt(v: View, factor: number, at: { x: number; y: number }): View {
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * factor));
  const k = zoom / v.zoom;
  return { zoom, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k };
}

export function panSession(ctx: ToolCtx, p: PointerInfo): DragSession {
  const start = ctx.view();
  return {
    cursor: "grabbing",
    move(q) {
      ctx.setView({ ...start, x: start.x + q.screen.x - p.screen.x, y: start.y + q.screen.y - p.screen.y });
    },
    up() {},
  };
}

export const handTool: ToolDef = {
  id: "hand",
  icon: Hand,
  label: "tools.hand",
  shortcut: "H",
  group: "view",
  cursor: () => "grab",
  down: (ctx, p) => panSession(ctx, p),
};

export const zoomTool: ToolDef = {
  id: "zoom",
  icon: ZoomIn,
  label: "tools.zoom",
  shortcut: "Z",
  group: "view",
  cursor: (_ctx, p) => (p?.alt ? "zoom-out" : "zoom-in"),
  down(ctx, p) {
    ctx.setView(zoomAt(ctx.view(), p.alt ? 0.5 : 2, p.screen));
    return null;
  },
};

export const eyedropperTool: ToolDef = {
  id: "eyedropper",
  icon: Pipette,
  label: "tools.eyedropper",
  shortcut: "I",
  group: "view",
  cursor: () => "crosshair",
  down(ctx, p) {
    const c = ctx.sampleColor(p.doc);
    if (!c) return null;
    ctx.api.ui.set({ fg: c });
    void copyText(c);
    toast({ tone: "info", title: t("tools.picked", { color: c }), detail: t("tools.pickedHint") }, 2400);
    return null;
  },
  Options: EyedropperOptions,
};

function EyedropperOptions() {
  const { t } = useI18n();
  const api = useEditor();
  const fg = useUi((s) => s.fg);
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-fg-muted">{t("tools.color")}</span>
      <div className="w-[120px]">
        <ColorField value={fg} onChange={(v) => api.ui.set({ fg: v })} />
      </div>
      <span className="ml-2 text-2xs text-fg-faint">{t("tools.eyedropperHint")}</span>
    </div>
  );
}
