import { deflateSync } from 'node:zlib';
import { markPartAt, rasterize, type Rgba } from './mark.js';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode straight RGBA pixels as a PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Menu-bar template icon: the Insider mark on transparent. Only alpha matters for a template
 * image (macOS tints it for light and dark bars), so the chatter is drawn at about half alpha
 * to keep the settled line and point reading first. Default 32 px = 16 pt at @2x.
 */
export function trayIconPng(size = 32): Buffer {
  const rgba = rasterize(size, 4, (x, y) => {
    const part = markPartAt(x * 64, y * 64);
    if (!part) return null;
    return part === 'chatter' ? [0, 0, 0, 140] : [0, 0, 0, 255];
  });
  return encodePng(size, size, rgba);
}

const TILE: Rgba = [0x1f, 0x5c, 0x3f, 255];
const COLOURS = {
  chatter: [0x8f, 0xb0, 0x9c, 255],
  line: [0xf7, 0xf4, 0xec, 255],
  point: [0xd9, 0x9a, 0x1e, 255],
} satisfies Record<string, Rgba>;

function inRoundedSquare(x: number, y: number, inset: number, radius: number): boolean {
  const lo = inset + radius;
  const hi = 1 - inset - radius;
  const dx = Math.max(lo - x, 0, x - hi);
  const dy = Math.max(lo - y, 0, y - hi);
  return x >= inset && x <= 1 - inset && y >= inset && y <= 1 - inset && Math.hypot(dx, dy) <= radius;
}

/**
 * App icon: the mark on the field-green brand tile (same colours as the web Logo tile).
 * `inset` and `radius` are fractions of the image; the defaults follow the macOS icon grid
 * (an 824 px tile in a 1024 px canvas). Pass 0, 0 for a full-bleed square that iOS masks itself.
 */
export function appIconPng(size = 1024, inset = 100 / 1024, radius = 185 / 1024): Buffer {
  const markScale = 0.65 * (1 - 2 * inset);
  const markOrigin = (1 - markScale) / 2;
  const rgba = rasterize(size, size > 256 ? 2 : 4, (x, y) => {
    if (!inRoundedSquare(x, y, inset, radius)) return null;
    const part = markPartAt(((x - markOrigin) / markScale) * 64, ((y - markOrigin) / markScale) * 64);
    return part ? COLOURS[part] : TILE;
  });
  return encodePng(size, size, rgba);
}
