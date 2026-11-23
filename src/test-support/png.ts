// Test support (not shipped): a tiny but structurally valid PNG (signature,
// IHDR with CRC, IDAT with an uncompressed zlib stream of transparent
// pixels, IEND) — enough for imageInfo and for fake engine hosts.

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

const u32be = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const chunk = (type: string, data: number[]) => [...u32be(data.length), ...ascii(type), ...data, ...u32be(crc32([...ascii(type), ...data]))];

function adler32(data: number[]): number {
  let a = 1;
  let b = 0;
  for (const x of data) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// RGBA 8-bit PNG of transparent pixels.
export function tinyPng(width = 2, height = 2): Uint8Array {
  const raw: number[] = [];
  for (let y = 0; y < height; y++) raw.push(0, ...new Array(width * 4).fill(0));
  // zlib stream of stored (uncompressed) deflate blocks, ≤ 65535 bytes each.
  const zlib: number[] = [0x78, 0x01];
  for (let o = 0; o < raw.length || o === 0; o += 65535) {
    const block = raw.slice(o, o + 65535);
    const last = o + 65535 >= raw.length ? 1 : 0;
    zlib.push(last, block.length & 255, (block.length >> 8) & 255, ~block.length & 255, (~block.length >> 8) & 255);
    for (const b of block) zlib.push(b);
  }
  zlib.push(...u32be(adler32(raw)));
  return new Uint8Array([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]), ...chunk("IDAT", zlib), ...chunk("IEND", [])]);
}
