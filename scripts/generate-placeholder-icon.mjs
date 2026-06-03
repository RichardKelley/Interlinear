import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const buildDir = "build";
const iconsetDir = join(buildDir, "icon.iconset");
const iconPath = join(buildDir, "icon.icns");

rmSync(iconsetDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });

const iconChunks = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024]
];

writeFileSync(iconPath, createIcns(iconChunks.map(([type, size]) => icnsChunk(type, createIconPng(size)))));

function createIconPng(size) {
  const pixels = Buffer.alloc(size * size * 4);
  fillRect(pixels, size, 0, 0, size, size, [39, 61, 53, 255]);
  fillRect(pixels, size, 0, Math.floor(size * 0.72), size, Math.ceil(size * 0.28), [229, 235, 228, 255]);
  fillRect(pixels, size, Math.floor(size * 0.16), Math.floor(size * 0.18), Math.ceil(size * 0.12), Math.ceil(size * 0.46), [
    255,
    254,
    251,
    255
  ]);
  fillRect(pixels, size, Math.floor(size * 0.38), Math.floor(size * 0.18), Math.ceil(size * 0.12), Math.ceil(size * 0.46), [
    255,
    254,
    251,
    255
  ]);
  fillRect(pixels, size, Math.floor(size * 0.38), Math.floor(size * 0.54), Math.ceil(size * 0.34), Math.ceil(size * 0.1), [
    255,
    254,
    251,
    255
  ]);
  fillRect(pixels, size, Math.floor(size * 0.16), Math.floor(size * 0.13), Math.ceil(size * 0.12), Math.ceil(size * 0.04), [
    255,
    254,
    251,
    255
  ]);

  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const sourceStart = y * size * 4;
    const targetStart = y * (size * 4 + 1);
    scanlines[targetStart] = 0;
    pixels.copy(scanlines, targetStart + 1, sourceStart, sourceStart + size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function fillRect(pixels, size, x, y, width, height, color) {
  for (let row = y; row < Math.min(size, y + height); row += 1) {
    for (let column = x; column < Math.min(size, x + width); column += 1) {
      const index = (row * size + column) * 4;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
  }
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createIcns(chunks) {
  const totalLength = 8 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(totalLength, 4);
  return Buffer.concat([header, ...chunks], totalLength);
}

function icnsChunk(type, data) {
  const chunk = Buffer.alloc(8 + data.length);
  chunk.write(type, 0, 4, "ascii");
  chunk.writeUInt32BE(8 + data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
