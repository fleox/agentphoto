// Small previews (layers panel thumbnails, mask chips) rendered with the
// thumbnail compositor, one at a time so the UI stays responsive.

import { useEffect, useRef, useState } from "react";
import { stableStringify } from "../../core/jsonPath";
import type { Layer, Mask } from "../../core/types";
import { isGradientMask, isImageMask } from "../../core/types";
import { paintToCss } from "../lib/paint";
import { aabb } from "./boxes";
import { useDoc, useEditor, useUi } from "../state/context";

let chain: Promise<unknown> = Promise.resolve();
export function queued<T>(job: () => Promise<T>): Promise<T> {
  const p = chain.then(job, job);
  chain = p.catch(() => undefined);
  return p;
}

const dpr = () => (typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1);

// The layer drawn where it sits on the canvas, scaled to w × h.
export function LayerThumb({ layer, w, h }: { layer: Layer; w: number; h: number }) {
  const api = useEditor();
  const doc = useDoc();
  const files = useUi((s) => s.filesVersion);
  const ref = useRef<HTMLCanvasElement>(null);
  const [own, setOwn] = useState(false);
  const key = `${stableStringify(layer)}|${doc.canvas.width}x${doc.canvas.height}|${files}`;
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      void queued(async () => {
        if (cancelled) return;
        // Small layers (badges, logos) are framed on themselves; the rest shows the whole canvas.
        const b = api.boxes.get(layer.id);
        const box = b ? aabb(b) : null;
        const own = !!box && box.width * box.height < doc.canvas.width * doc.canvas.height * 0.25;
        const fw = own ? box!.width : doc.canvas.width;
        const fh = own ? box!.height : doc.canvas.height;
        const k = Math.min(w / fw, h / fh) * dpr() * (own ? 0.9 : 1);
        const surf = await api.thumbs.layerSurface({ ...layer, visible: true, opacity: 1, blend: "normal", clip: false } as Layer, doc, k).catch(() => null);
        const c = ref.current;
        if (!c || cancelled) return;
        c.width = Math.max(1, Math.round(own ? w * dpr() : doc.canvas.width * k));
        c.height = Math.max(1, Math.round(own ? h * dpr() : doc.canvas.height * k));
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, c.width, c.height);
        const ox = own ? (c.width - box!.width * k) / 2 - box!.x * k : 0;
        const oy = own ? (c.height - box!.height * k) / 2 - box!.y * k : 0;
        if (surf) ctx.drawImage(surf.canvas as CanvasImageSource, surf.x + ox, surf.y + oy);
        setOwn(own);
      });
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const aspect = doc.canvas.width / doc.canvas.height;
  const cw = own ? w : aspect >= w / h ? w : h * aspect;
  const ch = own ? h : aspect >= w / h ? w / aspect : h;
  return (
    <div className="flex shrink-0 items-center justify-center" style={{ width: w, height: h }}>
      <canvas ref={ref} className="checker-sm rounded-[2px] ring-1 ring-white/10" style={{ width: cw, height: ch }} />
    </div>
  );
}

// Mask chip: the mask as white (visible) on black (hidden).
export function MaskThumb({ mask, w, h, frame }: { mask: Mask; w: number; h: number; frame?: { width: number; height: number } }) {
  const api = useEditor();
  const files = useUi((s) => s.filesVersion);
  const ref = useRef<HTMLCanvasElement>(null);
  const src = isImageMask(mask) ? mask.src : null;
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    void queued(async () => {
      const img = await api.engine.loader.image(src).catch(() => null);
      const c = ref.current;
      if (!img || !c || cancelled) return;
      c.width = w * 2;
      c.height = h * 2;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, c.width, c.height);
      const k = Math.min(c.width / img.width, c.height / img.height);
      ctx.drawImage(img as CanvasImageSource, (c.width - img.width * k) / 2, (c.height - img.height * k) / 2, img.width * k, img.height * k);
      if (mask.invert) {
        ctx.globalCompositeOperation = "difference";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api, src, w, h, files, mask.invert]);
  if (src) return <canvas ref={ref} style={{ width: w, height: h }} className="rounded-[2px] bg-black" />;
  if (isGradientMask(mask)) return <div style={{ width: w, height: h, background: paintToCss(mask.gradient), filter: `grayscale(1)${mask.invert ? " invert(1)" : ""}` }} className="rounded-[2px]" />;
  // Shape mask drawn where it sits in its frame (the layer box or the canvas).
  const m = mask as { shape: "rect" | "ellipse"; x: number; y: number; width: number; height: number };
  const fw = frame?.width || m.x + m.width || 1;
  const fh = frame?.height || m.y + m.height || 1;
  const pct = (v: number, d: number) => `${Math.max(-50, Math.min(150, (v / d) * 100))}%`;
  return (
    <div style={{ width: w, height: h, background: mask.invert ? "#fff" : "#000" }} className="relative overflow-hidden rounded-[2px]">
      <div className="absolute" style={{ left: pct(m.x, fw), top: pct(m.y, fh), width: pct(m.width, fw), height: pct(m.height, fh), background: mask.invert ? "#000" : "#fff", borderRadius: m.shape === "ellipse" ? "50%" : 1, filter: mask.feather ? "blur(1px)" : undefined }} />
    </div>
  );
}
