#!/usr/bin/env node
// Generates a minimal 20x20 PNG icon (Power BI blue #0078D4).
// Runs via `prepackage` — no external dependencies required.

const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const W = 20, H = 20;
const R = 0, G = 120, B = 212; // #0078D4

// CRC-32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
}
function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const name = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([lenBuf, name, data, crcBuf]);
}

// Raw scanlines: one filter byte (0x00 = None) + W * 3 RGB bytes per row
const row = Buffer.alloc(1 + W * 3);
for (let x = 0; x < W; x++) {
    row[1 + x * 3] = R;
    row[2 + x * 3] = G;
    row[3 + x * 3] = B;
}
const raw = Buffer.concat(Array.from({ length: H }, () => row));

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type: RGB
// bytes 10-12 are already 0 (compression/filter/interlace)

const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
]);

const dest = path.join(__dirname, "..", "assets", "icon.png");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, png);
console.log("Generated assets/icon.png (" + png.length + " bytes)");
