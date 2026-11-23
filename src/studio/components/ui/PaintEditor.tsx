// Paint editor: solid colour (HSV picker) or linear / radial gradient with
// draggable stops, angle and centre. PaintField = swatch + popover.

import clsx from "clsx";
import { ArrowLeftRight, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { ColorStop, Gradient, Paint } from "../../../core/types";
import { t } from "../../i18n";
import { colorAt, convertPaint, paintKind, paintToCss, sortStops, stopsOf, type PaintKind } from "../../lib/paint";
import { ColorPicker, SwatchButton } from "./ColorPicker";
import { NumberField } from "./NumberField";
import { Popover } from "./Popover";

// Gradient bar with draggable stops (also used by the gradient map filter).
export function GradientStops({ stops, onChange, selected, onSelect }: { stops: ColorStop[]; onChange(s: ColorStop[], final: boolean): void; selected: number; onSelect(i: number): void }) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; moved: boolean } | null>(null);
  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const css = `linear-gradient(to right, ${sortStops(stops)
    .map(([o, c]) => `${c} ${o * 100}%`)
    .join(", ")})`;
  return (
    <div className="space-y-1">
      <div
        ref={bar}
        className="checker-sm relative h-6 cursor-copy rounded-md ring-1 ring-inset ring-white/10"
        title={t("paint.addStop")}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const o = at(e.clientX);
          const next: ColorStop[] = [...stops, [Math.round(o * 1000) / 1000, colorAt(stops, o)]];
          onChange(next, true);
          onSelect(next.length - 1);
        }}
      >
        <div className="pointer-events-none absolute inset-0 rounded-md" style={{ background: css }} />
      </div>
      <div className="relative h-4">
        {stops.map(([o, c], i) => (
          <button
            key={i}
            type="button"
            aria-label={t("paint.stop", { n: i + 1 })}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { i, moved: false };
              onSelect(i);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || e.buttons !== 1) return;
              d.moved = true;
              const next = stops.map((s, k) => (k === d.i ? ([Math.round(at(e.clientX) * 1000) / 1000, s[1]] as ColorStop) : s));
              onChange(next, false);
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              drag.current = null;
              if (d?.moved) onChange(stops.map((s, k) => (k === d.i ? ([Math.round(at(e.clientX) * 1000) / 1000, s[1]] as ColorStop) : s)), true);
            }}
            className={clsx("absolute top-0 h-4 w-3 -translate-x-1/2 rounded-[3px] border-2 shadow", i === selected ? "border-accent" : "border-white")}
            style={{ left: `${o * 100}%`, background: c }}
          />
        ))}
      </div>
    </div>
  );
}

