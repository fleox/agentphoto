// Options-bar actions on the current pixel selection, shared by every
// selection tool (marquee, lasso, magic wand, quick AI select).

import { Copy, Crop, Eraser, FlipVertical, Layers2, PaintBucket, Sparkle, SquareDashed, X } from "lucide-react";
import { useState } from "react";
import { adjustmentFromRegion, copyRegionToLayer, cropToRegion, deleteRegion, featherSelection, fillRegion, invertSelection, maskFromRegion } from "../actions/region";
import { IconButton } from "../components/ui/controls";
import { NumberField } from "../components/ui/NumberField";
import { Popover } from "../components/ui/Popover";
import { Button } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { regionBounds } from "../lib/region";
import { useEditor, useUi } from "../state/context";

export function RegionBar() {
  const { t } = useI18n();
  const api = useEditor();
  const region = useUi((s) => s.region);
  const [busy, setBusy] = useState(false);
  const [feather, setFeather] = useState(8);
  if (!region) return null;
  const b = regionBounds(region);
  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-0.5">
      {b && (
        <span className="mr-1.5 text-2xs tabular-nums text-fg-faint">
          {Math.round(b.width)} × {Math.round(b.height)}
        </span>
      )}
      <Button size="xs" variant="ghost" disabled={busy || !api.store.primary} onClick={() => void run(() => maskFromRegion(api))} title={t("marquee.maskHint")}>
        <SquareDashed size={13} /> {t("marquee.mask")}
      </Button>
      <IconButton label={t("region.delete")} disabled={busy || !api.store.primary} onClick={() => void run(() => deleteRegion(api))} className="h-6 w-6">
        <Eraser size={13} />
      </IconButton>
      <IconButton label={t("region.copy")} disabled={busy} onClick={() => void run(() => copyRegionToLayer(api))} className="h-6 w-6">
        <Copy size={13} />
      </IconButton>
      <IconButton label={t("region.fill")} disabled={busy} onClick={() => void run(() => fillRegion(api))} className="h-6 w-6">
        <PaintBucket size={13} />
      </IconButton>
      <IconButton label={t("marquee.adjustHint")} disabled={busy} onClick={() => void run(() => adjustmentFromRegion(api))} className="h-6 w-6">
        <Layers2 size={13} />
      </IconButton>
      <div className="mx-1 h-4 w-px bg-line" />
      <IconButton label={t("region.invert")} onClick={() => invertSelection(api)} className="h-6 w-6">
        <FlipVertical size={13} />
      </IconButton>
      <Popover
        width={200}
        align="start"
        trigger={(open, isOpen) => (
          <IconButton label={t("region.feather")} active={isOpen} onClick={open} className="h-6 w-6">
            <Sparkle size={13} />
          </IconButton>
        )}
      >
        {(close) => (
          <div className="space-y-2 p-2.5">
            <div className="text-xs text-fg-muted">{t("region.featherRadius")}</div>
            <NumberField value={feather} min={1} max={500} integer suffix="px" onChange={(v) => setFeather(v)} ariaLabel={t("region.featherRadius")} />
            <Button size="xs" variant="primary" className="w-full" onClick={() => (featherSelection(api, feather), close())}>
              {t("region.apply")}
            </Button>
          </div>
        )}
      </Popover>
      <IconButton label={t("marquee.crop")} onClick={() => cropToRegion(api)} className="h-6 w-6">
        <Crop size={13} />
      </IconButton>
      <IconButton label={t("marquee.deselect")} onClick={() => api.ui.set({ region: null })} className="h-6 w-6">
        <X size={13} />
      </IconButton>
    </div>
  );
}
