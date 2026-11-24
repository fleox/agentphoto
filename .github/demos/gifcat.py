#!/usr/bin/env python3
"""Appends the frames of GIF b to GIF a without re-quantizing either.

ffmpeg's concat filter converts both inputs to one pixel format, so the
terminal take (small shared palette, changed rectangles only) and a still
(its own dithered 256-colour palette) would be re-encoded as full frames
with a poor palette. Here every frame of b keeps its colours: b's global
colour table becomes a local table on each of its frames that has none.
Both GIFs must have the same logical screen size.
  gifcat.py a.gif b.gif out.gif
"""
import sys


def table_size(packed):
    return 3 * (1 << ((packed & 7) + 1))


def parse(data):
    """-> (header+LSD bytes, global colour table, list of raw blocks)."""
    assert data[:3] == b"GIF", "not a GIF"
    lsd = data[6:13]
    pos = 13
    gct = b""
    if lsd[4] & 0x80:
        gct = data[pos:pos + table_size(lsd[4])]
        pos += len(gct)
    blocks = []
    while pos < len(data):
        start = pos
        marker = data[pos]
        if marker == 0x3B:  # trailer
            break
        if marker == 0x21:  # extension: label + sub-blocks
            pos += 2
        elif marker == 0x2C:  # image descriptor (+ local table) + LZW min size
            packed = data[pos + 9]
            pos += 10
            if packed & 0x80:
                pos += table_size(packed)
            pos += 1
        else:
            raise ValueError(f"unexpected block 0x{marker:02x} at {pos}")
        while data[pos] != 0:
            pos += data[pos] + 1
        pos += 1
        blocks.append(data[start:pos])
    return data[:13], gct, blocks


def main(a_path, b_path, out_path):
    a = open(a_path, "rb").read()
    head_a, gct_a, blocks_a = parse(a)
    head_b, gct_b, blocks_b = parse(open(b_path, "rb").read())
    assert head_a[6:10] == head_b[6:10], "different logical screen sizes"
    out = bytearray(head_a + gct_a)
    for block in blocks_a:
        out += block
    for block in blocks_b:
        if block[0] == 0x21 and block[1] == 0xFF:  # b's NETSCAPE loop block
            continue
        if block[0] == 0x2C and not block[9] & 0x80 and gct_b:
            packed = (block[9] & 0x40) | 0x80 | (head_b[10] & 7)
            block = block[:9] + bytes([packed]) + gct_b + block[10:]
        out += block
    out += b"\x3B"
    open(out_path, "wb").write(out)


if __name__ == "__main__":
    main(*sys.argv[1:4])
