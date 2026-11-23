// The canvas viewport: live render of the document (engine compositor, at
// viewport resolution), pan / zoom (wheel, pinch, space-drag, hand / zoom
// tools), the overlay (selection frames, transform handles, smart guides,
// marquee, crop, drafts, agent highlights), tool pointer handling, inline
// text editing, file drop and paste.

import clsx from "clsx";
import { ImagePlus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { hasBox, type Layer, type PhotoDoc } from "../../core/types";
import { findLayer } from "../../ops/tree";
import { useI18n } from "../i18n";
import { hitTest, movableLayers, unionBox } from "../lib/hit";
import { formatColor } from "../lib/paint";
import { HANDLES, handlePoint } from "../lib/transform";
import { aabb, boxCorners } from "../render/boxes";
import { LiveRenderer } from "../render/liveRenderer";
import { useEditor, useSnapshot, useUi, type View } from "../state/context";
import { isTyping } from "../state/shortcuts";
import { toolCtx } from "../state/toolCtx";
import { handlesFor, rotationHandle } from "../tools/move";
import { toolById } from "../tools/registry";
import type { DragSession, PointerInfo, Pt, ToolCtx } from "../tools/types";
import { panSession, zoomAt } from "../tools/view";
import { TextEditor } from "./TextEditor";

const GUIDE = "rgb(255 79 216)";

// Render resolution: quarter-octave steps ≥ zoom × dpr, at most 1 (document px).
export function renderScaleFor(zoom: number, dpr: number): number {
  const x = zoom * dpr;
  if (x >= 1) return 1;
  return Math.min(1, 2 ** (Math.ceil(Math.log2(x) * 4) / 4));
}

export function fitView(doc: PhotoDoc, w: number, h: number, margin = 56): View {
  const zoom = Math.max(0.02, Math.min(4, (w - margin * 2) / doc.canvas.width, (h - margin * 2) / doc.canvas.height));
  return { zoom, x: Math.round((w - doc.canvas.width * zoom) / 2), y: Math.round((h - doc.canvas.height * zoom) / 2) };
}

// The document shown for "alt-click on a mask chip": the layer's alpha × mask, white on black.
function maskPreviewDoc(doc: PhotoDoc, id: string): PhotoDoc | null {
  const l = findLayer(doc.layers, id)?.layer;
  if (!l || !l.mask) return null;
  const { filters: _f, effects: _e, clip: _c, ...rest } = l as Layer & Record<string, unknown>;
  const layer = { ...rest, opacity: 1, blend: "normal", visible: true, effects: { colorOverlay: { color: "#ffffff" } } } as Layer;
  if (l.type === "adjustment" || l.type === "group") return { ...doc, canvas: { ...doc.canvas, background: "#000000" }, layers: [{ id: "mask-preview", type: "fill", fill: "#ffffff", mask: l.mask }] };
  return { ...doc, canvas: { ...doc.canvas, background: "#000000" }, layers: [layer] };
}

export function Viewport() {
  const { t } = useI18n();
  const api = useEditor();
  const { ui, store, engine, boxes } = api;
  const snap = useSnapshot();
  const doc = snap.doc!;
  const selection = snap.selection;
  const view = useUi((s) => s.view);
  const tool = useUi((s) => s.tool);
  const textEdit = useUi((s) => s.textEdit);
  const marquee = useUi((s) => s.marquee);
  const crop = useUi((s) => s.crop);
  const flash = useUi((s) => s.flash);
  const fitRequest = useUi((s) => s.fitRequest);
  const filesVersion = useUi((s) => s.filesVersion);
  const showMask = useUi((s) => s.showMask);
  const boxMap = useSyncExternalStore(boxes.subscribe, boxes.getSnapshot);
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameScale = useRef(1);
  const [guides, setGuides] = useState<{ axis: "x" | "y"; at: number }[]>([]);
  const [draft, setDraft] = useState<{ kind: "rect" | "ellipse" | "line"; x: number; y: number; width: number; height: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState("default");
  const [dragOver, setDragOver] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const session = useRef<DragSession | null>(null);
  const space = useRef(false);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  // ─── live rendering ────────────────────────────────────────────────────
  const renderer = useMemo(
    () =>
      new LiveRenderer(engine, (f) => {
        const c = canvasRef.current;
        if (!c || !f.canvas) return;
        if (c.width !== f.canvas.width || c.height !== f.canvas.height) {
          c.width = f.canvas.width;
          c.height = f.canvas.height;
        }
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(f.canvas, 0, 0);
        frameScale.current = f.scale;
        setReady(true);
        ui.set({ renderMs: Math.round(f.ms) });
      }),
    [engine, ui],
  );
  useEffect(() => () => renderer.dispose(), [renderer]);

  const targetScale = renderScaleFor(view.zoom, dpr);
  const [renderScale, setRenderScale] = useState(targetScale);
  useEffect(() => {
    // Zooming re-renders once the zoom settles (the bitmap is scaled meanwhile).
    const id = setTimeout(() => setRenderScale(targetScale), targetScale > renderScale ? 120 : 250);
    return () => clearTimeout(id);
  }, [targetScale, renderScale]);

  const editingId = textEdit?.id ?? null;
  useEffect(() => {
    const masked = showMask ? maskPreviewDoc(doc, showMask) : null;
    renderer.request({ doc: masked ?? doc, scale: renderScale, skip: editingId ? new Set([editingId]) : undefined });
  }, [renderer, doc, renderScale, editingId, filesVersion, showMask]);

  // ─── view: fit, resize ─────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let last = { w: el.clientWidth, h: el.clientHeight };
    const ro = new ResizeObserver(() => {
      const next = { w: el.clientWidth, h: el.clientHeight };
      // Panels opening / closing keep the canvas centred where it was.
      if (last.w && last.h && (next.w !== last.w || next.h !== last.h)) {
        const dx = (next.w - last.w) / 2;
        const dy = (next.h - last.h) / 2;
        ui.set((s) => ({ view: { ...s.view, x: s.view.x + dx, y: s.view.y + dy } }));
      }
      last = next;
      setSize(next);
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ui]);
  const fitted = useRef(-1);
  useLayoutEffect(() => {
    if (!size.w || !size.h) return;
    if (fitted.current === fitRequest) return;
    fitted.current = fitRequest;
    ui.set({ view: fitView(store.doc!, size.w, size.h) });
  }, [fitRequest, size, ui, store]);

  // ─── tool context ──────────────────────────────────────────────────────
  const ctx: ToolCtx = useMemo(
    () => ({
      api,
      view: () => ui.get().view,
      setView: (v) => ui.set({ view: v }),
      toScreen: (p) => {
        const v = ui.get().view;
        return { x: v.x + p.x * v.zoom, y: v.y + p.y * v.zoom };
      },
      sampleColor: (p) => {
        const c = canvasRef.current;
        if (!c) return null;
        const k = frameScale.current;
        const x = Math.floor(p.x * k);
        const y = Math.floor(p.y * k);
        if (x < 0 || y < 0 || x >= c.width || y >= c.height) return null;
        const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(x, y, 1, 1).data;
        if (d[3] === 0) return null;
        return formatColor({ r: d[0], g: d[1], b: d[2], a: d[3] / 255 });
      },
      setGuides,
      setDraft,
    }),
    [api, ui],
  );
  useEffect(() => {
    toolCtx.current = ctx;
    return () => {
      if (toolCtx.current === ctx) toolCtx.current = null;
    };
  }, [ctx]);
  // A newly active tool may set itself up (crop rectangle…).
  useEffect(() => {
    toolById(tool).activate?.(api);
  }, [tool, api]);

  const info = useCallback(
    (e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean; button?: number; detail?: number }): PointerInfo => {
      const r = wrap.current!.getBoundingClientRect();
      const v = ui.get().view;
      const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
      return { screen, doc: { x: (screen.x - v.x) / v.zoom, y: (screen.y - v.y) / v.zoom }, shift: e.shiftKey, alt: e.altKey, mod: e.metaKey || e.ctrlKey, button: e.button ?? 0, clicks: e.detail ?? 1 };
    },
    [ui],
  );

  // ─── wheel: pan, ctrl / pinch zoom ─────────────────────────────────────
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = ui.get().view;
      if (e.ctrlKey || e.metaKey) {
        const d = Math.max(-60, Math.min(60, e.deltaY * (e.deltaMode === 1 ? 16 : 1)));
        const factor = Math.exp(-d * 0.0075);
        ui.set({ view: zoomAt(v, factor, { x: e.clientX - r.left, y: e.clientY - r.top }) });
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        ui.set({ view: { ...v, x: v.x - (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k, y: v.y - (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k } });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ui]);

  // Space held: temporary hand tool.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === " " && !isTyping(e)) {
        if (!space.current) setCursor("grab");
        space.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") {
        space.current = false;
        setCursor("default");
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Paste images (Cmd+V).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e as unknown as KeyboardEvent) || ui.get().dialog) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void readFiles(files).then((list) => api.importImages(list));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [api, ui]);

  // ─── pointer → tools ───────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    if (ui.get().textEdit) {
      // A click outside the inline editor commits the text.
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (ui.get().textEdit) ui.set({ textEdit: null });
      return;
    }
    const p = info(e);
    const def = toolById(ui.get().tool);
    let s: DragSession | null | undefined;
    if (e.button === 1 || space.current || def.id === "hand") s = panSession(ctx, p);
    else if (e.button === 0) s = def.down?.(ctx, p);
    if (s) {
      session.current = s;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      if (s.cursor) setCursor(s.cursor);
      e.preventDefault();
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = info(e);
    ui.set({ cursor: { x: Math.floor(p.doc.x), y: Math.floor(p.doc.y) } });
    const s = session.current;
    if (s) {
      s.move(p);
      return;
    }
    if (space.current) return setCursor("grab");
    const def = toolById(ui.get().tool);
    setCursor(def.cursor(ctx, p));
    if (def.id === "move" && store.doc) setHover(hitTest(store.doc.layers, boxes.getSnapshot(), p.doc));
    else if (hover) setHover(null);
  };
  const end = (e: React.PointerEvent, cancel = false) => {
    const s = session.current;
    session.current = null;
    if (!s) return;
    if (cancel) s.cancel?.();
    else s.up(info(e));
    const def = toolById(ui.get().tool);
    setCursor(space.current ? "grab" : def.cursor(ctx, info(e)));
  };

  // ─── drop files ────────────────────────────────────────────────────────
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(f.name));
    if (!files.length) return;
    const p = info({ clientX: e.clientX, clientY: e.clientY, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false });
    void readFiles(files).then((list) => api.importImages(list, p.doc));
  };

  // ─── overlay geometry ──────────────────────────────────────────────────
  const z = view.zoom;
  const S = (p: Pt) => ({ x: view.x + p.x * z, y: view.y + p.y * z });
  const poly = (pts: Pt[]) => pts.map((p) => S(p)).map((p) => `${p.x},${p.y}`).join(" ");
  const W = doc.canvas.width * z;
  const H = doc.canvas.height * z;
  const selectedBoxLayers = selection.map((id) => findLayer(doc.layers, id)?.layer).filter((l): l is Layer => !!l);
  const primary = selectedBoxLayers[selectedBoxLayers.length - 1];
  const single = selectedBoxLayers.length === 1 && primary && hasBox(primary) ? boxMap.get(primary.id) : undefined;
  const groupBox = !single && selectedBoxLayers.length ? unionBox(boxMap, movableLayers(doc.layers, selection)) : null;
  const showHandles = tool === "move" && single && primary && !primary.locked && !textEdit;
  const flashRecent = flash && Date.now() - flash.at < 3000 ? flash : null;

  return (
    <div
      ref={wrap}
      data-viewport
      tabIndex={-1}
      className={clsx("viewport-stage relative min-h-0 flex-1 overflow-hidden outline-none", dragOver && "ring-2 ring-inset ring-accent/60")}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onMouseDown={(e) => {
        // Keep the focus where it is (inline text editor, panels): the viewport is not a focus target.
        if (!(e.target as HTMLElement).isContentEditable) e.preventDefault();
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e)}
      onPointerCancel={(e) => end(e, true)}
      onPointerLeave={() => (ui.set({ cursor: null }), setHover(null))}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* Canvas: checkerboard (transparency) + the rendered bitmap */}
      <div className="checker canvas-shadow absolute" style={{ left: view.x, top: view.y, width: W, height: H }}>
        <canvas ref={canvasRef} className={clsx("absolute inset-0 h-full w-full transition-opacity duration-150", ready ? "opacity-100" : "opacity-0")} style={{ imageRendering: z * dpr >= 2.5 ? "pixelated" : "auto" }} />
      </div>

      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {/* hover outline */}
        {hover && !selection.includes(hover) && boxMap.get(hover) && tool === "move" && <polygon points={poly(boxCorners(boxMap.get(hover)!))} fill="none" stroke="rgb(var(--accent) / 0.7)" strokeWidth={1} />}
        {/* selection frames */}
        {!crop &&
          selectedBoxLayers.map((l) => {
            const b = hasBox(l) ? boxMap.get(l.id) : undefined;
            return b ? <polygon key={l.id} points={poly(boxCorners(b))} fill="none" stroke="rgb(var(--accent))" strokeWidth={1.25} /> : null;
          })}
        {!crop && groupBox && selectedBoxLayers.some((l) => !hasBox(l) || selectedBoxLayers.length > 1) && (
          <rect x={S(groupBox).x} y={S(groupBox).y} width={groupBox.width * z} height={groupBox.height * z} fill="none" stroke="rgb(var(--accent))" strokeDasharray="4 3" strokeWidth={1} />
        )}
        {/* transform handles */}
        {showHandles && single && (
          <g>
            {(() => {
              const top = S(handlePoint(single, { hx: 0, hy: -1 }));
              const rot = S(rotationHandle(single, z));
              return (
                <>
                  <line x1={top.x} y1={top.y} x2={rot.x} y2={rot.y} stroke="rgb(var(--accent))" strokeWidth={1} />
                  <circle cx={rot.x} cy={rot.y} r={4.5} fill="#fff" stroke="rgb(var(--accent))" strokeWidth={1.25} />
                </>
              );
            })()}
            {handlesFor(primary!).map((h) => {
              const p = S(handlePoint(single, h));
              return <rect key={`${h.hx}${h.hy}`} x={p.x - 4} y={p.y - 4} width={8} height={8} rx={1.5} fill="#fff" stroke="rgb(var(--accent))" strokeWidth={1.25} transform={single.rotation ? `rotate(${single.rotation} ${p.x} ${p.y})` : undefined} />;
            })}
          </g>
        )}
        {/* smart guides */}
        {guides.map((g, i) =>
          g.axis === "x" ? <line key={i} x1={view.x + g.at * z} x2={view.x + g.at * z} y1={0} y2="100%" stroke={GUIDE} strokeWidth={1} /> : <line key={i} y1={view.y + g.at * z} y2={view.y + g.at * z} x1={0} x2="100%" stroke={GUIDE} strokeWidth={1} />,
        )}
        {/* marquee */}
        {marquee && <MarqueeShape m={marquee} S={S} z={z} />}
        {/* drafts (shape tool) */}
        {draft &&
          (draft.kind === "line" ? (
            <line x1={S(draft).x} y1={S(draft).y} x2={S({ x: draft.x + draft.width, y: draft.y + draft.height }).x} y2={S({ x: draft.x + draft.width, y: draft.y + draft.height }).y} stroke="rgb(var(--accent))" strokeWidth={1.5} strokeDasharray="4 3" />
          ) : draft.kind === "ellipse" ? (
            <ellipse cx={S(draft).x + (draft.width * z) / 2} cy={S(draft).y + (draft.height * z) / 2} rx={(draft.width * z) / 2} ry={(draft.height * z) / 2} fill="rgb(var(--accent) / 0.08)" stroke="rgb(var(--accent))" strokeDasharray="4 3" />
          ) : (
            <rect x={S(draft).x} y={S(draft).y} width={draft.width * z} height={draft.height * z} fill="rgb(var(--accent) / 0.08)" stroke="rgb(var(--accent))" strokeDasharray="4 3" />
          ))}
        {/* crop */}
        {crop && tool === "crop" && <CropShape c={crop} S={S} z={z} canvas={{ x: view.x, y: view.y, w: W, h: H }} />}
      </svg>

      {/* agent highlights */}
      {flashRecent &&
        flashRecent.ids.map((id) => {
          const b = boxMap.get(id);
          if (!b) return null;
          const a = aabb(b);
          return <div key={`${id}${flashRecent.at}`} className="agent-pulse pointer-events-none absolute rounded-[2px]" style={{ left: view.x + a.x * z, top: view.y + a.y * z, width: a.width * z, height: a.height * z }} />;
        })}

      {textEdit && <TextEditor key={textEdit.id ?? `new${textEdit.x},${textEdit.y}`} />}

      {showMask && (
        <div className="pointer-events-auto absolute left-1/2 top-3 -translate-x-1/2 rounded-md border border-line bg-ink-1/95 px-3 py-1.5 text-xs shadow-lg">
          {t("viewport.showingMask")}{" "}
          <button type="button" className="ml-1 font-medium text-accent hover:underline" onClick={() => ui.set({ showMask: null })}>
            {t("viewport.backToImage")}
          </button>
        </div>
      )}

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent/5">
          <div className="flex items-center gap-2 rounded-lg border border-accent/50 bg-ink-1/95 px-4 py-2.5 text-sm shadow-xl">
            <ImagePlus size={16} className="text-accent" /> {t("viewport.dropHere")}
          </div>
        </div>
      )}
    </div>
  );
}

