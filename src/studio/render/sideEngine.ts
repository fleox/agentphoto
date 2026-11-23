// A second engine sharing the live engine's loader (decoded images, fonts)
// but with its own compositor cache: selection sampling, painting rasters,
// copies — renders at other scales without evicting the viewport's cache.

import { Engine } from "../../engine";
import type { EditorApi } from "../state/context";

const engines = new WeakMap<Engine, Engine>();

export function sideEngine(api: EditorApi): Engine {
  let e = engines.get(api.engine);
  if (!e) {
    e = new Engine({ assetBase: "", libraryBase: "" }, api.engine.loader);
    engines.set(api.engine, e);
  }
  return e;
}

// Decodes a PNG (mask) into a luminance plane.
export async function decodePlane(bytes: Uint8Array): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const out = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = ((d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114) * d[j + 3]) / 255;
  return { data: out, w: c.width, h: c.height };
}
