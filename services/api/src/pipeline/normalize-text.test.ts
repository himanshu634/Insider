import { describe, expect, it } from 'vitest';

import { contentHash, normalizeForHash } from './normalize-text.js';

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
