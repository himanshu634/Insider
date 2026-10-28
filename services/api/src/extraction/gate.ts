/**
 * The rule gate before any model call. Only text messages go on (images and documents wait for the vision
 * step). A text with no digits and no commodity or mandi spelling is noise, decided by rule.
 */
import type { waMessage } from '../db/schema.js';
import { normalizeDigits } from '../pipeline/normalize-text.js';
import { type Dictionary, mentions } from './dictionary.js';

export const GATE_VERSION = 'rule:v1';

export type GateVerdict = 'skip' | 'noise' | 'candidate';

export function gate(message: Pick<typeof waMessage.$inferSelect, 'type' | 'text'>, dict: Dictionary): GateVerdict {
  if (message.type !== 'text' || !message.text?.trim()) return 'skip';
  const hasDigit = /\d/.test(normalizeDigits(message.text));
  const hasTerm = [...dict.commodities, ...dict.markets].some((t) => mentions(message.text!, t));
  return hasDigit || hasTerm ? 'candidate' : 'noise';
}
