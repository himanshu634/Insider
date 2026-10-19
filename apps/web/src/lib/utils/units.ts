/**
 * Price unit helpers. Every price in the app is shown in ₹ per quintal (100 kg).
 *
 * The factors mirror the `unit` dictionary seeded by the API (`factor_to_quintal`):
 * multiply a price quoted in that unit by the factor to get ₹/quintal.
 */
export const UNIT_FACTORS = {
	per_quintal: 1,
	per_20kg: 5,
	per_kg: 100
} as const satisfies Record<string, number>;

export type UnitCode = keyof typeof UNIT_FACTORS;

/** Short human labels for the known unit codes. */
export const UNIT_LABELS: Record<UnitCode, string> = {
	per_quintal: '₹/quintal',
	per_20kg: '₹/20 kg',
	per_kg: '₹/kg'
};

export function isUnitCode(code: string): code is UnitCode {
	return Object.hasOwn(UNIT_FACTORS, code);
}

/**
 * Convert a price quoted in `unitCode` to ₹/quintal.
 * Returns `null` for a missing value or an unknown unit (never guess a factor).
 */
export function toPerQuintal(
	value: number | null | undefined,
	unitCode: string,
	factors: Record<string, number> = UNIT_FACTORS
): number | null {
	if (value == null || !Number.isFinite(value)) return null;
	const factor = Object.hasOwn(factors, unitCode) ? factors[unitCode] : undefined;
	if (factor == null) return null;
	return value * factor;
}

/** Label for a unit code; falls back to the raw code for units the app does not know yet. */
export function unitLabel(code: string): string {
	return isUnitCode(code) ? UNIT_LABELS[code] : code;
}

// Money formatting lives in format.ts; re-exported here so price helpers sit in one import.
export { formatRupees, formatRupeesShort } from './format.js';
