// URL-based asset loader for the browser: project files under `assetBase`,
// library files under `libraryBase` (images "library:<id>" and the bundled
// fonts registered as FontFace). Used by the Studio and the headless page.

import { fontDef } from "../core/catalog";
import { findLibraryAsset, isLibraryRef, libraryId, type LibraryIndex } from "../core/library";
import type { Drawable } from "./canvas";
import type { AssetLoader } from "./compositor";

export interface UrlLoaderOptions {
  // URL prefix of project files ("/project/", "./api/project/").
  assetBase: string;
  // URL prefix of library/ files.
  libraryBase: string;
  library?: LibraryIndex;
  // Custom URL for a project path (blob URLs of in-browser projects).
  resolve?(path: string): string | Promise<string>;
  fetchImpl?: typeof fetch;
}

export interface UrlLoader extends AssetLoader {
  // Forget a file (it changed on disk): next render reloads it.
  invalidate(src: string): void;
  setLibrary(index: LibraryIndex): void;
}

const join = (base: string, path: string) => `${base.replace(/\/?$/, "/")}${path.split("/").map(encodeURIComponent).join("/")}`;

async function decode(blob: Blob): Promise<Drawable> {
  const isSvg = blob.type.includes("svg");
  if (!isSvg && typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
      /* fall back to <img> (some formats / old engines) */
    }
  }
  if (typeof Image === "undefined") throw new Error(`Cannot decode ${blob.type || "image"} here.`);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    if (isSvg && (!img.naturalWidth || !img.naturalHeight)) {
      img.width = 512;
      img.height = 512;
    }
    return img as Drawable;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

export function createUrlLoader(opts: UrlLoaderOptions): UrlLoader {
  const f = opts.fetchImpl ?? fetch.bind(globalThis);
  let library = opts.library;
  const images = new Map<string, Promise<Drawable>>();
  const versions = new Map<string, number>();
  const fonts = new Map<string, Promise<string | null>>();

  const urlOf = async (src: string): Promise<string> => {
    if (isLibraryRef(src)) {
      const a = findLibraryAsset(library, libraryId(src));
      if (!a?.path) throw new Error(`Unknown library image "${src}".`);
      return join(opts.libraryBase, a.path);
    }
    if (/^(blob:|data:)/.test(src)) return src;
    const u = opts.resolve ? await opts.resolve(src) : join(opts.assetBase, src);
    const v = versions.get(src);
    return v ? `${u}${u.includes("?") ? "&" : "?"}v=${v}` : u;
  };

  return {
    image(src) {
      let p = images.get(src);
      if (!p) {
        p = (async () => {
          const res = await f(await urlOf(src), { cache: "no-store" });
          if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
          return decode(await res.blob());
        })();
        p.catch(() => images.delete(src));
        images.set(src, p);
      }
      return p;
    },
    version: (src) => versions.get(src) ?? 0,
    invalidate(src) {
      images.delete(src);
      versions.set(src, (versions.get(src) ?? 0) + 1);
    },
    setLibrary(index) {
      library = index;
    },
    font(id, weight, italic) {
      const def = fontDef(id);
      const asset = findLibraryAsset(library, id);
      if (!def || !asset?.files?.length || typeof FontFace === "undefined") return Promise.resolve(def?.family ?? null);
      const style = italic ? "italic" : "normal";
      // Closest bundled weight / style.
      const files = asset.files.filter((x) => x.style === style).length ? asset.files.filter((x) => x.style === style) : asset.files;
      const best = files.reduce((a, b) => (Math.abs(b.weight - weight) < Math.abs(a.weight - weight) ? b : a)).weight;
      const key = `${id}|${best}|${style}`;
      let p = fonts.get(key);
      if (!p) {
        p = (async () => {
          const set = (globalThis as unknown as { document?: Document; fonts?: FontFaceSet }).document?.fonts ?? (globalThis as unknown as { fonts?: FontFaceSet }).fonts;
          const chosen = files.filter((x) => x.weight === best);
          await Promise.all(
            chosen.map(async (file) => {
              const face = new FontFace(def.family, `url(${join(opts.libraryBase, file.path)}) format("woff2")`, { weight: String(weight), style, ...(file.unicodeRange ? { unicodeRange: file.unicodeRange } : {}) });
              await face.load();
              set?.add(face);
            }),
          );
          return def.family;
        })();
        p.catch(() => fonts.delete(key));
        fonts.set(key, p);
      }
      return p;
    },
  };
}
