// Numeric input with drag-to-scrub on its label (Figma / Blender style):
// drag horizontally to change, Shift = ×10, Alt = ×0.1; type to set;
// ↑/↓ step. onChange(value, final): final is false while dragging.

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { clampNumber, formatNumber } from "../../lib/num";

export interface NumberFieldProps {
  value: number;
  onChange(value: number, final: boolean): void;
  label?: string;
  labelClass?: string;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  suffix?: string;
  placeholder?: boolean; // value shown is a default (dimmed)
  empty?: boolean; // no value and no default: show "auto" instead of a number
  ariaLabel?: string;
  className?: string;
}

export function NumberField({ value, onChange, label, labelClass, step, min, max, integer, suffix, placeholder, empty, ariaLabel, className }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const drag = useRef<{ x: number; start: number; moved: boolean; last: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const s = step ?? (integer ? 1 : Math.abs(value) >= 10 ? 0.1 : 0.01);
  const clamp = (n: number) => clampNumber({ min, max, integer }, n);

  useEffect(() => {
    setDraft(null);
  }, [value]);

  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.replace(",", "."));
    setDraft(null);
    if (Number.isFinite(n) && n !== value) onChange(clamp(n), true);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: value, moved: false, last: value };
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 2) return;
    d.moved = true;
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const raw = d.start + dx * s * mult;
    const digits = integer ? 0 : Math.max(0, Math.ceil(-Math.log10(s * mult)));
    const n = clamp(Number(raw.toFixed(Math.min(digits, 6))));
    if (n !== d.last) {
      d.last = n;
      onChange(n, false);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!d) return;
    if (d.moved) onChange(d.last, true);
    else inputRef.current?.focus();
  };

  return (
    <div className={clsx("flex h-6 min-w-0 flex-1 items-center rounded-[5px] border border-transparent bg-ink-2 focus-within:border-accent/70 focus-within:bg-ink-1 hover:border-line", className)}>
      {label !== undefined && (
        <span
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className={clsx("flex h-full w-4 shrink-0 cursor-ew-resize select-none items-center justify-center text-2xs font-semibold", labelClass ?? "text-fg-faint")}
        >
          {label}
        </span>
      )}
      <input
        ref={inputRef}
        aria-label={ariaLabel ?? label}
        inputMode="decimal"
        value={draft ?? (empty ? "" : formatNumber(value, integer ? 0 : 3))}
        placeholder={empty ? "auto" : undefined}
        onPointerDown={label === undefined ? onPointerDown : undefined}
        onPointerMove={label === undefined ? onPointerMove : undefined}
        onPointerUp={label === undefined ? onPointerUp : undefined}
        onFocus={(e) => {
          setDraft(formatNumber(value, integer ? 0 : 3));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") {
            setDraft(null);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const n = clamp(Number(((Number(draft ?? value) || 0) + (e.key === "ArrowUp" ? 1 : -1) * s * (e.shiftKey ? 10 : 1)).toFixed(6)));
            setDraft(formatNumber(n, integer ? 0 : 3));
            onChange(n, true);
          }
        }}
        className={clsx("h-full w-full min-w-0 bg-transparent px-1 text-sm tabular-nums outline-none", label === undefined && "cursor-ew-resize focus:cursor-text", placeholder && draft === null ? "text-fg-faint" : "text-fg")}
      />
      {suffix && <span className="pr-1.5 text-2xs text-fg-faint">{suffix}</span>}
    </div>
  );
}

const AXIS_COLORS = ["text-[#f2766d]", "text-[#7bd88f]", "text-[#6fa8ff]"];

export function VecField({ value, onChange, labels = ["X", "Y", "Z"], step, suffix, placeholder, min }: { value: number[]; onChange(v: number[], final: boolean): void; labels?: string[]; step?: number; suffix?: string; placeholder?: boolean; min?: number }) {
  return (
    <div className="flex min-w-0 flex-1 gap-1">
      {value.map((v, i) => (
        <NumberField
          key={i}
          label={labels[i]}
          labelClass={AXIS_COLORS[i]}
          value={v}
          step={step}
          min={min}
          suffix={suffix}
          placeholder={placeholder}
          onChange={(n, final) => {
            const next = [...value];
            next[i] = n;
            onChange(next, final);
          }}
        />
      ))}
    </div>
  );
}

// Number with a slider (bounded params, e.g. roughness 0..1): drag the track
// or type in the field. onChange(value, final) like NumberField.
export function SliderField({ value, min, max, onChange, integer, placeholder, empty, ariaLabel, step }: { value: number; min: number; max: number; onChange(v: number, final: boolean): void; integer?: boolean; placeholder?: boolean; empty?: boolean; ariaLabel?: string; step?: number }) {
  const range = max - min || 1;
  const s = step ?? (integer ? 1 : range <= 2 ? 0.01 : range <= 20 ? 0.05 : range / 200);
  const pct = empty ? 0 : Math.max(0, Math.min(1, (value - min) / range)) * 100;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <div className="relative flex h-6 min-w-0 flex-1 items-center">
        <div className="pointer-events-none absolute inset-x-0 h-[3px] rounded-full bg-ink-4">
          <div className={clsx("h-full rounded-full", placeholder ? "bg-fg-faint/50" : "bg-accent")} style={{ width: `${pct}%` }} />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={s}
          value={Number.isFinite(value) ? value : min}
          aria-label={ariaLabel}
          onChange={(e) => onChange(clampNumber({ min, max, integer }, Number(e.target.value)), false)}
          onPointerUp={(e) => onChange(clampNumber({ min, max, integer }, Number((e.target as HTMLInputElement).value)), true)}
          onKeyUp={(e) => onChange(clampNumber({ min, max, integer }, Number((e.target as HTMLInputElement).value)), true)}
          className={clsx("slider relative h-6 w-full cursor-pointer appearance-none bg-transparent", empty && "opacity-40")}
        />
      </div>
      <NumberField value={value} min={min} max={max} integer={integer} placeholder={placeholder} empty={empty} onChange={onChange} ariaLabel={ariaLabel} className="w-[52px] flex-none" step={s} />
    </div>
  );
}
