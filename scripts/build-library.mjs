#!/usr/bin/env node
// Recomputes derived fields of library/index.json from the files on disk:
//   - `kb` of every asset (sum of all its files for fonts), rounded to 1 decimal
//   - `width` / `height` of every image (parsed from the JPEG SOF header)
// Usage:
//   node scripts/build-library.mjs          rewrite library/index.json
//   node scripts/build-library.mjs --check  exit 1 if anything is stale or missing
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'library');
const INDEX = path.join(LIB, 'index.json');
const check = process.argv.includes('--check');

/** Returns { width, height } from the first SOFn marker of a JPEG buffer. */
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG (missing SOI)');
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw new Error(`bad marker at ${i}`);
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xda) break; // start of scan without SOF
    i += 2 + len;
  }
  throw new Error('no SOF marker found');
}

const kbOf = (bytes) => Math.round((bytes / 1024) * 10) / 10;

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const problems = [];
let stale = 0;
let totalBytes = 0;

function fileBytes(rel, id) {
  const abs = path.join(LIB, rel);
  if (!fs.existsSync(abs)) { problems.push(`${id}: missing file ${rel}`); return null; }
  return fs.readFileSync(abs);
}

function set(asset, key, value) {
  if (asset[key] !== value) {
    stale++;
    if (check) problems.push(`${asset.id}: ${key} is ${JSON.stringify(asset[key])}, expected ${JSON.stringify(value)}`);
    asset[key] = value;
  }
}

const seen = new Set();
for (const asset of index.assets) {
  if (seen.has(asset.id)) problems.push(`duplicate id ${asset.id}`);
  seen.add(asset.id);
  if (asset.kind === 'font') {
    let bytes = 0;
    for (const f of asset.files || []) {
      const buf = fileBytes(f.path, asset.id);
      if (!buf) continue;
      if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') problems.push(`${asset.id}: ${f.path} is not a WOFF2 file`);
      bytes += buf.length;
    }
    totalBytes += bytes;
    set(asset, 'kb', kbOf(bytes));
  } else if (asset.kind === 'image') {
    const buf = fileBytes(asset.path, asset.id);
    if (!buf) continue;
    totalBytes += buf.length;
    set(asset, 'kb', kbOf(buf.length));
    try {
      const { width, height } = jpegSize(buf);
      set(asset, 'width', width);
      set(asset, 'height', height);
    } catch (e) {
      problems.push(`${asset.id}: ${e.message}`);
    }
  } else {
    problems.push(`${asset.id}: unknown kind ${asset.kind}`);
  }
}

if (check) {
  if (problems.length) {
    console.error(`library/index.json is not up to date (${problems.length} problem(s)):`);
    for (const p of problems) console.error('  - ' + p);
    console.error('Run: node scripts/build-library.mjs');
    process.exit(1);
  }
  console.log(`library/index.json OK (${index.assets.length} assets, ${kbOf(totalBytes)} KB)`);
} else {
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');
  console.log(`library/index.json written: ${index.assets.length} assets, ${kbOf(totalBytes)} KB, ${stale} field(s) updated`);
  if (problems.length) {
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
}
