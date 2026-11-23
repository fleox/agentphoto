// HSV colour picker (saturation / value square, hue and alpha sliders, hex +
// alpha inputs, screen eyedropper when the browser has one, recent colours)
// and the ColorField that opens it in a popover.

import clsx from "clsx";
import { Pipette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isValidColor, parseColor } from "../../../core/color";
import { t } from "../../i18n";
import { colorToHsv, formatColor, hsvToColor, hsvToRgb, type Hsva } from "../../lib/paint";
import { Popover } from "./Popover";

const RECENT_KEY = "agentphoto.studio.recentColors";
const PALETTE = ["#ffffff", "#000000", "#e5e7eb", "#6b7280", "#ef4444", "#f97316", "#f59e0b", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#7c8cff"];

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    return Array.isArray(v) ? v.filter((c) => isValidColor(c)).slice(0, 8) : [];
  } catch {
    return [];
  }
}
export function rememberColor(c: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([c, ...readRecent().filter((x) => x !== c)].slice(0, 8)));
  } catch {
    /* ignore */
  }
}

function useDrag(onPos: (x: number, y: number, final: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (e: { clientX: number; clientY: number }, final: boolean) => {
    const r = ref.current!.getBoundingClientRect();
    onPos(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)), final);
  };
  return {
    ref,
    onPointerDown: (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      at(e, false);
    },
    onPointerMove: (e: React.PointerEvent) => e.buttons === 1 && at(e, false),
    onPointerUp: (e: React.PointerEvent) => at(e, true),
  };
}

export function ColorPicker({ value, onChange, alpha = true }: { value: string; onChange(v: string, final: boolean): void; alpha?: boolean }) {
  const [hsv, setHsv] = useState<Hsva>(() => colorToHsv(value));
  const [hex, setHex] = useState<string | null>(null);
  const last = useRef(value);
  // External value changes (undo, another stop) re-sync the picker; keep the hue for greys.
  useEffect(() => {
    if (value === last.current) return;
    last.current = value;
    const next = colorToHsv(value);
    setHsv((h) => ({ ...next, h: next.s === 0 || next.v === 0 ? h.h : next.h }));
  }, [value]);
  const emit = (next: Hsva, final: boolean) => {
    setHsv(next);
    const c = hsvToColor(alpha ? next : { ...next, a: 1 });
    last.current = c;
    onChange(c, final);
    if (final) rememberColor(c);
  };
  const sv = useDrag((x, y, final) => emit({ ...hsv, s: x, v: 1 - y }, final));
  const hue = useDrag((x, _y, final) => emit({ ...hsv, h: Math.min(359.9, x * 360) }, final));
  const al = useDrag((x, _y, final) => emit({ ...hsv, a: Math.round(x * 100) / 100 }, final));
  const rgb = hsvToRgb({ ...hsv, a: 1 });
  const solid = formatColor({ ...rgb, a: 1 });
  const pure = formatColor({ ...hsvToRgb({ h: hsv.h, s: 1, v: 1, a: 1 }), a: 1 });
  const recent = readRecent();
  const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

  return (
    <div className="w-[232px] select-none space-y-2.5 p-2.5">
      <div {...sv} className="relative h-[150px] cursor-crosshair rounded-md" style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})` }}>
        <div className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: solid }} />
      </div>
      <div className="flex items-center gap-2">
        {hasEyeDropper && (
          <button
            type="button"
            title={t("color.eyedropper")}
            aria-label={t("color.eyedropper")}
            onClick={async () => {
              try {
                const r = await new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open();
                emit({ ...colorToHsv(r.sRGBHex), a: hsv.a }, true);
              } catch {
                /* cancelled */
              }
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-ink-3 hover:text-fg"
          >
            <Pipette size={14} />
          </button>
        )}
        <div className="flex-1 space-y-2">
          <div {...hue} className="relative h-2.5 cursor-pointer rounded-full" style={{ background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}>
            <Thumb at={hsv.h / 360} color={pure} />
          </div>
          {alpha && (
            <div {...al} className="checker-sm relative h-2.5 cursor-pointer rounded-full">
              <div className="absolute inset-0 rounded-full" style={{ background: `linear-gradient(to right, transparent, ${solid})` }} />
              <Thumb at={hsv.a} color={solid} />
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-1.5">
        <input
          aria-label={t("color.hex")}
          spellCheck={false}
          value={hex ?? solid}
          onFocus={(e) => (setHex(solid), requestAnimationFrame(() => e.target.select()))}
          onChange={(e) => setHex(e.target.value)}
          onBlur={() => {
            const v = (hex ?? "").trim();
            setHex(null);
            const p = parseColor(v.startsWith("#") || !/^[0-9a-f]{3,8}$/i.test(v) ? v : `#${v}`);
            if (p) emit({ ...colorToHsv(formatColor(p)), a: alpha ? p.a : 1 }, true);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="field h-7 flex-1 font-mono text-xs uppercase"
        />
        {alpha && (
          <div className="flex h-7 w-[58px] items-center rounded-[5px] bg-ink-2 pr-1.5">
            <input
              aria-label={t("color.alpha")}
              inputMode="numeric"
              value={Math.round(hsv.a * 100)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) emit({ ...hsv, a: Math.max(0, Math.min(100, n)) / 100 }, true);
              }}
              className="h-full w-full min-w-0 bg-transparent px-1.5 text-right text-sm tabular-nums outline-none"
            />
            <span className="text-2xs text-fg-faint">%</span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-8 gap-1">
        {[...recent, ...PALETTE].slice(0, 16).map((c, i) => (
          <button key={`${c}${i}`} type="button" title={c} aria-label={c} onClick={() => emit({ ...colorToHsv(c), a: alpha ? (parseColor(c)?.a ?? 1) : 1 }, true)} className="checker-sm relative h-5 overflow-hidden rounded-[4px] ring-1 ring-white/10 hover:ring-white/40">
            <span className="absolute inset-0" style={{ background: c }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Thumb({ at, color }: { at: number; color: string }) {
  return <div className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" style={{ left: `${at * 100}%`, background: color }} />;
}

// A swatch (checker under the colour) that opens the picker.
export function SwatchButton({ css, onClick, open, ariaLabel, className }: { css: string; onClick(): void; open?: boolean; ariaLabel?: string; className?: string }) {
  return (
    <button type="button" aria-label={ariaLabel ?? t("color.pick")} aria-expanded={open} onClick={onClick} className={clsx("checker-sm relative h-6 w-6 shrink-0 overflow-hidden rounded-[5px] ring-1 ring-inset ring-white/10 hover:ring-white/30", open && "ring-accent", className)}>
      <span className="absolute inset-0" style={{ background: css }} />
    </button>
  );
}

// Colour swatch + hex text, the picker in a popover.
export function ColorField({ value, onChange, alpha = true, compact }: { value: string; onChange(v: string, final: boolean): void; alpha?: boolean; compact?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Popover width={232} align="start" trigger={(open, isOpen) => <SwatchButton css={isValidColor(value) ? value : "transparent"} onClick={open} open={isOpen} />}>
        {() => <ColorPicker value={value} onChange={onChange} alpha={alpha} />}
      </Popover>
      {!compact && (
        <input
          aria-label={t("color.value")}
          spellCheck={false}
          value={draft ?? value}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null && isValidColor(draft.trim())) onChange(draft.trim(), true);
            setDraft(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="field font-mono text-xs"
        />
      )}
    </div>
  );
}
