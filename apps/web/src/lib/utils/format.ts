/**
 * Number and money formatting with Indian digit grouping (1,23,456) and
 * lakh / crore short forms. Built on `Intl.NumberFormat('en-IN')` for the
 * grouping, with the ₹ sign added by hand so output is stable across runtimes.
 */

export const EMPTY = '—';
const LAKH = 1_00_000;
const CRORE = 1_00_00_000;

const groupers = new Map<number, Intl.NumberFormat>();

function grouper(decimals: number): Intl.NumberFormat {
	let f = groupers.get(decimals);
	if (!f) {
		f = new Intl.NumberFormat('en-IN', {
			minimumFractionDigits: 0,
			maximumFractionDigits: decimals
		});
		groupers.set(decimals, f);
	}
	return f;
}

/** 123456 → "1,23,456". Missing values render as an em dash. */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
	if (value == null || !Number.isFinite(value)) return EMPTY;
	return grouper(decimals).format(value);
}

/** 123456 → "₹1,23,456"; -45 → "-₹45". */
export function formatRupees(value: number | null | undefined, decimals = 0): string {
	if (value == null || !Number.isFinite(value)) return EMPTY;
	const sign = value < 0 ? '-' : '';
	return `${sign}₹${grouper(decimals).format(Math.abs(value))}`;
}

/**
 * Short form for large amounts: 1,50,000 → "₹1.5 L", 2,30,00,000 → "₹2.3 Cr".
 * Values under one lakh are shown in full.
 */
export function formatRupeesShort(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) return EMPTY;
	const abs = Math.abs(value);
	const sign = value < 0 ? '-' : '';
	if (abs >= CRORE) return `${sign}₹${grouper(2).format(abs / CRORE)} Cr`;
	if (abs >= LAKH) return `${sign}₹${grouper(2).format(abs / LAKH)} L`;
	return formatRupees(value);
}

/** Signed change for price deltas: +120 → "+₹120", -45 → "-₹45", 0 → "₹0". */
export function formatRupeeChange(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) return EMPTY;
	return value > 0 ? `+${formatRupees(value)}` : formatRupees(value);
}

/** Direction of a change, for colouring. */
export function changeDirection(value: number | null | undefined): 'up' | 'down' | 'flat' {
	if (value == null || !Number.isFinite(value) || value === 0) return 'flat';
	return value > 0 ? 'up' : 'down';
}

/** 0.873 → "87%". */
export function formatPercent(fraction: number | null | undefined): string {
	if (fraction == null || !Number.isFinite(fraction)) return EMPTY;
	return `${Math.round(fraction * 100)}%`;
}

/** "groundnut-bold" → "Groundnut bold". For slugs shown before a dictionary name is known. */
export function humanizeSlug(slug: string): string {
	const words = slug.replace(/[-_]+/g, ' ').trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}
