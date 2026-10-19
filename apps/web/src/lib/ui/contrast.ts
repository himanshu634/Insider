/** WCAG 2.1 contrast helpers, used by the /design style guide. */

/** Parse #rgb / #rrggbb into [r, g, b] (0–255); null for anything else. */
export function parseHex(value: string): [number, number, number] | null {
	const hex = value.trim().replace(/^#/, '');
	const full =
		hex.length === 3
			? hex
					.split('')
					.map((c) => c + c)
					.join('')
			: hex;
	if (!/^[0-9a-f]{6}$/i.test(full)) return null;
	return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

export function relativeLuminance([r, g, b]: [number, number, number]): number {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio between two hex colours (1–21), or null if either is not a hex colour. */
export function contrastRatio(a: string, b: string): number | null {
	const ca = parseHex(a);
	const cb = parseHex(b);
	if (!ca || !cb) return null;
	const [hi, lo] = [relativeLuminance(ca), relativeLuminance(cb)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** WCAG rating for normal-size text. */
export function wcagRating(ratio: number | null): 'AAA' | 'AA' | 'AA large' | 'Fail' | '—' {
	if (ratio == null) return '—';
	if (ratio >= 7) return 'AAA';
	if (ratio >= 4.5) return 'AA';
	if (ratio >= 3) return 'AA large';
	return 'Fail';
}
