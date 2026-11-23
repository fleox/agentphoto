// Image dimensions and format from the file header — PNG, JPEG, WebP, GIF,
// BMP, AVIF / HEIC (ispe box), SVG (width/height or viewBox). Pure TS, no
// decoding: ops use it to size new layers and documents without a browser.

export type ImageType = "png" | "jpeg" | "webp" | "gif" | "bmp" | "avif" | "svg";

export interface ImageInfo {
  type: ImageType;
  width: number;
  height: number;
  // PNG colour type with alpha / WebP alpha flag (undefined when unknown).
  alpha?: boolean;
}

export const IMAGE_MIME: Record<ImageType, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export const IMAGE_EXTENSIONS: Record<string, ImageType> = { png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp", gif: "gif", bmp: "bmp", avif: "avif", svg: "svg" };

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const i32le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  const b = bytes;
  if (b.length < 12) return null;
  // PNG
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b.length >= 26) {
    const colorType = b[25];
    return { type: "png", width: u32be(b, 16), height: u32be(b, 20), alpha: colorType === 4 || colorType === 6 };
  }
  // JPEG: walk the markers to the first SOFn
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = b[o + 1];
      if (marker === 0xff) {
        o++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      const len = u16be(b, o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const size = { type: "jpeg" as const, height: u16be(b, o + 5), width: u16be(b, o + 7), alpha: false };
        return applyExifRotation(b, size);
      }
      o += 2 + len;
    }
    return null;
  }
  // WebP
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP" && b.length >= 30) {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8 ") return { type: "webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, alpha: false };
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { type: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, alpha: !!((bits >> 28) & 1) };
    }
    if (chunk === "VP8X") return { type: "webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1, alpha: !!(b[20] & 0x10) };
    return null;
  }
  // GIF
  if (ascii(b, 0, 4) === "GIF8") return { type: "gif", width: u16le(b, 6), height: u16le(b, 8) };
  // BMP
  if (b[0] === 0x42 && b[1] === 0x4d && b.length >= 26) return { type: "bmp", width: Math.abs(i32le(b, 18)), height: Math.abs(i32le(b, 22)) };
  // AVIF / HEIF: ftyp + ispe
  if (ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (/avi[fs]|mif1|heic|heix/.test(brand)) {
      for (let o = 12; o + 20 < b.length && o < 64 * 1024; o++) {
        if (b[o] === 0x69 && ascii(b, o, 4) === "ispe") return { type: "avif", width: u32be(b, o + 8), height: u32be(b, o + 12) };
      }
      return null;
    }
  }
  // SVG (text)
  const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 4096)));
  if (/<svg[\s>]/i.test(head)) {
    const tag = /<svg[^>]*>/i.exec(head)?.[0] ?? "";
    const attr = (n: string) => {
      const m = new RegExp(`\\s${n}\\s*=\\s*["']([\\d.]+)(px)?["']`, "i").exec(tag);
      return m ? Number(m[1]) : undefined;
    };
    let w = attr("width");
    let h = attr("height");
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
    if ((!w || !h) && vb) {
      const vw = Number(vb[1]);
      const vh = Number(vb[2]);
      if (w && !h) h = (w * vh) / vw;
      else if (h && !w) w = (h * vw) / vh;
      else {
        w = vw;
        h = vh;
      }
    }
    return { type: "svg", width: Math.round(w ?? 300), height: Math.round(h ?? 150), alpha: true };
  }
  return null;
}

// EXIF orientation 5..8 swaps width / height (browsers apply the rotation when decoding).
function applyExifRotation(b: Uint8Array, info: ImageInfo): ImageInfo {
  const o = exifOrientation(b);
  return o >= 5 && o <= 8 ? { ...info, width: info.height, height: info.width } : info;
}

export function exifOrientation(b: Uint8Array): number {
  let o = 2;
  while (o + 4 < b.length) {
    if (b[o] !== 0xff) return 1;
    const marker = b[o + 1];
    const len = u16be(b, o + 2);
    if (marker === 0xe1 && ascii(b, o + 4, 4) === "Exif") {
      const t = o + 10;
      const le = b[t] === 0x49;
      const r16 = (p: number) => (le ? u16le(b, p) : u16be(b, p));
      const r32 = (p: number) => (le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : u32be(b, p));
      const ifd = t + r32(t + 4);
      const count = r16(ifd);
      for (let k = 0; k < count; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 10 > b.length) break;
        if (r16(e) === 0x0112) return r16(e + 8);
      }
      return 1;
    }
    if (marker === 0xda) return 1;
    o += 2 + len;
  }
  return 1;
}

export function imageTypeOfPath(path: string): ImageType | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS[ext] : undefined;
}
