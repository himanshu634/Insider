/**
 * Masks contact details in message text before a model sees it (SF-03). The stored text and the web feed keep
 * the raw text; only what the agents send to an LLM is masked.
 */

// ASCII, Gujarati and Devanagari digits. JS `\d` is ASCII only, and the number check reads all three.
const DIGIT = String.raw`[0-9૦-૯०-९]`;
const MOBILE_FIRST = String.raw`[6-9૬-૯६-९]`;
const ZERO = String.raw`[0૦०]`;
const NINE_ONE = String.raw`[9૯९][1૧१]`;
// Horizontal separators only, so that numbers on two lines never join.
const SEP = String.raw`[   –-]`;

/**
 * An Indian mobile number: 10 digits from 6 to 9, after an optional +91, 0091, 91 or 0. A separator is allowed only
 * after the prefix and at the 5+5 split ("98765 43210"), so lists of prices ("6250 6300 6350") stay intact.
 * A 5-digit price range from 60000 ("60500-61500") has the same shape and is masked too: a lost price fails closed
 * in the number check, a leaked phone number does not.
 */
const PHONE = new RegExp(
  `(?<!${DIGIT})(?:(?:(?:\\+|${ZERO}{2})?${NINE_ONE}|${ZERO})${SEP}?)?${MOBILE_FIRST}${DIGIT}{4}${SEP}?${DIGIT}{5}(?!${DIGIT})`,
  'gu',
);

/**
 * A WhatsApp mention, stored as "@" and the member's full number or linked id: 10 digits or more. Traders write
 * "@6250" for "at ₹6250", so shorter runs are prices and stay.
 */
const MENTION = new RegExp(`@${DIGIT}{10,}`, 'gu');

/** The text with phone numbers as "[phone]" and member mentions as "@[member]". */
export function scrubContacts(text: string): string {
  // Mentions first, so that "@919876543210" becomes "@[member]" and not "@[phone]".
  return text.replace(MENTION, '@[member]').replace(PHONE, '[phone]');
}