// Full stops editor: bar + the selected stop's colour + offset + remove.
export function StopsEditor({ stops, onChange }: { stops: ColorStop[]; onChange(s: ColorStop[], final: boolean): void }) {
  const [sel, setSel] = useState(0);
  const i = Math.min(sel, stops.length - 1);
  const cur = stops[i];
  return (
    <div className="space-y-2">
      <GradientStops stops={stops} onChange={onChange} selected={i} onSelect={setSel} />
      {cur && (
        <div className="flex items-center gap-1.5">
          <Popover width={232} align="start" trigger={(open, isOpen) => <SwatchButton css={cur[1]} onClick={open} open={isOpen} />}>
            {() => <ColorPicker value={cur[1]} onChange={(c, final) => onChange(stops.map((s, k) => (k === i ? ([s[0], c] as ColorStop) : s)), final)} />}
          </Popover>
          <NumberField label="%" value={Math.round(cur[0] * 100)} min={0} max={100} integer onChange={(v, final) => onChange(stops.map((s, k) => (k === i ? ([v / 100, s[1]] as ColorStop) : s)), final)} ariaLabel={t("paint.position")} />
          <button type="button" title={t("paint.reverse")} aria-label={t("paint.reverse")} onClick={() => onChange(stops.map(([o, c]) => [Math.round((1 - o) * 1000) / 1000, c] as ColorStop), true)} className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-ink-3 hover:text-fg">
            <ArrowLeftRight size={12} />
          </button>
          <button type="button" title={t("paint.removeStop")} aria-label={t("paint.removeStop")} disabled={stops.length <= 2} onClick={() => (onChange(stops.filter((_, k) => k !== i), true), setSel(0))} className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-ink-3 hover:text-danger disabled:opacity-30">
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

export function PaintEditor({ value, onChange, allowNone, fallback = "#ffffff" }: { value: Paint | null | undefined; onChange(p: Paint | null, final: boolean): void; allowNone?: boolean; fallback?: string }) {
  const kind: PaintKind | "none" = value === null || value === undefined ? "none" : paintKind(value);
  const [sel, setSel] = useState(0);
  const kinds: (PaintKind | "none")[] = allowNone ? ["none", "solid", "linear", "radial"] : ["solid", "linear", "radial"];
  const g = value && typeof value === "object" ? (value as Gradient) : null;
  const stops = g ? stopsOf(g) : [];
  const i = Math.min(sel, Math.max(0, stops.length - 1));
  const setG = (patch: Partial<Gradient>, final: boolean) => g && onChange({ ...g, ...patch } as Gradient, final);
  return (
    <div className="w-[252px]">
      <div className="flex gap-0.5 border-b border-line p-1.5">
        {kinds.map((k) => (
          <button key={k} type="button" onClick={() => onChange(k === "none" ? null : convertPaint(value, k, fallback), true)} className={clsx("h-6 flex-1 rounded text-xs font-medium", kind === k ? "bg-ink-3 text-fg" : "text-fg-muted hover:text-fg")}>
            {t(`paint.${k}`)}
          </button>
        ))}
      </div>
      {kind === "solid" && <ColorPicker value={value as string} onChange={(c, final) => onChange(c, final)} />}
      {g && (
        <div className="space-y-2.5 p-2.5">
          <GradientStops stops={stops} selected={i} onSelect={setSel} onChange={(s, final) => setG({ stops: s }, final)} />
          {g.type === "linear" ? (
            <div className="flex items-center gap-1.5">
              <AngleDial value={g.angle ?? 90} onChange={(a, final) => setG({ angle: a }, final)} />
              <NumberField label="°" value={g.angle ?? 90} min={-360} max={360} integer onChange={(a, final) => setG({ angle: a }, final)} ariaLabel={t("paint.angle")} />
              <button type="button" title={t("paint.reverse")} aria-label={t("paint.reverse")} onClick={() => setG({ stops: stops.map(([o, c]) => [Math.round((1 - o) * 1000) / 1000, c] as ColorStop) }, true)} className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-ink-3 hover:text-fg">
                <ArrowLeftRight size={12} />
              </button>
            </div>
          ) : (
            <div className="flex gap-1">
              <NumberField label="X" value={Math.round((g.cx ?? 0.5) * 100)} min={0} max={100} integer onChange={(v, final) => setG({ cx: v / 100 }, final)} ariaLabel={t("paint.centerX")} />
              <NumberField label="Y" value={Math.round((g.cy ?? 0.5) * 100)} min={0} max={100} integer onChange={(v, final) => setG({ cy: v / 100 }, final)} ariaLabel={t("paint.centerY")} />
              <NumberField label="R" value={Math.round((g.radius ?? 1) * 100)} min={1} max={300} integer onChange={(v, final) => setG({ radius: v / 100 }, final)} ariaLabel={t("paint.radius")} />
            </div>
          )}
          {stops[i] && (
            <div className="-mx-2.5 border-t border-line">
              <div className="flex items-center justify-between px-2.5 pt-2 text-2xs text-fg-faint">
                <span>{t("paint.stop", { n: i + 1 })}</span>
                <button type="button" disabled={stops.length <= 2} onClick={() => (setG({ stops: stops.filter((_, k) => k !== i) }, true), setSel(0))} className="hover:text-danger disabled:opacity-30">
                  {t("paint.removeStop")}
                </button>
              </div>
              <ColorPicker value={stops[i][1]} onChange={(c, final) => setG({ stops: stops.map((s, k) => (k === i ? ([s[0], c] as ColorStop) : s)) }, final)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AngleDial({ value, onChange }: { value: number; onChange(v: number, final: boolean): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (e: { clientX: number; clientY: number }, final: boolean, snap: boolean) => {
    const r = ref.current!.getBoundingClientRect();
    let a = (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
    if (snap) a = Math.round(a / 15) * 15;
    onChange(Math.round(a), final);
  };
  return (
    <div
      ref={ref}
      role="slider"
      aria-label={t("paint.angle")}
      aria-valuenow={value}
      onPointerDown={(e) => ((e.target as HTMLElement).setPointerCapture(e.pointerId), at(e, false, e.shiftKey))}
      onPointerMove={(e) => e.buttons === 1 && at(e, false, e.shiftKey)}
      onPointerUp={(e) => at(e, true, e.shiftKey)}
      className="relative h-6 w-6 shrink-0 cursor-pointer rounded-full bg-ink-2 ring-1 ring-inset ring-line"
    >
      <div className="absolute left-1/2 top-1/2 h-[2px] w-[10px] origin-left rounded bg-fg" style={{ transform: `rotate(${value}deg)` }} />
    </div>
  );
}

// Swatch showing the paint; opens the editor.
export function PaintField({ value, onChange, allowNone, fallback, label }: { value: Paint | null | undefined; onChange(p: Paint | null, final: boolean): void; allowNone?: boolean; fallback?: string; label?: string }) {
  const kind = value === null || value === undefined ? "none" : paintKind(value);
  return (
    <Popover
      width={252}
      align="start"
      anchorClass="flex min-w-0 flex-1"
      trigger={(open, isOpen) => (
        <button type="button" aria-label={label ?? t("paint.edit")} aria-expanded={isOpen} onClick={open} className={clsx("field flex items-center gap-1.5 pl-0.5", isOpen && "border-accent/70 bg-ink-1")}>
          <span className="checker-sm relative h-5 w-7 shrink-0 overflow-hidden rounded-[4px] ring-1 ring-inset ring-white/10">
            <span className="absolute inset-0" style={{ background: paintToCss(value ?? null) }} />
          </span>
          <span className="truncate font-mono text-xs text-fg-muted">{kind === "none" ? t("paint.none") : kind === "solid" ? String(value) : t(`paint.${kind}`)}</span>
        </button>
      )}
    >
      {() => <PaintEditor value={value} onChange={onChange} allowNone={allowNone} fallback={fallback} />}
    </Popover>
  );
}
