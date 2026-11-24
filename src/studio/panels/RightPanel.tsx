// Right column: layers (top) and the inspector tabs (bottom): properties,
// filters, looks, effects. The split is draggable.

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { EffectsPanel } from "../inspector/EffectsPanel";
import { FiltersPanel } from "../inspector/FiltersPanel";
import { LooksPanel } from "../inspector/LooksPanel";
import { Properties } from "../inspector/Properties";
import { useEditor, useSelectedLayer, useUi, type RightTab } from "../state/context";
import { LayersPanel } from "./LayersPanel";

const SPLIT_KEY = "agentphoto.studio.layersHeight";
const TABS: RightTab[] = ["properties", "filters", "looks", "effects"];

export function RightPanel() {
  const { t } = useI18n();
  const { ui } = useEditor();
  const tab = useUi((s) => s.rightTab);
  const layer = useSelectedLayer();
  const col = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(() => {
    try {
      return Number(localStorage.getItem(SPLIT_KEY)) || 300;
    } catch {
      return 300;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, String(Math.round(h)));
    } catch {
      /* ignore */
    }
  }, [h]);
  const counts: Partial<Record<RightTab, number>> = {
    filters: layer?.filters?.length || undefined,
    effects: layer?.effects ? Object.values(layer.effects).filter(Boolean).length || undefined : undefined,
  };
  return (
    <aside ref={col} className="flex w-[312px] max-w-[88vw] shrink-0 flex-col border-l border-line bg-ink-1">
      <div className="flex min-h-[120px] flex-col" style={{ height: h }}>
        <LayersPanel />
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("panels.resize")}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const top = col.current!.getBoundingClientRect().top;
          const move = (ev: PointerEvent) => setH(Math.max(120, Math.min(window.innerHeight - 260, ev.clientY - top)));
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
        className="group relative h-1.5 shrink-0 cursor-row-resize border-y border-line bg-ink-1 hover:bg-accent/30"
      />
      <div className="flex h-9 shrink-0 items-end gap-0.5 border-b border-line px-1.5">
        {TABS.map((k) => (
          <button key={k} type="button" data-tab={k} onClick={() => ui.set({ rightTab: k })} className={clsx("relative flex h-8 items-center gap-1 rounded-t-md px-2.5 text-xs font-medium transition-colors", tab === k ? "text-fg" : "text-fg-muted hover:text-fg")}>
            {t(`tabs.${k}`)}
            {counts[k] && <span className="rounded bg-ink-3 px-1 text-2xs text-fg-muted">{counts[k]}</span>}
            {tab === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-accent" />}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "properties" && <Properties />}
        {tab === "filters" && <FiltersPanel />}
        {tab === "looks" && <LooksPanel />}
        {tab === "effects" && <EffectsPanel />}
      </div>
    </aside>
  );
}
