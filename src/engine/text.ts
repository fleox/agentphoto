// Text layers: layout (wrap, line height, letter spacing, transform) and drawing.

import type { TextLayer } from "../core/types";
import { createCanvas, ctx2d, type Ctx } from "./canvas";
import { fillStyle } from "./paint";

export interface TextLayout {
  font: string;
  lines: { text: string; width: number }[];
  // Box in layer px (unscaled): explicit width / height or the measured text.
  width: number;
  height: number;
  lineHeight: number;
  ascent: number;
  descent: number;
  textHeight: number;
}

let measureCtx: Ctx | null = null;
const mctx = () => (measureCtx ??= ctx2d(createCanvas(8, 8)));

export function cssFont(l: TextLayer, family: string, size: number): string {
  const fam = /[\s,'"]/.test(family) && !/^["']/.test(family) && !family.includes(",") ? `"${family}"` : family;
  return `${l.italic ? "italic " : ""}${l.weight ?? 400} ${size}px ${fam}, system-ui, sans-serif`;
}

const applyTransform = (l: TextLayer, s: string) => (l.transform === "uppercase" ? s.toUpperCase() : l.transform === "lowercase" ? s.toLowerCase() : s);

function setSpacing(ctx: Ctx, px: number): boolean {
  if ("letterSpacing" in ctx) {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
    return true;
  }
  return false;
}

function measure(ctx: Ctx, s: string, spacing: number, native: boolean): number {
  if (!s) return 0;
  if (native || !spacing) return ctx.measureText(s).width;
  return ctx.measureText(s).width + spacing * (Array.from(s).length - 1);
}

// Layout at size `size` (px) — the engine calls it with scaled sizes.
export function layoutText(l: TextLayer, family: string, scale = 1): TextLayout {
  const ctx = mctx();
  const size = (l.size ?? 64) * scale;
  const spacing = (l.letterSpacing ?? 0) * scale;
  const font = cssFont(l, family, size);
  ctx.font = font;
  const native = setSpacing(ctx, spacing);
  const maxW = l.width !== undefined ? l.width * scale : Infinity;
  const lines: { text: string; width: number }[] = [];
  for (const para of applyTransform(l, String(l.text ?? "")).split("\n")) {
    const words = para.split(/(\s+)/);
    let cur = "";
    for (const w of words) {
      const next = cur + w;
      if (cur && measure(ctx, next.trimEnd(), spacing, native) > maxW && w.trim()) {
        lines.push({ text: cur.trimEnd(), width: measure(ctx, cur.trimEnd(), spacing, native) });
        cur = w.trimStart();
        // A single word longer than the box: break it by characters.
        while (measure(ctx, cur, spacing, native) > maxW && cur.length > 1) {
          let k = cur.length - 1;
          while (k > 1 && measure(ctx, cur.slice(0, k), spacing, native) > maxW) k--;
          lines.push({ text: cur.slice(0, k), width: measure(ctx, cur.slice(0, k), spacing, native) });
          cur = cur.slice(k);
        }
      } else cur = next;
    }
    lines.push({ text: cur.trimEnd(), width: measure(ctx, cur.trimEnd(), spacing, native) });
  }
  const m = ctx.measureText("Hg");
  const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? size * 0.8;
  const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? size * 0.2;
  const lineHeight = (l.lineHeight ?? 1.2) * size;
  const textW = Math.max(0, ...lines.map((x) => x.width));
  const textHeight = lineHeight * lines.length;
  if (native) setSpacing(ctx, 0);
  return {
    font,
    lines,
    width: (l.width !== undefined ? l.width * scale : textW) / scale,
    height: (l.height !== undefined ? l.height * scale : textHeight) / scale,
    lineHeight,
    ascent,
    descent,
    textHeight,
  };
}

// What a text layer actually paints, in layer px relative to its box's
// top-left corner (scale 1): the lines placed by align / valign (font ascent
// + descent per line) and the background with its padding. Empty text with no
// background → null. Glyph overhang (italics) is not measured.
export function textInkBox(l: TextLayer, lay: TextLayout): { x: number; y: number; width: number; height: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (ax: number, ay: number, bx: number, by: number) => {
    x0 = Math.min(x0, ax);
    y0 = Math.min(y0, ay);
    x1 = Math.max(x1, bx);
    y1 = Math.max(y1, by);
  };
  const w = lay.width;
  const h = lay.height;
  if (l.background) {
    const [px, py] = backgroundPad(l);
    add(-px, -py, w + px, h + py);
  }
  const valign = l.valign ?? "top";
  const top = valign === "middle" ? (h - lay.textHeight) / 2 : valign === "bottom" ? h - lay.textHeight : 0;
  const align = l.align ?? "left";
  lay.lines.forEach((line, i) => {
    if (!line.text || line.width <= 0) return;
    const lineTop = top + i * lay.lineHeight + (lay.lineHeight - (lay.ascent + lay.descent)) / 2;
    const x = align === "center" ? (w - line.width) / 2 : align === "right" ? w - line.width : 0;
    add(x, lineTop, x + line.width, lineTop + lay.ascent + lay.descent);
  });
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function backgroundPad(l: TextLayer): [number, number] {
  const p = l.background?.padding ?? 0;
  return Array.isArray(p) ? [p[0], p[1]] : [p, p];
}

// Draws the text into a new canvas: returns it with the offset of the box's
// top-left corner inside it (background padding).
export function drawText(l: TextLayer, family: string, scale: number): { canvas: ReturnType<typeof createCanvas>; ox: number; oy: number; w: number; h: number } {
  const lay = layoutText(l, family, scale);
  const w = lay.width * scale;
  const h = lay.height * scale;
  const [px, py] = l.background ? backgroundPad(l).map((v) => v * scale) : [0, 0];
  // Glyph overhang (italics, script fonts) — keep a margin around the box.
  const m = Math.ceil(((l.size ?? 64) * scale) * 0.25);
  const ox = Math.ceil(px) + m;
  const oy = Math.ceil(py) + m;
  const c = createCanvas(w + ox * 2, h + oy * 2);
  const ctx = ctx2d(c);
  if (l.background) {
    ctx.fillStyle = l.background.color;
    const r = (l.background.radius ?? 0) * scale;
    ctx.beginPath();
    roundRect(ctx, ox - px, oy - py, w + px * 2, h + py * 2, r);
    ctx.fill();
  }
  ctx.font = lay.font;
  const native = setSpacing(ctx, (l.letterSpacing ?? 0) * scale);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = fillStyle(ctx, l.color ?? "#ffffff", { x: ox, y: oy, w, h });
  const valign = l.valign ?? "top";
  const top = oy + (valign === "middle" ? (h - lay.textHeight) / 2 : valign === "bottom" ? h - lay.textHeight : 0);
  const spacing = (l.letterSpacing ?? 0) * scale;
  lay.lines.forEach((line, i) => {
    const lineTop = top + i * lay.lineHeight;
    const baseline = lineTop + (lay.lineHeight - (lay.ascent + lay.descent)) / 2 + lay.ascent;
    const align = l.align ?? "left";
    const x = ox + (align === "center" ? (w - line.width) / 2 : align === "right" ? w - line.width : 0);
    if (native || !spacing) ctx.fillText(line.text, x, baseline);
    else {
      let cx = x;
      for (const ch of Array.from(line.text)) {
        ctx.fillText(ch, cx, baseline);
        cx += ctx.measureText(ch).width + spacing;
      }
    }
  });
  return { canvas: c, ox, oy, w, h };
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!rr) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
