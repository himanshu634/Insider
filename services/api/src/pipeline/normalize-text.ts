import { createHash } from 'node:crypto';

const FORWARDED = /^\s*(forwarded( many times)?|fwd:?)\s*/i;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+/gu;
const SPACE = /\s+/g;

/** Strip whitespace, emoji and "Forwarded" headers so forwards of one post hash alike. */
export function normalizeForHash(text: string): string {
  return text.normalize('NFC').replace(FORWARDED, '').replace(EMOJI, '').replace(SPACE, ' ').trim().toLowerCase();
}

export function contentHash(text: string | null | undefined): string | null {
  if (!text) return null;
  const normalized = normalizeForHash(text);
  return normalized ? createHash('sha256').update(normalized).digest('hex') : null;
}
