// Tone curve editor (curves filter): drag points, click the curve to add one,
// double-click a point (or drag it out of the box) to remove it. Points are
// [input, output] 0..255; the curve is drawn with the engine's own LUT.

import { useRef, useState } from "react";
import { tapTracker } from "../../lib/touch";
import { curveLut } from "../../../engine/filters/pixels";
import { t } from "../../i18n";

export type CurvePoints = [number, number][];

const SIZE = 236;
const pad = 6;
const inner = SIZE - pad * 2;
const sx = (v: number) => pad + (v / 255) * inner;
const sy = (v: number) => pad + (1 - v / 255) * inner;

export function CurveEditor({ points, onChange, color = "rgb(var(--fg))" }: { points: CurvePoints; onChange(p: CurvePoints, final: boolean): void; color?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ i: number; out: boolean } | null>(null);
  const tap = useRef(tapTracker());
  const [active, setActive] = useState<number | null>(null);
  const pts = points.length >= 2 ? points : ([[0, 0], [255, 255]] as CurvePoints);
  const lut = curveLut(pts);
  const path = Array.from({ length: 64 }, (_, k) => {
    const x = Math.round((k / 63) * 255);
    return `${k ? "L" : "M"}${sx(x).toFixed(1)},${sy(lut[x]).toFixed(1)}`;
  }).join("");
  const toVal = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * SIZE;
    const y = ((e.clientY - r.top) / r.height) * SIZE;
    return { x: Math.round(((x - pad) / inner) * 255), y: Math.round((1 - (y - pad) / inner) * 255) };
  };
  const clampPt = (i: number, v: { x: number; y: number }): [number, number] => {
    const sorted = pts;
    const lo = i > 0 ? sorted[i - 1][0] + 1 : 0;
    const hi = i < sorted.length - 1 ? sorted[i + 1][0] - 1 : 255;
    const fixedX = i === 0 ? Math.min(v.x, hi) : i === sorted.length - 1 ? Math.max(v.x, lo) : v.x;
    return [Math.max(lo, Math.min(hi, fixedX)), Math.max(0, Math.min(255, v.y))];
  };
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="aspect-square w-full touch-none select-none rounded-md bg-ink-0"
      role="img"
      aria-label={t("curve.label")}
      onPointerDown={(e) => {
        if ((e.target as Element).tagName === "circle") return;
        const v = toVal(e);
        const next = [...pts, [Math.max(0, Math.min(255, v.x)), Math.max(0, Math.min(255, v.y))] as [number, number]].sort((a, b) => a[0] - b[0]);
        const i = next.findIndex((p) => p[0] === Math.max(0, Math.min(255, v.x)));
        onChange(next, false);
        drag.current = { i, out: false };
        setActive(i);
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || e.buttons !== 1) return;
        const v = toVal(e);
        const removable = d.i > 0 && d.i < pts.length - 1;
        d.out = removable && (v.y < -30 || v.y > 285 || v.x < -30 || v.x > 285);
        const next = pts.map((p, k) => (k === d.i ? clampPt(k, v) : p)) as CurvePoints;
        onChange(next, false);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        onChange(d.out ? pts.filter((_, k) => k !== d.i) : pts, true);
        if (d.out) setActive(null);
      }}
    >
      {[0.25, 0.5, 0.75].map((f) => (
        <g key={f} stroke="rgb(255 255 255 / 0.07)">
          <line x1={pad + f * inner} y1={pad} x2={pad + f * inner} y2={pad + inner} />
          <line x1={pad} y1={pad + f * inner} x2={pad + inner} y2={pad + f * inner} />
        </g>
      ))}
      <rect x={pad} y={pad} width={inner} height={inner} fill="none" stroke="rgb(255 255 255 / 0.12)" />
      <line x1={sx(0)} y1={sy(0)} x2={sx(255)} y2={sy(255)} stroke="rgb(255 255 255 / 0.12)" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.75} />
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={sx(x)}
          cy={sy(y)}
          r={active === i ? 5 : 4}
          fill={active === i ? color : "rgb(var(--ink-0))"}
          stroke={color}
          strokeWidth={1.5}
          className="cursor-grab"
          onPointerDown={(e) => {
            e.stopPropagation();
            drag.current = { i, out: false };
            setActive(i);
            (e.currentTarget.ownerSVGElement as Element).setPointerCapture(e.pointerId);
          }}
          onDoubleClick={() => i > 0 && i < pts.length - 1 && onChange(pts.filter((_, k) => k !== i), true)}
          onPointerUp={(e) => {
            // Touch: double tap removes an inner point.
            if (tap.current(`pt:${i}`, e) && i > 0 && i < pts.length - 1) onChange(pts.filter((_, k) => k !== i), true);
          }}
        />
      ))}
    </svg>
  );
}
