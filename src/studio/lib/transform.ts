// Transform math for the viewport (pure, tested): resize with handles on
// rotated boxes, rotation with snapping, smart-guide snapping for moves.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface Pt {
  x: number;
  y: number;
}

// Handle direction: -1 / 0 / 1 on each axis (corners: both non-zero).
export interface Handle {
  hx: -1 | 0 | 1;
  hy: -1 | 0 | 1;
}

export const HANDLES: Handle[] = [
  { hx: -1, hy: -1 },
  { hx: 0, hy: -1 },
  { hx: 1, hy: -1 },
  { hx: 1, hy: 0 },
  { hx: 1, hy: 1 },
  { hx: 0, hy: 1 },
  { hx: -1, hy: 1 },
  { hx: -1, hy: 0 },
];

const rad = (deg: number) => (deg * Math.PI) / 180;

export function rotate(p: Pt, deg: number): Pt {
  const r = rad(deg);
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
}

export const center = (b: Box): Pt => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

// Document position of a handle of a (rotated) box.
export function handlePoint(b: Box, h: Handle): Pt {
  const c = center(b);
  const o = rotate({ x: (h.hx * b.width) / 2, y: (h.hy * b.height) / 2 }, b.rotation);
  return { x: c.x + o.x, y: c.y + o.y };
}

// New box when dragging handle `h` to document point `p` (the opposite side
// stays put). keepRatio keeps the aspect ratio.
export function resizeBox(start: Box, h: Handle, p: Pt, keepRatio: boolean, minSize = 1): Omit<Box, "rotation"> {
  const c0 = center(start);
  const local = rotate({ x: p.x - c0.x, y: p.y - c0.y }, -start.rotation);
  const ax = (-h.hx * start.width) / 2;
  const ay = (-h.hy * start.height) / 2;
  let w = h.hx ? Math.max(minSize, (local.x - ax) * h.hx) : start.width;
  let hgt = h.hy ? Math.max(minSize, (local.y - ay) * h.hy) : start.height;
  if (keepRatio && start.width > 0 && start.height > 0) {
    let k: number;
    if (h.hx && h.hy) k = Math.max(w / start.width, hgt / start.height);
    else if (h.hx) k = w / start.width;
    else k = hgt / start.height;
    w = Math.max(minSize, start.width * k);
    hgt = Math.max(minSize, start.height * k);
  }
  const cl = { x: h.hx ? ax + (h.hx * w) / 2 : 0, y: h.hy ? ay + (h.hy * hgt) / 2 : 0 };
  const off = rotate(cl, start.rotation);
  const cx = c0.x + off.x;
  const cy = c0.y + off.y;
  return { x: cx - w / 2, y: cy - hgt / 2, width: w, height: hgt };
}

// Rotation when dragging from `from` to `to` around the box centre; snap = 15° steps.
export function rotateBox(start: Box, from: Pt, to: Pt, snap: boolean): number {
  const c = center(start);
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  const a1 = Math.atan2(to.y - c.y, to.x - c.x);
  let deg = start.rotation + ((a1 - a0) * 180) / Math.PI;
  if (snap) deg = Math.round(deg / 15) * 15;
  deg = ((((deg + 180) % 360) + 360) % 360) - 180;
  return Math.round(deg * 10) / 10;
}

export interface SnapTargets {
  xs: number[];
  ys: number[];
}

export interface SnapResult {
  dx: number;
  dy: number;
  // Guide lines to draw (document px).
  guides: { axis: "x" | "y"; at: number }[];
}

// Snaps a moving rectangle's edges / centre to the closest target lines.
export function snapRect(r: { x: number; y: number; width: number; height: number }, targets: SnapTargets, threshold: number): SnapResult {
  const pick = (vals: number[], lines: number[]) => {
    let best: { d: number; at: number } | null = null;
    for (const v of vals)
      for (const l of lines) {
        const d = l - v;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: l };
      }
    return best;
  };
  const bx = pick([r.x, r.x + r.width / 2, r.x + r.width], targets.xs);
  const by = pick([r.y, r.y + r.height / 2, r.y + r.height], targets.ys);
  const guides: SnapResult["guides"] = [];
  if (bx) guides.push({ axis: "x", at: bx.at });
  if (by) guides.push({ axis: "y", at: by.at });
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0, guides };
}

// Canvas edges + centre and other layers' edges / centres.
export function snapTargets(canvas: { width: number; height: number }, others: { x: number; y: number; width: number; height: number }[]): SnapTargets {
  const xs = [0, canvas.width / 2, canvas.width];
  const ys = [0, canvas.height / 2, canvas.height];
  for (const o of others) {
    xs.push(o.x, o.x + o.width / 2, o.x + o.width);
    ys.push(o.y, o.y + o.height / 2, o.y + o.height);
  }
  return { xs, ys };
}

// Normalised rectangle from two drag points (Shift: square, Alt: from centre).
export function dragRect(a: Pt, b: Pt, square = false, fromCenter = false): { x: number; y: number; width: number; height: number } {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (square) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  if (fromCenter) return { x: a.x - Math.abs(dx), y: a.y - Math.abs(dy), width: Math.abs(dx) * 2, height: Math.abs(dy) * 2 };
  return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), width: Math.abs(dx), height: Math.abs(dy) };
}

// Clamp a rectangle inside the canvas.
export function clampRect(r: { x: number; y: number; width: number; height: number }, W: number, H: number) {
  const x = Math.max(0, Math.min(W, r.x));
  const y = Math.max(0, Math.min(H, r.y));
  return { x, y, width: Math.max(0, Math.min(W, r.x + r.width) - x), height: Math.max(0, Math.min(H, r.y + r.height) - y) };
}
