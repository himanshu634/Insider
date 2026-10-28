/**
 * Normalize and validate one extracted row, in code. A row either becomes an observation (auto, or
 * needs_review with reasons) or is dropped with a note. Nothing the model says is stored unchecked:
 * the evidence must be in the message (CX-06), every number must be in the evidence (CX-07), and the
 * commodity, market and unit are resolved against the dictionaries here.
 */
import { extractNumbers } from '../agent/number-check.js';
import { mapDigits } from '../pipeline/normalize-text.js';
import { type Dictionary, matchTerm, matchUnit, mentions, termKey, type UnitTerm } from './dictionary.js';
import type { ExtractedRow } from './prompt.js';

/** Unit used when the message writes none: Gujarat mandis quote per 20 kg (મણ). */
export const DEFAULT_UNIT = 'per_20kg';
/** Rows under this confidence go to review. */
export const REVIEW_BELOW = 0.8;
/** A field taken from the group's only commodity, or a unit not written: likely right, not read. */
const INFERRED = 0.9;
/** A spelling the dictionary does not know, or a mandi named only in the quoted message: a guess. */
const GUESSED = 0.7;
/** How far back or ahead of the message date a row's date may be before a person checks it. */
const MAX_PAST_DAYS = 7;
const MAX_FUTURE_DAYS = 1;

export interface RowContext {
  dict: Dictionary;
  /** The message text as the model saw it (see packetText). */
  text: string;
  quotedText: string | null;
  /** Commodity slugs the group trades. */
  groupCommodities: string[];
  /** The message's IST date, YYYY-MM-DD. */
  messageDate: string;
}

export interface NormalizedRow {
  commodityId: number;
  marketId: number;
  unitId: number;
  commodity: string;
  market: string;
  unit: string;
  /** False when the message wrote no unit and DEFAULT_UNIT was used. */
  unitWritten: boolean;
  variety: string | null;
  obsDate: string;
  minRaw: number | null;
  maxRaw: number | null;
  modalRaw: number | null;
  minPerQuintal: number | null;
  maxPerQuintal: number | null;
  modalPerQuintal: number | null;
  arrivals: number | null;
  arrivalsUnit: string | null;
  arrivalsQuintal: number | null;
  evidence: string;
  confidence: number;
  /** Why the row needs review; empty when it is stored as auto. */
  reasons: string[];
}

export type RowResult = { ok: true; row: NormalizedRow } | { ok: false; note: string };

const drop = (note: string): RowResult => ({ ok: false, note });
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const contains = (text: string | null, part: string) => !!text && termKey(text).includes(termKey(part));
/** The price_observation.variety column width. */
const VARIETY_MAX = 64;

/** A real calendar date: "2026-02-30" parses in JavaScript (as 2 March) but Postgres rejects it. */
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const perQuintal = (raw: number | null, u: UnitTerm) => (raw === null ? null : raw * u.factor);

