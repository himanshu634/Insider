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
