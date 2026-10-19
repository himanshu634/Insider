import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex, wcagRating } from './contrast.js';

describe('contrast', () => {
	it('parses short and long hex', () => {
		expect(parseHex('#fff')).toEqual([255, 255, 255]);
		expect(parseHex('#1F5C3F')).toEqual([31, 92, 63]);
		expect(parseHex('rgb(0 0 0)')).toBeNull();
	});

	it('computes WCAG ratios', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
		expect(contrastRatio('#ffffff', 'nope')).toBeNull();
	});

	it('keeps the Mandi Ledger text roles at AA or better', () => {
		// Light theme: ink, ink-muted, primary on surface and paper.
		for (const fg of ['#1f2a24', '#566057', '#1f5c3f', '#1d7342', '#b03a28', '#8a5a00']) {
			expect(contrastRatio(fg, '#ffffff')!).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(fg, '#f7f4ec')!).toBeGreaterThanOrEqual(4.5);
		}
		// Dark theme on surface.
		for (const fg of ['#e7ede8', '#a2b0a6', '#74c79a', '#72d193', '#f38e7c', '#ebc567']) {
			expect(contrastRatio(fg, '#151f1a')!).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('rates ratios', () => {
		expect(wcagRating(8)).toBe('AAA');
		expect(wcagRating(5)).toBe('AA');
		expect(wcagRating(3.2)).toBe('AA large');
		expect(wcagRating(2)).toBe('Fail');
		expect(wcagRating(null)).toBe('—');
	});
});
