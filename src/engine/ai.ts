// Local AI (transformers.js + ONNX Runtime WebAssembly), loaded on demand:
// background removal (RMBG-1.4, MODNet) and Segment Anything (points / box →
// mask). Models are downloaded once from `remoteHost` (the CLI serves a local
// cache at /__models/, the static Studio uses the Hugging Face Hub) and kept
// in the browser cache. Nothing leaves the computer: images are processed here.

import { DEFAULT_MODELS, modelDef, MODELS } from "../core/catalog";
import type { AnyCanvas } from "./canvas";

export interface AiConfig {
  // Model host (default https://huggingface.co/) and path template.
  remoteHost?: string;
  remotePathTemplate?: string;
  // Folder (URL) holding ort-wasm-simd-threaded.asyncify.{mjs,wasm}.
  wasmPaths?: string;
  onProgress?(p: { model: string; progress: number; label: string }): void;
}

export interface SegmentPrompt {
  // [x, y, label] in image px; label 1 = include, 0 = exclude.
  points?: [number, number, number][];
  // [x1, y1, x2, y2] in image px.
  box?: [number, number, number, number];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type TF = any;
let tfPromise: Promise<TF> | null = null;
const sessions = new Map<string, Promise<{ model: any; processor: any }>>();
let configured: AiConfig = {};

export function configureAi(cfg: AiConfig): void {
  configured = { ...configured, ...cfg };
}

async function lib(): Promise<TF> {
  if (!tfPromise) {
    tfPromise = import("@huggingface/transformers").then((tf: TF) => {
      tf.env.allowLocalModels = false;
      if (configured.remoteHost) tf.env.remoteHost = configured.remoteHost;
      if (configured.remotePathTemplate) tf.env.remotePathTemplate = configured.remotePathTemplate;
      if (configured.wasmPaths && tf.env.backends?.onnx?.wasm) tf.env.backends.onnx.wasm.wasmPaths = configured.wasmPaths;
      // Cross-origin isolation is not guaranteed: single thread always works.
      if (tf.env.backends?.onnx?.wasm && typeof crossOriginIsolated !== "undefined" && !crossOriginIsolated) tf.env.backends.onnx.wasm.numThreads = 1;
      return tf;
    });
    tfPromise.catch(() => (tfPromise = null));
  }
  return tfPromise;
}

function progressCb(model: string) {
  const files = new Map<string, number>();
  return (data: any) => {
    if (!data?.file) return;
    if (data.status === "progress" && typeof data.progress === "number") files.set(data.file, data.progress);
    else if (data.status === "done") files.set(data.file, 100);
    else if (data.status === "initiate" && !files.has(data.file)) files.set(data.file, 0);
    const v = [...files.values()];
    const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    configured.onProgress?.({ model, progress: avg / 100, label: `Loading ${model} (${Math.round(avg)} %)` });
  };
}

async function session(modelId: string): Promise<{ model: any; processor: any; tf: TF }> {
  const def = modelDef(modelId);
  if (!def) throw new Error(`Unknown model "${modelId}". Models: ${MODELS.map((m) => m.id).join(", ")}.`);
  const tf = await lib();
  let p = sessions.get(modelId);
  if (!p) {
    const cb = progressCb(modelId);
    p = (async () => {
      configured.onProgress?.({ model: modelId, progress: 0, label: `Loading ${modelId}` });
      if (def.task === "segmentation") {
        const [model, processor] = await Promise.all([tf.SamModel.from_pretrained(def.repo, { progress_callback: cb, dtype: "fp32" }), tf.AutoProcessor.from_pretrained(def.repo, { progress_callback: cb })]);
        return { model, processor };
      }
      const custom = def.id === "rmbg-1.4";
      const [model, processor] = await Promise.all([
        tf.AutoModel.from_pretrained(def.repo, { progress_callback: cb, dtype: "fp32", ...(custom ? { config: { model_type: "custom" } } : {}) }),
        tf.AutoProcessor.from_pretrained(def.repo, {
          progress_callback: cb,
          ...(custom
            ? { config: { do_normalize: true, do_pad: false, do_rescale: true, do_resize: true, image_mean: [0.5, 0.5, 0.5], image_std: [1, 1, 1], resample: 2, rescale_factor: 1 / 255, size: { width: 1024, height: 1024 } } }
            : {}),
        }),
      ]);
      return { model, processor };
    })();
    p.catch(() => sessions.delete(modelId));
    sessions.set(modelId, p);
  }
  const s = await p;
  configured.onProgress?.({ model: modelId, progress: 1, label: `${modelId} ready` });
  return { ...s, tf };
}

export function isModelLoaded(modelId: string): boolean {
  return sessions.has(modelId);
}

// Foreground alpha (0..255, width × height) of the canvas.
export async function removeBackground(canvas: AnyCanvas, modelId: string = DEFAULT_MODELS["background-removal"]): Promise<Uint8ClampedArray> {
  const def = modelDef(modelId);
  if (def?.task !== "background-removal") throw new Error(`"${modelId}" is not a background-removal model.`);
  const { model, processor, tf } = await session(modelId);
  const image = tf.RawImage.fromCanvas(canvas);
  const { pixel_values } = await processor(image);
  const out = await model({ input: pixel_values });
  const tensor = (out.output ?? out.alphas ?? Object.values(out)[0]) as any;
  const t = tensor[0] ?? tensor;
  const mask = await tf.RawImage.fromTensor(t.mul(255).to("uint8")).resize(canvas.width, canvas.height);
  const data = mask.data as Uint8Array;
  const channels = mask.channels ?? 1;
  const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * channels];
  return alpha;
}

