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
