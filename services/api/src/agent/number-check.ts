import { normalizeDigits } from '../pipeline/normalize-text.js';

/** Numbers below this (counts, days, horizons) are not price-sized and are not checked. */
export const CHECKED_MIN = 100;

const NUMBER = /\d+(?:\.\d+)?/g;

/** Every unsigned integer or decimal in the text, so "1250-1290" gives two numbers. */
export function extractNumbers(text: string): number[] {
  return (normalizeDigits(text).match(NUMBER) ?? []).map(Number);
}

/**
 * The numbers of `answer` (at least CHECKED_MIN) that no evidence supports, each once, in the order
 * first seen. An answer number `a` is supported by an evidence number `e` when `e === a` or
 * `Math.round(e) === a`.
 *
 * Evidence must separate list items with whitespace or newlines (for example `JSON.stringify(x, null, 1)`),
 * because grouping-comma removal merges a list item of exactly 3 digits ("[120,150]" becomes "[120150]").
 * Commas are deliberately not re-spaced inside this function, because grouping commas in message text
 * ("₹6,250") must keep working.
 */
export function uncheckedNumbers(answer: string, evidence: readonly string[]): number[] {
  const supported = new Set<number>();
  for (const e of extractNumbers(evidence.join('\n'))) {
    supported.add(e);
    supported.add(Math.round(e));
  }
  const unchecked = extractNumbers(answer).filter((a) => a >= CHECKED_MIN && !supported.has(a));
  return [...new Set(unchecked)];
}