export function normalizeRow(r: ExtractedRow, ctx: RowContext): RowResult {
  if (r.kind === 'relative') return drop('relative_row');

  // Evidence: the exact text of the message, compared with whitespace squashed and digits in ASCII.
  const evidence = mapDigits(r.evidence);
  if (!evidence.trim() || !squash(mapDigits(ctx.text)).includes(squash(evidence))) return drop('evidence_not_in_message');
  // Read "480,520" both ways: as two prices, and as one number with a grouping comma ("6,250").
  const numbers = new Set([...extractNumbers(evidence), ...(evidence.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)]);
  for (const n of [r.min_price, r.max_price, r.modal_price, r.arrivals]) {
    if (n !== null && !numbers.has(n)) return drop(`number_not_in_evidence ${n}`);
  }
  if (r.min_price === null && r.max_price === null && r.modal_price === null) return drop('no_price');

  const reasons: string[] = [];
  let confidence = 1;
  const lower = (c: number, reason?: string) => {
    confidence = Math.min(confidence, c);
    if (reason) reasons.push(reason);
  };

  // Commodity: the word as written decides; the model's slug only fills a spelling we do not know.
  const { commodities } = ctx.dict;
  let commodity = r.commodity_term ? matchTerm(commodities, r.commodity_term) : undefined;
  if (r.commodity_term) {
    if (!contains(ctx.text, r.commodity_term) && !contains(ctx.quotedText, r.commodity_term)) {
      return drop(`commodity_term_not_in_text ${r.commodity_term}`);
    }
    if (!commodity) {
      commodity = commodities.find((c) => c.slug === r.commodity);
      if (!commodity) return drop(`unknown_commodity ${r.commodity_term}`);
      lower(GUESSED, `unknown_commodity_term ${r.commodity_term}`);
    }
  } else {
    // The model left the word out: look for a spelling in the row's own text, then in the whole message.
    const inEvidence = commodities.filter((c) => mentions(r.evidence, c));
    const named = inEvidence.length ? inEvidence : commodities.filter((c) => mentions(ctx.text, c));
    const only = ctx.groupCommodities.length === 1 ? ctx.groupCommodities[0] : undefined;
    if (named.length === 1) commodity = named[0];
    else if (named.length === 0 && only) {
      commodity = commodities.find((c) => c.slug === only);
      lower(INFERRED);
    }
    if (!commodity) return drop('ambiguous_commodity');
  }

  // Market: must be named in the message (or, as a guess, in the quoted message). No mandi, no row.
  if (!r.market_term) return drop('no_market');
  const inMessage = contains(ctx.text, r.market_term);
  if (!inMessage && !contains(ctx.quotedText, r.market_term)) return drop(`market_term_not_in_text ${r.market_term}`);
  let market = matchTerm(ctx.dict.markets, r.market_term);
  if (!market) {
    market = ctx.dict.markets.find((m) => m.slug === r.market);
    if (!market) return drop(`unknown_market ${r.market_term}`);
    lower(GUESSED, `unknown_market_term ${r.market_term}`);
  }
  if (!inMessage) lower(GUESSED, 'market_from_quote');

  // Unit: as written, or the default when none is written.
  const written = r.unit_term && contains(ctx.text, r.unit_term) ? r.unit_term : null;
  const unit = written ? matchUnit(ctx.dict.units, written) : ctx.dict.units.find((u) => u.slug === DEFAULT_UNIT);
  if (!unit) return drop(written ? `unknown_unit ${written}` : `default_unit_missing ${DEFAULT_UNIT}`);
  if (!written) lower(INFERRED);

  let obsDate = ctx.messageDate;
  if (r.obs_date && isDate(r.obs_date)) {
    obsDate = r.obs_date;
    if (obsDate > addDays(ctx.messageDate, MAX_FUTURE_DAYS)) reasons.push('future_date');
    if (obsDate < addDays(ctx.messageDate, -MAX_PAST_DAYS)) reasons.push('stale_date');
  }

  // Written max-first: a person decides, the code never swaps (EX-10).
  if (r.min_price !== null && r.max_price !== null && r.min_price > r.max_price) reasons.push('min_gt_max');

  // Arrivals convert only from a known weight unit; bags (guni, boriya) stay unconverted.
  const arrivalsUnit = r.arrivals !== null ? (r.arrivals_unit_term ?? null) : null;
  const arrivalsBy = arrivalsUnit ? matchUnit(ctx.dict.units, arrivalsUnit) : undefined;

  if (confidence < REVIEW_BELOW) reasons.push('low_confidence');
  return {
    ok: true,
    row: {
      commodityId: commodity.id,
      marketId: market.id,
      unitId: unit.id,
      commodity: commodity.slug,
      market: market.slug,
      unit: unit.slug,
      unitWritten: !!written,
      // As written, cut to the column width so a long one cannot fail the save.
      variety: r.variety?.trim().slice(0, VARIETY_MAX) || null,
      obsDate,
      minRaw: r.min_price,
      maxRaw: r.max_price,
      modalRaw: r.modal_price,
      minPerQuintal: perQuintal(r.min_price, unit),
      maxPerQuintal: perQuintal(r.max_price, unit),
      modalPerQuintal: perQuintal(r.modal_price, unit),
      arrivals: r.arrivals,
      arrivalsUnit,
      // A price per 20 kg is ×5 per quintal, so 1 bag of 20 kg is 1/5 quintal.
      arrivalsQuintal: r.arrivals !== null && arrivalsBy ? r.arrivals / arrivalsBy.factor : null,
      evidence: r.evidence,
      confidence,
      reasons,
    },
  };
}

/** The row's price per quintal for the bounds check: the modal, else the middle of the range. */
export function centralPerQuintal(row: Pick<NormalizedRow, 'minPerQuintal' | 'maxPerQuintal' | 'modalPerQuintal'>) {
  if (row.modalPerQuintal !== null) return row.modalPerQuintal;
  const ends = [row.minPerQuintal, row.maxPerQuintal].filter((v): v is number => v !== null);
  return ends.length ? ends.reduce((a, b) => a + b, 0) / ends.length : null;
}