function MarqueeShape({ m, S, z }: { m: { kind: "rect" | "ellipse"; x: number; y: number; width: number; height: number }; S: (p: Pt) => Pt; z: number }) {
  const p = S(m);
  const w = m.width * z;
  const h = m.height * z;
  const shape = (props: Record<string, unknown>) => (m.kind === "ellipse" ? <ellipse cx={p.x + w / 2} cy={p.y + h / 2} rx={w / 2} ry={h / 2} fill="none" {...props} /> : <rect x={p.x} y={p.y} width={w} height={h} fill="none" {...props} />);
  return (
    <g>
      {shape({ stroke: "#000", strokeWidth: 1 })}
      {shape({ stroke: "#fff", strokeWidth: 1, strokeDasharray: "4 4", className: "ants" })}
    </g>
  );
}

function CropShape({ c, S, z, canvas }: { c: { x: number; y: number; width: number; height: number }; S: (p: Pt) => Pt; z: number; canvas: { x: number; y: number; w: number; h: number } }) {
  const p = S(c);
  const w = c.width * z;
  const h = c.height * z;
  const big = 100000;
  return (
    <g>
      <path d={`M${-big},${-big}H${big}V${big}H${-big}Z M${p.x},${p.y}v${h}h${w}v${-h}Z`} fill="rgb(8 9 12 / 0.62)" fillRule="evenodd" />
      <rect x={canvas.x} y={canvas.y} width={canvas.w} height={canvas.h} fill="none" stroke="rgb(255 255 255 / 0.15)" strokeDasharray="3 3" />
      <rect x={p.x} y={p.y} width={w} height={h} fill="none" stroke="#fff" strokeWidth={1.25} />
      {[1, 2].map((k) => (
        <g key={k} stroke="rgb(255 255 255 / 0.45)" strokeWidth={0.75}>
          <line x1={p.x + (w * k) / 3} x2={p.x + (w * k) / 3} y1={p.y} y2={p.y + h} />
          <line y1={p.y + (h * k) / 3} y2={p.y + (h * k) / 3} x1={p.x} x2={p.x + w} />
        </g>
      ))}
      {HANDLES.map((hd) => {
        const hx = p.x + ((hd.hx + 1) / 2) * w;
        const hy = p.y + ((hd.hy + 1) / 2) * h;
        const corner = hd.hx && hd.hy;
        return corner ? (
          <path key={`${hd.hx}${hd.hy}`} d={`M${hx - hd.hx * 0},${hy + hd.hy * -14}V${hy}H${hx + hd.hx * -14}`} fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="square" />
        ) : (
          <rect key={`${hd.hx}${hd.hy}`} x={hx - (hd.hx ? 2 : 9)} y={hy - (hd.hy ? 2 : 9)} width={hd.hx ? 4 : 18} height={hd.hy ? 4 : 18} fill="#fff" />
        );
      })}
      <text x={p.x + 6} y={p.y - 8} fill="#fff" fontSize={11} style={{ paintOrder: "stroke" }} stroke="rgb(0 0 0 / 0.6)" strokeWidth={3}>
        {Math.round(c.width)} × {Math.round(c.height)}
      </text>
    </g>
  );
}

export async function readFiles(files: File[]): Promise<{ name: string; bytes: Uint8Array }[]> {
  return Promise.all(files.map(async (f) => ({ name: f.name || `pasted-${Date.now()}.png`, bytes: new Uint8Array(await f.arrayBuffer()) })));
}