// Segment Anything: best mask (0 / 255) for the prompt.
export async function segment(canvas: AnyCanvas, prompt: SegmentPrompt, modelId: string = DEFAULT_MODELS.segmentation): Promise<Uint8ClampedArray> {
  const def = modelDef(modelId);
  if (def?.task !== "segmentation") throw new Error(`"${modelId}" is not a segmentation model.`);
  const { model, processor, tf } = await session(modelId);
  const W = canvas.width;
  const H = canvas.height;
  const image = tf.RawImage.fromCanvas(canvas);
  let points = (prompt.points ?? []).map((p) => [Math.max(0, Math.min(W - 1, p[0])), Math.max(0, Math.min(H - 1, p[1]))]);
  let labels = (prompt.points ?? []).map((p) => (p[2] ? 1 : 0));
  const box = prompt.box ? [Math.max(0, prompt.box[0]), Math.max(0, prompt.box[1]), Math.min(W, prompt.box[2]), Math.min(H, prompt.box[3])] : null;
  // transformers.js needs points even with a box: add the box centre as a positive hint.
  if (!points.length) {
    points = [box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : [W / 2, H / 2]];
    labels = [1];
  }
  const inputs = await processor(image, { input_points: [[points]], input_labels: [[labels]], ...(box ? { input_boxes: [[box]] } : {}) });
  const outputs = await model(inputs);
  const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const m = Array.isArray(masks) ? masks[0] : masks;
  const scores: ArrayLike<number> = outputs.iou_scores?.data ?? [1];
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  const dims: number[] = m.dims;
  const n = dims.length >= 3 ? dims[dims.length - 3] : 1;
  const mh = dims[dims.length - 2];
  const mw = dims[dims.length - 1];
  const idx = Math.min(best, n - 1);
  const data = m.data as ArrayLike<number | boolean>;
  const out = new Uint8ClampedArray(W * H);
  const off = idx * mh * mw;
  for (let y = 0; y < H; y++) {
    const sy = Math.min(mh - 1, Math.floor((y * mh) / H));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(mw - 1, Math.floor((x * mw) / W));
      out[y * W + x] = data[off + sy * mw + sx] ? 255 : 0;
    }
  }
  return out;
}
