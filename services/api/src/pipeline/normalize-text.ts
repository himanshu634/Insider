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
const COMMA_BETWEEN_DIGITS = /(?<=\d),(?=\d)/g;

/** Map Gujarati and Devanagari digits to ASCII and drop commas between digits ("૬,૨૫૦" becomes "6250"). */
export function normalizeDigits(text: string): string {
  return text
    .replace(GUJARATI_DIGIT, (digit) => String(digit.charCodeAt(0) - 0x0ae6))
    .replace(DEVANAGARI_DIGIT, (digit) => String(digit.charCodeAt(0) - 0x0966))
    .replace(COMMA_BETWEEN_DIGITS, '');
}

export function contentHash(text: string | null | undefined): string | null {
  if (!text) return null;
  const normalized = normalizeForHash(text);
  return normalized ? createHash('sha256').update(normalized).digest('hex') : null;
}
