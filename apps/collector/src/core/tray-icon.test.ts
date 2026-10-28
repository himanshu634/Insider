import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { markPartAt } from './mark.js';
import { appIconPng, trayIconPng } from './tray-icon.js';

/** Decode an unfiltered RGBA PNG from encodePng into a pixel reader. */
function pixels(png: Buffer) {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const idatStart = png.indexOf('IDAT') + 4;
  const idatLen = png.readUInt32BE(idatStart - 8);
  const raw = inflateSync(png.subarray(idatStart, idatStart + idatLen));
  expect(raw.length).toBe(height * (width * 4 + 1));
  const at = (x: number, y: number) => {
    const o = y * (width * 4 + 1) + 1 + x * 4;
    return [raw[o], raw[o + 1], raw[o + 2], raw[o + 3]];
  };
  return { width, height, at };
}

describe('markPartAt', () => {
  it('finds each part of the mark on its centre line and nothing outside it', () => {
    expect(markPartAt(8, 16)).toBe('chatter');
    expect(markPartAt(24, 32)).toBe('chatter');
    expect(markPartAt(25, 48)).toBe('line');
    expect(markPartAt(52, 48)).toBe('point');
    expect(markPartAt(32, 58)).toBeNull();
    expect(markPartAt(0, 0)).toBeNull();
  });
});

describe('trayIconPng', () => {
  it('is a 32×32 template: transparent corners, solid line and point, half-alpha chatter', () => {
    const { width, height, at } = pixels(trayIconPng(32));
    expect([width, height]).toEqual([32, 32]);
    expect(at(0, 0)[3]).toBe(0);
    expect(at(12, 24)[3]).toBe(255); // line
    expect(at(26, 24)[3]).toBe(255); // point
    const chatter = at(12, 16)[3]!; // second wave row
    expect(chatter).toBeGreaterThan(60);
    expect(chatter).toBeLessThan(160);
  });
});

describe('appIconPng', () => {
  it('draws the mark on a field-green tile with transparent macOS-grid margins', () => {
    const { at } = pixels(appIconPng(64));
    expect(at(1, 1)[3]).toBe(0);
    expect(at(32, 10)).toEqual([0x1f, 0x5c, 0x3f, 255]); // tile above the mark
  });

  it('is full bleed with no inset', () => {
    const { at } = pixels(appIconPng(64, 0, 0));
    expect(at(0, 0)).toEqual([0x1f, 0x5c, 0x3f, 255]);
  });
});
