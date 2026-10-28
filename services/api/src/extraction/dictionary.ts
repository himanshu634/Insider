/**
 * The commodity, market and unit dictionaries, loaded once per message, and term matching against them.
 * Code, not the model, decides what a word in a message refers to: the model's slug is accepted only when
 * the word it read is in the message, and a slug whose word is not a known spelling counts as a guess.
 */
import type { Db } from '../db/client.js';
import { commodity, market, unit } from '../db/schema.js';
import { normalizeDigits } from '../pipeline/normalize-text.js';

export interface Term {
  id: number;
  slug: string;
  name: string;
  /** The slug, the name and every synonym or alias, as matching keys. */
  keys: string[];
}

export interface UnitTerm extends Term {
  /** Multiply a price in this unit by this to get ₹/quintal. */
  factor: number;
}

export interface Dictionary {
  commodities: Term[];
  markets: Term[];
  units: UnitTerm[];
}

/** A matching key: NFC, ASCII digits, lower case, single spaces. */
export const termKey = (s: string) => normalizeDigits(s.normalize('NFC')).toLowerCase().replace(/\s+/g, ' ').trim();

const keysOf = (slug: string, name: string, more: string[]) => [...new Set([slug, name, ...more].map(termKey))];

export async function loadDictionary(db: Db): Promise<Dictionary> {
  const [commodities, markets, units] = await Promise.all([
    db.select().from(commodity).orderBy(commodity.slug),
    db.select().from(market).orderBy(market.slug),
    db.select().from(unit).orderBy(unit.code),
  ]);
  return {
    commodities: commodities.map((c) => ({ id: c.id, slug: c.slug, name: c.name, keys: keysOf(c.slug, c.name, c.synonyms) })),
    markets: markets.map((m) => ({ id: m.id, slug: m.slug, name: m.name, keys: keysOf(m.slug, m.name, m.aliases) })),
    units: units.map((u) => ({
      id: u.id,
      slug: u.code,
      name: u.label,
      keys: keysOf(u.code, u.label, u.aliases).map(unitKey),
      factor: u.factorToQuintal,
    })),
  };
}

/** The entry one of whose spellings is exactly `term`. */
export function matchTerm<T extends Term>(entries: readonly T[], term: string): T | undefined {
  const key = termKey(term);
  return entries.find((e) => e.keys.includes(key));
}

const LATIN = /^[a-z0-9 ]+$/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether `text` contains one of the entry's spellings. Latin spellings must stand as whole words ("sing" is
 * not in "using"); Gujarati and Devanagari spellings match anywhere, because suffixes attach to the word.
 */
export function mentions(text: string, entry: Term): boolean {
  const haystack = termKey(text);
  return entry.keys.some((k) =>
    LATIN.test(k) ? new RegExp(`(?<![a-z0-9])${escape(k)}(?![a-z0-9])`).test(haystack) : haystack.includes(k),
  );
}

/** Unit spellings compare without spaces or a leading "per", "/" or "₹": "per 20 kg" is "20kg". */
const unitKey = (s: string) =>
  termKey(s)
    .replace(/^(?:₹|rs\.?|rupees?)\s*/, '')
    .replace(/^(?:per|\/)\s*/, '')
    .replace(/\s+/g, '');

export function matchUnit(units: readonly UnitTerm[], term: string): UnitTerm | undefined {
  const key = unitKey(term);
  return units.find((u) => u.keys.includes(key));
}
