// Export options (pure): what to render and encode. The host (headless Chrome
// for the CLI / MCP, the page itself in the Studio) renders the document with
// src/engine/ and encodes it; ops decide sizes, formats and file names so every
// front door produces the same files.

import { sizePreset, SIZE_PRESETS } from "../core/catalog";
import { isValidColor, parseColor } from "../core/color";
import { didYouMean } from "../core/suggest";
import type { ExportSettings, ImageFormat, PhotoDoc } from "../core/types";
import { MAX_CANVAS } from "../core/validate";
import { OpsError } from "./context";

export const IMAGE_FORMATS: ImageFormat[] = ["png", "jpeg", "webp", "avif"];
export const FORMAT_EXT: Record<ImageFormat, string> = { png: "png", jpeg: "jpg", webp: "webp", avif: "avif" };
export const DEFAULT_QUALITY: Record<ImageFormat, number> = { png: 100, jpeg: 88, webp: 86, avif: 70 };

export interface ExportRequest extends ExportSettings {
  // A size preset id (catalog "sizes"): the image is fitted into it.
  preset?: string;
  // How to fit a preset / width × height with another aspect: cover (crop), contain (pad), stretch.
  fit?: "cover" | "contain" | "stretch";
  // Output path inside the project (default dist/<name>.<ext>).
  out?: string;
}

export interface ExportJob {
  format: ImageFormat;
  mime: string;
  quality: number;
  // Output pixel size.
  width: number;
  height: number;
  // Render scale (output / canvas) and the canvas rectangle to draw (cover crops).
  scale: number;
  // Canvas rect mapped to the output (x, y, w, h) and padding offsets (contain).
  source: { x: number; y: number; width: number; height: number };
  dest: { x: number; y: number; width: number; height: number };
  background: string | null;
  file: string;
}

export function planExport(doc: PhotoDoc, req: ExportRequest = {}): ExportJob {
  const d = { ...(doc.export ?? {}), ...stripUndefined(req) } as ExportRequest;
  const format = (d.format ?? "png") as ImageFormat;
  if (!IMAGE_FORMATS.includes(format)) throw new OpsError("invalid", `Unknown export format "${String(d.format)}".`, `${didYouMean(String(d.format), IMAGE_FORMATS)}Formats: ${IMAGE_FORMATS.join(", ")}.`);
  const quality = Math.max(1, Math.min(100, Math.round(d.quality ?? DEFAULT_QUALITY[format])));
  const W = doc.canvas.width;
  const H = doc.canvas.height;
  let outW = W;
  let outH = H;
  let fit = d.fit ?? "cover";
  if (!["cover", "contain", "stretch"].includes(fit)) throw new OpsError("invalid", `Unknown fit "${String(fit)}".`, "fit: cover (crop), contain (pad) or stretch.");
  for (const k of ["width", "height", "scale"] as const) {
    const v = d[k];
    if (v !== undefined && v !== null && !(typeof v === "number" && Number.isFinite(v) && v > 0)) throw new OpsError("invalid", `Export ${k} must be a positive number, got ${JSON.stringify(v)}.`, k === "scale" ? "e.g. scale: 2 (twice the canvas size) or 0.5." : `${k} in px, e.g. 1080.`);
  }
  if (d.preset) {
    const p = sizePreset(d.preset);
    if (!p) throw new OpsError("invalid", `Unknown size preset "${d.preset}".`, `${didYouMean(d.preset, SIZE_PRESETS.map((s) => s.id))}Presets: ${SIZE_PRESETS.map((s) => s.id).join(", ")}.`);
    outW = p.width;
    outH = p.height;
  } else if (d.width && d.height) {
    outW = d.width;
    outH = d.height;
  } else if (d.width) {
    outW = d.width;
    outH = (d.width * H) / W;
    fit = "stretch";
  } else if (d.height) {
    outH = d.height;
    outW = (d.height * W) / H;
    fit = "stretch";
  } else if (d.scale) {
    outW = W * d.scale;
    outH = H * d.scale;
    fit = "stretch";
  }
  outW = Math.max(1, Math.round(outW));
  outH = Math.max(1, Math.round(outH));
  if (outW > MAX_CANVAS || outH > MAX_CANVAS) throw new OpsError("invalid", `Export size ${outW}×${outH} exceeds ${MAX_CANVAS} px.`);
  let source = { x: 0, y: 0, width: W, height: H };
  let dest = { x: 0, y: 0, width: outW, height: outH };
  if (fit === "cover") {
    const s = Math.max(outW / W, outH / H);
    const sw = outW / s;
    const sh = outH / s;
    source = { x: (W - sw) / 2, y: (H - sh) / 2, width: sw, height: sh };
  } else if (fit === "contain") {
    const s = Math.min(outW / W, outH / H);
    dest = { x: (outW - W * s) / 2, y: (outH - H * s) / 2, width: W * s, height: H * s };
  }
  const scale = dest.width / source.width;
  let background: string | null = d.background ?? null;
  if (background !== null && !isValidColor(background)) throw new OpsError("invalid", `Export background ${JSON.stringify(background)} is not a colour.`);
  // JPEG has no alpha: a missing or fully transparent background would come out black.
  if (format === "jpeg" && (!background || parseColor(background)?.a === 0)) background = "#ffffff";
  const name = (d.name ?? doc.id ?? "photo").replace(/[^\w.-]+/g, "-");
  const suffix = d.preset ? `-${d.preset}` : d.width || d.height || d.scale ? `-${outW}x${outH}` : "";
  const file = d.out ?? `dist/${name}${suffix}.${FORMAT_EXT[format]}`;
  return { format, mime: format === "jpeg" ? "image/jpeg" : `image/${format}`, quality, width: outW, height: outH, scale, source, dest, background, file };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
