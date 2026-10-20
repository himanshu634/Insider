import { describe, expect, it } from 'vitest';

import { contentHash, normalizeDigits, normalizeForHash } from './normalize-text.js';

describe('content hash', () => {
  it('hashes forwards and emoji variants alike', () => {
    expect(contentHash('Forwarded\nએરંડા 1250 🌱')).toBe(contentHash('એરંડા   1250'));
  });
  it('has no hash for empty or emoji-only text', () => {
    expect(contentHash(null)).toBeNull();
    expect(contentHash('🙏🙏')).toBeNull();
  });
  it('lowercases and collapses whitespace', () => {
    expect(normalizeForHash('  Castor\n\n RATE ')).toBe('castor rate');
  });
});

describe('normalizeDigits', () => {
  it('maps Gujarati and Devanagari digits to ASCII', () => {
    expect(normalizeDigits('એરંડા ૧૨૫૦-૧૨૯૦')).toBe('એરંડા 1250-1290');
    expect(normalizeDigits('₹6,250 and १००')).toBe('₹6250 and 100');
  });
  it('removes commas between digits, in any grouping and in any script', () => {
    expect(normalizeDigits('1,00,000')).toBe('100000');
    expect(normalizeDigits('₹૬,૨૫૦')).toBe('₹6250');
  });
  it('keeps commas that are not between two digits', () => {
    expect(normalizeDigits('Rajkot, 1250, up 20')).toBe('Rajkot, 1250, up 20');
  });
  it('keeps commas between digits that are a list, not grouping', () => {
    expect(normalizeDigits('[6250,6450]')).toBe('[6250,6450]');
    expect(normalizeDigits('6250,6450,7000')).toBe('6250,6450,7000');
  });
  it('removes the commas of western and Indian grouping alike', () => {
    expect(normalizeDigits('1,000,000')).toBe('1000000');
    expect(normalizeDigits('12,34,567')).toBe('1234567');
  });
  it('known limitation: a list item that looks like grouping is merged', () => {
    expect(normalizeDigits('[3,450]')).toBe('[3450]');
  });
});
