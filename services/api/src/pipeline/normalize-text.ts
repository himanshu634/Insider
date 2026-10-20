import { createHash } from 'node:crypto';

const FORWARDED = /^\s*(forwarded( many times)?|fwd:?)\s*/i;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+/gu;
const SPACE = /\s+/g;

/** Strip whitespace, emoji and "Forwarded" headers so forwards of one post hash alike. */
export function normalizeForHash(text: string): string {
  return text.normalize('NFC').replace(FORWARDED, '').replace(EMOJI, '').replace(SPACE, ' ').trim().toLowerCase();
}

const GUJARATI_DIGIT = /[૦-૯]/g;
const DEVANAGARI_DIGIT = /[०-९]/g;
// A grouping comma follows a digit and precedes a 3-digit group that no digit follows, with optional
// 2-digit groups between: "6,250", "1,000,000" and "1,00,000". The comma of a list like "6250,6450"
// precedes a 4-digit number, so it stays. Known limitation: a list item of exactly 3 digits after a
// comma still merges with the number before it ("[120,150]" becomes "[120150]"). Callers must put
// whitespace after the commas of a list.
const GROUPING_COMMA = /(?<=\d),(?=(?:\d{2},)*\d{3}(?!\d))/g;

/** Map Gujarati and Devanagari digits to ASCII and drop digit-grouping commas ("૬,૨૫૦" becomes "6250"). */
export function normalizeDigits(text: string): string {
  return text
    .replace(GUJARATI_DIGIT, (digit) => String(digit.charCodeAt(0) - 0x0ae6))
    .replace(DEVANAGARI_DIGIT, (digit) => String(digit.charCodeAt(0) - 0x0966))
    .replace(GROUPING_COMMA, '');
}

export function contentHash(text: string | null | undefined): string | null {
  if (!text) return null;
  const normalized = normalizeForHash(text);
  return normalized ? createHash('sha256').update(normalized).digest('hex') : null;
}
