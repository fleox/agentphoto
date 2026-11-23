import { describe, expect, it } from "vitest";
import { exifOrientation, imageInfo, imageTypeOfPath } from "./imageInfo";

// ─── hand-made headers ──────────────────────────────────────────────────

const u32be = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u16be = (v: number) => [(v >> 8) & 255, v & 255];
const u16le = (v: number) => [v & 255, (v >> 8) & 255];
const u24le = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
const u32le = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: number[]): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const chunk = (type: string, data: number[]) => [...u32be(data.length), ...ascii(type), ...data, ...u32be(crc32([...ascii(type), ...data]))];

function png(width: number, height: number, colorType = 6): Uint8Array {
  return bytes([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a], chunk("IHDR", [...u32be(width), ...u32be(height), 8, colorType, 0, 0, 0]), chunk("IEND", []));
}

function jpeg(width: number, height: number, opts: { orientation?: number; littleEndian?: boolean; sof?: number } = {}): Uint8Array {
  const parts: number[][] = [[0xff, 0xd8]];
  // APP0 JFIF
  const jfif = [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  parts.push([0xff, 0xe0, ...u16be(jfif.length + 2), ...jfif]);
  if (opts.orientation) {
    const le = !!opts.littleEndian;
    const w16 = le ? u16le : u16be;
    const w32 = le ? u32le : u32be;
    const tiff = [...(le ? ascii("II") : ascii("MM")), ...w16(42), ...w32(8), ...w16(1), ...w16(0x0112), ...w16(3), ...w32(1), ...w16(opts.orientation), 0, 0, ...w32(0)];
    const app1 = [...ascii("Exif"), 0, 0, ...tiff];
    parts.push([0xff, 0xe1, ...u16be(app1.length + 2), ...app1]);
  }
  // DQT-like filler segment then SOF
  parts.push([0xff, 0xdb, ...u16be(4), 0, 0]);
  // DHT (0xc4) must not be taken for a SOF
  parts.push([0xff, 0xc4, ...u16be(4), 0, 0]);
  const sof = [8, ...u16be(height), ...u16be(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  parts.push([0xff, opts.sof ?? 0xc0, ...u16be(sof.length + 2), ...sof]);
  parts.push([0xff, 0xd9]);
  return bytes(...parts);
}

function riff(chunkType: string, payload: number[]): Uint8Array {
  const body = [...ascii("WEBP"), ...ascii(chunkType), ...u32le(payload.length), ...payload];
  return bytes(ascii("RIFF"), u32le(body.length), body);
}
const webpVp8 = (w: number, h: number) => riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(w), ...u16le(h), 0, 0]);
function webpVp8l(w: number, h: number, alpha: boolean): Uint8Array {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14) | ((alpha ? 1 : 0) << 28);
  return riff("VP8L", [0x2f, ...u32le(bits >>> 0), 0, 0, 0, 0, 0, 0, 0, 0]);
}
const webpVp8x = (w: number, h: number, alpha: boolean) => riff("VP8X", [alpha ? 0x10 : 0, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)]);
const gif = (w: number, h: number) => bytes(ascii("GIF89a"), u16le(w), u16le(h), [0, 0, 0, 0, 0, 0]);
function bmp(w: number, h: number): Uint8Array {
  const header = [...ascii("BM"), ...u32le(70), 0, 0, 0, 0, ...u32le(54)];
  const dib = [...u32le(40), ...u32le(w), ...u32le(h >>> 0), ...u16le(1), ...u16le(24), ...new Array(24).fill(0)];
  return bytes(header, dib);
}
function avif(w: number, h: number): Uint8Array {
  const ftyp = [...u32be(20), ...ascii("ftyp"), ...ascii("avif"), 0, 0, 0, 0, ...ascii("mif1")];
  const ispe = [...u32be(20), ...ascii("ispe"), 0, 0, 0, 0, ...u32be(w), ...u32be(h)];
  return bytes(ftyp, [...u32be(8), ...ascii("meta")], ispe, new Array(8).fill(0));
}
const svg = (s: string) => new TextEncoder().encode(s);

