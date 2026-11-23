// Looks: the catalog's one-click grades as live thumbnails of the selected
// image layer (or of the whole picture). Click applies / replaces the layer's
// `look` filter (or a "Look" adjustment layer on top), with an intensity slider.

import clsx from "clsx";
import { Ban, Check, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LOOKS } from "../../core/catalog";
import type { Filter, Layer, PhotoDoc } from "../../core/types";
import { createCanvas, ctx2d, Engine, readPixels, runFilters, writePixels, type AnyCanvas } from "../../engine";
import { SliderField } from "../components/ui/NumberField";
import { useI18n } from "../i18n";
import { lookTitle } from "../lib/labels";
import { newId } from "../lib/layers";
import { queued } from "../render/thumbs";
import { useEditor, useSelectedLayer, useSnapshot, useUi } from "../state/context";

const TW = 104;
const TH = 72;

interface Target {
  // The layer holding the look filter (null = a new adjustment layer on top).
  layer: Layer | null;
  index: number;
  kind: "layer" | "picture";
}

// Where the look goes: the selected image / adjustment layer, else the topmost "look" adjustment layer.
export function lookTarget(doc: PhotoDoc, selected: Layer | null): Target {
  if (selected && (selected.type === "image" || selected.type === "adjustment" || selected.type === "group")) {
    return { layer: selected, index: (selected.filters ?? []).findIndex((f) => f.type === "look"), kind: selected.type === "image" ? "layer" : "picture" };
  }
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.type === "adjustment") {
      const k = l.filters.findIndex((f) => f.type === "look");
      if (k >= 0) return { layer: l, index: k, kind: "picture" };
    }
  }
  return { layer: null, index: -1, kind: "picture" };
}

function withoutLook(l: Layer, index: number): Layer {
  return { ...l, filters: (l.filters ?? []).filter((_, k) => k !== index) } as Layer;
}

