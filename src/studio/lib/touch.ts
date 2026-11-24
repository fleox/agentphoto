// Touch screens: the narrow-layout breakpoint and two-finger pinch / pan of the
// viewport (pure, so it is tested without a DOM).

import { useSyncExternalStore } from "react";
import type { View } from "../state/context";
import { ZOOM_MAX, ZOOM_MIN } from "../tools/view";

// Below Tailwind's `md` (768 px): panels become a drawer, the top bar is compact.
export const NARROW_QUERY = "(max-width: 767px)";

const subscribe = (cb: () => void) => {
  if (typeof matchMedia === "undefined") return () => undefined;
  const m = matchMedia(NARROW_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

export function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof matchMedia !== "undefined" && matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

export interface Pt {
  x: number;
  y: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// The view while two fingers move from (a0, b0) to (a, b), from view `start`:
// the document point under the fingers' midpoint follows the midpoint, and the
// zoom follows the distance between the fingers.
export function pinchView(start: View, a0: Pt, b0: Pt, a: Pt, b: Pt): View {
  const d0 = Math.max(1, dist(a0, b0));
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, start.zoom * (dist(a, b) / d0)));
  const c0 = mid(a0, b0);
  const c = mid(a, b);
  // Document point under the starting midpoint.
  const docX = (c0.x - start.x) / start.zoom;
  const docY = (c0.y - start.y) / start.zoom;
  return { zoom, x: c.x - docX * zoom, y: c.y - docY * zoom };
}

// Double tap on touch screens: Safari does not reliably send dblclick (nor a
// click count in `detail`), so two taps on the same target, close in time and
// place, are detected here. Mouse events are left to dblclick / `detail`.
export const DOUBLE_TAP_MS = 350;
export const DOUBLE_TAP_PX = 24;

export interface Tap {
  key: string;
  t: number;
  x: number;
  y: number;
}

export function isDoubleTap(last: Tap | null, next: Tap): boolean {
  return !!last && last.key === next.key && next.t - last.t <= DOUBLE_TAP_MS && Math.hypot(next.x - last.x, next.y - last.y) <= DOUBLE_TAP_PX;
}

// One tracker per component (keep it in a ref): call it on pointerdown / up
// with a key naming the target; true on the second tap of a double tap.
export function tapTracker(): (key: string, e: { pointerType: string; clientX: number; clientY: number; timeStamp: number }) => boolean {
  let last: Tap | null = null;
  return (key, e) => {
    if (e.pointerType === "mouse") return false;
    const next = { key, t: e.timeStamp, x: e.clientX, y: e.clientY };
    const double = isDoubleTap(last, next);
    last = double ? null : next;
    return double;
  };
}
