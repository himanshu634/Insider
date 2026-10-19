import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { trayIconPng } from './tray-icon.js';

describe('trayIconPng', () => {
  it('is a valid 32×32 RGBA PNG with transparent corners and an opaque ring', () => {
    const png = trayIconPng(32);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);

    const idatStart = png.indexOf('IDAT') + 4;
    const idatLen = png.readUInt32BE(idatStart - 8);
    const raw = inflateSync(png.subarray(idatStart, idatStart + idatLen));
    expect(raw.length).toBe(32 * (32 * 4 + 1));
    const alpha = (x: number, y: number) => raw[y * (32 * 4 + 1) + 1 + x * 4 + 3];
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(16, 16)).toBe(255); // centre dot
    expect(alpha(16, 3)).toBe(255); // ring
  });
});