export function LooksPanel() {
  const { t } = useI18n();
  const api = useEditor();
  const doc = useSnapshot().doc!;
  const selected = useSelectedLayer();
  const files = useUi((s) => s.filesVersion);
  const target = lookTarget(doc, selected);
  const current = target.layer && target.index >= 0 ? (target.layer.filters![target.index] as Filter) : null;
  const currentLook = current && typeof current.look === "string" ? current.look : null;
  const engine = useMemo(() => new Engine({ assetBase: "", libraryBase: "" }, api.engine.loader), [api]);
  const [base, setBase] = useState<AnyCanvas | null>(null);
  const [scale, setScale] = useState(1);

  // The picture the looks are previewed on (without the current look).
  const baseKey = JSON.stringify([target.kind === "layer" ? withoutLook(target.layer!, target.index) : null, target.kind === "picture" ? doc.layers.map((l) => (l === target.layer ? withoutLook(l, target.index) : l)) : null, doc.canvas, files]);
  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      void queued(async () => {
        try {
          let c: AnyCanvas;
          if (target.kind === "layer" && target.layer) {
            const d: PhotoDoc = { ...doc, layers: doc.layers.map(function strip(l): Layer {
              if (l.id === target.layer!.id) return withoutLook(l, target.index);
              return l.type === "group" ? ({ ...l, children: l.children.map(strip) } as Layer) : l;
            }) };
            c = await engine.layerPixels(d, target.layer.id, { maxSide: TW * 2, withFilters: true });
          } else {
            const d: PhotoDoc = { ...doc, layers: target.layer ? doc.layers.map((l) => (l.id === target.layer!.id ? withoutLook(l, target.index) : l)) : doc.layers };
            const k = Math.min((TW * 2) / doc.canvas.width, (TH * 2) / doc.canvas.height) * 1.6;
            c = await engine.render(d, { scale: Math.min(1, k) });
          }
          if (alive) {
            const fullW = target.kind === "layer" && target.layer ? (api.boxes.get(target.layer.id)?.width ?? c.width) : doc.canvas.width;
            setScale(c.width / Math.max(1, fullW));
            setBase(c);
          }
        } catch {
          if (alive) setBase(null);
        }
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [baseKey, engine]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (look: string | null) => {
    if (!look) {
      if (target.layer && target.index >= 0) {
        // Removing the only filter of a dedicated look layer removes the layer.
        if (target.layer.type === "adjustment" && target.layer.filters.length === 1) api.edit([{ op: "removeLayer", id: target.layer.id }]);
        else api.edit([{ op: "removeFilter", id: target.layer.id, index: target.index }]);
      }
      return;
    }
    if (target.layer && target.index >= 0) api.edit([{ op: "updateFilter", id: target.layer.id, index: target.index, set: { look } }]);
    else if (target.layer) api.edit([{ op: "addFilter", id: target.layer.id, filter: { type: "look", look, amount: 0.85 } }]);
    else {
      const id = newId(doc, "look");
      api.edit([{ op: "addLayer", layer: { id, type: "adjustment", name: t("looks.layerName"), filters: [{ type: "look", look, amount: 0.85 }] } }]);
    }
  };

  return (
    <div className="pb-4">
      <div className="border-b border-line px-3 py-2">
        <div className="text-sm font-semibold">{t("looks.title")}</div>
        <div className="truncate text-2xs text-fg-faint">{target.kind === "layer" ? t("looks.onLayer", { name: target.layer?.name ?? target.layer?.id ?? "" }) : t("looks.onPicture")}</div>
      </div>
      {current && target.layer && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="w-[70px] shrink-0 text-xs text-fg-muted">{t("looks.intensity")}</span>
          <SliderField value={Math.round((typeof current.amount === "number" ? current.amount : 1) * 100)} min={0} max={100} integer onChange={(v, final) => api.edit([{ op: "updateFilter", id: target.layer!.id, index: target.index, set: { amount: v >= 100 ? null : v / 100 } }], final ? {} : { coalesce: `look-amount:${target.layer!.id}` })} ariaLabel={t("looks.intensity")} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 p-2.5">
        <LookTile id={null} title={t("looks.none")} base={base} scale={scale} active={!currentLook} onClick={() => apply(null)} />
        {LOOKS.map((l) => (
          <LookTile key={l.id} id={l.id} title={lookTitle(l.id)} base={base} scale={scale} active={currentLook === l.id} onClick={() => apply(l.id)} hint={l.description} />
        ))}
      </div>
    </div>
  );
}

function LookTile({ id, title, base, scale, active, onClick, hint }: { id: string | null; title: string; base: AnyCanvas | null; scale: number; active: boolean; onClick(): void; hint?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!base) return;
    let alive = true;
    void queued(async () => {
      const c = ref.current;
      if (!c || !alive) return;
      // Cover-fit the base into the tile, then grade it.
      const W = TW * 2;
      const H = TH * 2;
      const tmp = createCanvas(W, H);
      const k = Math.max(W / base.width, H / base.height);
      ctx2d(tmp).drawImage(base as CanvasImageSource, (W - base.width * k) / 2, (H - base.height * k) / 2, base.width * k, base.height * k);
      if (id) {
        const p = readPixels(tmp);
        runFilters(p, [{ type: "look", look: id }], { scale: scale * k });
        writePixels(tmp, p);
      }
      c.width = W;
      c.height = H;
      c.getContext("2d")!.drawImage(tmp as CanvasImageSource, 0, 0);
      if (alive) setDone(true);
    });
    return () => {
      alive = false;
    };
  }, [base, id, scale]);
  return (
    <button type="button" onClick={onClick} title={hint} aria-pressed={active} className={clsx("group relative overflow-hidden rounded-lg text-left ring-1 transition", active ? "ring-2 ring-accent" : "ring-white/10 hover:ring-white/30")}>
      <div className="checker-sm relative" style={{ aspectRatio: `${TW} / ${TH}` }}>
        <canvas ref={ref} className={clsx("absolute inset-0 h-full w-full object-cover transition-opacity", done ? "opacity-100" : "opacity-0")} />
        {!done && base && <Loader2 size={14} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-fg-faint" />}
        {!id && done && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Ban size={16} className="text-white/80" />
          </div>
        )}
        {active && (
          <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-ink-0">
            <Check size={10} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="flex items-center justify-between bg-ink-2/80 px-2 py-1 text-xs">
        <span className="truncate">{title}</span>
      </div>
    </button>
  );
}