describe("imageInfo", () => {
  it("reads PNG sizes and alpha", () => {
    expect(imageInfo(png(640, 480))).toEqual({ type: "png", width: 640, height: 480, alpha: true });
    expect(imageInfo(png(1, 70000, 2))).toEqual({ type: "png", width: 1, height: 70000, alpha: false });
    expect(imageInfo(png(3, 3, 4))?.alpha).toBe(true);
    // Large values use the full unsigned 32 bits.
    expect(imageInfo(png(0x80000001, 2))?.width).toBe(0x80000001);
  });

  it("reads JPEG SOF0 / SOF2 sizes, skipping DHT", () => {
    expect(imageInfo(jpeg(1920, 1080))).toEqual({ type: "jpeg", width: 1920, height: 1080, alpha: false });
    expect(imageInfo(jpeg(800, 600, { sof: 0xc2 }))).toMatchObject({ width: 800, height: 600 });
  });

  it("swaps JPEG sizes for EXIF orientations 5..8 (both byte orders)", () => {
    expect(exifOrientation(jpeg(10, 20))).toBe(1);
    expect(exifOrientation(jpeg(10, 20, { orientation: 6 }))).toBe(6);
    expect(exifOrientation(jpeg(10, 20, { orientation: 8, littleEndian: true }))).toBe(8);
    for (const o of [1, 2, 3, 4]) expect(imageInfo(jpeg(4000, 3000, { orientation: o })), String(o)).toMatchObject({ width: 4000, height: 3000 });
    for (const o of [5, 6, 7, 8]) expect(imageInfo(jpeg(4000, 3000, { orientation: o, littleEndian: o % 2 === 0 })), String(o)).toMatchObject({ width: 3000, height: 4000 });
  });

  it("reads WebP VP8, VP8L and VP8X", () => {
    expect(imageInfo(webpVp8(300, 200))).toEqual({ type: "webp", width: 300, height: 200, alpha: false });
    expect(imageInfo(webpVp8l(1024, 768, true))).toEqual({ type: "webp", width: 1024, height: 768, alpha: true });
    expect(imageInfo(webpVp8l(16384, 1, false))).toEqual({ type: "webp", width: 16384, height: 1, alpha: false });
    expect(imageInfo(webpVp8x(5000, 4000, true))).toEqual({ type: "webp", width: 5000, height: 4000, alpha: true });
    expect(imageInfo(webpVp8x(7, 9, false))?.alpha).toBe(false);
    expect(imageInfo(riff("ALPH", new Array(20).fill(0)))).toBeNull();
  });

  it("reads GIF, BMP (bottom-up and top-down) and AVIF", () => {
    expect(imageInfo(gif(320, 240))).toEqual({ type: "gif", width: 320, height: 240 });
    expect(imageInfo(bmp(64, 32))).toEqual({ type: "bmp", width: 64, height: 32 });
    expect(imageInfo(bmp(64, -32))).toEqual({ type: "bmp", width: 64, height: 32 });
    expect(imageInfo(avif(2048, 1536))).toEqual({ type: "avif", width: 2048, height: 1536 });
  });

  it("reads SVG width / height / viewBox", () => {
    expect(imageInfo(svg('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"></svg>'))).toEqual({ type: "svg", width: 200, height: 100, alpha: true });
    expect(imageInfo(svg('<?xml version="1.0"?>\n<svg viewBox="0 0 64 32" xmlns="http://www.w3.org/2000/svg"/>'))).toMatchObject({ width: 64, height: 32 });
    expect(imageInfo(svg('<svg width="128px" viewBox="0 0 64 32"></svg>'))).toMatchObject({ width: 128, height: 64 });
    expect(imageInfo(svg('<svg height="10" viewBox="0,0,30,20"></svg>'))).toMatchObject({ width: 15, height: 10 });
    expect(imageInfo(svg('<svg stroke-width="3" xmlns="http://www.w3.org/2000/svg"></svg>'))).toMatchObject({ width: 300, height: 150 });
  });

  it("returns null for short / unknown data", () => {
    expect(imageInfo(new Uint8Array(4))).toBeNull();
    expect(imageInfo(new TextEncoder().encode("hello world, not an image"))).toBeNull();
    expect(imageInfo(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it("maps extensions", () => {
    expect(imageTypeOfPath("a/b/Photo.JPG")).toBe("jpeg");
    expect(imageTypeOfPath("x.webp")).toBe("webp");
    expect(imageTypeOfPath("x.tiff")).toBeUndefined();
    expect(imageTypeOfPath("noext")).toBeUndefined();
  });
});

describe("test-support tinyPng", () => {
  it("is a decodable PNG", async () => {
    const { inflateSync } = await import("node:zlib");
    const { tinyPng } = await import("../test-support/png");
    const b = tinyPng(3, 2);
    expect(imageInfo(b)).toEqual({ type: "png", width: 3, height: 2, alpha: true });
    const len = (b[33] << 24) | (b[34] << 16) | (b[35] << 8) | b[36];
    expect(String.fromCharCode(...b.subarray(37, 41))).toBe("IDAT");
    expect(inflateSync(b.subarray(41, 41 + len)).length).toBe(2 * (1 + 3 * 4));
  });
});
